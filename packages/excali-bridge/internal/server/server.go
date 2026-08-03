// Package server implements the Agent Bridge daemon (Wayfinder Ticket 009):
// a 127.0.0.1-only HTTP+WS server that is BOTH the Leg-B server (activated
// Local editor pages dial out) AND the Leg-A endpoint for the bundled agent
// CLI. It is the cross-profile single-active-canvas arbiter (Tickets 016/017):
//
//   - holds at most ONE active page (the slot is keyed on the WS connection —
//     never tabId, which is per-profile and not global)
//   - a new activation (page handshake) DISPLACES the prior holder: the prior
//     page receives the `displaced` control message, then its socket closes
//   - agent connections (role="agent") are authenticated but never claim the
//     slot, so a CLI ping can not kick the active canvas
//   - single-instance is enforced by the pidfile (see internal/pidfile)
//
// Auth (Ticket 011): loopback-only, origin allow-list (chrome-extension://<id>)
// at upgrade, and a ≥128-bit per-session hex token in the handshake message.
// The token is never logged.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/pidfile"
	"github.com/excali-local/excali-bridge/internal/ws"
)

// keepaliveInterval is how often the server pings each connection; the peer's
// pong (auto at the protocol level) plus any app traffic resets the read
// deadline, so idle-but-alive connections never drop.
const keepaliveInterval = 30 * time.Second

// readTimeout is the per-frame read deadline (90s): comfortably above
// background-tab timer throttling (~60s) for the page's 20s heartbeat.
const readTimeout = 90 * time.Second

// ErrAlreadyRunning is returned by ListenAndServe when a live daemon already
// owns the pidfile (the caller should exit 0 and reuse it).
var ErrAlreadyRunning = errors.New("bridge daemon already running")

// defaultOriginRE mirrors the stub's allow-list: any chrome-extension page
// (ids are 32 chars [a-p]). Any profile/install shares the id for a store
// listing, so this naturally accepts every profile — intended: it is what
// makes cross-profile reachable (Ticket 016); the daemon arbitrates
// regardless of which profile.
var defaultOriginRE = regexp.MustCompile(`^chrome-extension://[a-p]{32}$`)

type client struct {
	conn   *ws.Conn
	role   string
	authed bool
}

type Config struct {
	// Ports is the fixed range to bind (first free wins). Default: contract.BridgePorts.
	Ports []int
	// StrictOrigin, when non-empty, allows exactly this origin instead of the regex.
	StrictOrigin string
	// Pidfile, when non-empty, is where the pidfile is written (default from pidfile.Path).
	Pidfile string
	// Logger receives non-token daemon logs.
	Logger *log.Logger
	// RPCTimeout bounds how long a routed agent request may wait for the active
	// page to answer before the daemon fails it (default 60s; large exports are slow).
	RPCTimeout time.Duration
}

// Server is the bridge daemon.
type Server struct {
	cfg  Config
	port int
	log  *log.Logger

	mu        sync.Mutex
	active    *client
	clients   map[*ws.Conn]*client
	srv       *http.Server
	closeOnce sync.Once

	rpcMu      sync.Mutex
	pending    map[string]*pendingRPC // key: JSON-RPC id (raw bytes as string)
	rpcTimeout time.Duration
}

// New returns a configured server.
func New(cfg Config) *Server {
	if len(cfg.Ports) == 0 {
		cfg.Ports = contract.BridgePorts[:]
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stderr, "[bridge] ", log.LstdFlags)
	}
	if cfg.RPCTimeout <= 0 {
		cfg.RPCTimeout = defaultRPCTimeout
	}
	return &Server{
		cfg:        cfg,
		log:        cfg.Logger,
		clients:    map[*ws.Conn]*client{},
		pending:    map[string]*pendingRPC{},
		rpcTimeout: cfg.RPCTimeout,
	}
}

// Port returns the bound port (valid after ListenAndServe has started).
func (s *Server) Port() int { return s.port }

