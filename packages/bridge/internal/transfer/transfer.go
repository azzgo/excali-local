// Package transfer implements the Canvas transfer state machine (ADR 0013,
// docs/PEERING.md): the three-phase prepare / accept / carry exchange that
// travels on the LAN surface.
//
// The package is pure state. It holds pending offers, one-time tokens and the
// staged scene bytes of an accepted carry in memory, and it never touches the
// network. The LAN listener owns the wire; this package owns the rules — the
// 60s in-memory offer deadline, the token bound to source address + transferID
// + deadline, the 200KB chunking from seq 4, and the single whole-scene
// sha256 check.
//
// The scene is opaque. Nothing here parses Excalidraw content.
package transfer

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/lan"
)

// CodeInvalidParams is the JSON-RPC code for a malformed transfer frame.
const CodeInvalidParams = -32602

// Error is a transfer failure carrying the JSON-RPC error code the LAN
// surface answers with.
type Error struct {
	Code int
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

// Is reports whether target carries the same error code.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

// The transfer failures of ADR 0013 (docs/PEERING.md → Failure paths).
var (
	// ErrOfferExpired: the offer or its token passed its deadline.
	ErrOfferExpired = &Error{Code: contract.JSONRPCErrorOfferExpired, Msg: "transfer: offer expired"}
	// ErrInvalidToken: the token was wrong, replayed or bound to another
	// source address.
	ErrInvalidToken = &Error{Code: contract.JSONRPCErrorInvalidToken, Msg: "transfer: invalid token"}
	// ErrSceneTooLarge: the scene is over the 64MB transfer cap.
	ErrSceneTooLarge = &Error{Code: contract.JSONRPCErrorSceneTooLarge, Msg: "transfer: scene too large"}
	// ErrPeerUnreachable: the peer device went away.
	ErrPeerUnreachable = &Error{Code: contract.JSONRPCErrorPeerUnreachable, Msg: "transfer: peer unreachable"}
	// ErrInvalidRequest: a malformed frame.
	ErrInvalidRequest = &Error{Code: CodeInvalidParams, Msg: "transfer: invalid request"}
	// ErrDigestMismatch: the whole scene's sha256 did not match.
	ErrDigestMismatch = &Error{Code: CodeInvalidParams, Msg: "transfer: scene digest mismatch"}
)

// CodeOf returns the JSON-RPC error code of err, or 0 when err is not a
// transfer error.
func CodeOf(err error) int {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return 0
}

func coded(base *Error, format string, args ...any) *Error {
	return &Error{Code: base.Code, Msg: base.Msg + ": " + fmt.Sprintf(format, args...)}
}

// Clock returns the current time.
type Clock func() time.Time

// FirstSeq is the sequence number of the first chunk of a carry.
const FirstSeq = 4

// OfferTTL is the in-memory offer deadline.
const OfferTTL = time.Duration(contract.TransferOfferTTLms) * time.Millisecond

// Registry holds the Canvas transfer state: the pending offers, the issued
// tokens and the staged bytes of an accepted carry.
type Registry struct {
	mu     sync.Mutex
	now    Clock
	offers map[string]*offerState
	tokens map[string]*tokenState
}

type offerState struct {
	transferID string
	source     string
	offer      lan.Offer
	deadline   time.Time
	accepted   bool
}

type tokenState struct {
	transferID string
	source     string
	deadline   time.Time
	total      int
	next       int
	started    bool
	data       []byte
}

// NewRegistry returns a registry driven by the wall clock.
func NewRegistry() *Registry { return NewRegistryWithClock(time.Now) }

// NewRegistryWithClock returns a registry driven by the given clock.
func NewRegistryWithClock(now Clock) *Registry {
	if now == nil {
		now = time.Now
	}
	return &Registry{
		now:    now,
		offers: map[string]*offerState{},
		tokens: map[string]*tokenState{},
	}
}

// Prepare records an incoming offer's metadata and returns the transfer ID.
// The offer carries descriptions only — alias, fingerprint, element count,
// byte estimate, canvas name. A scene over the 64MB cap is refused here,
// before any byte is carried.
func (r *Registry) Prepare(source string, offer lan.Offer) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweepLocked()

	if offer.ElementCount < 0 {
		return "", coded(ErrInvalidRequest, "negative element count %d", offer.ElementCount)
	}
	if offer.Bytes < 0 {
		return "", coded(ErrInvalidRequest, "negative byte count %d", offer.Bytes)
	}
	if offer.Bytes > contract.TransferSceneMaxBytes {
		return "", coded(ErrSceneTooLarge, "%d bytes over the %d byte cap", offer.Bytes, contract.TransferSceneMaxBytes)
	}

	transferID := NewTransferID()
	offer.TransferID = transferID
	offer.ExpiresAt = 0
	r.offers[transferID] = &offerState{
		transferID: transferID,
		source:     source,
		offer:      offer,
		deadline:   r.now().Add(OfferTTL),
	}
	return transferID, nil
}

