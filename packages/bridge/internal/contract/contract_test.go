package contract

import "testing"

func TestIsValidBridgeToken(t *testing.T) {
	valid := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" // 64 hex
	short := "deadbeef"
	badChars := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeG"
	empty := ""

	cases := []struct {
		name  string
		token string
		want  bool
	}{
		{"64-hex chars", valid, true},
		{"short token", short, false},
		{"non-hex char", badChars, false},
		{"empty", empty, false},
	}
	for _, tc := range cases {
		if got := IsValidBridgeToken(tc.token); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

// TestBridgeStopMirror locks the 045 wire additions to the TS source of
// truth (packages/shared/src/agent-bridge.ts): the two constants and
// the DaemonLocalMethods map entry must match exactly.
func TestBridgeStopMirror(t *testing.T) {
	if BridgeStopMethod != "bridge.stop" {
		t.Errorf("BridgeStopMethod = %q, want \"bridge.stop\"", BridgeStopMethod)
	}
	if JSONRPCErrorRequiresActivePage != -32007 {
		t.Errorf("JSONRPCErrorRequiresActivePage = %d, want -32007", JSONRPCErrorRequiresActivePage)
	}
	if !DaemonLocalMethods["bridge.stop"] {
		t.Error("DaemonLocalMethods[\"bridge.stop\"] is false")
	}
}

// TestPeeringMirror locks the Peering / LAN / autostart wire additions to the
// TS source of truth (packages/shared/src/agent-bridge.ts): the method sets,
// the numbers, the mDNS service, the error codes and the daemon-local routing
// must match exactly.
func TestPeeringMirror(t *testing.T) {
	wantPeering := []string{
		"peers.list",
		"peers.transferOffer",
		"peers.transferStatus",
		"peers.transferRespond",
	}
	if len(PeeringMethods) != len(wantPeering) {
		t.Fatalf("PeeringMethods = %v, want %v", PeeringMethods, wantPeering)
	}
	for i, m := range wantPeering {
		if PeeringMethods[i] != m {
			t.Errorf("PeeringMethods[%d] = %q, want %q", i, PeeringMethods[i], m)
		}
		if !IsPeeringMethod(m) {
			t.Errorf("IsPeeringMethod(%q) = false", m)
		}
		if !DaemonLocalMethods[m] {
			t.Errorf("DaemonLocalMethods[%q] = false", m)
		}
	}
	if IsPeeringMethod("peers.unknown") {
		t.Error("IsPeeringMethod(\"peers.unknown\") = true")
	}

	wantLAN := []string{"lan.status", "lan.on", "lan.off"}
	for _, m := range wantLAN {
		if !DaemonLocalMethods[m] {
			t.Errorf("DaemonLocalMethods[%q] = false", m)
		}
	}

	wantAutostart := []string{"autostart.status", "autostart.on", "autostart.off"}
	for _, m := range wantAutostart {
		if !DaemonLocalMethods[m] {
			t.Errorf("DaemonLocalMethods[%q] = false", m)
		}
	}

	if TransferChunkBytes != 200*1024 {
		t.Errorf("TransferChunkBytes = %d, want %d", TransferChunkBytes, 200*1024)
	}
	if TransferSceneMaxBytes != 64*1024*1024 {
		t.Errorf("TransferSceneMaxBytes = %d, want %d", TransferSceneMaxBytes, 64*1024*1024)
	}
	if TransferOfferTTLms != 60_000 {
		t.Errorf("TransferOfferTTLms = %d, want 60000", TransferOfferTTLms)
	}
	if PeeringProtocolVersion != "1" {
		t.Errorf("PeeringProtocolVersion = %q, want \"1\"", PeeringProtocolVersion)
	}
	if LANMDNSService != "_excali-bridge._tcp" {
		t.Errorf("LANMDNSService = %q, want \"_excali-bridge._tcp\"", LANMDNSService)
	}

	codes := map[string]int{
		"JSONRPCErrorOfferExpired":    JSONRPCErrorOfferExpired,
		"JSONRPCErrorInvalidToken":    JSONRPCErrorInvalidToken,
		"JSONRPCErrorSceneTooLarge":   JSONRPCErrorSceneTooLarge,
		"JSONRPCErrorPeerUnreachable": JSONRPCErrorPeerUnreachable,
	}
	wantCodes := map[string]int{
		"JSONRPCErrorOfferExpired":    -32008,
		"JSONRPCErrorInvalidToken":    -32009,
		"JSONRPCErrorSceneTooLarge":   -32010,
		"JSONRPCErrorPeerUnreachable": -32011,
	}
	for name, got := range codes {
		if got != wantCodes[name] {
			t.Errorf("%s = %d, want %d", name, got, wantCodes[name])
		}
	}
}

// TestAllMethodsCoversPeering asserts the peering / LAN / autostart methods
// reach commands.list (AllMethods is the reported inventory).
func TestAllMethodsCoversPeering(t *testing.T) {
	all := AllMethods()
	for _, m := range []string{
		"peers.list",
		"peers.transferOffer",
		"peers.transferStatus",
		"peers.transferRespond",
		"lan.status",
		"lan.on",
		"lan.off",
		"autostart.status",
		"autostart.on",
		"autostart.off",
	} {
		found := false
		for _, got := range all {
			if got == m {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("AllMethods() missing %q", m)
		}
	}
}
