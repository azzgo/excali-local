// Package peering connects the LAN listener (internal/lan) to the Canvas
// transfer state machine (internal/transfer).
//
// The LAN listener owns the wire: the framing, the capability gate and the
// connection. The transfer registry owns the rules: the 60s in-memory offer
// deadline, the one-time token bound to source address + transferID +
// deadline, the 200KB chunking from seq 4 and the single whole-scene sha256
// check. This package is the glue between them and nothing else:
//
//   - Handler implements lan.Handler and dispatches every transfer frame to
//     the registry: offer → Prepare, accept/reject → Accept, chunk → Upload,
//     done → Done. It never parses the scene: it moves opaque bytes.
//   - Handler.Send runs the sender side of the exchange against a peer
//     address: Prepare, wait for the acceptance, carry the chunks, finish
//     with the digest. It dials TCP itself, because the LAN listener is a
//     listener and the sender is the one that reaches out.
//
// The receiver never caches canvas content before acceptance: an unaccepted
// offer holds metadata only, and the staged bytes live in a token state,
// which exists only after an acceptance.
//
// The lan frame types are the whole vocabulary — no frame type, no field name
// and no error code is invented here. Two payloads extend the lan frames
// because the transfer rules need them and the lan structs have no place for
// them: the chunk and the done frame carry the one-time token the receiver
// issued, and the accept and the reject frame echo the offer's transfer id
// so that the sender can match the answer to its pending offer.
package peering

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/lan"
	"github.com/excali-local/excali-bridge/internal/transfer"
)

// Decision is the receiver's answer to an incoming offer.
type Decision struct {
	// Accept is whether the receiver takes the canvas.
	Accept bool
	// Reason states why the receiver refused; it travels back to the sender.
	Reason string
}

// Decider answers an incoming offer. The daemon wires it to the extension
// page: with no page connected the decision never comes and the offer waits
// out its own deadline.
type Decider interface {
	Decide(ctx context.Context, peer lan.Peer, offer lan.Offer) (Decision, error)
}

// Deliverer hands the completed scene to the canvas. The daemon wires it to
// the load path; the scene stays opaque bytes.
type Deliverer interface {
	Deliver(ctx context.Context, peer lan.Peer, offer lan.Offer, scene []byte) error
}

// Handler answers the transfer frames of one peer connection. It implements
// lan.Handler.
type Handler struct {
	// Registry holds the transfer state: the pending offers, the issued
	// tokens and the staged bytes of an accepted carry.
	Registry *transfer.Registry
	// Decider answers incoming offers. A nil decider refuses every offer.
	Decider Decider
	// Deliverer receives the completed scene. A nil deliverer drops the
	// scene once its digest was checked.
	Deliverer Deliverer
	// DecisionTimeout bounds one acceptance wait on the receiving side. It
	// never exceeds the transfer package's offer deadline.
	DecisionTimeout time.Duration
	// AcceptTimeout bounds the sender's wait for the peer's answer. It
	// never exceeds the transfer package's offer deadline.
	AcceptTimeout time.Duration
	// DialTimeout bounds the sender's TCP dial.
	DialTimeout time.Duration
	// ReadTimeout bounds one frame read of the sender's connection.
	ReadTimeout time.Duration
	// WriteTimeout bounds one frame write of the sender's connection.
	WriteTimeout time.Duration

	mu       sync.Mutex
	outgoing map[string]outgoingOffer
}

type outgoingOffer struct {
	peerAddress string
	offer       lan.Offer
}

// Acceptance is the outcome of an offer answer.
type Acceptance struct {
	// Accepted is whether the peer took the canvas.
	Accepted bool
	// Reason states why the peer refused.
	Reason string
	// PeerTransferID is the peer's own transfer id: the id the carry was
	// answered and staged under.
	PeerTransferID string
	// PeerToken is the one-time token the peer issued for the carry.
	PeerToken string
	// LocalTransferID is this daemon's transfer id for the same offer.
	LocalTransferID string
	// LocalToken is the one-time token this daemon issued for the same
	// offer.
	LocalToken string
}

var _ lan.Handler = (*Handler)(nil)

// NewHandler returns a handler bound to a registry.
func NewHandler(registry *transfer.Registry, decider Decider, deliverer Deliverer) *Handler {
	return &Handler{
		Registry:        registry,
		Decider:         decider,
		Deliverer:       deliverer,
		DecisionTimeout: transfer.OfferTTL,
		AcceptTimeout:   transfer.OfferTTL,
		DialTimeout:     10 * time.Second,
		ReadTimeout:     30 * time.Second,
		WriteTimeout:    30 * time.Second,
		outgoing:        map[string]outgoingOffer{},
	}
}

