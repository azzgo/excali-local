package transfer

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/lan"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func testOffer() lan.Offer {
	return lan.Offer{
		Alias:        "studio",
		Fingerprint:  "fp-1234",
		ElementCount: 12,
		Bytes:        4096,
		CanvasName:   "roadmap",
	}
}

func mustCode(t *testing.T, err error, want int) {
	t.Helper()
	if err == nil {
		t.Fatalf("want error with code %d, got nil", want)
	}
	if got := CodeOf(err); got != want {
		t.Fatalf("want code %d, got %d (%v)", want, got, err)
	}
}

func TestThreePhaseCarry(t *testing.T) {
	clock := newFakeClock()
	reg := NewRegistryWithClock(clock.Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if transferID == "" {
		t.Fatal("prepare returned no transfer id")
	}

	offer, ok := reg.Offer(transferID)
	if !ok {
		t.Fatal("offer metadata not held")
	}
	if offer.Alias != "studio" || offer.ElementCount != 12 || offer.Bytes != 4096 || offer.CanvasName != "roadmap" {
		t.Fatalf("offer metadata changed: %+v", offer)
	}

	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if token == "" {
		t.Fatal("accept returned no token")
	}

	scene := []byte("opaque scene bytes that the daemon never parses")
	plan := NewPlan(transferID, scene)
	if plan.Total() != 1 {
		t.Fatalf("want 1 chunk, got %d", plan.Total())
	}

	var carried []lan.Chunk
	err = plan.Carry(
		func(c lan.Chunk) error {
			carried = append(carried, c)
			return reg.Upload(source, token, c)
		},
		func(d lan.Done) error {
			data, err := reg.Done(source, token, d.SHA256)
			if err != nil {
				return err
			}
			if !bytes.Equal(data, scene) {
				return fmt.Errorf("carried bytes differ")
			}
			return nil
		},
	)
	if err != nil {
		t.Fatalf("carry: %v", err)
	}
	if len(carried) != 1 {
		t.Fatalf("want 1 chunk carried, got %d", len(carried))
	}
	if carried[0].Seq != FirstSeq {
		t.Fatalf("want first seq %d, got %d", FirstSeq, carried[0].Seq)
	}
}

func TestCarryTwoChunks(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	scene := bytes.Repeat([]byte("excalidraw"), contract.TransferChunkBytes/10+10)
	plan := NewPlan(transferID, scene)
	if plan.Total() != 2 {
		t.Fatalf("want 2 chunks, got %d", plan.Total())
	}

	var got []byte
	var seqs []int
	err = plan.Carry(
		func(c lan.Chunk) error {
			seqs = append(seqs, c.Seq)
			if err := reg.Upload(source, token, c); err != nil {
				return err
			}
			raw, err := base64.StdEncoding.DecodeString(c.DataBase64)
			if err != nil {
				return err
			}
			got = append(got, raw...)
			return nil
		},
		func(d lan.Done) error {
			data, err := reg.Done(source, token, d.SHA256)
			if err != nil {
				return err
			}
			got = data
			return nil
		},
	)
	if err != nil {
		t.Fatalf("carry: %v", err)
	}
	if !bytes.Equal(got, scene) {
		t.Fatal("carried bytes differ from the scene")
	}
	if len(seqs) != 2 || seqs[0] != FirstSeq || seqs[1] != FirstSeq+1 {
		t.Fatalf("unexpected seq sequence %v", seqs)
	}
}

func TestTokenReplayRejected(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	scene := []byte("scene")
	plan := NewPlan(transferID, scene)
	chunk, _ := plan.Next()
	if err := reg.Upload(source, token, chunk); err != nil {
		t.Fatalf("upload: %v", err)
	}
	if _, err := reg.Done(source, token, plan.SHA256()); err != nil {
		t.Fatalf("done: %v", err)
	}

	err = reg.Upload(source, token, chunk)
	mustCode(t, err, contract.JSONRPCErrorInvalidToken)
	if _, err := reg.Done(source, token, plan.SHA256()); err == nil {
		t.Fatal("replayed token was accepted")
	} else {
		mustCode(t, err, contract.JSONRPCErrorInvalidToken)
	}
}

func TestTokenBoundToSourceAddress(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)

	transferID, err := reg.Prepare("10.0.0.2:5555", testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	chunk, _ := NewPlan(transferID, []byte("scene")).Next()
	err = reg.Upload("10.0.0.9:6666", token, chunk)
	mustCode(t, err, contract.JSONRPCErrorInvalidToken)
}

func TestUnknownTokenRejected(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	transferID, err := reg.Prepare("10.0.0.2:5555", testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	chunk, _ := NewPlan(transferID, []byte("scene")).Next()
	err = reg.Upload("10.0.0.2:5555", "not-a-token", chunk)
	mustCode(t, err, contract.JSONRPCErrorInvalidToken)
}

func TestExpiredOfferRejected(t *testing.T) {
	clock := newFakeClock()
	reg := NewRegistryWithClock(clock.Now)

	transferID, err := reg.Prepare("10.0.0.2:5555", testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}

	clock.Advance(time.Duration(contract.TransferOfferTTLms) * time.Millisecond)

	_, err = reg.Accept(transferID)
	mustCode(t, err, contract.JSONRPCErrorOfferExpired)
}

func TestExpiredTokenRejected(t *testing.T) {
	clock := newFakeClock()
	reg := NewRegistryWithClock(clock.Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	clock.Advance(time.Duration(contract.TransferOfferTTLms) * time.Millisecond)

	chunk, _ := NewPlan(transferID, []byte("scene")).Next()
	err = reg.Upload(source, token, chunk)
	mustCode(t, err, contract.JSONRPCErrorOfferExpired)
}

func TestSceneOverCapRejectedAtPrepare(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)

	offer := testOffer()
	offer.Bytes = contract.TransferSceneMaxBytes + 1

	_, err := reg.Prepare("10.0.0.2:5555", offer)
	mustCode(t, err, contract.JSONRPCErrorSceneTooLarge)
	if reg.OfferCount() != 0 {
		t.Fatalf("a refused offer was held: %d offers", reg.OfferCount())
	}
}

func TestSceneAtCapAccepted(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)

	offer := testOffer()
	offer.Bytes = contract.TransferSceneMaxBytes

	if _, err := reg.Prepare("10.0.0.2:5555", offer); err != nil {
		t.Fatalf("a scene at the cap was refused: %v", err)
	}
}

func TestOfferWithContentRejected(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)

	cases := []string{
		`{"type":"transfer.offer","transferId":"t1","alias":"studio","elements":[{"type":"rectangle"}]}`,
		`{"type":"transfer.offer","transferId":"t1","alias":"studio","thumbnail":"data:image/png;base64,AAAA"}`,
		`{"type":"transfer.offer","transferId":"t1","alias":"studio","scene":{"elements":[]}}`,
		`{"type":"transfer.offer","transferId":"t1","alias":"studio","elementsBase64":"AAAA"}`,
		`{"type":"transfer.offer","transferId":"t1","alias":"studio","preview":"AAAA"}`,
	}

	for _, raw := range cases {
		_, err := reg.PrepareFrame("10.0.0.2:5555", json.RawMessage(raw))
		if err == nil {
			t.Fatalf("offer with content was accepted: %s", raw)
		}
		mustCode(t, err, CodeInvalidParams)
	}
	if reg.OfferCount() != 0 {
		t.Fatalf("a refused offer was held: %d offers", reg.OfferCount())
	}
}

