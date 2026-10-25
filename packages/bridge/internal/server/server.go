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
	"sync/atomic"
	"time"

	"github.com/excali-local/excali-bridge/internal/autostart"
	"github.com/excali-local/excali-bridge/internal/config"
	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/fonts"
	"github.com/excali-local/excali-bridge/internal/lan"
	"github.com/excali-local/excali-bridge/internal/peering"
	"github.com/excali-local/excali-bridge/internal/pidfile"
	"github.com/excali-local/excali-bridge/internal/transfer"
	"github.com/excali-local/excali-bridge/internal/ws"
)

// keepaliveInterval is how often the server pings each connection; the peer's
// pong (auto at the protocol level) plus any app traffic resets the read
// deadline, so idle-but-alive connections never drop.
const keepaliveInterval = 30 * time.Second

// pageMessageLimit caps one inbound page frame. A scene read (scene.get)
// returns every element, the app state and the file table — a real board with
// embedded images is far past the 1MB control-traffic default, and refusing it
// as a protocol error tears the connection down, surfacing to the agent as
// "page disconnected" instead of a scene.
const pageMessageLimit = 256 << 20

// readTimeout is the per-frame read deadline (90s): comfortably above
// background-tab timer throttling (~60s) for the page's 20s heartbeat.
const readTimeout = 90 * time.Second

// ErrAlreadyRunning is returned by ListenAndServe when a live daemon already
// owns the pidfile (the caller should exit 0 and reuse it).
var ErrAlreadyRunning = errors.New("bridge daemon already running")

// defaultOriginRE mirrors the stub's allow-list: any extension page — a
// chrome-extension://<id> (32 chars of [a-p]) or a Firefox moz-extension://<uuid>.
// Any profile/install shares the id for a store
// listing, so this naturally accepts every profile — intended: it is what
// makes cross-profile reachable (Ticket 016); the daemon arbitrates
// regardless of which profile.
var defaultOriginRE = regexp.MustCompile(
	`^(chrome-extension://[a-p]{32}|moz-extension://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`)

type client struct {
	conn     *ws.Conn
	role     string
	authed   bool
	identity string // per-profile uuid (page + control-page roles, goal 3)
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
	port atomic.Int32
	log  *log.Logger

	mu      sync.Mutex
	active  *client
	clients map[*ws.Conn]*client
	// controls holds one control-page connection per paired profile, keyed by the
	// per-profile uuid (goal 3, Option A). NOT a singleton: N profiles may each
	// hold a control connection simultaneously; a second dial from the SAME
	// profile displaces the prior one (mirrors the active slot).
	controls   map[string]*client
	srv        atomic.Pointer[http.Server]
	closeOnce  sync.Once
	rpcMu      sync.Mutex
	pending    map[string]*pendingRPC // key: JSON-RPC id (raw bytes as string)
	rpcTimeout time.Duration
	peering    *peering.Handler
	offers     map[string]chan peering.Decision
	lanSrv     atomic.Pointer[lan.Server]
	lanPort    atomic.Int32
	peerAddrs  atomic.Pointer[[]string]
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
	s := &Server{
		cfg:        cfg,
		log:        cfg.Logger,
		offers:     map[string]chan peering.Decision{},
		clients:    map[*ws.Conn]*client{},
		controls:   map[string]*client{},
		pending:    map[string]*pendingRPC{},
		rpcTimeout: cfg.RPCTimeout,
	}
	s.peering = peering.NewHandler(transfer.NewRegistry(), pageDecider{srv: s}, nil)
	return s
}