// PrepareFor records an outgoing offer and returns this daemon's transfer id
// for it. The peer's answer is matched against it when it arrives.
func (h *Handler) PrepareFor(peerAddress string, offer lan.Offer) (string, error) {
	if h.Registry == nil {
		return "", errors.New("peering: no transfer registry is wired")
	}
	transferID, err := h.Registry.Prepare(peerAddress, offer)
	if err != nil {
		return "", err
	}
	h.mu.Lock()
	h.outgoing[transferID] = outgoingOffer{peerAddress: peerAddress, offer: offer}
	h.mu.Unlock()
	return transferID, nil
}

// HandleTransfer dispatches one LAN surface frame to the transfer registry.
func (h *Handler) HandleTransfer(ctx context.Context, peer lan.Peer, msg lan.Message) (lan.Reply, error) {
	switch msg.Type {
	case lan.TypeOffer:
		return h.handleOffer(ctx, peer, msg)
	case lan.TypeAccept:
		return h.handleAccept(peer, msg)
	case lan.TypeReject:
		return h.handleReject(peer, msg)
	case lan.TypeChunk:
		return h.handleChunk(peer, msg)
	case lan.TypeDone:
		return h.handleDone(ctx, peer, msg)
	}
	return errorReply(lan.CodeUnsupportedType, fmt.Sprintf("unsupported message type %q", msg.Type)), nil
}

func (h *Handler) handleOffer(ctx context.Context, peer lan.Peer, msg lan.Message) (lan.Reply, error) {
	if h.Registry == nil {
		return errorReply(lan.CodeNoHandler, "no transfer registry is wired"), nil
	}
	var offered lan.Offer
	if err := msg.Decode(&offered); err != nil {
		return transferErrorReply(transfer.ErrInvalidRequest), nil
	}
	transferID, err := h.Registry.PrepareFrame(peer.Address, msg.Payload)
	if err != nil {
		return transferErrorReply(err), nil
	}
	offer, _ := h.Registry.Offer(transferID)
	decision, err := h.decide(ctx, peer, offer)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return lan.Reply{}, nil
		}
		return transferErrorReply(err), nil
	}
	fields := map[string]any{
		"transferId":      transferID,
		"offerTransferId": offered.TransferID,
	}
	if !decision.Accept {
		fields["reason"] = decision.Reason
		return lan.Reply{Type: lan.TypeReject, Fields: fields}, nil
	}
	token, err := h.Registry.Accept(transferID)
	if err != nil {
		return transferErrorReply(err), nil
	}
	fields["token"] = token
	return lan.Reply{Type: lan.TypeAccept, Fields: fields}, nil
}

func (h *Handler) handleAccept(peer lan.Peer, msg lan.Message) (lan.Reply, error) {
	acceptance, err := h.ResolveAnswer(peer, msg)
	if err != nil {
		return transferErrorReply(err), nil
	}
	h.forgetOutgoing(acceptance.LocalTransferID)
	return lan.Reply{
		Type: lan.TypeAccept,
		Fields: map[string]any{
			"transferId": acceptance.LocalTransferID,
			"token":      acceptance.LocalToken,
		},
	}, nil
}

func (h *Handler) handleReject(peer lan.Peer, msg lan.Message) (lan.Reply, error) {
	acceptance, err := h.ResolveAnswer(peer, msg)
	if err != nil {
		return transferErrorReply(err), nil
	}
	h.forgetOutgoing(acceptance.LocalTransferID)
	return lan.Reply{
		Type: lan.TypeReject,
		Fields: map[string]any{
			"transferId": acceptance.LocalTransferID,
			"reason":     acceptance.Reason,
		},
	}, nil
}

func (h *Handler) handleChunk(peer lan.Peer, msg lan.Message) (lan.Reply, error) {
	if h.Registry == nil {
		return errorReply(lan.CodeNoHandler, "no transfer registry is wired"), nil
	}
	var frame chunkFrame
	if err := msg.Decode(&frame); err != nil {
		return transferErrorReply(transfer.ErrInvalidRequest), nil
	}
	if err := h.Registry.Upload(peer.Address, frame.Token, frame.Chunk); err != nil {
		return transferErrorReply(err), nil
	}
	return lan.Reply{}, nil
}

func (h *Handler) handleDone(ctx context.Context, peer lan.Peer, msg lan.Message) (lan.Reply, error) {
	if h.Registry == nil {
		return errorReply(lan.CodeNoHandler, "no transfer registry is wired"), nil
	}
	var frame doneFrame
	if err := msg.Decode(&frame); err != nil {
		return transferErrorReply(transfer.ErrInvalidRequest), nil
	}
	scene, err := h.Registry.Done(peer.Address, frame.Token, frame.SHA256)
	if err != nil {
		return transferErrorReply(err), nil
	}
	if h.Deliverer != nil {
		offer, _ := h.Registry.Offer(frame.TransferID)
		if err := h.Deliverer.Deliver(ctx, peer, offer, scene); err != nil {
			return transferErrorReply(err), nil
		}
	}
	return lan.Reply{
		Type: lan.TypeDone,
		Fields: map[string]any{
			"transferId": frame.TransferID,
			"sha256":     frame.SHA256,
		},
	}, nil
}

