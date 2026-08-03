package server

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/ws"
)

// rpcReply reads the next JSON-RPC response for id from c.
func rpcReply(t *testing.T, c *ws.Conn, wantID any) map[string]any {
	t.Helper()
	for {
		reply := mustReadJSON(t, c)
		if rid, ok := reply["id"]; ok && jsonEqual(rid, wantID) {
			return reply
		}
	}
}

func jsonEqual(a, b any) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return string(ab) == string(bb)
}

func sendRPC(t *testing.T, c *ws.Conn, id any, method string, params any) {
	t.Helper()
	req := map[string]any{"jsonrpc": "2.0", "id": id, "method": method}
	if params != nil {
		req["params"] = params
	}
	if err := writeJSON(c, req); err != nil {
		t.Fatal(err)
	}
}

func TestRoutedForwardAndResponse(t *testing.T) {
	s := startServer(t)
	page, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 1, "scene.get", nil)

	// The page receives the forwarded request (same id + method + params).
	req := mustReadJSON(t, page)
	if req["method"] != "scene.get" || req["id"] != float64(1) || req["jsonrpc"] != "2.0" {
		t.Fatalf("page got %v, want forwarded scene.get id=1", req)
	}

	// Page answers with a correlated response → agent receives it.
	pageResp := map[string]any{"jsonrpc": "2.0", "id": float64(1), "result": map[string]any{"elements": []any{}}}
	if err := writeJSON(page, pageResp); err != nil {
		t.Fatal(err)
	}
	reply := rpcReply(t, agent, 1)
	if reply["error"] != nil {
		t.Fatalf("agent got error: %v", reply)
	}
	res, _ := reply["result"].(map[string]any)
	if res["elements"] == nil {
		t.Fatalf("agent result missing elements: %v", reply)
	}
}

func TestRoutedStringIDCorrelation(t *testing.T) {
	s := startServer(t)
	page, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	// Two concurrent requests; the page answers out of order — each response
	// must reach the agent matched to its own id.
	sendRPC(t, agent, "req-a", "scene.elements", nil)
	sendRPC(t, agent, "req-b", "scene.elements", nil)

	// Page receives two forwarded requests.
	ra := mustReadJSON(t, page)
	rb := mustReadJSON(t, page)
	if ra["id"].(string) == rb["id"].(string) {
		t.Fatalf("expected two distinct ids, got %v and %v", ra["id"], rb["id"])
	}
	// Answer b first, then a (out of order).
	if err := writeJSON(page, map[string]any{"jsonrpc": "2.0", "id": rb["id"], "result": "resp-b"}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(page, map[string]any{"jsonrpc": "2.0", "id": ra["id"], "result": "resp-a"}); err != nil {
		t.Fatal(err)
	}
	first := rpcReply(t, agent, "req-b")
	if first["result"] != "resp-b" {
		t.Fatalf("expected resp-b first, got %v", first)
	}
	second := rpcReply(t, agent, "req-a")
	if second["result"] != "resp-a" {
		t.Fatalf("expected resp-a second, got %v", second)
	}
}

func TestNoActiveCanvasGuard(t *testing.T) {
	s := startServer(t)
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 7, "scene.get", nil)
	reply := rpcReply(t, agent, 7)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(contract.JSONRPCErrorNoActiveCanvas) {
		t.Fatalf("expected -32001 no active canvas, got %v", reply)
	}
}

func TestPageTimeout(t *testing.T) {
	cfg := testConfig(t)
	cfg.RPCTimeout = 100 * time.Millisecond
	s := startServerCfg(t, cfg)

	page, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 3, "scene.state", nil)
	req := mustReadJSON(t, page) // page receives but never answers
	_ = req

	reply := rpcReply(t, agent, 3)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(contract.JSONRPCErrorPageTimeout) {
		t.Fatalf("expected -32002 timeout, got %v", reply)
	}
}

func TestPageDisconnectFailsInflight(t *testing.T) {
	s := startServer(t)
	page, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 9, "scene.get", nil)
	req := mustReadJSON(t, page) // page receives the forwarded request
	_ = req

	// Page disconnects mid-request (tab close / displacement).
	page.Close()

	reply := rpcReply(t, agent, 9)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(contract.JSONRPCErrorPageDisconnected) {
		t.Fatalf("expected -32003 page disconnected, got %v", reply)
	}
}

