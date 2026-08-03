package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/ws"
)

const testOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"

const validToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// testProfileID is a well-formed per-profile uuid (goal 3 identity handshake).
const testProfileID = "11111111-2222-4333-8444-555555555555"

func startServer(t *testing.T) *Server {
	t.Helper()
	return startServerCfg(t, testConfig(t))
}

func testConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Ports:   []int{0}, // ephemeral for tests
		Pidfile: filepath.Join(t.TempDir(), "bridge.pid"),
		Logger:  log.New(testWriter{t}, "test ", 0),
	}
}

func startServerCfg(t *testing.T, cfg Config) *Server {
	t.Helper()
	s := New(cfg)
	done := make(chan error, 1)
	go func() { done <- s.ListenAndServe() }()
	t.Cleanup(func() {
		_ = s.Shutdown(context.Background())
		select {
		case err := <-done:
			if err != nil {
				t.Logf("server exited: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Log("server did not exit")
		}
	})
	// Wait until the listener is up.
	for i := 0; i < 100; i++ {
		if s.Port() != 0 {
			return s
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("server never started")
	return nil
}

type testWriter struct{ t *testing.T }

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(strings.TrimSpace(string(p)))
	return len(p), nil
}

func dialPage(t *testing.T, s *Server, token string) (*ws.Conn, error) {
	t.Helper()
	return dialProfile(t, s, token, testProfileID, "", "")
}

// dialControlPage dials a control-page connection with a specific per-profile
// uuid (goal 3: multiple profiles may each hold a control connection).
func dialControlPage(t *testing.T, s *Server, profileID, token string) (*ws.Conn, error) {
	t.Helper()
	return dialProfile(t, s, token, profileID, contract.RoleControlPage, "")
}

func dialAgent(t *testing.T, s *Server, version string) (*ws.Conn, error) {
	t.Helper()
	return dialProfile(t, s, validToken, "", contract.RoleAgent, version)
}

func dialProfile(t *testing.T, s *Server, token, profileID, role, version string) (*ws.Conn, error) {
	t.Helper()
	c, err := ws.Dial(context.Background(), fmt.Sprintf("127.0.0.1:%d", s.Port()), testOrigin, 5*time.Second)
	if err != nil {
		return nil, err
	}
	hs := map[string]any{"type": contract.WSHandshake, "token": token, "origin": testOrigin}
	if profileID != "" {
		hs[contract.ProfileIDField] = profileID
	}
	if role != "" {
		hs["role"] = role
	}
	if version != "" {
		hs["version"] = version
	}
	if err := writeJSON(c, hs); err != nil {
		c.Close()
		return nil, err
	}
	reply, err := readJSON(c)
	if err != nil {
		c.Close()
		return nil, err
	}
	if t, _ := reply["type"].(string); t != contract.WSHandshakeOK {
		c.Close()
		return nil, fmt.Errorf("handshake rejected: %v", reply)
	}
	return c, nil
}

func health(t *testing.T, s *Server) map[string]any {
	t.Helper()
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", s.Port()))
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	defer resp.Body.Close()
	var h map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		t.Fatalf("health decode: %v", err)
	}
	return h
}

func waitHealth(t *testing.T, s *Server, wantActive bool, wantPages int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		h := health(t, s)
		if h["active"] == wantActive && h["pageConnections"] == float64(wantPages) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("health never reached active=%v pages=%d (last=%v)", wantActive, wantPages, health(t, s))
}

func TestPageClaimAndDisplacement(t *testing.T) {
	s := startServer(t)

	a, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatalf("page A: %v", err)
	}
	waitHealth(t, s, true, 1)

	b, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatalf("page B: %v", err)
	}

	// A must receive `displaced`, then the connection closes.
	msg, err := readJSON(a)
	if err != nil {
		t.Fatalf("A read displaced: %v", err)
	}
	if msg["type"] != contract.WSDisplaced {
		t.Fatalf("A got %v, want displaced", msg["type"])
	}
	// A is closed by the daemon (next read errors).
	_ = a.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := a.ReadMessage(); err == nil {
		t.Fatal("A should have been closed after displacement")
	}

	// Daemon still holds exactly one active page (B).
	waitHealth(t, s, true, 1)

	// B still works: Leg-B ping → pong.
	if err := writeJSON(b, map[string]any{"type": contract.WSPing}); err != nil {
		t.Fatalf("B ping write: %v", err)
	}
	reply, err := readJSON(b)
	if err != nil {
		t.Fatalf("B ping read: %v", err)
	}
	if reply["type"] != contract.WSPong {
		t.Fatalf("B got %v, want pong", reply)
	}
}