func TestOfferWithMetadataAccepted(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)

	raw := `{"type":"transfer.offer","transferId":"","alias":"studio","fingerprint":"fp","elementCount":3,"bytes":100,"canvasName":"board"}`
	transferID, err := reg.PrepareFrame("10.0.0.2:5555", json.RawMessage(raw))
	if err != nil {
		t.Fatalf("metadata offer was refused: %v", err)
	}
	offer, ok := reg.Offer(transferID)
	if !ok {
		t.Fatal("offer metadata not held")
	}
	if offer.Alias != "studio" || offer.Fingerprint != "fp" || offer.ElementCount != 3 || offer.Bytes != 100 || offer.CanvasName != "board" {
		t.Fatalf("offer metadata wrong: %+v", offer)
	}
}

func TestDigestMismatchDiscardsScene(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	plan := NewPlan(transferID, []byte("scene"))
	chunk, _ := plan.Next()
	if err := reg.Upload(source, token, chunk); err != nil {
		t.Fatalf("upload: %v", err)
	}

	wrong := sha256.Sum256([]byte("another scene"))
	data, err := reg.Done(source, token, hex.EncodeToString(wrong[:]))
	if err == nil {
		t.Fatal("a wrong digest was accepted")
	}
	if data != nil {
		t.Fatal("a wrong digest handed out bytes")
	}
	if reg.TokenCount() != 0 {
		t.Fatalf("the staged scene was kept: %d tokens", reg.TokenCount())
	}
}