// ResolveAnswer matches an accept or reject frame to a pending outgoing offer
// and moves the local registry over the answer.
func (h *Handler) ResolveAnswer(peer lan.Peer, msg lan.Message) (Acceptance, error) {
	if h.Registry == nil {
		return Acceptance{}, errors.New("peering: no transfer registry is wired")
	}
	switch msg.Type {
	case lan.TypeAccept:
		var frame acceptFrame
		if err := msg.Decode(&frame); err != nil {
			return Acceptance{}, transfer.ErrInvalidRequest
		}
		localID, ok := h.resolveOutgoing(frame.OfferTransferID, frame.TransferID, peer)
		if !ok {
			return Acceptance{}, errors.New("peering: no offer of this daemon was pending for the peer")
		}
		localToken, err := h.Registry.Accept(localID)
		if err != nil {
			return Acceptance{}, err
		}
		return Acceptance{
			Accepted:        true,
			PeerTransferID:  frame.TransferID,
			PeerToken:       frame.Token,
			LocalTransferID: localID,
			LocalToken:      localToken,
		}, nil
	case lan.TypeReject:
		var frame rejectFrame
		if err := msg.Decode(&frame); err != nil {
			return Acceptance{}, transfer.ErrInvalidRequest
		}
		localID, ok := h.resolveOutgoing(frame.OfferTransferID, frame.TransferID, peer)
		if !ok {
			return Acceptance{}, errors.New("peering: no offer of this daemon was pending for the peer")
		}
		return Acceptance{
			Accepted:        false,
			Reason:          frame.Reason,
			LocalTransferID: localID,
		}, nil
	}
	return Acceptance{}, fmt.Errorf("peering: %q is not an answer to an offer", msg.Type)
}

func (h *Handler) resolveOutgoing(preferred, fallback string, peer lan.Peer) (string, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if preferred != "" {
		if _, ok := h.outgoing[preferred]; ok {
			return preferred, true
		}
	}
	if fallback != "" {
		if _, ok := h.outgoing[fallback]; ok {
			return fallback, true
		}
	}
	matches := make([]string, 0, 1)
	for id, entry := range h.outgoing {
		if entry.peerAddress == peer.Address {
			matches = append(matches, id)
		}
	}
	if len(matches) == 1 {
		return matches[0], true
	}
	return "", false
}

func (h *Handler) decide(ctx context.Context, peer lan.Peer, offer lan.Offer) (Decision, error) {
	if h.Decider == nil {
		return Decision{Accept: false, Reason: "no decider is wired"}, nil
	}
	decisionCtx, cancel := context.WithTimeout(ctx, h.decisionTimeout())
	defer cancel()
	return h.Decider.Decide(decisionCtx, peer, offer)
}

func (h *Handler) decisionTimeout() time.Duration {
	if h.DecisionTimeout <= 0 || h.DecisionTimeout > transfer.OfferTTL {
		return transfer.OfferTTL
	}
	return h.DecisionTimeout
}

func (h *Handler) forgetOutgoing(transferID string) {
	h.mu.Lock()
	delete(h.outgoing, transferID)
	h.mu.Unlock()
}

// lanCode maps a transfer failure onto the LAN surface's own error codes.
func lanCode(err error) string {
	switch transfer.CodeOf(err) {
	case contract.JSONRPCErrorSceneTooLarge:
		return lan.CodeFrameTooLarge
	case transfer.CodeInvalidParams:
		return lan.CodeMalformedFrame
	default:
		return lan.CodeHandlerFailed
	}
}

func errorReply(code, message string) lan.Reply {
	return lan.Reply{
		Type: lan.TypeError,
		Fields: map[string]any{
			"code":    code,
			"message": message,
		},
	}
}

func transferErrorReply(err error) lan.Reply {
	message := err.Error()
	code := transfer.CodeOf(err)
	if code != 0 {
		message = fmt.Sprintf("%s (transfer code %d)", message, code)
	}
	return lan.Reply{
		Type: lan.TypeError,
		Fields: map[string]any{
			"code":         lanCode(err),
			"message":      message,
			"transferCode": code,
		},
	}
}

type acceptFrame struct {
	Type string `json:"type"`
	lan.Accept
	OfferTransferID string `json:"offerTransferId"`
}

type rejectFrame struct {
	Type string `json:"type"`
	lan.Reject
	OfferTransferID string `json:"offerTransferId"`
}

type chunkFrame struct {
	Type string `json:"type"`
	lan.Chunk
	Token string `json:"token"`
}

type doneFrame struct {
	Type string `json:"type"`
	lan.Done
	Token string `json:"token"`
}