func TestAgentNeverClaimsSlot(t *testing.T) {
	s := startServer(t)

	// An agent CLI connection must NOT displace or claim the active slot.
	page, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	waitHealth(t, s, true, 1)

	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatalf("agent: %v", err)
	}
	waitHealth(t, s, true, 1) // page still active

	// Leg-A JSON-RPC ping → result pong.
	if err := writeJSON(agent, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping", "params": map[string]any{}}); err != nil {
		t.Fatalf("agent rpc write: %v", err)
	}
	reply, err := readJSON(agent)
	if err != nil {
		t.Fatalf("agent rpc read: %v", err)
	}
	if reply["result"] != "pong" {
		t.Fatalf("agent rpc got %v, want result pong", reply)
	}

	// The page was never displaced: it can still ping.
	if err := writeJSON(page, map[string]any{"type": contract.WSPing}); err != nil {
		t.Fatal(err)
	}
	if reply, err := readJSON(page); err != nil || reply["type"] != contract.WSPong {
		t.Fatalf("page ping after agent: %v %v", reply, err)
	}
}

func TestAuthRejections(t *testing.T) {
	s := startServer(t)

	// Bad origin → 403 at the WS upgrade (Dial sees a non-101).
	_, err := ws.Dial(context.Background(), fmt.Sprintf("127.0.0.1:%d", s.Port()), "https://evil.example.com", 2*time.Second)
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("bad origin dial = %v, want 403", err)
	}

	// Bad (short) token → handshake_error bad-token.
	c, err := ws.Dial(context.Background(), fmt.Sprintf("127.0.0.1:%d", s.Port()), testOrigin, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := writeJSON(c, map[string]any{"type": contract.WSHandshake, "token": "deadbeef", "origin": testOrigin}); err != nil {
		t.Fatal(err)
	}
	reply, err := readJSON(c)
	if err != nil {
		t.Fatal(err)
	}
	if reply["type"] != contract.WSHandshakeError || reply["reason"] != "bad-token" {
		t.Fatalf("bad token reply = %v", reply)
	}

	// Agent with unsupported version → handshake_error unsupported-version.
	c2, err := ws.Dial(context.Background(), fmt.Sprintf("127.0.0.1:%d", s.Port()), testOrigin, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c2.Close()
	if err := writeJSON(c2, map[string]any{
		"type": contract.WSHandshake, "token": validToken, "origin": testOrigin,
		"role": contract.RoleAgent, "version": "999",
	}); err != nil {
		t.Fatal(err)
	}
	reply, err = readJSON(c2)
	if err != nil {
		t.Fatal(err)
	}
	if reply["type"] != contract.WSHandshakeError || reply["reason"] != "unsupported-version" {
		t.Fatalf("bad version reply = %v", reply)
	}
}

func TestRPCRegistryErrors(t *testing.T) {
	s := startServer(t)
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	// Unknown method → -32601.
	if err := writeJSON(agent, map[string]any{"jsonrpc": "2.0", "id": 7, "method": "canvas.read"}); err != nil {
		t.Fatal(err)
	}
	reply, err := readJSON(agent)
	if err != nil {
		t.Fatal(err)
	}
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(-32601) {
		t.Fatalf("unknown method reply = %v", reply)
	}

	// Invalid request (bad jsonrpc version) → -32600.
	if err := writeJSON(agent, map[string]any{"jsonrpc": "1.0", "id": 8, "method": "ping"}); err != nil {
		t.Fatal(err)
	}
	reply, err = readJSON(agent)
	if err != nil {
		t.Fatal(err)
	}
	errObj, ok = reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(-32600) {
		t.Fatalf("invalid request reply = %v", reply)
	}
}

func writeJSON(c *ws.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.WriteText(data)
}

func readJSON(c *ws.Conn) (map[string]any, error) {
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	data, err := c.ReadMessage()
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}