// Port returns the bound port (valid after ListenAndServe has started).
func (s *Server) Port() int { return int(s.port.Load()) }

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
	port := int32(ln.Addr().(*net.TCPAddr).Port)
	s.port.Store(port)

	// Single-instance race guard: if a live daemon appeared while we were
	// binding (e.g. two CLI invocations spawned concurrently), reuse it.
	if err := pidfileAliveAndHealthy(s.cfg.Pidfile); err == nil {
		ln.Close()
		return ErrAlreadyRunning
	}

	if err := pidfile.WriteAt(s.cfg.Pidfile, os.Getpid(), int(port)); err != nil {
		ln.Close()
		return fmt.Errorf("pidfile: %w", err)
	}
	s.log.Printf("listening ws://127.0.0.1:%d (pid %d, loopback only)", port, os.Getpid())

	srv := &http.Server{Handler: s}
	s.srv.Store(srv)
	err := srv.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Shutdown stops accepting connections and closes all live WS connections.
func (s *Server) Shutdown(ctx context.Context) error {
	s.closeOnce.Do(func() {
		if srv := s.srv.Load(); srv != nil {
			_ = srv.Close() // stops the listener + idle conns
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
	c.SetMaxMessage(pageMessageLimit)
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
			// Log the teardown reason (EOF vs read-deadline timeout vs protocol
			// violation) so transient drops are diagnosable — without this every
			// drop was silent and surfaced only as -32003 at the CLI.
			s.log.Printf("conn %s: read error: %v", cl.identity, err)
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

// doHandshake validates token + role/version and, for pages, records the
// per-profile identity and claims the single active slot (displacing any prior
// holder) or registers a control connection (per-profile, non-singleton).
// Returns false to close.
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
	case "", contract.RolePage, contract.RoleControlPage:
		// Page + control-page MUST present the per-profile identity uuid (goal 3):
		// origin alone cannot distinguish profiles (store-install ids are shared).
		identity, _ := m[contract.ProfileIDField].(string)
		if !isValidProfileID(identity) {
			s.sendJSON(c, map[string]any{typeKey: contract.WSHandshakeError, "reason": "missing-profile-id"})
			return false
		}
		cl.identity = identity
		if role == "" {
			role = contract.RolePage
		}
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
	switch role {
	case contract.RolePage:
		s.claimActive(cl)
	case contract.RoleControlPage:
		s.registerControl(cl)
	}
	return true
}

// isValidProfileID accepts a reasonably-formed per-profile uuid (lowercase hex
// with dashes, 36 chars — crypto.randomUUID() shape).
func isValidProfileID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if c == '-' {
			continue
		}
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// registerControl adds cl to the control-page set keyed by its per-profile
// uuid. One control connection per profile (a second dial from the same profile
// displaces the prior one); different profiles coexist — pairing is NOT a
// singleton (goal 3, Option A).
func (s *Server) registerControl(cl *client) {
	s.mu.Lock()
	prev := s.controls[cl.identity]
	s.controls[cl.identity] = cl
	s.mu.Unlock()
	if prev != nil && prev != cl {
		// Send `displaced` BEFORE closing so the displaced page stops its
		// session (never re-enters the reconnect → re-displace thrash loop).
		s.log.Printf("displacing prior control page (same profile)")
		_ = s.sendJSON(prev.conn, map[string]any{typeKey: contract.WSDisplaced})
		_ = prev.conn.Close()
	}
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
// Local methods (ping/commands.list/protocol.version/bridge.status) resolve
// here; canvas-bound methods (canvas/v1 + gallery.load/save) route to the
// single active page; paired-only gallery methods route per the unambiguous
// rule (goal 3): active page when active, else exactly-one control page.
func (s *Server) handleRPC(cl *client, m map[string]any, raw []byte) {
	if m["jsonrpc"] != "2.0" {
		s.sendRPCError(cl, nil, -32600, "invalid request")
		return
	}
	id := rpcID(raw)
	method, _ := m["method"].(string)
	switch {
	case contract.DaemonLocalMethods[method]:
		s.handleLocalMethod(cl, id, method, raw)
	case contract.IsCanvasBoundMethod(method):
		s.routeToActive(cl, id, raw)
	case contract.IsPairedOnlyMethod(method):
		s.routeToPaired(cl, id, raw)
	default:
		s.sendRPCError(cl, id, -32601, "method not found")
	}
}

// handleLocalMethod resolves daemon-local methods without involving the page.
// StartLAN opens the LAN listener when the effective configuration says on
// (ADR 0013 decision 2). A listener that is off, or that fails to bind, leaves
// the daemon fully functional on loopback: Peering is an addition, never a
// precondition.
func (s *Server) StartLAN(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.LANEnabled() {
		return nil
	}
	srv, err := lan.ListenAndServe(ctx, lan.Config{
		LAN:     cfg,
		Handler: s.peering,
		Logger:  s.log,
	})
	if err != nil {
		return err
	}
	s.lanSrv.Store(srv)
	s.lanPort.Store(int32(srv.Endpoint().Port))
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	return nil
}

// LANPort reports the LAN listener's port, or 0 when it is not open.
func (s *Server) LANPort() int { return int(s.lanPort.Load()) }

// LANState reports the persisted LAN switch and the live port: the switch is
// the single source of truth (config), the port is this process's fact.
func (s *Server) LANState() map[string]any {
	switchValue := string(config.LANUnset)
	if cfg, err := config.Load(); err == nil {
		switchValue = string(cfg.LAN)
	}
	return map[string]any{"lan": switchValue, "lanPort": s.LANPort()}
}

func (s *Server) lanStatus() map[string]any {
	state := s.LANState()
	peers := []string{}
	if addrs := s.peerAddrs.Load(); addrs != nil {
		peers = *addrs
	}
	state["peers"] = len(peers)
	state["peerAddresses"] = peers
	return state
}

func (s *Server) setLAN(cl *client, id json.RawMessage, on bool) {
	next := config.LANOff
	if on {
		next = config.LANOn
	}
	if err := config.SetLAN(next); err != nil {
		s.sendRPCError(cl, id, contract.JSONRPCErrorNotFound, "could not persist the LAN switch")
		return
	}
	state := s.lanStatus()
	state["takesEffectOnRestart"] = true
	s.sendRPCResult(cl, id, state)
}

func (s *Server) addPeer(address string) {
	if address == "" {
		return
	}
	existing := []string{}
	if cur := s.peerAddrs.Load(); cur != nil {
		existing = *cur
	}
	for _, a := range existing {
		if a == address {
			return
		}
	}
	next := append(append([]string{}, existing...), address)
	s.peerAddrs.Store(&next)
}

// transferOffer carries the active canvas to a peer device (ADR 0013 S1). It is
// the only Peering entry that touches both surfaces: the scene comes from the
// active page over loopback, the bytes leave over the LAN listener's dial.
func (s *Server) transferOffer(cl *client, id json.RawMessage, params json.RawMessage) {
	var req struct {
		Address string `json:"address"`
	}
	if len(params) > 0 {
		if err := json.Unmarshal(params, &req); err != nil {
			s.sendRPCError(cl, id, -32602, "invalid params: want {address}")
			return
		}
	}
	if req.Address == "" {
		s.sendRPCError(cl, id, -32602, "invalid params: address is required")
		return
	}
	s.mu.Lock()
	active := s.active
	handler := s.peering
	s.mu.Unlock()
	if active == nil || active == cl {
		s.sendRPCError(cl, id, contract.JSONRPCErrorNoActiveCanvas,
			"a Canvas transfer needs an activated canvas to read the scene from")
		return
	}
	if handler == nil {
		s.sendRPCError(cl, id, contract.JSONRPCErrorNotFound, "peering is unavailable in this daemon")
		return
	}

	scene, err := s.readScene(active)
	if err != nil {
		s.sendRPCError(cl, id, contract.JSONRPCErrorPageTimeout, err.Error())
		return
	}

	offer := lan.Offer{Alias: s.deviceAlias(), Fingerprint: s.deviceFingerprint(), Bytes: len(scene)}
	ctx, cancel := context.WithTimeout(context.Background(), transfer.OfferTTL)
	defer cancel()
	result, err := handler.Send(ctx, req.Address, offer, scene)
	if err != nil {
		code := contract.JSONRPCErrorNotFound
		if errors.Is(err, peering.ErrAcceptTimeout) {
			code = contract.JSONRPCErrorOfferExpired
		} else if errors.Is(err, peering.ErrRejected) {
			code = contract.JSONRPCErrorPeerUnreachable
		} else if tc := peering.TransferCode(err); tc != 0 {
			code = tc
		}
		s.sendRPCError(cl, id, code, err.Error())
		return
	}
	s.sendRPCResult(cl, id, map[string]any{
		"transferId":     result.TransferID,
		"peerTransferId": result.PeerTransferID,
		"bytes":          result.Bytes,
		"sha256":         result.SHA256,
	})
}

// readScene asks the active page for its scene and returns the opaque bytes the
// peer will receive. The daemon never parses them (ADR 0013 decision 5).
func (s *Server) readScene(active *client) ([]byte, error) {
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      sceneReadID,
		"method":  "scene.get",
		"params":  map[string]any{},
	})
	if err != nil {
		return nil, err
	}
	done := make(chan []byte, 1)
	p := &pendingRPC{page: active, id: json.RawMessage(`"` + sceneReadID + `"`), done: done}
	p.timer = time.AfterFunc(s.rpcTimeout, func() {
		s.rpcMu.Lock()
		if s.pending[sceneReadKey] == p {
			delete(s.pending, sceneReadKey)
			s.rpcMu.Unlock()
			done <- nil
			return
		}
		s.rpcMu.Unlock()
	})
	s.rpcMu.Lock()
	s.pending[sceneReadKey] = p
	s.rpcMu.Unlock()

	if err := active.conn.WriteText(payload); err != nil {
		s.failPendingKey(sceneReadKey, contract.JSONRPCErrorPageDisconnected, "page unavailable")
		<-done
		return nil, errors.New("the active page is unavailable")
	}
	raw := <-done
	if raw == nil {
		return nil, errors.New("the active page did not return its scene in time")
	}
	var reply struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil {
		return nil, errors.New("the active page returned an unreadable scene")
	}
	if reply.Error != nil {
		return nil, errors.New("the active page refused to read its scene: " + reply.Error.Message)
	}
	return reply.Result, nil
}

// sceneReadID is the JSON-RPC id of the daemon's own scene read. It never
// collides with an agent request: agents send numeric ids, this one is a string.
const sceneReadID = "excali-daemon-scene-read"

// sceneReadKey is the pending-map key for that request. The map is keyed by the
// raw id bytes as they appear on the wire (quotes included — see rpcIDKey), so a
// bare unquoted string would never match the page's echoed response and the
// daemon would wait out the full timeout.
var sceneReadKey = `"` + sceneReadID + `"`

func (s *Server) deviceAlias() string {
	if cfg, err := config.Load(); err == nil && cfg.Alias != "" {
		return cfg.Alias
	}
	return ""
}

func (s *Server) deviceFingerprint() string {
	if cfg, err := config.Load(); err == nil {
		return cfg.Fingerprint
	}
	return ""
}

func (s *Server) handleLocalMethod(cl *client, id json.RawMessage, method string, raw []byte) {
	var request struct {
		Params json.RawMessage `json:"params"`
	}
	_ = json.Unmarshal(raw, &request)
	params := request.Params
	switch method {
	case "ping":
		s.sendRPCResult(cl, id, "pong")
	case "commands.list":
		s.sendRPCResult(cl, id, contract.AllMethods())
	case "protocol.version":
		s.sendRPCResult(cl, id, contract.CanvasV1Protocol)
	case contract.BridgeStatusMethod:
		s.sendRPCResult(cl, id, s.bridgeStatus())
	case "fonts.system.list":
		// Goal 4 refinement: OS font enumeration, daemon-local (needs no
		// canvas/control page — the daemon reads the OS, not IndexedDB).
		fonts, err := fonts.EnumerateOSFonts()
		if err != nil {
			s.sendRPCError(cl, id, contract.JSONRPCErrorNotFound, "font enumeration failed")
			return
		}
		s.sendRPCResult(cl, id, fonts)
	case contract.BridgeStopMethod:
		// Authority (045): only the single active page can stop the daemon — the
		// active page IS the user's consent authority (Ticket 011 layer 4). Any
		// other peer (agent CLI, control page, idle page) gets -32007.
		s.mu.Lock()
		isActive := s.active == cl
		s.mu.Unlock()
		if !isActive {
			s.sendRPCError(cl, id, contract.JSONRPCErrorRequiresActivePage,
				"bridge.stop requires the active-page role")
			return
		}
		// Send the response FIRST so the page can confirm success before the
		// socket closes, then trigger shutdown on a small flush window.
		// Shutdown is idempotent (closeOnce), so a concurrent SIGTERM no-ops.
		s.sendRPCResult(cl, id, map[string]any{"stopped": true})
		go func() {
			time.Sleep(150 * time.Millisecond)
			_ = s.Shutdown(context.Background())
		}()
	case "lan.status":
		s.sendRPCResult(cl, id, s.lanStatus())
	case "lan.on":
		s.setLAN(cl, id, true)
	case "lan.off":
		s.setLAN(cl, id, false)
	case "peers.transferOffer":
		s.transferOffer(cl, id, params)
	case "peers.transferStatus":
		s.sendRPCResult(cl, id, map[string]any{"inFlight": 0})
	case "peers.transferRespond":
		s.transferRespond(cl, id, params)
	case "peers.list":
		peers := []string{}
		if addrs := s.peerAddrs.Load(); addrs != nil {
			peers = *addrs
		}
		s.sendRPCResult(cl, id, map[string]any{"peers": peers, "count": len(peers)})
	case "autostart.status":
		status, err := autostart.Detect(autostart.Options{})
		if err != nil {
			s.sendRPCResult(cl, id, map[string]any{"enabled": false, "error": err.Error()})
			return
		}
		s.sendRPCResult(cl, id, map[string]any{"enabled": status.Enabled, "entries": status.Entries})
	case "autostart.on", "autostart.off":
		s.sendRPCError(cl, id, contract.JSONRPCErrorNotFound,
			"the autostart write side is undecided (ADR 0012 decision 2); the daemon only reports it")
	}
}

// bridgeStatus reports the agent's context (goal 3 status query): the active
// canvas's extension identity (per-profile uuid) + the connected control-page
// identities.
func (s *Server) bridgeStatus() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	activeInfo := map[string]any(nil)
	if s.active != nil {
		activeInfo = map[string]any{"profileId": s.active.identity}
	}
	controls := make([]map[string]any, 0, len(s.controls))
	for _, c := range s.controls {
		controls = append(controls, map[string]any{"profileId": c.identity})
	}
	state := s.LANState()
	return map[string]any{
		"lan":             state["lan"],
		"lanPort":         state["lanPort"],
		"activeCanvas":    activeInfo,
		"controlPages":    controls,
		"protocol":        contract.LegAProtocolVersion,
		"canvasProtocol":  contract.CanvasV1Protocol,
		"galleryProtocol": contract.GalleryV1Protocol,
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
	if cl.identity != "" && s.controls[cl.identity] == cl {
		delete(s.controls, cl.identity)
	}
	s.mu.Unlock()
	_ = cl.conn.Close()
	// A disconnecting page must not leave agent requests hanging (displacement /
	// tab close / daemon shutdown): fail any in-flight request routed to it.
	s.failPendingFor(cl, contract.JSONRPCErrorPageDisconnected, "page disconnected")
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
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.healthPayload())
}

// healthPayload is the /health body: shared with the tests so a field added
// here is covered without re-implementing the shape.
func (s *Server) healthPayload() map[string]any {
	s.mu.Lock()
	active := s.active != nil
	var activeIdentity any
	if s.active != nil {
		activeIdentity = s.active.identity
	}
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
	controlPages := len(s.controls)
	s.mu.Unlock()
	return map[string]any{
		"ok":                     true,
		"pid":                    os.Getpid(),
		"port":                   s.Port(),
		"version":                contract.LegAProtocolVersion,
		"active":                 active,
		"activeProfileId":        activeIdentity,
		"pageConnections":        pages,
		"controlPageConnections": controlPages,
		"agentConnections":       agents,
		"lan":                    s.LANState()["lan"],
		"lanPort":                s.LANPort(),
	}
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
	// done, when set, receives the page's raw response instead of the agent
	// connection: an internal request (the scene read of a Canvas transfer) has
	// no agent waiting on a socket.
	done chan []byte
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

// routeToActive forwards a canvas-bound agent request (canvas/v1 +
// gallery.load/save) to the single active page (Ticket 010 topology:
// agent ↔ daemon ↔ page) and registers a pending response correlation keyed
// by JSON-RPC id. Guards: no active page → -32001; duplicate in-flight id →
// -32600; page never answers → -32002 timeout.
func (s *Server) routeToActive(cl *client, id json.RawMessage, raw []byte) {
	s.mu.Lock()
	active := s.active
	s.mu.Unlock()
	if active == nil || active == cl {
		s.sendRPCError(cl, id, contract.JSONRPCErrorNoActiveCanvas, "no active canvas")
		return
	}
	s.routeToPage(active, cl, id, raw)
}

// routeToPaired forwards a paired-only gallery request (goal 3, Option A). The
// routing is UNAMBIGUOUS by design — never a silent guess:
//  1. a canvas IS active → route to ITS page (the agent's active context);
//  2. else exactly ONE control page → route there;
//  3. else N>1 control pages → -32004 (agent must disambiguate);
//  4. else no page at all → -32001 (never hangs).
func (s *Server) routeToPaired(cl *client, id json.RawMessage, raw []byte) {
	s.mu.Lock()
	target := s.active
	controls := make([]*client, 0, len(s.controls))
	if target == nil {
		for _, c := range s.controls {
			controls = append(controls, c)
		}
		if len(controls) == 1 {
			target = controls[0]
		} else if len(controls) > 1 {
			s.mu.Unlock()
			s.sendRPCError(cl, id, contract.JSONRPCErrorAmbiguousTarget,
				fmt.Sprintf("ambiguous target: %d control pages connected (no active canvas)", len(controls)))
			return
		}
	}
	s.mu.Unlock()
	if target == nil || target == cl {
		s.sendRPCError(cl, id, contract.JSONRPCErrorNoActiveCanvas, "no active canvas or control page available")
		return
	}
	s.routeToPage(target, cl, id, raw)
}

// routeToPage forwards raw to target with a pending response correlation keyed
// by JSON-RPC id (shared by routeToActive + routeToPaired).
func (s *Server) routeToPage(target, cl *client, id json.RawMessage, raw []byte) {
	key := rpcIDKey(raw)

	s.rpcMu.Lock()
	if _, dup := s.pending[key]; dup {
		s.rpcMu.Unlock()
		s.sendRPCError(cl, id, -32600, "duplicate request id in flight")
		return
	}
	p := &pendingRPC{agent: cl, page: target, id: id}
	p.timer = time.AfterFunc(s.rpcTimeout, func() {
		s.rpcMu.Lock()
		if s.pending[key] == p {
			delete(s.pending, key)
			s.rpcMu.Unlock()
			s.sendRPCError(cl, id, contract.JSONRPCErrorPageTimeout, "page did not respond in time")
			return
		}
		s.rpcMu.Unlock()
	})
	s.pending[key] = p
	s.rpcMu.Unlock()

	if err := target.conn.WriteText(raw); err != nil {
		s.failPendingKey(key, contract.JSONRPCErrorPageDisconnected, "page unavailable")
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
	if p.done != nil {
		p.done <- raw
		return
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
	if p.done != nil {
		select {
		case p.done <- nil:
		default:
		}
		return
	}
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