// PrepareFrame decodes an offer frame strictly and records it. A frame
// carrying a field outside the metadata set — element content, a thumbnail —
// is refused.
func (r *Registry) PrepareFrame(source string, raw json.RawMessage) (string, error) {
	offer, err := ParseOffer(raw)
	if err != nil {
		return "", err
	}
	return r.Prepare(source, offer)
}

// Accept accepts a pending offer and issues a one-time token bound to the
// offer's source address, its transfer ID and the offer's deadline.
func (r *Registry) Accept(transferID string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweepLocked()

	st, ok := r.offers[transferID]
	if !ok {
		return "", coded(ErrOfferExpired, "no pending offer %s", transferID)
	}
	if !r.now().Before(st.deadline) {
		delete(r.offers, transferID)
		return "", coded(ErrOfferExpired, "offer %s", transferID)
	}
	if st.accepted {
		return "", coded(ErrInvalidToken, "offer %s was already accepted", transferID)
	}
	st.accepted = true

	for token, ts := range r.tokens {
		if ts.transferID == transferID {
			delete(r.tokens, token)
		}
	}

	token := newToken()
	r.tokens[token] = &tokenState{
		transferID: transferID,
		source:     st.source,
		deadline:   st.deadline,
		next:       FirstSeq,
	}
	return token, nil
}

// Upload receives one chunk of an accepted carry and stages its bytes.
func (r *Registry) Upload(source, token string, chunk lan.Chunk) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	defer r.sweepLocked()

	st, err := r.lookupTokenLocked(source, token)
	if err != nil {
		return err
	}
	if chunk.TransferID != "" && chunk.TransferID != st.transferID {
		return coded(ErrInvalidRequest, "chunk belongs to transfer %s", chunk.TransferID)
	}
	if chunk.Total <= 0 {
		return coded(ErrInvalidRequest, "chunk declares %d chunks", chunk.Total)
	}
	if !st.started {
		st.started = true
		st.total = chunk.Total
	} else if st.total != chunk.Total {
		return coded(ErrInvalidRequest, "chunk declares %d chunks, expected %d", chunk.Total, st.total)
	}
	if chunk.Seq < st.next {
		return coded(ErrInvalidToken, "chunk %d was already carried", chunk.Seq)
	}
	if chunk.Seq != st.next {
		return coded(ErrInvalidRequest, "chunk %d out of order, expected %d", chunk.Seq, st.next)
	}

	data, err := base64.StdEncoding.DecodeString(chunk.DataBase64)
	if err != nil {
		return coded(ErrInvalidRequest, "chunk data is not base64")
	}
	if len(data) > contract.TransferChunkBytes {
		return coded(ErrInvalidRequest, "chunk of %d bytes over the %d byte chunk size", len(data), contract.TransferChunkBytes)
	}
	if len(st.data)+len(data) > contract.TransferSceneMaxBytes {
		delete(r.tokens, token)
		return coded(ErrSceneTooLarge, "%d bytes over the %d byte cap", len(st.data)+len(data), contract.TransferSceneMaxBytes)
	}

	st.data = append(st.data, data...)
	st.next++
	return nil
}

// Done ends a carry: it checks the whole scene's sha256 and hands over the
// staged bytes. A mismatch discards the staged scene.
func (r *Registry) Done(source, token, digest string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	defer r.sweepLocked()

	st, err := r.lookupTokenLocked(source, token)
	if err != nil {
		return nil, err
	}
	carried := st.next - FirstSeq
	if !st.started || carried != st.total {
		delete(r.tokens, token)
		return nil, coded(ErrInvalidRequest, "carry incomplete: %d of %d chunks", carried, st.total)
	}

	sum := sha256.Sum256(st.data)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), strings.TrimSpace(digest)) {
		delete(r.tokens, token)
		return nil, coded(ErrDigestMismatch, "expected %s, got %s", digest, hex.EncodeToString(sum[:]))
	}

	data := st.data
	delete(r.tokens, token)
	return data, nil
}

// Offer returns the metadata of a pending offer.
func (r *Registry) Offer(transferID string) (lan.Offer, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	st, ok := r.offers[transferID]
	if !ok {
		return lan.Offer{}, false
	}
	stamped := st.offer
	stamped.ExpiresAt = st.deadline.UnixMilli()
	return stamped, true
}

