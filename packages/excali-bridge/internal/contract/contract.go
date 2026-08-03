// Package contract mirrors the wire contract in
// `packages/excali-shared/src/agent-bridge.ts` (the single source of truth for
// the Leg-B protocol). Keep this file in sync with that module — a divergence
// here breaks the page client ↔ daemon handshake. (Single source of truth TBD:
// code-gen vs documented duplication — tracked as a follow-up, not a blocker.)
package contract

// BridgePorts is the small fixed range the daemon binds (first free wins) and
// the page scans (BRIDGE_PORTS in excali-shared).
var BridgePorts = [...]int{17331, 17332, 17333, 17334, 17335}

// WS message types (Leg B protocol framing).
const (
	WSHandshake      = "handshake"
	WSHandshakeOK    = "handshake_ok"
	WSHandshakeError = "handshake_error"
	WSPing           = "ping"
	WSPong           = "pong"
	WSDisplaced      = "displaced"
)

// Handshake connection role. The page client does NOT send a role (absent =
// page); the daemon's own agent CLI sends "agent" so it is authenticated but
// never claims the single active-page slot (WS_ROLE_PAGE / WS_ROLE_AGENT).
const (
	RolePage  = "page"
	RoleAgent = "agent"
)

// LegAProtocolVersion is the Leg-A (agent CLI ↔ daemon) JSON-RPC protocol
// version, negotiated by the agent at handshake (LEG_A_PROTOCOL_VERSION).
const LegAProtocolVersion = "1"

// IsValidBridgeToken mirrors isValidBridgeToken() in excali-shared: a hex
// string of at least 64 chars (256 bits). The doc comments there say
// ">=128-bit" but the code enforces 256 — we mirror the code, not the prose.
func IsValidBridgeToken(token string) bool {
	if len(token) < 64 {
		return false
	}
	for i := 0; i < len(token); i++ {
		c := token[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// canvas/v1 command set (Wayfinder Ticket 007) — EXACT names. The agent CLI
// subcommand == method; the daemon routes these to the active page.
var CanvasV1Methods = [...]string{
	"scene.get",
	"scene.elements",
	"scene.state",
	"scene.bounds",
	"scene.exportPng",
	"scene.exportSvg",
	"scene.update",
	"elements.add",
	"elements.clear",
	"scene.reset",
	"files.add",
	"tool.setActive",
	"view.scrollTo",
	"history.clear",
	"commands.list",
	"protocol.version",
}

// DaemonLocalMethods resolve locally (no page involved) — like ping.
var DaemonLocalMethods = map[string]bool{
	"ping":             true,
	"commands.list":    true,
	"protocol.version": true,
}

// CanvasV1Protocol is the contract version string returned by protocol.version.
const CanvasV1Protocol = "canvas/v1"

// JSON-RPC server error codes (custom range -32000..-32099 per spec).
const (
	JSONRPCErrorNoActiveCanvas   = -32001
	JSONRPCErrorPageTimeout      = -32002
	JSONRPCErrorPageDisconnected = -32003
)

// IsCanvasV1Method reports whether m is a routed or local canvas/v1 method.
func IsCanvasV1Method(m string) bool {
	for _, method := range CanvasV1Methods {
		if method == m {
			return true
		}
	}
	return false
}