// ListenAndServe binds the first free loopback port in the range, writes the
// pidfile (pid + port only — never the token), and serves until Shutdown.
func (s *Server) ListenAndServe() error {
	var ln net.Listener
	for _, p := range s.cfg.Ports {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err != nil {
			continue
		}
		ln = l
		break
	}
	if ln == nil {
		return errors.New("no free port in the bridge range")
	}
	s.port = ln.Addr().(*net.TCPAddr).Port

	// Single-instance race guard: if a live daemon appeared while we were
	// binding (e.g. two CLI invocations spawned concurrently), reuse it.
	if err := pidfileAliveAndHealthy(s.cfg.Pidfile); err == nil {
		ln.Close()
		return ErrAlreadyRunning
	}

	if err := pidfile.WriteAt(s.cfg.Pidfile, os.Getpid(), s.port); err != nil {
		ln.Close()
		return fmt.Errorf("pidfile: %w", err)
	}
	s.log.Printf("listening ws://127.0.0.1:%d (pid %d, loopback only)", s.port, os.Getpid())

	srv := &http.Server{Handler: s}
	s.srv = srv
	err := srv.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Shutdown stops accepting connections and closes all live WS connections.
func (s *Server) Shutdown(ctx context.Context) error {
	s.closeOnce.Do(func() {
		if s.srv != nil {
			_ = s.srv.Close() // stops the listener + idle conns
		}
		s.failAllPending(contract.JSONRPCErrorPageDisconnected, "daemon shutting down")
		s.mu.Lock()
		conns := make([]*ws.Conn, 0, len(s.clients))
		for c := range s.clients {
			conns = append(conns, c)
		}
		s.mu.Unlock()
		for _, c := range conns {
			_ = c.Close()
		}
	})
	return nil
}

// ServeHTTP dispatches /health and WS upgrades.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health" {
		s.handleHealth(w)
		return
	}
	origin := r.Header.Get("Origin")
	if !s.originAllowed(origin) {
		http.Error(w, "forbidden: origin not allowed", http.StatusForbidden)
		return
	}
	c, err := ws.UpgradeServer(w, r, readTimeout)
	if err != nil {
		http.Error(w, "agent bridge — WebSocket or GET /health\n", http.StatusBadRequest)
		return
	}
	cl := &client{conn: c, role: "unknown"}
	s.mu.Lock()
	s.clients[c] = cl
	s.mu.Unlock()
	go s.keepalive(cl)
	s.serveConn(cl)
}

func (s *Server) originAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	if s.cfg.StrictOrigin != "" {
		return origin == s.cfg.StrictOrigin
	}
	return defaultOriginRE.MatchString(origin)
}

// serveConn runs the connection's message loop until close/error.
func (s *Server) serveConn(cl *client) {
	defer s.cleanup(cl)
	c := cl.conn

	for {
		msg, err := c.ReadMessage()
		if err != nil {
			return
		}
		var m map[string]any
		if err := json.Unmarshal(msg, &m); err != nil {
			s.sendJSON(c, map[string]any{typeKey: "error", "message": "bad-json"})
			return
		}
		typ, _ := m[typeKey].(string)
		if typ == contract.WSHandshake {
			if !s.doHandshake(cl, m) {
				return
			}
			continue
		}
		if !cl.authed {
			s.sendJSON(c, map[string]any{typeKey: contract.WSHandshakeError, "reason": "not-authenticated"})
			return
		}
		s.handleMessage(cl, m, msg)
	}
}

const typeKey = "type"

// doHandshake validates token + role/version and, for pages, claims the
// single active slot (displacing any prior holder). Returns false to close.
func (s *Server) doHandshake(cl *client, m map[string]any) bool {
	c := cl.conn
	token, _ := m["token"].(string)
	if !contract.IsValidBridgeToken(token) {
		// Never log the token itself.
		s.sendJSON(c, map[string]any{typeKey: contract.WSHandshakeError, "reason": "bad-token"})
		s.log.Printf("handshake rejected: bad token")
		return false
	}
	role, _ := m["role"].(string)
	switch role {
	case "", contract.RolePage:
		role = contract.RolePage
	case contract.RoleAgent:
		ver, _ := m["version"].(string)
		if ver != contract.LegAProtocolVersion {
			s.sendJSON(c, map[string]any{typeKey: contract.WSHandshakeError, "reason": "unsupported-version"})
			return false
		}
	default:
		s.sendJSON(c, map[string]any{typeKey: contract.WSHandshakeError, "reason": "bad-role"})
		return false
	}
	cl.role = role
	cl.authed = true
	s.sendJSON(c, map[string]any{typeKey: contract.WSHandshakeOK})
	s.log.Printf("handshake ok (role=%s)", role)
	if role == contract.RolePage {
		s.claimActive(cl)
	}
	return true
}

// claimActive makes cl the single active page, displacing the prior holder
// (Ticket 017: new activation wins; the prior page gets `displaced` + close).
func (s *Server) claimActive(cl *client) {
	s.mu.Lock()
	prev := s.active
	s.active = cl
	s.mu.Unlock()
	if prev != nil && prev != cl {
		s.log.Printf("displacing prior active page")
		_ = s.sendJSON(prev.conn, map[string]any{typeKey: contract.WSDisplaced})
		_ = prev.conn.Close()
	}
}

