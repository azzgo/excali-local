// Package ws implements a minimal RFC 6455 WebSocket (server + client) on the
// stdlib only, so `go build` works fully offline with no module downloads.
//
// Supported: text frames, masked client→server frames, ping/pong control
// frames, the close handshake, and message fragmentation. Not supported (and
// not needed for the bridge's tiny JSON text messages): compression, binary
// extensions, subprotocols, permessage-deflate.
package ws

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA
)

// maxMessage caps an accepted data message (plenty for JSON control traffic).
const maxMessage = 1 << 20

var (
	// ErrClosed is returned by ReadMessage after a close handshake.
	ErrClosed = errors.New("websocket: closed")
	// ErrProtocol is returned on an RFC 6455 violation.
	ErrProtocol = errors.New("websocket: protocol error")
)

// wsGUID is the RFC 6455 magic GUID used to derive the accept key.
const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// acceptKey derives the Sec-WebSocket-Accept value for a client key.
func acceptKey(key string) string {
	h := sha1.Sum([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(h[:])
}

// Conn is a live WebSocket connection (one direction of masking per mode).
type Conn struct {
	conn        net.Conn
	br          *bufio.Reader
	writeMask   bool // true = client mode (mask outgoing frames)
	readTimeout time.Duration

	writeMu   sync.Mutex
	closeSent bool
}

func newConn(conn net.Conn, br *bufio.Reader, writeMask bool, readTimeout time.Duration) *Conn {
	return &Conn{conn: conn, br: br, writeMask: writeMask, readTimeout: readTimeout}
}

// SetReadDeadline forwards to the underlying connection.
func (c *Conn) SetReadDeadline(t time.Time) error { return c.conn.SetReadDeadline(t) }

// RemoteAddr returns the peer address.
func (c *Conn) RemoteAddr() net.Addr { return c.conn.RemoteAddr() }

// WriteText sends a text message (server → client, unmasked).
func (c *Conn) WriteText(payload []byte) error { return c.writeFrame(opText, payload) }

// WritePing sends a protocol-level ping (keepalive).
func (c *Conn) WritePing(payload []byte) error { return c.writeFrame(opPing, payload) }

// Close sends a close frame (1000) and closes the underlying connection.
func (c *Conn) Close() error {
	_ = c.writeClose(1000)
	return c.conn.Close()
}

// ReadMessage reads the next complete text/binary message, transparently
// replying to ping control frames and handling the close handshake. It
// returns ErrClosed after a peer close frame.
func (c *Conn) ReadMessage() ([]byte, error) {
	opcode, payload, fin, err := c.readFrame()
	if err != nil {
		return nil, err
	}
	switch opcode {
	case opPing:
		_ = c.writeFrame(opPong, payload)
		return c.ReadMessage()
	case opPong:
		return c.ReadMessage()
	case opClose:
		return nil, c.handleCloseFrame(payload)
	case opText, opBinary:
		if fin {
			return payload, nil
		}
		return c.readFragmented(payload)
	default:
		return nil, ErrProtocol
	}
}

// readFragmented accumulates continuation frames until FIN. Control frames
// may be interleaved per RFC 6455 §5.4.
func (c *Conn) readFragmented(first []byte) ([]byte, error) {
	msg := append([]byte(nil), first...)
	for {
		opcode, payload, fin, err := c.readFrame()
		if err != nil {
			return nil, err
		}
		switch opcode {
		case opContinuation:
			if len(msg)+len(payload) > maxMessage {
				return nil, ErrProtocol
			}
			msg = append(msg, payload...)
			if fin {
				return msg, nil
			}
		case opPing:
			_ = c.writeFrame(opPong, payload)
		case opPong:
			// keepalive only
		case opClose:
			return nil, c.handleCloseFrame(payload)
		default:
			return nil, ErrProtocol
		}
	}
}

func (c *Conn) handleCloseFrame(payload []byte) error {
	// Echo the peer's close code (or an empty close) per RFC 6455 §5.5.1.
	if err := c.writeClosePayload(payload); err != nil {
		return err
	}
	return ErrClosed
}

func (c *Conn) writeClose(code int) error {
	if c.closeSent {
		return nil
	}
	c.closeSent = true
	if code == 1005 || code == 0 {
		return c.writeFrame(opClose, nil)
	}
	buf := make([]byte, 2)
	binary.BigEndian.PutUint16(buf, uint16(code))
	return c.writeFrame(opClose, buf)
}

func (c *Conn) writeClosePayload(payload []byte) error {
	if c.closeSent {
		return nil
	}
	c.closeSent = true
	if len(payload) > 125 {
		payload = nil
	}
	return c.writeFrame(opClose, payload)
}

// readFrame reads a single WS frame. Client→server frames MUST be masked;
// server→client frames MUST NOT be. Every frame resets the read deadline so
// control traffic keeps idle connections alive.
func (c *Conn) readFrame() (opcode byte, payload []byte, fin bool, err error) {
	if err := c.conn.SetReadDeadline(time.Now().Add(c.readTimeout)); err != nil {
		return 0, nil, false, err
	}
	if c.br == nil {
		c.br = bufio.NewReader(c.conn)
	}
	b0, err := c.br.ReadByte()
	if err != nil {
		return 0, nil, false, err
	}
	fin = b0&0x80 != 0
	opcode = b0 & 0x0f
	if b0&0x70 != 0 {
		return 0, nil, false, ErrProtocol // RSV bits must be 0
	}
	b1, err := c.br.ReadByte()
	if err != nil {
		return 0, nil, false, err
	}
	masked := b1&0x80 != 0
	length := uint64(b1 & 0x7f)
	switch length {
	case 126:
		var b [2]byte
		if _, err := io.ReadFull(c.br, b[:]); err != nil {
			return 0, nil, false, err
		}
		length = uint64(binary.BigEndian.Uint16(b[:]))
	case 127:
		var b [8]byte
		if _, err := io.ReadFull(c.br, b[:]); err != nil {
			return 0, nil, false, err
		}
		length = binary.BigEndian.Uint64(b[:])
	}
	if length > maxMessage {
		return 0, nil, false, ErrProtocol
	}
	if opcode >= 0x8 && length > 125 {
		return 0, nil, false, ErrProtocol // control frames ≤ 125 bytes
	}

	expectMasked := !c.writeMask // server mode: peer frames must be masked
	if masked != expectMasked {
		return 0, nil, false, ErrProtocol
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(c.br, mask[:]); err != nil {
			return 0, nil, false, err
		}
	}
	payload = make([]byte, length)
	if _, err := io.ReadFull(c.br, payload); err != nil {
		return 0, nil, false, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i&3]
		}
	}
	return opcode, payload, fin, nil
}