// PendingOffers returns the metadata of every unanswered offer.
func (r *Registry) PendingOffers() []lan.Offer {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]lan.Offer, 0, len(r.offers))
	for _, st := range r.offers {
		if !st.accepted {
			out = append(out, st.offer)
		}
	}
	return out
}

// Sweep drops the expired offers and tokens.
func (r *Registry) Sweep() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweepLocked()
}

// OfferCount returns the number of held offers.
func (r *Registry) OfferCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.offers)
}

// TokenCount returns the number of issued tokens.
func (r *Registry) TokenCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.tokens)
}

func (r *Registry) lookupTokenLocked(source, token string) (*tokenState, error) {
	st, ok := r.tokens[token]
	if !ok {
		return nil, coded(ErrInvalidToken, "unknown token")
	}
	if !r.now().Before(st.deadline) {
		delete(r.tokens, token)
		return nil, coded(ErrOfferExpired, "token deadline passed")
	}
	if st.source != source {
		return nil, coded(ErrInvalidToken, "token is bound to %s", st.source)
	}
	return st, nil
}

func (r *Registry) sweepLocked() {
	now := r.now()
	for id, st := range r.offers {
		if !now.Before(st.deadline) {
			delete(r.offers, id)
		}
	}
	for token, st := range r.tokens {
		if !now.Before(st.deadline) {
			delete(r.tokens, token)
		}
	}
}

// Plan is the sender-side chunking plan of one scene.
type Plan struct {
	transferID string
	scene      []byte
	total      int
	sent       int
}

// NewPlan plans the carry of scene under transferID.
func NewPlan(transferID string, scene []byte) *Plan {
	total := 0
	if len(scene) > 0 {
		total = (len(scene) + contract.TransferChunkBytes - 1) / contract.TransferChunkBytes
	}
	return &Plan{transferID: transferID, scene: scene, total: total}
}

// Total returns the number of chunks the plan carries.
func (p *Plan) Total() int { return p.total }

// Next returns the next chunk of the plan.
func (p *Plan) Next() (lan.Chunk, bool) {
	if p.sent >= p.total {
		return lan.Chunk{}, false
	}
	seq := FirstSeq + p.sent
	start := p.sent * contract.TransferChunkBytes
	end := start + contract.TransferChunkBytes
	if end > len(p.scene) {
		end = len(p.scene)
	}
	p.sent++
	return lan.Chunk{
		TransferID: p.transferID,
		Seq:        seq,
		Total:      p.total,
		DataBase64: base64.StdEncoding.EncodeToString(p.scene[start:end]),
	}, true
}

// Send walks the plan and hands every chunk to send.
func (p *Plan) Send(send func(lan.Chunk) error) error {
	for {
		chunk, ok := p.Next()
		if !ok {
			return nil
		}
		if err := send(chunk); err != nil {
			return err
		}
	}
}

// Carry walks the plan and finishes it with the done frame.
func (p *Plan) Carry(send func(lan.Chunk) error, finish func(lan.Done) error) error {
	if err := p.Send(send); err != nil {
		return err
	}
	return finish(p.Done())
}

// SHA256 is the whole scene's digest.
func (p *Plan) SHA256() string {
	sum := sha256.Sum256(p.scene)
	return hex.EncodeToString(sum[:])
}

// Done returns the done frame of the plan.
func (p *Plan) Done() lan.Done {
	return lan.Done{TransferID: p.transferID, SHA256: p.SHA256()}
}

// ParseOffer decodes an offer frame and refuses every field that is not
// descriptive metadata: element content and a thumbnail are content, and
// content never leaves the sender before acceptance.
func ParseOffer(raw json.RawMessage) (lan.Offer, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return lan.Offer{}, coded(ErrInvalidRequest, "empty offer frame")
	}
	var envelope struct {
		Type string `json:"type"`
		lan.Offer
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return lan.Offer{}, coded(ErrInvalidRequest, "offer frame: %v", err)
	}
	if decoder.More() {
		return lan.Offer{}, coded(ErrInvalidRequest, "offer frame: trailing data")
	}
	if envelope.Type != "" && envelope.Type != lan.TypeOffer {
		return lan.Offer{}, coded(ErrInvalidRequest, "unexpected frame type %q", envelope.Type)
	}
	return envelope.Offer, nil
}

// NewTransferID mints a transfer ID.
func NewTransferID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf[:])
}

func newToken() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return NewTransferID()
	}
	return hex.EncodeToString(buf[:])
}
