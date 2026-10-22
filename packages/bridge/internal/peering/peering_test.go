package peering

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/excali-local/excali-bridge/internal/config"
	"github.com/excali-local/excali-bridge/internal/lan"
	"github.com/excali-local/excali-bridge/internal/transfer"
)

type scriptedDecider struct {
	mu     sync.Mutex
	offers []lan.Offer
	peers  []lan.Peer
	accept bool
	reason string
	block  bool
	delay  time.Duration
}

func (d *scriptedDecider) Decide(ctx context.Context, peer lan.Peer, offer lan.Offer) (Decision, error) {
	d.mu.Lock()
	d.offers = append(d.offers, offer)
	d.peers = append(d.peers, peer)
	d.mu.Unlock()
	if d.block {
		<-ctx.Done()
		return Decision{}, ctx.Err()
	}
	if d.delay > 0 {
		select {
		case <-time.After(d.delay):
		case <-ctx.Done():
			return Decision{}, ctx.Err()
		}
	}
	return Decision{Accept: d.accept, Reason: d.reason}, nil
}

func (d *scriptedDecider) seenOffers() []lan.Offer {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]lan.Offer(nil), d.offers...)
}

type recordingDeliverer struct {
	mu       sync.Mutex
	scenes   map[string][]byte
	offers   map[string]lan.Offer
	failWith error
}

func newRecordingDeliverer() *recordingDeliverer {
	return &recordingDeliverer{
		scenes: map[string][]byte{},
		offers: map[string]lan.Offer{},
	}
}

func (d *recordingDeliverer) Deliver(_ context.Context, _ lan.Peer, offer lan.Offer, scene []byte) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.failWith != nil {
		return d.failWith
	}
	sum := sha256.Sum256(scene)
	key := hex.EncodeToString(sum[:])
	d.scenes[key] = append([]byte(nil), scene...)
	d.offers[key] = offer
	return nil
}

func (d *recordingDeliverer) delivered(key string) ([]byte, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	scene, ok := d.scenes[key]
	return scene, ok
}

func startLAN(t *testing.T, handler lan.Handler) *lan.Server {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	server, err := lan.ListenAndServe(ctx, lan.Config{
		LAN:          config.Config{LAN: config.LANOn, Alias: "studio", Fingerprint: "fp"},
		Handler:      handler,
		BindAddress:  "127.0.0.1",
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		Logger:       log.New(io.Discard, "", 0),
	})
	if err != nil {
		cancel()
		t.Fatalf("ListenAndServe: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		_ = server.Close()
		server.Wait()
	})
	return server
}

func loopbackAddress(server *lan.Server) string {
	return fmt.Sprintf("127.0.0.1:%d", server.Port())
}

func testOffer() lan.Offer {
	return lan.Offer{
		Alias:        "studio",
		Fingerprint:  "fp-1234",
		ElementCount: 12,
		Bytes:        300 * 1024,
		CanvasName:   "roadmap",
	}
}

func sceneBytes(size int) []byte {
	scene := make([]byte, size)
	for i := range scene {
		scene[i] = byte(i*31 + i/251)
	}
	return scene
}

func digestOf(scene []byte) string {
	sum := sha256.Sum256(scene)
	return hex.EncodeToString(sum[:])
}

func TestSendCarriesTheWholeSceneToTheReceiver(t *testing.T) {
	decider := &scriptedDecider{accept: true}
	deliverer := newRecordingDeliverer()
	receiver := NewHandler(transfer.NewRegistry(), decider, deliverer)
	server := startLAN(t, receiver)

	sender := NewHandler(transfer.NewRegistry(), nil, nil)
	scene := sceneBytes(300 * 1024)

	result, err := sender.Send(context.Background(), loopbackAddress(server), testOffer(), scene)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if result.Bytes != len(scene) {
		t.Fatalf("result bytes = %d, want %d", result.Bytes, len(scene))
	}
	if result.SHA256 != digestOf(scene) {
		t.Fatalf("result sha256 = %s, want %s", result.SHA256, digestOf(scene))
	}
	if result.Token == "" {
		t.Fatal("the receiver issued no token")
	}
	if result.PeerTransferID == "" {
		t.Fatal("the receiver named no transfer")
	}

	delivered, ok := deliverer.delivered(digestOf(scene))
	if !ok {
		t.Fatal("the scene was never delivered")
	}
	if !bytes.Equal(delivered, scene) {
		t.Fatal("the delivered bytes differ from the carried bytes")
	}

	offers := decider.seenOffers()
	if len(offers) != 1 {
		t.Fatalf("the decider saw %d offers, want 1", len(offers))
	}
	if offers[0].Alias != "studio" || offers[0].ElementCount != 12 || offers[0].CanvasName != "roadmap" {
		t.Fatalf("the offer metadata changed: %+v", offers[0])
	}
	if offers[0].Bytes != len(scene) {
		t.Fatalf("the offer announced %d bytes, want %d", offers[0].Bytes, len(scene))
	}
}