func TestIncompleteCarryRejected(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	plan := NewPlan(transferID, []byte("scene"))
	chunk := lan.Chunk{
		TransferID: transferID,
		Seq:        FirstSeq,
		Total:      2,
		DataBase64: base64.StdEncoding.EncodeToString([]byte("scene")),
	}
	if err := reg.Upload(source, token, chunk); err != nil {
		t.Fatalf("upload: %v", err)
	}

	if _, err := reg.Done(source, token, plan.SHA256()); err == nil {
		t.Fatal("an incomplete carry was accepted")
	}
}

func TestEmptySceneCarry(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	plan := NewPlan(transferID, nil)
	if plan.Total() != 0 {
		t.Fatalf("want 0 chunks, got %d", plan.Total())
	}

	chunk := lan.Chunk{
		TransferID: transferID,
		Seq:        FirstSeq,
		Total:      1,
		DataBase64: "",
	}
	if err := reg.Upload(source, token, chunk); err != nil {
		t.Fatalf("upload: %v", err)
	}
	data, err := reg.Done(source, token, plan.SHA256())
	if err != nil {
		t.Fatalf("done: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("want no bytes, got %d", len(data))
	}
}

func TestExpiredEntriesSwept(t *testing.T) {
	clock := newFakeClock()
	reg := NewRegistryWithClock(clock.Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := reg.Accept(transferID); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if reg.OfferCount() != 1 || reg.TokenCount() != 1 {
		t.Fatalf("state not held: %d offers, %d tokens", reg.OfferCount(), reg.TokenCount())
	}

	clock.Advance(time.Duration(contract.TransferOfferTTLms)*time.Millisecond + time.Second)
	reg.Sweep()

	if reg.OfferCount() != 0 {
		t.Fatalf("expired offers kept: %d", reg.OfferCount())
	}
	if reg.TokenCount() != 0 {
		t.Fatalf("expired tokens kept: %d", reg.TokenCount())
	}
}

func TestSweepOnPrepareDropsExpired(t *testing.T) {
	clock := newFakeClock()
	reg := NewRegistryWithClock(clock.Now)

	if _, err := reg.Prepare("10.0.0.2:5555", testOffer()); err != nil {
		t.Fatalf("prepare: %v", err)
	}
	clock.Advance(time.Duration(contract.TransferOfferTTLms)*time.Millisecond + time.Second)
	if _, err := reg.Prepare("10.0.0.3:5555", testOffer()); err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if reg.OfferCount() != 1 {
		t.Fatalf("expired offer survived a prepare: %d", reg.OfferCount())
	}
}

func TestConcurrentTransfersIndependent(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)

	const transfers = 16
	var wg sync.WaitGroup
	errs := make([]error, transfers)

	for i := 0; i < transfers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			source := fmt.Sprintf("10.0.0.%d:5555", i+1)
			scene := bytes.Repeat([]byte{byte(i)}, 1000+i)

			transferID, err := reg.Prepare(source, lan.Offer{
				Alias:        fmt.Sprintf("peer-%d", i),
				Fingerprint:  fmt.Sprintf("fp-%d", i),
				ElementCount: i,
				Bytes:        len(scene),
				CanvasName:   fmt.Sprintf("canvas-%d", i),
			})
			if err != nil {
				errs[i] = err
				return
			}
			token, err := reg.Accept(transferID)
			if err != nil {
				errs[i] = err
				return
			}
			plan := NewPlan(transferID, scene)
			err = plan.Carry(
				func(c lan.Chunk) error { return reg.Upload(source, token, c) },
				func(d lan.Done) error {
					data, err := reg.Done(source, token, d.SHA256)
					if err != nil {
						return err
					}
					if !bytes.Equal(data, scene) {
						return fmt.Errorf("scene %d differs", i)
					}
					return nil
				},
			)
			errs[i] = err
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("transfer %d failed: %v", i, err)
		}
	}
	if reg.TokenCount() != 0 {
		t.Fatalf("tokens left over: %d", reg.TokenCount())
	}
}