func TestLocalMetaMethods(t *testing.T) {
	s := startServer(t)
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 10, "commands.list", nil)
	reply := rpcReply(t, agent, 10)
	list, ok := reply["result"].([]any)
	if !ok || len(list) != len(contract.AllMethods()) {
		t.Fatalf("commands.list result = %v", reply)
	}
	if !slices.Contains(contract.AllMethods(), "gallery.list") {
		t.Fatal("commands.list missing gallery/v1 methods")
	}

	sendRPC(t, agent, 11, "protocol.version", nil)
	reply = rpcReply(t, agent, 11)
	if reply["result"] != contract.CanvasV1Protocol {
		t.Fatalf("protocol.version = %v, want %q", reply, contract.CanvasV1Protocol)
	}

	// ping still local, even with no page connected.
	sendRPC(t, agent, 12, "ping", nil)
	reply = rpcReply(t, agent, 12)
	if reply["result"] != "pong" {
		t.Fatalf("ping = %v", reply)
	}
}

func TestUnknownMethod(t *testing.T) {
	s := startServer(t)
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}
	sendRPC(t, agent, 13, "canvas.read", nil)
	reply := rpcReply(t, agent, 13)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(-32601) {
		t.Fatalf("expected -32601, got %v", reply)
	}
}

func TestDuplicateInFlightID(t *testing.T) {
	s := startServer(t)
	page, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 1, "scene.get", nil)
	mustReadJSON(t, page) // first forwarded

	sendRPC(t, agent, 1, "scene.get", nil) // duplicate id while first in flight
	reply := rpcReply(t, agent, 1)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(-32600) {
		t.Fatalf("expected -32600 duplicate, got %v", reply)
	}
}

func mustReadJSON(t *testing.T, c *ws.Conn) map[string]any {
	t.Helper()
	m, err := readJSON(c)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return m
}

// ---------------------------------------------------------------------------
// Goal 3 — paired-control-connection model (Option A)
// ---------------------------------------------------------------------------

func TestControlPageHandshakeRequiresProfileID(t *testing.T) {
	s := startServer(t)
	// A control-page without the per-profile uuid is rejected.
	c, err := ws.Dial(context.Background(), fmt.Sprintf("127.0.0.1:%d", s.Port()), testOrigin, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := writeJSON(c, map[string]any{
		"type": contract.WSHandshake, "token": validToken, "origin": testOrigin,
		"role": contract.RoleControlPage,
	}); err != nil {
		t.Fatal(err)
	}
	reply := mustReadJSON(t, c)
	if reply["type"] != contract.WSHandshakeError || reply["reason"] != "missing-profile-id" {
		t.Fatalf("control-page without profileId reply = %v", reply)
	}
}

func TestControlPagesAreNotSingleton(t *testing.T) {
	s := startServer(t)
	// Two DIFFERENT profiles each hold a control connection simultaneously —
	// pairing is provably NOT a singleton (goal 3, Option A).
	if _, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken); err != nil {
		t.Fatalf("control A: %v", err)
	}
	if _, err := dialControlPage(t, s, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", validToken); err != nil {
		t.Fatalf("control B: %v", err)
	}
	h := health(t, s)
	if h["controlPageConnections"] != float64(2) {
		t.Fatalf("controlPageConnections = %v, want 2 (multi-profile non-singleton)", h["controlPageConnections"])
	}
	if h["active"] != false {
		t.Fatalf("control pages must not claim the active slot: %v", h)
	}
}

func TestSameProfileControlDisplaces(t *testing.T) {
	s := startServer(t)
	a, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken); err != nil {
		t.Fatal(err)
	}
	// The prior same-profile control connection is closed by the daemon.
	_ = a.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := a.ReadMessage(); err == nil {
		t.Fatal("prior same-profile control should have been closed")
	}
	h := health(t, s)
	if h["controlPageConnections"] != float64(1) {
		t.Fatalf("controlPageConnections = %v, want 1 after same-profile displacement", h["controlPageConnections"])
	}
}