func TestSendCarriesASceneLargerThanOneChunk(t *testing.T) {
	decider := &scriptedDecider{accept: true}
	deliverer := newRecordingDeliverer()
	receiver := NewHandler(transfer.NewRegistry(), decider, deliverer)
	server := startLAN(t, receiver)

	sender := NewHandler(transfer.NewRegistry(), nil, nil)
	scene := sceneBytes(900*1024 + 17)

	result, err := sender.Send(context.Background(), loopbackAddress(server), testOffer(), scene)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if result.SHA256 != digestOf(scene) {
		t.Fatalf("result sha256 = %s, want %s", result.SHA256, digestOf(scene))
	}
	delivered, ok := deliverer.delivered(digestOf(scene))
	if !ok {
		t.Fatal("the scene was never delivered")
	}
	if !bytes.Equal(delivered, scene) {
		t.Fatal("the delivered bytes differ from the carried bytes")
	}
}

func TestSendTimesOutWhenNobodyAccepts(t *testing.T) {
	decider := &scriptedDecider{block: true}
	registry := transfer.NewRegistry()
	receiver := NewHandler(registry, decider, nil)
	receiver.DecisionTimeout = 100 * time.Millisecond
	server := startLAN(t, receiver)

	sender := NewHandler(transfer.NewRegistry(), nil, nil)
	sender.AcceptTimeout = 500 * time.Millisecond

	started := time.Now()
	_, err := sender.Send(context.Background(), loopbackAddress(server), testOffer(), sceneBytes(4096))
	elapsed := time.Since(started)
	if err == nil {
		t.Fatal("Send must fail when nobody accepts the offer")
	}
	if !errors.Is(err, ErrAcceptTimeout) {
		t.Fatalf("error = %v, want ErrAcceptTimeout", err)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("the sender waited %s, want a short timeout", elapsed)
	}
	if sender.acceptTimeout() > transfer.OfferTTL {
		t.Fatalf("the sender's accept timeout %s exceeds the offer deadline %s", sender.acceptTimeout(), transfer.OfferTTL)
	}
	if registry.TokenCount() != 0 {
		t.Fatalf("the receiver issued %d tokens without an acceptance", registry.TokenCount())
	}
}

func TestSendFailsWhenTheReceiverRejects(t *testing.T) {
	decider := &scriptedDecider{accept: false, reason: "the user declined"}
	deliverer := newRecordingDeliverer()
	receiver := NewHandler(transfer.NewRegistry(), decider, deliverer)
	server := startLAN(t, receiver)

	sender := NewHandler(transfer.NewRegistry(), nil, nil)
	_, err := sender.Send(context.Background(), loopbackAddress(server), testOffer(), sceneBytes(4096))
	if err == nil {
		t.Fatal("Send must fail when the receiver rejects the offer")
	}
	if !errors.Is(err, ErrRejected) {
		t.Fatalf("error = %v, want ErrRejected", err)
	}
	if !strings.Contains(err.Error(), "the user declined") {
		t.Fatalf("error = %v, want it to carry the rejection reason", err)
	}
	if len(deliverer.scenes) != 0 {
		t.Fatal("a rejected offer must not deliver a scene")
	}
}

func TestTheOfferDeadlineBoundsBothSides(t *testing.T) {
	handler := NewHandler(transfer.NewRegistry(), nil, nil)
	if handler.acceptTimeout() != transfer.OfferTTL {
		t.Fatalf("accept timeout = %s, want the offer deadline %s", handler.acceptTimeout(), transfer.OfferTTL)
	}
	if handler.decisionTimeout() != transfer.OfferTTL {
		t.Fatalf("decision timeout = %s, want the offer deadline %s", handler.decisionTimeout(), transfer.OfferTTL)
	}
	handler.AcceptTimeout = 10 * time.Minute
	handler.DecisionTimeout = 10 * time.Minute
	if handler.acceptTimeout() > transfer.OfferTTL {
		t.Fatalf("accept timeout %s exceeds the offer deadline %s", handler.acceptTimeout(), transfer.OfferTTL)
	}
	if handler.decisionTimeout() > transfer.OfferTTL {
		t.Fatalf("decision timeout %s exceeds the offer deadline %s", handler.decisionTimeout(), transfer.OfferTTL)
	}
}