func TestConcurrentSameTransfer(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	chunk, _ := NewPlan(transferID, []byte("scene")).Next()

	var wg sync.WaitGroup
	var mu sync.Mutex
	accepted := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := reg.Upload(source, token, chunk); err == nil {
				mu.Lock()
				accepted++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if accepted != 1 {
		t.Fatalf("want exactly one accepted chunk, got %d", accepted)
	}
}

func TestAcceptTwiceRejected(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)

	transferID, err := reg.Prepare("10.0.0.2:5555", testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := reg.Accept(transferID); err != nil {
		t.Fatalf("accept: %v", err)
	}
	_, err = reg.Accept(transferID)
	mustCode(t, err, contract.JSONRPCErrorInvalidToken)
}

func TestAcceptUnknownOffer(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	_, err := reg.Accept("no-such-transfer")
	mustCode(t, err, contract.JSONRPCErrorOfferExpired)
}

func TestChunkOutOfOrderRejected(t *testing.T) {
	reg := NewRegistryWithClock(newFakeClock().Now)
	source := "10.0.0.2:5555"

	transferID, err := reg.Prepare(source, testOffer())
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	token, err := reg.Accept(transferID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	chunk := lan.Chunk{TransferID: transferID, Seq: FirstSeq + 1, Total: 2, DataBase64: base64.StdEncoding.EncodeToString([]byte("b"))}
	err = reg.Upload(source, token, chunk)
	if err == nil {
		t.Fatal("an out-of-order chunk was accepted")
	}
	mustCode(t, err, CodeInvalidParams)
}

func TestErrorCodesMatchContract(t *testing.T) {
	cases := map[int]*Error{
		contract.JSONRPCErrorOfferExpired:    ErrOfferExpired,
		contract.JSONRPCErrorInvalidToken:    ErrInvalidToken,
		contract.JSONRPCErrorSceneTooLarge:   ErrSceneTooLarge,
		contract.JSONRPCErrorPeerUnreachable: ErrPeerUnreachable,
	}
	for code, err := range cases {
		if err.Code != code {
			t.Fatalf("error %s carries code %d, want %d", err.Msg, err.Code, code)
		}
	}
	if CodeOf(errors.New("plain")) != 0 {
		t.Fatal("a plain error must carry no code")
	}
	if CodeOf(ErrPeerUnreachable) != contract.JSONRPCErrorPeerUnreachable {
		t.Fatal("peer unreachable code wrong")
	}
}

func TestOfferCarriesTheReceiversDeadline(t *testing.T) {
	base := time.Unix(1700000000, 0)
	registry := NewRegistryWithClock(func() time.Time { return base })

	id, err := registry.Prepare("10.0.0.5:9000", lan.Offer{Alias: "a", Fingerprint: "f", ElementCount: 3, Bytes: 100, CanvasName: "c"})
	if err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	offer, ok := registry.Offer(id)
	if !ok {
		t.Fatal("Offer: want the staged offer")
	}
	want := base.Add(OfferTTL).UnixMilli()
	if offer.ExpiresAt != want {
		t.Fatalf("ExpiresAt = %d, want %d (the receiver's own deadline)", offer.ExpiresAt, want)
	}
}

func TestSenderSuppliedExpiryIsDiscarded(t *testing.T) {
	base := time.Unix(1700000000, 0)
	registry := NewRegistryWithClock(func() time.Time { return base })

	id, err := registry.Prepare("10.0.0.5:9000", lan.Offer{
		Alias: "a", Fingerprint: "f", ElementCount: 1, Bytes: 10, CanvasName: "c",
		ExpiresAt: base.Add(24 * time.Hour).UnixMilli(),
	})
	if err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	offer, _ := registry.Offer(id)
	if offer.ExpiresAt == base.Add(24*time.Hour).UnixMilli() {
		t.Fatal("a sender-supplied ExpiresAt was honoured; the receiver owns the deadline")
	}
	if offer.ExpiresAt != base.Add(OfferTTL).UnixMilli() {
		t.Fatalf("ExpiresAt = %d, want the receiver's deadline", offer.ExpiresAt)
	}
}
