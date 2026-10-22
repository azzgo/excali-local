package peering

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/excali-local/excali-bridge/internal/lan"
	"github.com/excali-local/excali-bridge/internal/transfer"
)

// maxFrameBytes is the sender's frame cap. It matches the LAN listener's own
// cap: one 200KB chunk is base64-encoded (~267KB) before it goes on the wire.
const maxFrameBytes = 1 << 20

var (
	// ErrAcceptTimeout is returned when the peer did not answer the offer
	// before the offer deadline.
	ErrAcceptTimeout = errors.New("peering: the peer did not answer the offer in time")
	// ErrRejected is returned when the peer refused the offer.
	ErrRejected = errors.New("peering: the peer rejected the offer")
)

// PeerError is an error frame the peer answered with.
type PeerError struct {
	// Code is the LAN surface error code of the refused frame.
	Code string
	// Message is the peer's own wording.
	Message string
	// TransferCode is the transfer error code the peer reported, or 0 when
	// the peer reported no transfer failure.
	TransferCode int
}

func (e *PeerError) Error() string {
	return fmt.Sprintf("peering: the peer refused the frame with %s: %s", e.Code, e.Message)
}

// TransferCode returns the transfer error code of err: the local transfer code
// for a local failure, the code the peer reported for a refused frame.
func TransferCode(err error) int {
	if code := transfer.CodeOf(err); code != 0 {
		return code
	}
	var peerErr *PeerError
	if errors.As(err, &peerErr) {
		return peerErr.TransferCode
	}
	return 0
}

// Result is the outcome of a completed carry.
type Result struct {
	// TransferID is the sender's own transfer id for the offer.
	TransferID string
	// PeerTransferID is the receiver's transfer id: the id the carry was
	// answered and staged under.
	PeerTransferID string
	// Token is the one-time token the receiver issued for the carry.
	Token string
	// Bytes is the size of the carried scene.
	Bytes int
	// SHA256 is the whole scene's digest.
	SHA256 string
}

// Send runs the sender side of the exchange against a peer address: it
// describes the canvas, waits for the receiver's acceptance, carries the
// scene in chunks and finishes with the whole scene's digest.
//
// The scene stays opaque bytes: it is never parsed, only moved.
func (h *Handler) Send(ctx context.Context, peerAddress string, offer lan.Offer, scene []byte) (Result, error) {
	if h.Registry == nil {
		return Result{}, errors.New("peering: no transfer registry is wired")
	}
	conn, err := net.DialTimeout("tcp", peerAddress, h.dialTimeout())
	if err != nil {
		return Result{}, fmt.Errorf("peering: dial %s: %w", peerAddress, err)
	}
	defer conn.Close()
	peer := &peerConn{
		conn:   conn,
		reader: bufio.NewReader(conn),
	}
	stop := h.watchContext(ctx, conn)
	defer stop()

	transferID, err := h.PrepareFor(peerAddress, offer)
	if err != nil {
		return Result{}, err
	}

	offered := offer
	offered.TransferID = transferID
	if err := h.writeFrame(ctx, peer, offerFrame{Type: lan.TypeOffer, Offer: offered}); err != nil {
		return Result{}, err
	}

	answer, err := h.readFrame(ctx, peer, h.acceptTimeout())
	if err != nil {
		if isTimeout(err) {
			return Result{}, fmt.Errorf("%w: %v", ErrAcceptTimeout, err)
		}
		return Result{}, err
	}
	switch answer.Type {
	case lan.TypeAccept, lan.TypeReject:
	case lan.TypeError:
		return Result{}, peerErrorOf(answer)
	default:
		return Result{}, fmt.Errorf("peering: the peer answered the offer with %q", answer.Type)
	}

	acceptance, err := h.ResolveAnswer(lan.Peer{Address: peerAddress}, answer)
	if err != nil {
		return Result{}, err
	}
	h.forgetOutgoing(acceptance.LocalTransferID)
	if !acceptance.Accepted {
		return Result{}, rejectionError(acceptance.Reason)
	}

	plan := transfer.NewPlan(acceptance.PeerTransferID, scene)
	if err := plan.Send(func(chunk lan.Chunk) error {
		return h.writeFrame(ctx, peer, chunkFrame{Type: lan.TypeChunk, Chunk: chunk, Token: acceptance.PeerToken})
	}); err != nil {
		return Result{}, err
	}
	if err := h.writeFrame(ctx, peer, doneFrame{Type: lan.TypeDone, Done: plan.Done(), Token: acceptance.PeerToken}); err != nil {
		return Result{}, err
	}

	confirmation, err := h.readFrame(ctx, peer, h.ackTimeout())
	if err != nil {
		if isTimeout(err) {
			return Result{}, fmt.Errorf("peering: the peer did not confirm the carry: %w", err)
		}
		return Result{}, err
	}
	switch confirmation.Type {
	case lan.TypeDone:
	case lan.TypeError:
		return Result{}, peerErrorOf(confirmation)
	default:
		return Result{}, fmt.Errorf("peering: the peer confirmed the carry with %q", confirmation.Type)
	}

	return Result{
		TransferID:     transferID,
		PeerTransferID: acceptance.PeerTransferID,
		Token:          acceptance.PeerToken,
		Bytes:          len(scene),
		SHA256:         plan.SHA256(),
	}, nil
}

