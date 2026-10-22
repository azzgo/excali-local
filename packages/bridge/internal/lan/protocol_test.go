package lan

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

type offerHandler struct {
	mu       sync.Mutex
	replies  map[string]Reply
	fallback Reply
	failWith error
	calls    int
	peers    []string
}

func (h *offerHandler) HandleTransfer(_ context.Context, peer Peer, msg Message) (Reply, error) {
	h.mu.Lock()
	h.calls++
	h.peers = append(h.peers, peer.Address)
	failWith := h.failWith
	h.mu.Unlock()

	if failWith != nil {
		return Reply{}, failWith
	}

	var offer struct {
		TransferID string `json:"transferId"`
	}
	_ = msg.Decode(&offer)

	h.mu.Lock()
	defer h.mu.Unlock()
	if reply, ok := h.replies[offer.TransferID]; ok {
		return reply, nil
	}
	return h.fallback, nil
}

func (h *offerHandler) callCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.calls
}

func (h *offerHandler) peerAddresses() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.peers...)
}

func TestTransferFrameIsAnsweredByTheHandler(t *testing.T) {
	handler := &offerHandler{
		fallback: Reply{Type: TypeAccept, Fields: map[string]any{"transferId": "t1", "token": "tok"}},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t1", "alias": "studio-mac", "elementCount": 12})

	reply := p.receive(t, 5*time.Second)
	if reply["type"] != TypeAccept {
		t.Fatalf("reply = %v, want %s", reply, TypeAccept)
	}
	if reply["token"] != "tok" || reply["transferId"] != "t1" {
		t.Fatalf("reply = %v, want the accept fields", reply)
	}
	if handler.callCount() != 1 {
		t.Fatalf("handler calls = %d, want 1", handler.callCount())
	}
}

func TestNonTransferFrameIsRejectedWithAnErrorFrame(t *testing.T) {
	handler := &offerHandler{
		fallback: Reply{Type: TypeAccept, Fields: map[string]any{"transferId": "t1", "token": "tok"}},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": "rpc.call", "id": 1, "method": "ping"})

	reply := p.receive(t, 5*time.Second)
	if reply["type"] != TypeError {
		t.Fatalf("reply = %v, want %s", reply, TypeError)
	}
	if reply["code"] != CodeUnsupportedType {
		t.Fatalf("code = %v, want %s", reply["code"], CodeUnsupportedType)
	}
	if message, _ := reply["message"].(string); !strings.Contains(message, "rpc.call") {
		t.Fatalf("message = %v, want it to name the refused type", reply["message"])
	}
	if handler.callCount() != 0 {
		t.Fatalf("the handler must not see a non-transfer frame, calls = %d", handler.callCount())
	}

	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t1"})
	answer := p.receive(t, 5*time.Second)
	if answer["type"] != TypeAccept {
		t.Fatalf("reply = %v, want the connection to stay usable", answer)
	}
	if s.Conns() != 1 {
		t.Fatalf("live connections = %d, want 1", s.Conns())
	}
}

func TestLegAJSONRPCFrameIsRejectedWithAnErrorFrame(t *testing.T) {
	s, _ := startLAN(t, Config{LAN: lanOn, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.sendRaw(t, []byte(`{"jsonrpc":"2.0","id":1,"method":"ping"}`+"\n"))

	reply := p.receive(t, 5*time.Second)
	if reply["type"] != TypeError {
		t.Fatalf("reply = %v, want %s", reply, TypeError)
	}
	if reply["code"] != CodeMalformedFrame {
		t.Fatalf("code = %v, want %s", reply["code"], CodeMalformedFrame)
	}
}

func TestMalformedFramesAreRejectedWithAnErrorFrame(t *testing.T) {
	s, _ := startLAN(t, Config{LAN: lanOn, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	cases := []struct {
		name string
		raw  string
	}{
		{name: "not json", raw: "this is not json\n"},
		{name: "no type", raw: `{"id":1}` + "\n"},
		{name: "type is not a string", raw: `{"type":7}` + "\n"},
		{name: "type is empty", raw: `{"type":""}` + "\n"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := dialPeer(t, s)
			p.sendRaw(t, []byte(tc.raw))

			reply := p.receive(t, 5*time.Second)
			if reply["type"] != TypeError {
				t.Fatalf("reply = %v, want %s", reply, TypeError)
			}
			if reply["code"] != CodeMalformedFrame {
				t.Fatalf("code = %v, want %s", reply["code"], CodeMalformedFrame)
			}
		})
	}
}

func TestTransferFrameWithoutHandlerIsRejected(t *testing.T) {
	s, _ := startLAN(t, Config{LAN: lanOn, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t1"})

	reply := p.receive(t, 5*time.Second)
	if reply["type"] != TypeError {
		t.Fatalf("reply = %v, want %s", reply, TypeError)
	}
	if reply["code"] != CodeNoHandler {
		t.Fatalf("code = %v, want %s", reply["code"], CodeNoHandler)
	}
}

func TestHandlerFailureIsReportedAsAnErrorFrame(t *testing.T) {
	handler := &offerHandler{failWith: errors.New("the canvas is gone")}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t1"})

	reply := p.receive(t, 5*time.Second)
	if reply["type"] != TypeError {
		t.Fatalf("reply = %v, want %s", reply, TypeError)
	}
	if reply["code"] != CodeHandlerFailed {
		t.Fatalf("code = %v, want %s", reply["code"], CodeHandlerFailed)
	}
	if message, _ := reply["message"].(string); !strings.Contains(message, "the canvas is gone") {
		t.Fatalf("message = %v, want the handler error", reply["message"])
	}
}

func TestReplyCloseEndsTheConnection(t *testing.T) {
	handler := &offerHandler{
		fallback: Reply{Type: TypeAccept, Fields: map[string]any{"transferId": "t1", "token": "tok"}, Close: true},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t1"})

	reply := p.receive(t, 5*time.Second)
	if reply["type"] != TypeAccept {
		t.Fatalf("reply = %v, want %s", reply, TypeAccept)
	}
	err := p.drainUntilError(5 * time.Second)
	if err == nil || isTimeout(err) {
		t.Fatalf("the connection must end after a close reply, got %v", err)
	}
	if !waitFor(3*time.Second, func() bool { return s.Conns() == 0 }) {
		t.Fatalf("live connections = %d, want 0", s.Conns())
	}
}

func TestOversizedFrameIsRejected(t *testing.T) {
	s, _ := startLAN(t, Config{LAN: lanOn, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	oversized := strings.Repeat("x", maxFrameBytes)
	writeDone := make(chan error, 1)
	go func() {
		_ = p.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		_, err := p.conn.Write([]byte(oversized))
		writeDone <- err
	}()

	reply, err := p.tryReceive(t, 15*time.Second)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	if reply["type"] != TypeError {
		t.Fatalf("reply = %v, want %s", reply, TypeError)
	}
	if reply["code"] != CodeFrameTooLarge {
		t.Fatalf("code = %v, want %s", reply["code"], CodeFrameTooLarge)
	}
	select {
	case <-writeDone:
	case <-time.After(5 * time.Second):
		t.Fatal("the oversized write never finished")
	}
}

func TestParseMessage(t *testing.T) {
	cases := []struct {
		name     string
		raw      string
		wantType string
		wantCode string
	}{
		{name: "offer", raw: `{"type":"transfer.offer","transferId":"t1"}`, wantType: TypeOffer},
		{name: "accept", raw: `{"type":"transfer.accept"}`, wantType: TypeAccept},
		{name: "reject", raw: `{"type":"transfer.reject"}`, wantType: TypeReject},
		{name: "chunk", raw: `{"type":"transfer.chunk"}`, wantType: TypeChunk},
		{name: "done", raw: `{"type":"transfer.done"}`, wantType: TypeDone},
		{name: "not json", raw: `nope`, wantCode: CodeMalformedFrame},
		{name: "no type", raw: `{}`, wantCode: CodeMalformedFrame},
		{name: "type not a string", raw: `{"type":1}`, wantCode: CodeMalformedFrame},
		{name: "empty type", raw: `{"type":""}`, wantCode: CodeMalformedFrame},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			msg, parseErr := parseMessage([]byte(tc.raw))
			if tc.wantCode != "" {
				if parseErr == nil {
					t.Fatalf("parseMessage(%q) = %+v, want code %s", tc.raw, msg, tc.wantCode)
				}
				if parseErr.code != tc.wantCode {
					t.Fatalf("code = %q, want %q", parseErr.code, tc.wantCode)
				}
				return
			}
			if parseErr != nil {
				t.Fatalf("parseMessage(%q): %v", tc.raw, parseErr)
			}
			if msg.Type != tc.wantType {
				t.Fatalf("type = %q, want %q", msg.Type, tc.wantType)
			}
			if !IsTransferType(msg.Type) {
				t.Fatalf("type %q must be a transfer type", msg.Type)
			}
		})
	}
}

func TestIsTransferType(t *testing.T) {
	transfer := []string{TypeOffer, TypeAccept, TypeReject, TypeChunk, TypeDone}
	for _, typ := range transfer {
		if !IsTransferType(typ) {
			t.Fatalf("%q must be a transfer type", typ)
		}
	}
	others := []string{TypeError, "rpc.call", "ping", "", "transfer"}
	for _, typ := range others {
		if IsTransferType(typ) {
			t.Fatalf("%q must not be a transfer type", typ)
		}
	}
}

func TestOfferDecodesIntoTheTransferVocabulary(t *testing.T) {
	raw := `{"type":"transfer.offer","transferId":"t1","alias":"studio-mac","fingerprint":"ff","elementCount":12,"bytes":2048,"canvasName":"sketch"}`
	msg, parseErr := parseMessage([]byte(raw))
	if parseErr != nil {
		t.Fatalf("parseMessage: %v", parseErr)
	}
	var offer Offer
	if err := msg.Decode(&offer); err != nil {
		t.Fatalf("decode offer: %v", err)
	}
	want := Offer{
		TransferID:   "t1",
		Alias:        "studio-mac",
		Fingerprint:  "ff",
		ElementCount: 12,
		Bytes:        2048,
		CanvasName:   "sketch",
	}
	if offer != want {
		t.Fatalf("offer = %+v, want %+v", offer, want)
	}
}

func TestEndpointString(t *testing.T) {
	endpoint := Endpoint{Address: "0.0.0.0", Port: 4321}
	if endpoint.String() != "0.0.0.0:4321" {
		t.Fatalf("String() = %q, want 0.0.0.0:4321", endpoint.String())
	}
}

func TestWriteFrameReportsAFailedWrite(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()

	s := &Server{writeTimeout: 200 * time.Millisecond}
	started := time.Now()
	if s.writeFrame(server, map[string]any{"type": TypeError}) {
		t.Fatal("writeFrame must report a failed write")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("the write took %s, want the write timeout to bound it", elapsed)
	}
}

func TestWriteFrameToAClosedPeerFails(t *testing.T) {
	server, client := net.Pipe()
	_ = client.Close()

	s := &Server{writeTimeout: 200 * time.Millisecond}
	if s.writeFrame(server, map[string]any{"type": TypeError}) {
		t.Fatal("writeFrame must report a failed write")
	}
}

func TestErrorFrameFieldsAreComplete(t *testing.T) {
	s, _ := startLAN(t, Config{LAN: lanOn, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": "nope"})

	reply := p.receive(t, 5*time.Second)
	if reply["type"] != TypeError {
		t.Fatalf("reply = %v, want %s", reply, TypeError)
	}
	if _, ok := reply["code"].(string); !ok {
		t.Fatalf("reply = %v, want a code", reply)
	}
	if _, ok := reply["message"].(string); !ok {
		t.Fatalf("reply = %v, want a message", reply)
	}
}

func TestFrameFieldsAreAnsweredOneFramePerLine(t *testing.T) {
	handler := &offerHandler{
		replies: map[string]Reply{
			"t1": {Type: TypeAccept, Fields: map[string]any{"transferId": "t1", "token": "tok"}},
			"t2": {Type: TypeAccept, Fields: map[string]any{"transferId": "t2", "token": "tok"}},
		},
		fallback: Reply{Type: TypeReject, Fields: map[string]any{"transferId": "unknown", "reason": "no such transfer"}},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t1"})
	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t2"})

	for i, wantID := range []string{"t1", "t2"} {
		reply := p.receive(t, 5*time.Second)
		if reply["type"] != TypeAccept {
			t.Fatalf("reply %d = %v, want %s", i, reply, TypeAccept)
		}
		if reply["transferId"] != wantID {
			t.Fatalf("reply %d transferId = %v, want %s", i, reply["transferId"], wantID)
		}
	}
}

func TestPeerAddressIsReportedToTheHandler(t *testing.T) {
	handler := &offerHandler{
		fallback: Reply{Type: TypeAccept, Fields: map[string]any{"transferId": "t1", "token": "tok"}},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	p.send(t, map[string]any{"type": TypeOffer, "transferId": "t1"})
	p.receive(t, 5*time.Second)

	peers := handler.peerAddresses()
	if len(peers) != 1 {
		t.Fatalf("peers = %v, want one", peers)
	}
	if !strings.HasPrefix(peers[0], "127.0.0.1:") {
		t.Fatalf("peer address = %q, want the loopback remote address", peers[0])
	}
}

func TestTwoListenersGetDistinctPorts(t *testing.T) {
	first, _ := startLAN(t, Config{LAN: lanOn})
	second, _ := startLAN(t, Config{LAN: lanOn})

	if first.Port() == second.Port() {
		t.Fatalf("two listeners share the port %d", first.Port())
	}
	if first.Endpoint() == second.Endpoint() {
		t.Fatal("two listeners share the endpoint")
	}
}

func TestListenAndServeReportsABindFailure(t *testing.T) {
	_, err := ListenAndServe(context.Background(), Config{
		LAN:         lanOn,
		BindAddress: "1.2.3.4",
		Logger:      newTestLogger(t),
	})
	if err == nil {
		t.Fatal("ListenAndServe must report a bind failure")
	}
	if !strings.Contains(err.Error(), "bind") {
		t.Fatalf("error %q must name the bind failure", err)
	}
}