// handleMessage dispatches Leg-B (type) and Leg-A (JSON-RPC) messages.
func (s *Server) handleMessage(cl *client, m map[string]any, raw []byte) {
	switch m[typeKey] {
	case contract.WSPing:
		_ = s.sendJSON(cl.conn, map[string]any{typeKey: contract.WSPong})
		return
	case contract.WSDisplaced:
		return // clients never send this; ignore
	}
	// Leg A: JSON-RPC 2.0 requests carry a "method" field (never a "type").
	if _, hasMethod := m["method"]; hasMethod {
		s.handleRPC(cl, m, raw)
		return
	}
	// Page JSON-RPC responses (jsonrpc + id + result/error, no "type") route
	// back to the waiting agent request.
	if isRPCResponse(m) {
		s.routeResponse(cl, raw)
		return
	}
	_ = s.sendJSON(cl.conn, map[string]any{typeKey: "error", "message": "unknown message type"})
}

func isRPCResponse(m map[string]any) bool {
	if m["jsonrpc"] != "2.0" {
		return false
	}
	if _, ok := m["id"]; !ok {
		return false
	}
	if _, hasResult := m["result"]; hasResult {
		return true
	}
	_, hasError := m["error"]
	return hasError
}

// handleRPC serves the versioned minimal JSON-RPC (ADR 0001, Ticket 005).
// Local methods (ping/commands.list/protocol.version) resolve here; canvas/v1
// methods are routed to the single active page.
func (s *Server) handleRPC(cl *client, m map[string]any, raw []byte) {
	if m["jsonrpc"] != "2.0" {
		s.sendRPCError(cl, nil, -32600, "invalid request")
		return
	}
	id := rpcID(raw)
	method, _ := m["method"].(string)
	switch {
	case contract.DaemonLocalMethods[method]:
		s.handleLocalMethod(cl, id, method)
	case contract.IsCanvasV1Method(method):
		s.routeToActive(cl, id, raw)
	default:
		s.sendRPCError(cl, id, -32601, "method not found")
	}
}

// handleLocalMethod resolves daemon-local methods without involving the page.
func (s *Server) handleLocalMethod(cl *client, id json.RawMessage, method string) {
	switch method {
	case "ping":
		s.sendRPCResult(cl, id, "pong")
	case "commands.list":
		methods := make([]string, 0, len(contract.CanvasV1Methods))
		for _, m := range contract.CanvasV1Methods {
			methods = append(methods, m)
		}
		s.sendRPCResult(cl, id, methods)
	case "protocol.version":
		s.sendRPCResult(cl, id, contract.CanvasV1Protocol)
	}
}

func (s *Server) sendRPCResult(cl *client, id json.RawMessage, result any) {
	_ = s.sendJSON(cl.conn, rpcResponse{JSONRPC: "2.0", ID: id, Result: result})
}

func (s *Server) sendRPCError(cl *client, id json.RawMessage, code int, message string) {
	_ = s.sendJSON(cl.conn, rpcResponse{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: message}})
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *Server) sendJSON(c *ws.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.WriteText(data)
}

func (s *Server) cleanup(cl *client) {
	s.mu.Lock()
	delete(s.clients, cl.conn)
	if s.active == cl {
		s.active = nil
	}
	s.mu.Unlock()
	_ = cl.conn.Close()
	// A disconnecting page must not leave agent requests hanging (displacement /
	// tab close / daemon shutdown): fail any in-flight request routed to it.
	s.failPendingFor(cl, contract.JSONRPCErrorPageDisconnected, "active canvas disconnected")
}

// keepalive sends protocol pings so idle-but-alive connections (and their
// read deadlines) never expire while dead peers are detected and dropped.
func (s *Server) keepalive(cl *client) {
	t := time.NewTicker(keepaliveInterval)
	defer t.Stop()
	for range t.C {
		if err := cl.conn.WritePing([]byte("k")); err != nil {
			_ = cl.conn.Close()
			return
		}
	}
}

func (s *Server) handleHealth(w http.ResponseWriter) {
	s.mu.Lock()
	active := s.active != nil
	pages, agents := 0, 0
	for _, cl := range s.clients {
		if !cl.authed {
			continue
		}
		if cl.role == contract.RolePage {
			pages++
		} else if cl.role == contract.RoleAgent {
			agents++
		}
	}
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":               true,
		"pid":              os.Getpid(),
		"port":             s.port,
		"version":          contract.LegAProtocolVersion,
		"active":           active,
		"pageConnections":  pages,
		"agentConnections": agents,
	})
}

// HealthOK reports whether a bridge daemon answers /health on the port.
func HealthOK(port int) bool {
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var h map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return false
	}
	return h["ok"] == true
}

// pidfileAliveAndHealthy reports nil when a live bridge daemon owns the
// pidfile (pid alive AND /health answers) — i.e. reuse, don't respawn.
// pidfile (pid alive AND /health answers) — i.e. reuse, don't respawn.
func pidfileAliveAndHealthy(override string) error {
	info, err := pidfile.ReadAt(override)
	if err != nil {
		return err
	}
	if !pidfile.Alive(info.PID) {
		return errors.New("pidfile pid not alive")
	}
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", info.Port))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("health not ok")
	}
	var h map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return err
	}
	if h["ok"] != true {
		return errors.New("health reports not ok")
	}
	return nil
}