// writeFrame writes a single frame (server frames unmasked, client frames
// masked). Serialized per connection via writeMu so the keepalive goroutine
// and message handlers never interleave frames.
func (c *Conn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	var hdr [14]byte
	n := 2
	hdr[0] = 0x80 | opcode
	l := len(payload)
	switch {
	case l < 126:
		hdr[1] = byte(l)
	case l <= 0xFFFF:
		hdr[1] = 126
		binary.BigEndian.PutUint16(hdr[2:4], uint16(l))
		n = 4
	default:
		hdr[1] = 127
		binary.BigEndian.PutUint64(hdr[2:10], uint64(l))
		n = 10
	}
	if c.writeMask {
		var mask [4]byte
		if _, err := rand.Read(mask[:]); err != nil {
			return err
		}
		hdr[1] |= 0x80
		copy(hdr[n:n+4], mask[:])
		for i := range payload {
			payload[i] ^= mask[i&3]
		}
		n += 4
	}
	if _, err := c.conn.Write(hdr[:n]); err != nil {
		return err
	}
	if len(payload) > 0 {
		if _, err := c.conn.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

// headerHasToken reports whether a comma-separated header contains a token
// (case-insensitive), e.g. Connection: keep-alive, Upgrade.
func headerHasToken(h http.Header, name, token string) bool {
	for _, v := range h.Values(name) {
		for _, part := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

// UpgradeServer performs the RFC 6455 server handshake on a hijacked HTTP
// request and returns a server-mode Conn. The caller is responsible for the
// origin check before calling this.
func UpgradeServer(w http.ResponseWriter, r *http.Request, readTimeout time.Duration) (*Conn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		!headerHasToken(r.Header, "Connection", "upgrade") {
		return nil, errors.New("not a websocket upgrade")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing Sec-WebSocket-Key")
	}
	if v := r.Header.Get("Sec-WebSocket-Version"); v != "13" {
		return nil, fmt.Errorf("unsupported websocket version %q", v)
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("response writer does not support hijacking")
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	accept := acceptKey(key)
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := rw.WriteString(resp); err != nil {
		conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}
	return newConn(conn, nil, false, readTimeout), nil
}

// Dial opens a client-mode WS connection to ws://addr (TCP only; no TLS — the
// daemon is loopback-only). origin is sent as the Origin header, matching how
// browser extension pages connect (Ticket 011 layer 2).
func Dial(ctx context.Context, addr, origin string, timeout time.Duration) (*Conn, error) {
	d := net.Dialer{Timeout: timeout}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		conn.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)

	var req strings.Builder
	fmt.Fprintf(&req, "GET / HTTP/1.1\r\n")
	fmt.Fprintf(&req, "Host: %s\r\n", addr)
	req.WriteString("Upgrade: websocket\r\n")
	req.WriteString("Connection: Upgrade\r\n")
	fmt.Fprintf(&req, "Sec-WebSocket-Key: %s\r\n", key)
	req.WriteString("Sec-WebSocket-Version: 13\r\n")
	fmt.Fprintf(&req, "Origin: %s\r\n", origin)
	req.WriteString("\r\n")
	if _, err := conn.Write([]byte(req.String())); err != nil {
		conn.Close()
		return nil, err
	}

	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, err
	}
	if !strings.Contains(statusLine, "101") {
		conn.Close()
		return nil, fmt.Errorf("upgrade failed: %s", strings.TrimSpace(statusLine))
	}
	headers := map[string]string{}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			headers[strings.ToLower(strings.TrimSpace(parts[0]))] = strings.TrimSpace(parts[1])
		}
	}
	if got := headers["sec-websocket-accept"]; got != acceptKey(key) {
		conn.Close()
		return nil, errors.New("bad sec-websocket-accept")
	}
	return newConn(conn, br, true, timeout), nil
}
