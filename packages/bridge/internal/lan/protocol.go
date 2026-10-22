package lan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// LAN surface frame types. They travel peer ↔ peer on the LAN listener only —
// never on the loopback surface — and they carry the Canvas transfer
// vocabulary of docs/PEERING.md.
const (
	TypeOffer  = "transfer.offer"
	TypeAccept = "transfer.accept"
	TypeReject = "transfer.reject"
	TypeChunk  = "transfer.chunk"
	TypeDone   = "transfer.done"
	TypeError  = "error"
)

// LAN surface error codes. Every rejected frame answers with one of them —
// the LAN listener never drops a frame silently.
const (
	CodeUnsupportedType = "unsupported-type"
	CodeMalformedFrame  = "malformed-frame"
	CodeFrameTooLarge   = "frame-too-large"
	CodeNoHandler       = "no-handler"
	CodeHandlerFailed   = "handler-failed"
)

// transferTypes is the complete set of frames the LAN listener carries.
var transferTypes = map[string]bool{
	TypeOffer:  true,
	TypeAccept: true,
	TypeReject: true,
	TypeChunk:  true,
	TypeDone:   true,
}

// IsTransferType reports whether a frame type is one of the Canvas transfer
// frames the LAN listener carries.
func IsTransferType(typ string) bool { return transferTypes[typ] }

// Peer is the peer device on the other end of a LAN connection.
type Peer struct {
	// Address is the peer's remote address (host:port). A transfer token is
	// bound to it, so it is part of the identity of a transfer.
	Address string
}

// Message is one LAN surface frame.
type Message struct {
	// Type is the frame type.
	Type string

	// Payload is the raw JSON body of the frame.
	Payload json.RawMessage
}

// Decode unmarshals the frame payload into v.
func (m Message) Decode(v any) error {
	if len(m.Payload) == 0 {
		return errors.New("lan: empty payload")
	}
	return json.Unmarshal(m.Payload, v)
}

// Offer is the pre-acceptance description of an incoming Canvas transfer.
// It carries metadata only — no element content and no thumbnail.
type Offer struct {
	TransferID   string `json:"transferId"`
	Alias        string `json:"alias"`
	Fingerprint  string `json:"fingerprint"`
	ElementCount int    `json:"elementCount"`
	Bytes        int    `json:"bytes"`
	CanvasName   string `json:"canvasName"`
	// ExpiresAt is the receiver's offer deadline in epoch milliseconds. The
	// receiver sets it; a page displays the remaining time from this value and
	// never computes its own deadline.
	ExpiresAt int64 `json:"expiresAt,omitempty"`
}

// Accept is the receiver's acceptance, carrying the per-transfer token.
type Accept struct {
	TransferID string `json:"transferId"`
	Token      string `json:"token"`
}

// Reject is the receiver's refusal.
type Reject struct {
	TransferID string `json:"transferId"`
	Reason     string `json:"reason"`
}

// Chunk is one chunk of the opaque scene bytes.
type Chunk struct {
	TransferID string `json:"transferId"`
	Seq        int    `json:"seq"`
	Total      int    `json:"total"`
	DataBase64 string `json:"dataBase64"`
}

// Done ends a carry and states the whole scene's sha256.
type Done struct {
	TransferID string `json:"transferId"`
	SHA256     string `json:"sha256"`
}

// Reply is what a handler answers with. An empty Type means "no answer".
type Reply struct {
	// Type is the frame type of the answer.
	Type string

	// Fields are the answer's payload fields.
	Fields map[string]any

	// Close ends the connection after the reply is written.
	Close bool
}

// Handler answers the transfer frames of one peer connection. The LAN
// listener owns the connection, the framing, and the capability gate; the
// handler owns the transfer itself.
type Handler interface {
	HandleTransfer(ctx context.Context, peer Peer, msg Message) (Reply, error)
}

// HandlerFunc adapts a function to the Handler interface.
type HandlerFunc func(ctx context.Context, peer Peer, msg Message) (Reply, error)

// HandleTransfer calls f.
func (f HandlerFunc) HandleTransfer(ctx context.Context, peer Peer, msg Message) (Reply, error) {
	return f(ctx, peer, msg)
}

// parseError carries the LAN surface error code of a rejected frame.
type parseError struct {
	code    string
	message string
}

func (e *parseError) Error() string { return e.message }

func parseMessage(line []byte) (Message, *parseError) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(line, &envelope); err != nil {
		return Message{}, &parseError{
			code:    CodeMalformedFrame,
			message: fmt.Sprintf("malformed frame: %v", err),
		}
	}
	rawType, ok := envelope["type"]
	if !ok {
		return Message{}, &parseError{
			code:    CodeMalformedFrame,
			message: "frame has no \"type\"",
		}
	}
	var typ string
	if err := json.Unmarshal(rawType, &typ); err != nil {
		return Message{}, &parseError{
			code:    CodeMalformedFrame,
			message: "frame \"type\" is not a string",
		}
	}
	if typ == "" {
		return Message{}, &parseError{
			code:    CodeMalformedFrame,
			message: "frame \"type\" is empty",
		}
	}
	payload := make(json.RawMessage, len(line))
	copy(payload, line)
	return Message{Type: typ, Payload: payload}, nil
}