func TestAnUnacceptedOfferHoldsMetadataOnly(t *testing.T) {
	decider := &scriptedDecider{block: true}
	registry := transfer.NewRegistry()
	receiver := NewHandler(registry, decider, nil)
	receiver.DecisionTimeout = 100 * time.Millisecond
	server := startLAN(t, receiver)

	sender := NewHandler(transfer.NewRegistry(), nil, nil)
	sender.AcceptTimeout = 300 * time.Millisecond
	_, _ = sender.Send(context.Background(), loopbackAddress(server), testOffer(), sceneBytes(64*1024))

	if registry.OfferCount() != 1 {
		t.Fatalf("held offers = %d, want 1", registry.OfferCount())
	}
	if registry.TokenCount() != 0 {
		t.Fatalf("issued tokens = %d, want 0: no canvas content may be staged before an acceptance", registry.TokenCount())
	}
}

func TestTheLANLayerStillRefusesNonTransferFrames(t *testing.T) {
	decider := &scriptedDecider{accept: true}
	receiver := NewHandler(transfer.NewRegistry(), decider, nil)
	server := startLAN(t, receiver)

	cases := []struct {
		name string
		raw  string
		want string
	}{
		{name: "a loopback rpc call", raw: `{"jsonrpc":"2.0","id":1,"method":"ping"}`, want: lan.CodeMalformedFrame},
		{name: "an unknown frame type", raw: `{"type":"rpc.call","id":1,"method":"ping"}`, want: lan.CodeUnsupportedType},
		{name: "the loopback method set", raw: `{"type":"canvas/v1","method":"scene.get"}`, want: lan.CodeUnsupportedType},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			conn, err := net.DialTimeout("tcp", loopbackAddress(server), 3*time.Second)
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			defer conn.Close()
			if _, err := conn.Write([]byte(tc.raw + "\n")); err != nil {
				t.Fatalf("write: %v", err)
			}
			_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			line, err := bufio.NewReader(conn).ReadBytes('\n')
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			var frame map[string]any
			if err := json.Unmarshal(bytes.TrimSpace(line), &frame); err != nil {
				t.Fatalf("decode %q: %v", line, err)
			}
			if frame["type"] != lan.TypeError {
				t.Fatalf("frame = %v, want %s", frame, lan.TypeError)
			}
			if frame["code"] != tc.want {
				t.Fatalf("code = %v, want %s", frame["code"], tc.want)
			}
		})
	}
	if len(decider.seenOffers()) != 0 {
		t.Fatal("a non-transfer frame must never reach the transfer handler")
	}
}

func TestTwoConcurrentTransfersDoNotCrossTalk(t *testing.T) {
	decider := &scriptedDecider{accept: true}
	deliverer := newRecordingDeliverer()
	receiver := NewHandler(transfer.NewRegistry(), decider, deliverer)
	server := startLAN(t, receiver)

	sender := NewHandler(transfer.NewRegistry(), nil, nil)

	first := sceneBytes(250 * 1024)
	second := sceneBytes(700*1024 + 11)

	var wg sync.WaitGroup
	results := make([]Result, 2)
	errs := make([]error, 2)
	for i, scene := range [][]byte{first, second} {
		wg.Add(1)
		go func(index int, payload []byte) {
			defer wg.Done()
			results[index], errs[index] = sender.Send(context.Background(), loopbackAddress(server), testOffer(), payload)
		}(i, scene)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("transfer %d: %v", i, err)
		}
	}
	if results[0].SHA256 != digestOf(first) {
		t.Fatalf("transfer 0 sha256 = %s, want %s", results[0].SHA256, digestOf(first))
	}
	if results[1].SHA256 != digestOf(second) {
		t.Fatalf("transfer 1 sha256 = %s, want %s", results[1].SHA256, digestOf(second))
	}
	if results[0].PeerTransferID == results[1].PeerTransferID {
		t.Fatal("the two transfers share one transfer id")
	}
	if results[0].Token == results[1].Token {
		t.Fatal("the two transfers share one token")
	}

	deliveredFirst, ok := deliverer.delivered(digestOf(first))
	if !ok || !bytes.Equal(deliveredFirst, first) {
		t.Fatal("the first scene was not delivered intact")
	}
	deliveredSecond, ok := deliverer.delivered(digestOf(second))
	if !ok || !bytes.Equal(deliveredSecond, second) {
		t.Fatal("the second scene was not delivered intact")
	}
}
func TestSendStopsWhenTheContextIsCancelled(t *testing.T) {
	decider := &scriptedDecider{block: true}
	receiver := NewHandler(transfer.NewRegistry(), decider, nil)
	receiver.DecisionTimeout = 30 * time.Second
	server := startLAN(t, receiver)

	sender := NewHandler(transfer.NewRegistry(), nil, nil)
	sender.AcceptTimeout = 30 * time.Second
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()
	started := time.Now()
	_, err := sender.Send(ctx, loopbackAddress(server), testOffer(), sceneBytes(4096))
	elapsed := time.Since(started)
	if err == nil {
		t.Fatal("Send must fail when the context is cancelled")
	}
	if elapsed > 10*time.Second {
		t.Fatalf("the sender waited %s after the cancellation", elapsed)
	}
}