// watchContext closes the connection when the context is cancelled, so a
// cancelled send never blocks until the read deadline.
func (h *Handler) watchContext(ctx context.Context, conn net.Conn) func() {
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()
	return func() { close(done) }
}

type peerConn struct {
	conn   net.Conn
	reader *bufio.Reader
}

func (h *Handler) writeFrame(ctx context.Context, peer *peerConn, frame any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	data, err := json.Marshal(frame)
	if err != nil {
		return fmt.Errorf("peering: marshal frame: %w", err)
	}
	if err := peer.conn.SetWriteDeadline(h.deadline(ctx, h.writeTimeout())); err != nil {
		return fmt.Errorf("peering: set write deadline: %w", err)
	}
	if _, err := peer.conn.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("peering: write frame: %w", err)
	}
	return nil
}

func (h *Handler) readFrame(ctx context.Context, peer *peerConn, timeout time.Duration) (lan.Message, error) {
	if err := ctx.Err(); err != nil {
		return lan.Message{}, err
	}
	if err := peer.conn.SetReadDeadline(h.deadline(ctx, timeout)); err != nil {
		return lan.Message{}, fmt.Errorf("peering: set read deadline: %w", err)
	}
	line, err := peer.reader.ReadBytes('\n')
	if err != nil {
		return lan.Message{}, err
	}
	if len(line) > maxFrameBytes {
		return lan.Message{}, fmt.Errorf("peering: the peer sent a frame of %d bytes, over the %d byte cap", len(line), maxFrameBytes)
	}
	return decodeFrame(line)
}

func (h *Handler) deadline(ctx context.Context, timeout time.Duration) time.Time {
	deadline := time.Now().Add(timeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		return ctxDeadline
	}
	return deadline
}

func decodeFrame(line []byte) (lan.Message, error) {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(line, &envelope); err != nil {
		return lan.Message{}, fmt.Errorf("peering: malformed frame: %w", err)
	}
	if envelope.Type == "" {
		return lan.Message{}, errors.New("peering: malformed frame: no type")
	}
	payload := make(json.RawMessage, len(line))
	copy(payload, line)
	return lan.Message{Type: envelope.Type, Payload: payload}, nil
}

func rejectionError(reason string) error {
	if reason == "" {
		return ErrRejected
	}
	return fmt.Errorf("%w: %s", ErrRejected, reason)
}

func peerErrorOf(msg lan.Message) error {
	var frame errorFrame
	if err := msg.Decode(&frame); err != nil {
		return errors.New("peering: malformed error frame")
	}
	return &PeerError{Code: frame.Code, Message: frame.Message, TransferCode: frame.TransferCode}
}

func isTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func (h *Handler) dialTimeout() time.Duration {
	if h.DialTimeout <= 0 {
		return 10 * time.Second
	}
	return h.DialTimeout
}

func (h *Handler) writeTimeout() time.Duration {
	if h.WriteTimeout <= 0 {
		return 30 * time.Second
	}
	return h.WriteTimeout
}

func (h *Handler) ackTimeout() time.Duration {
	if h.ReadTimeout <= 0 {
		return 30 * time.Second
	}
	return h.ReadTimeout
}

func (h *Handler) acceptTimeout() time.Duration {
	if h.AcceptTimeout <= 0 || h.AcceptTimeout > transfer.OfferTTL {
		return transfer.OfferTTL
	}
	return h.AcceptTimeout
}

type offerFrame struct {
	Type string `json:"type"`
	lan.Offer
}

type errorFrame struct {
	Type         string `json:"type"`
	Code         string `json:"code"`
	Message      string `json:"message"`
	TransferCode int    `json:"transferCode"`
}
