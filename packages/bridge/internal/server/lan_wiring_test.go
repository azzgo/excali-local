package server

import (
	"context"
	"testing"

	"github.com/excali-local/excali-bridge/internal/config"
	"github.com/excali-local/excali-bridge/internal/contract"
)

// The LAN listener switch governs who may connect *in*, never whether this
// machine may send *out*: a sender that never opens a listener must still be
// able to offer a canvas, so peering is built with the server, not with the
// listener.
func TestSendingDoesNotRequireTheLANListener(t *testing.T) {
	isolateConfig(t)
	s := startServer(t)

	if s.peering == nil {
		t.Fatal("peering is nil on a daemon that never opened its LAN listener")
	}
	if port := s.LANPort(); port != 0 {
		t.Fatalf("LANPort = %d, want 0 with the listener closed", port)
	}
	if status := s.lanStatus(); status["lan"] != string(config.LANUnset) {
		t.Fatalf("lan = %v, want unset", status["lan"])
	}
}

func TestStartLANStaysClosedWhenTheSwitchIsOff(t *testing.T) {
	isolateConfig(t)
	s := startServer(t)

	if err := s.StartLAN(context.Background()); err != nil {
		t.Fatalf("StartLAN: %v", err)
	}
	if port := s.LANPort(); port != 0 {
		t.Fatalf("LANPort = %d, want 0 when the switch is off", port)
	}
}

func TestStartLANOpensTheListenerWhenTheSwitchIsOn(t *testing.T) {
	isolateConfig(t)
	if err := config.SetLAN(config.LANOn); err != nil {
		t.Fatalf("SetLAN: %v", err)
	}
	s := startServer(t)

	if err := s.StartLAN(context.Background()); err != nil {
		t.Fatalf("StartLAN: %v", err)
	}
	port := s.LANPort()
	if port == 0 {
		t.Fatal("LANPort = 0 after StartLAN with the switch on")
	}
	t.Cleanup(func() {
		if srv := s.lanSrv.Load(); srv != nil {
			_ = srv.Close()
		}
	})

	status := s.lanStatus()
	if status["lan"] != string(config.LANOn) {
		t.Fatalf("lan = %v, want on", status["lan"])
	}
	if status["lanPort"] != port {
		t.Fatalf("lanPort = %v, want %d", status["lanPort"], port)
	}
}

func TestHealthAndStatusReportLANState(t *testing.T) {
	isolateConfig(t)
	s := startServer(t)

	health := s.healthPayload()
	if health["lan"] != string(config.LANUnset) {
		t.Fatalf("health lan = %v, want unset", health["lan"])
	}
	if health["lanPort"] != 0 {
		t.Fatalf("health lanPort = %v, want 0", health["lanPort"])
	}

	status := s.bridgeStatus()
	if _, ok := status["lan"]; !ok {
		t.Fatal("bridge.status has no lan field")
	}
	if _, ok := status["lanPort"]; !ok {
		t.Fatal("bridge.status has no lanPort field")
	}
}

func TestTransferOfferNeedsAnActivatedCanvas(t *testing.T) {
	isolateConfig(t)
	s := startServer(t)
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatalf("dialAgent: %v", err)
	}

	sendRPC(t, agent, 7, "peers.transferOffer", map[string]string{"address": "192.0.2.1:1"})
	reply := rpcReply(t, agent, 7)

	errObj, ok := reply["error"].(map[string]any)
	if !ok {
		t.Fatalf("reply = %v, want an error (no active canvas)", reply)
	}
	code, _ := errObj["code"].(float64)
	if int(code) != contract.JSONRPCErrorNoActiveCanvas {
		t.Fatalf("code = %v, want %d", code, contract.JSONRPCErrorNoActiveCanvas)
	}
}

func TestLANSenderIgnoresTheSwitchOnTheSendingSide(t *testing.T) {
	isolateConfig(t)
	if err := config.SetLAN(config.LANOff); err != nil {
		t.Fatalf("SetLAN: %v", err)
	}
	s := startServer(t)

	if s.peering == nil {
		t.Fatal("peering must exist even with the switch explicitly off")
	}
	if port := s.LANPort(); port != 0 {
		t.Fatalf("LANPort = %d, want 0", port)
	}
}

// isolateConfig points the daemon's config and state at temp directories so a
// test never reads or writes the developer's real switch.
func isolateConfig(t *testing.T) {
	t.Helper()
	t.Setenv("EXCALI_BRIDGE_CONFIG_DIR", t.TempDir())
	t.Setenv("EXCALI_BRIDGE_STATE_DIR", t.TempDir())
}