func TestTheHandlerRefusesAnUnknownFrameType(t *testing.T) {
	handler := NewHandler(transfer.NewRegistry(), &scriptedDecider{accept: true}, nil)
	reply, err := handler.HandleTransfer(context.Background(), lan.Peer{Address: "127.0.0.1:1"}, lan.Message{Type: "canvas/v1"})
	if err != nil {
		t.Fatalf("HandleTransfer: %v", err)
	}
	if reply.Type != lan.TypeError {
		t.Fatalf("reply = %+v, want %s", reply, lan.TypeError)
	}
	if reply.Fields["code"] != lan.CodeUnsupportedType {
		t.Fatalf("code = %v, want %s", reply.Fields["code"], lan.CodeUnsupportedType)
	}
}

func TestTheHandlerMapsATransferFailureOntoTheLANErrorCodes(t *testing.T) {
	handler := NewHandler(transfer.NewRegistry(), &scriptedDecider{accept: true}, nil)

	oversized := testOffer()
	oversized.Bytes = 64*1024*1024 + 1
	frame, err := json.Marshal(map[string]any{
		"type":         lan.TypeOffer,
		"alias":        oversized.Alias,
		"fingerprint":  oversized.Fingerprint,
		"elementCount": oversized.ElementCount,
		"bytes":        oversized.Bytes,
		"canvasName":   oversized.CanvasName,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	reply, err := handler.HandleTransfer(context.Background(), lan.Peer{Address: "127.0.0.1:1"}, lan.Message{Type: lan.TypeOffer, Payload: frame})
	if err != nil {
		t.Fatalf("HandleTransfer: %v", err)
	}
	if reply.Type != lan.TypeError {
		t.Fatalf("reply = %+v, want %s", reply, lan.TypeError)
	}
	if reply.Fields["code"] != lan.CodeFrameTooLarge {
		t.Fatalf("code = %v, want %s", reply.Fields["code"], lan.CodeFrameTooLarge)
	}
	if code, _ := reply.Fields["transferCode"].(int); code != -32010 {
		t.Fatalf("transferCode = %v, want %d", reply.Fields["transferCode"], -32010)
	}
}

func TestTheHandlerRefusesAChunkWithoutAToken(t *testing.T) {
	handler := NewHandler(transfer.NewRegistry(), &scriptedDecider{accept: true}, nil)
	frame, err := json.Marshal(map[string]any{
		"type":       lan.TypeChunk,
		"transferId": "t1",
		"seq":        4,
		"total":      1,
		"dataBase64": "aGk=",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	reply, err := handler.HandleTransfer(context.Background(), lan.Peer{Address: "127.0.0.1:1"}, lan.Message{Type: lan.TypeChunk, Payload: frame})
	if err != nil {
		t.Fatalf("HandleTransfer: %v", err)
	}
	if reply.Type != lan.TypeError {
		t.Fatalf("reply = %+v, want %s", reply, lan.TypeError)
	}
	if reply.Fields["code"] != lan.CodeHandlerFailed {
		t.Fatalf("code = %v, want %s", reply.Fields["code"], lan.CodeHandlerFailed)
	}
}

func TestDeciderReceivesTheReceiversDeadline(t *testing.T) {
	registry := transfer.NewRegistry()
	decider := &scriptedDecider{reason: "inspect only"}
	handler := NewHandler(registry, decider, nil)

	offer := lan.Offer{Alias: "sender", Fingerprint: "fp", ElementCount: 2, Bytes: 64, CanvasName: "deck"}
	payload, err := json.Marshal(struct {
		Type string `json:"type"`
		lan.Offer
	}{Type: lan.TypeOffer, Offer: offer})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	if _, err := handler.HandleTransfer(context.Background(), lan.Peer{Address: "10.0.0.9:1"}, lan.Message{
		Type:    lan.TypeOffer,
		Payload: payload,
	}); err != nil {
		t.Fatalf("HandleTransfer: %v", err)
	}

	decider.mu.Lock()
	defer decider.mu.Unlock()
	if len(decider.offers) != 1 {
		t.Fatalf("decider saw %d offers, want 1", len(decider.offers))
	}
	seen := decider.offers[0]
	if seen.ExpiresAt == 0 {
		t.Fatal("the decider received an offer with no deadline; a page could not count down")
	}
	if seen.CanvasName != "deck" || seen.ElementCount != 2 {
		t.Fatalf("offer metadata was not carried to the decider: %+v", seen)
	}
}
