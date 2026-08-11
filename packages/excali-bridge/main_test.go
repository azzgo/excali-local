package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/pidfile"
	"github.com/excali-local/excali-bridge/internal/ws"
)

const bridgeStopTestOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"

const bridgeStopTestToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const bridgeStopTestProfileID = "11111111-2222-4333-8444-555555555555"

// TestCmdServeBridgeStopFullPath is the 045 acceptance criterion end-to-end at
// the process level: cmdServe (real main) → active page dials bridge.stop →
// {stopped:true} received BEFORE the socket closes → ListenAndServe returns →
// pidfile removed → exit 0. The server package tests cover authority + flush
// ordering; this one proves the pidfile teardown that only cmdServe performs.
func TestCmdServeBridgeStopFullPath(t *testing.T) {
	dir := t.TempDir()
	pidfilePath := filepath.Join(dir, "bridge.pid")
	t.Setenv("EXCALI_BRIDGE_PIDFILE", pidfilePath)

	done := make(chan int, 1)
	go func() { done <- run([]string{"serve"}) }()
	t.Cleanup(func() {
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Log("cmdServe did not exit")
		}
	})

	// Wait for the daemon to bind + write the pidfile.
	var port int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		info, err := pidfile.ReadAt(pidfilePath)
		if err == nil && pidfile.Alive(info.PID) {
			port = info.Port
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if port == 0 {
		t.Fatal("daemon never wrote a healthy pidfile")
	}

	// Dial as the active page (role=page with a profile id) and handshake.
	c, err := ws.Dial(context.Background(), fmt.Sprintf("127.0.0.1:%d", port), bridgeStopTestOrigin, 5*time.Second)
	if err != nil {
		t.Fatalf("page dial: %v", err)
	}
	defer c.Close()
	if err := writeJSON(c, map[string]any{
		"type": contract.WSHandshake, "token": bridgeStopTestToken, "origin": bridgeStopTestOrigin,
		contract.ProfileIDField: bridgeStopTestProfileID,
	}); err != nil {
		t.Fatal(err)
	}
	reply, err := readJSON(c)
	if err != nil {
		t.Fatal(err)
	}
	if typ, _ := reply["type"].(string); typ != contract.WSHandshakeOK {
		t.Fatalf("handshake rejected: %v", reply)
	}

	// Active page calls bridge.stop → {stopped:true} MUST arrive first.
	if err := writeJSON(c, map[string]any{"jsonrpc": "2.0", "id": 1, "method": contract.BridgeStopMethod}); err != nil {
		t.Fatal(err)
	}
	reply, err = readJSON(c)
	if err != nil {
		t.Fatalf("bridge.stop response: %v", err)
	}
	res, ok := reply["result"].(map[string]any)
	if !ok || res["stopped"] != true {
		t.Fatalf("bridge.stop result = %v, want {stopped:true}", reply["result"])
	}

	// The daemon then closes the socket (flush window → Shutdown).
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.ReadMessage(); err == nil {
		t.Fatal("socket should have been closed by the daemon shutdown")
	}

	// cmdServe exits 0 and removes the pidfile.
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("cmdServe exit = %d, want 0", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cmdServe did not exit after bridge.stop")
	}
	if _, err := os.Stat(pidfilePath); !os.IsNotExist(err) {
		t.Fatalf("pidfile %s should have been removed, stat err = %v", pidfilePath, err)
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