func TestPairedRoutingPrefersActivePage(t *testing.T) {
	s := startServer(t)
	// A control page AND an active page are connected. A paired-only op must
	// route to the ACTIVE page (the agent's active context — zero ambiguity),
	// NOT to the control page.
	control, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken)
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	page, err := dialPage(t, s, validToken)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 21, "gallery.list", nil)
	req := mustReadJSON(t, page) // the ACTIVE page receives it
	if req["method"] != "gallery.list" {
		t.Fatalf("active page got %v, want gallery.list", req)
	}

	// The control page receives nothing.
	_ = control.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, err := control.ReadMessage(); err == nil {
		t.Fatal("control page should NOT receive a paired-only op while active")
	}
}

func TestPairedRoutingSingleControlFallback(t *testing.T) {
	s := startServer(t)
	// NO canvas active — exactly ONE control page → paired-only op routes there.
	control, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 22, "gallery.list", nil)
	req := mustReadJSON(t, control)
	if req["method"] != "gallery.list" {
		t.Fatalf("control page got %v, want gallery.list", req)
	}
	// Control page answers → the agent receives the correlated result.
	if err := writeJSON(control, map[string]any{"jsonrpc": "2.0", "id": float64(22), "result": []any{}}); err != nil {
		t.Fatal(err)
	}
	reply := rpcReply(t, agent, 22)
	if reply["error"] != nil {
		t.Fatalf("agent got error: %v", reply)
	}
	if _, ok := reply["result"].([]any); !ok {
		t.Fatalf("agent result = %v, want []", reply)
	}
}

func TestPairedRoutingAmbiguousControlPages(t *testing.T) {
	s := startServer(t)
	// NO canvas, TWO control pages → -32004 disambiguation error, never a guess.
	if _, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken); err != nil {
		t.Fatal(err)
	}
	if _, err := dialControlPage(t, s, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", validToken); err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 23, "gallery.list", nil)
	reply := rpcReply(t, agent, 23)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(contract.JSONRPCErrorAmbiguousTarget) {
		t.Fatalf("expected -32004 ambiguous, got %v", reply)
	}
}

func TestPairedRoutingNoPageAtAll(t *testing.T) {
	s := startServer(t)
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}
	sendRPC(t, agent, 24, "gallery.list", nil)
	reply := rpcReply(t, agent, 24)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(contract.JSONRPCErrorNoActiveCanvas) {
		t.Fatalf("expected -32001 no page, got %v", reply)
	}
}

func TestCanvasBoundIgnoresControlPages(t *testing.T) {
	s := startServer(t)
	// gallery.load/save are ACTIVATED — control pages must NOT satisfy them.
	if _, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken); err != nil {
		t.Fatal(err)
	}
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 25, "gallery.load", map[string]any{"id": "d1"})
	reply := rpcReply(t, agent, 25)
	errObj, ok := reply["error"].(map[string]any)
	if !ok || errObj["code"] != float64(contract.JSONRPCErrorNoActiveCanvas) {
		t.Fatalf("gallery.load with only controls = %v, want -32001", reply)
	}
}

func TestBridgeStatusReportsIdentities(t *testing.T) {
	s := startServer(t)
	if _, err := dialControlPage(t, s, "11111111-2222-4333-8444-555555555555", validToken); err != nil {
		t.Fatal(err)
	}
	page, err := dialPage(t, s, validToken) // active, identity testProfileID
	if err != nil {
		t.Fatal(err)
	}
	defer page.Close()
	agent, err := dialAgent(t, s, contract.LegAProtocolVersion)
	if err != nil {
		t.Fatal(err)
	}

	sendRPC(t, agent, 26, "bridge.status", nil)
	reply := rpcReply(t, agent, 26)
	st, ok := reply["result"].(map[string]any)
	if !ok {
		t.Fatalf("bridge.status result = %v", reply)
	}
	active, _ := st["activeCanvas"].(map[string]any)
	if active == nil || active["profileId"] != testProfileID {
		t.Fatalf("activeCanvas identity = %v, want profileId %q", active, testProfileID)
	}
	controls, _ := st["controlPages"].([]any)
	if len(controls) != 1 {
		t.Fatalf("controlPages = %v, want 1", controls)
	}
}