// defaultRPCTimeout is how long the daemon waits for the active page to answer
// a routed agent request before failing it (large PNG exports are slow).
const defaultRPCTimeout = 60 * time.Second

// pendingRPC tracks an agent request forwarded to the active page.
type pendingRPC struct {
	agent *client // requester to receive the response
	page  *client // page the request was routed to
	id    json.RawMessage
	timer *time.Timer // timeout → fail the request
}

// rpcID extracts the exact raw JSON-RPC id bytes from a request/response.
func rpcID(raw []byte) json.RawMessage {
	var req struct {
		ID json.RawMessage `json:"id"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil
	}
	return req.ID
}

// rpcIDKey keys the pending map: the raw id bytes as a string. Both the
// request (from the agent) and the response (echoed by the page) carry the
// same id bytes, so the correlation is deterministic.
func rpcIDKey(raw []byte) string {
	return string(rpcID(raw))
}

// routeToActive forwards a canvas/v1 agent request to the single active page
// (Ticket 010 topology: agent ↔ daemon ↔ page) and registers a pending
// response correlation keyed by JSON-RPC id. Guards: no active page → error;
// duplicate in-flight id → error; page never answers → timeout error.
func (s *Server) routeToActive(cl *client, id json.RawMessage, raw []byte) {
	s.mu.Lock()
	active := s.active
	s.mu.Unlock()
	if active == nil || active == cl {
		s.sendRPCError(cl, id, contract.JSONRPCErrorNoActiveCanvas, "no active canvas")
		return
	}
	key := rpcIDKey(raw)

	s.rpcMu.Lock()
	if _, dup := s.pending[key]; dup {
		s.rpcMu.Unlock()
		s.sendRPCError(cl, id, -32600, "duplicate request id in flight")
		return
	}
	p := &pendingRPC{agent: cl, page: active, id: id}
	p.timer = time.AfterFunc(s.rpcTimeout, func() {
		s.rpcMu.Lock()
		if s.pending[key] == p {
			delete(s.pending, key)
			s.rpcMu.Unlock()
			s.sendRPCError(cl, id, contract.JSONRPCErrorPageTimeout, "active canvas did not respond in time")
			return
		}
		s.rpcMu.Unlock()
	})
	s.pending[key] = p
	s.rpcMu.Unlock()

	if err := active.conn.WriteText(raw); err != nil {
		s.failPendingKey(key, contract.JSONRPCErrorPageDisconnected, "active canvas unavailable")
	}
}

// routeResponse forwards a page JSON-RPC response back to the waiting agent.
func (s *Server) routeResponse(cl *client, raw []byte) {
	key := rpcIDKey(raw)
	s.rpcMu.Lock()
	p, ok := s.pending[key]
	if ok {
		p.timer.Stop()
		delete(s.pending, key)
	}
	s.rpcMu.Unlock()
	if !ok {
		return // stale (timed out / already failed) — ignore
	}
	_ = p.agent.conn.WriteText(raw)
}

// failPendingKey fails a single pending request by id (used when the forward
// write to the page fails immediately).
func (s *Server) failPendingKey(key string, code int, message string) {
	s.rpcMu.Lock()
	p, ok := s.pending[key]
	if ok {
		delete(s.pending, key)
	}
	s.rpcMu.Unlock()
	if !ok {
		return
	}
	p.timer.Stop()
	s.sendRPCError(p.agent, p.id, code, message)
}

// failPendingFor fails every in-flight request routed to a given page
// (called from cleanup when a page disconnects).
func (s *Server) failPendingFor(page *client, code int, message string) {
	s.rpcMu.Lock()
	var keys []string
	var pendings []*pendingRPC
	for key, p := range s.pending {
		if p.page == page {
			keys = append(keys, key)
			pendings = append(pendings, p)
		}
	}
	for _, key := range keys {
		delete(s.pending, key)
	}
	s.rpcMu.Unlock()
	for _, p := range pendings {
		p.timer.Stop()
		s.sendRPCError(p.agent, p.id, code, message)
	}
}

// failAllPending fails every in-flight request (daemon shutdown).
func (s *Server) failAllPending(code int, message string) {
	s.rpcMu.Lock()
	pendings := make([]*pendingRPC, 0, len(s.pending))
	for _, p := range s.pending {
		pendings = append(pendings, p)
	}
	s.pending = map[string]*pendingRPC{}
	s.rpcMu.Unlock()
	for _, p := range pendings {
		p.timer.Stop()
		s.sendRPCError(p.agent, p.id, code, message)
	}
}
