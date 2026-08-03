package server

import (
	"encoding/json"
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
	if !ok || len(list) != len(contract.CanvasV1Methods) {
		t.Fatalf("commands.list result = %v", reply)
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
