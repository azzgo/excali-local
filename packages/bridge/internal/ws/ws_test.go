package ws

import (
	"bufio"
	"encoding/binary"
	"errors"
	"net"
	"testing"
	"time"
)

// TestAcceptKeyVector checks the RFC 6455 §1.3 example key.
func TestAcceptKeyVector(t *testing.T) {
	got := acceptKey("dGhlIHNhbXBsZSBub25jZQ==")
	want := "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
	if got != want {
		t.Fatalf("acceptKey = %q, want %q", got, want)
	}
}

// pipePair returns a server-mode and client-mode Conn over a TCP loopback
// pair (writes are buffered, so tests don't deadlock on unread frames).
func pipePair(t *testing.T) (*Conn, *Conn) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	accepted := make(chan net.Conn, 1)
	go func() {
		c, err := ln.Accept()
		if err == nil {
			accepted <- c
		}
	}()
	cliConn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	serverConn := <-accepted
	_ = ln.Close()

	server := newConn(serverConn, bufio.NewReader(serverConn), false, 5*time.Second)
	client := newConn(cliConn, bufio.NewReader(cliConn), true, 5*time.Second)
	t.Cleanup(func() { server.Close(); client.Close() })
	return server, client
}

func TestTextRoundTrip(t *testing.T) {
	server, client := pipePair(t)

	go func() {
		if err := client.WriteText([]byte(`{"type":"ping"}`)); err != nil {
			t.Errorf("client write: %v", err)
		}
	}()
	got, err := server.ReadMessage()
	if err != nil {
		t.Fatalf("server read: %v", err)
	}
	if string(got) != `{"type":"ping"}` {
		t.Fatalf("server got %q", got)
	}

	go func() {
		if err := server.WriteText([]byte(`{"type":"pong"}`)); err != nil {
			t.Errorf("server write: %v", err)
		}
	}()
	got, err = client.ReadMessage()
	if err != nil {
		t.Fatalf("client read: %v", err)
	}
	if string(got) != `{"type":"pong"}` {
		t.Fatalf("client got %q", got)
	}
}

func TestPingPong(t *testing.T) {
	server, client := pipePair(t)

	go func() {
		if err := server.WritePing([]byte("k")); err != nil {
			t.Errorf("ping: %v", err)
		}
	}()
	// The client must transparently answer the ping; the next real message is
	// whatever the server sends after.
	go func() {
		time.Sleep(50 * time.Millisecond)
		if err := server.WriteText([]byte("after")); err != nil {
			t.Errorf("write after: %v", err)
		}
	}()
	got, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("client read: %v", err)
	}
	if string(got) != "after" {
		t.Fatalf("client got %q, want the message after the ping", got)
	}
}

func TestCloseHandshake(t *testing.T) {
	server, client := pipePair(t)

	go func() {
		_ = client.Close()
	}()
	_, err := server.ReadMessage()
	if !errors.Is(err, ErrClosed) {
		t.Fatalf("server read after close = %v, want ErrClosed", err)
	}
}

func TestFragmentedMessage(t *testing.T) {
	server, client := pipePair(t)

	go func() {
		// Two-fragment masked text message: "hel" (no FIN) + "lo" (FIN).
		writeRaw(t, client, 0x01, []byte("hel"))
		writeRaw(t, client, 0x80, []byte("lo"))
	}()
	got, err := server.ReadMessage()
	if err != nil {
		t.Fatalf("read fragmented: %v", err)
	}
	if string(got) != "hello" {
		t.Fatalf("got %q, want hello", got)
	}
}

// writeRaw sends a hand-built masked frame (fragment testing only; zero mask
// key so the payload passes through unchanged).
func writeRaw(t *testing.T, c *Conn, b0 byte, payload []byte) {
	t.Helper()
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	hdr := []byte{b0, 0x80 | byte(len(payload)), 0x00, 0x00, 0x00, 0x00}
	if _, err := c.conn.Write(hdr); err != nil {
		t.Fatalf("raw write: %v", err)
	}
	if _, err := c.conn.Write(payload); err != nil {
		t.Fatalf("raw payload: %v", err)
	}
}

// TestCloseWithCode checks a close frame carrying a code round-trips.
func TestCloseWithCode(t *testing.T) {
	server, client := pipePair(t)

	go func() {
		payload := make([]byte, 2)
		binary.BigEndian.PutUint16(payload, 4001)
		writeRaw(t, client, 0x88, payload)
	}()
	_, err := server.ReadMessage()
	if !errors.Is(err, ErrClosed) {
		t.Fatalf("got %v, want ErrClosed", err)
	}
}

func TestServerRejectsUnmaskedClientFrame(t *testing.T) {
	server, client := pipePair(t)

	// The client sends an unmasked frame — a protocol violation the
	// server-mode reader must reject.
	go func() {
		client.writeMu.Lock()
		defer client.writeMu.Unlock()
		_, _ = client.conn.Write([]byte{0x81, 0x02, 'h', 'i'}) // no mask bit
	}()
	_, err := server.ReadMessage()
	if !errors.Is(err, ErrProtocol) {
		t.Fatalf("got %v, want ErrProtocol", err)
	}
}
