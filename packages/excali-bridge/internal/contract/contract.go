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
// Goal 3 (Option A): a paired-but-not-activated page dials role "control-page"
// — it never claims the active slot, and unlike the active slot it is NOT a
// singleton (one control connection per paired profile).
const (
	RolePage        = "page"
	RoleControlPage = "control-page"
	RoleAgent       = "agent"
)

// ProfileIDField is the handshake field carrying the per-profile identity uuid
// (goal 3): every page + control-page connection MUST send it (minted once per
// profile, persisted in chrome.storage.local). Store-install extension ids are
// identical across profiles, so the origin alone cannot distinguish them.
const ProfileIDField = "profileId"

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
	"bridge.status":    true,
}

// CanvasV1Protocol is the contract version string returned by protocol.version.
const CanvasV1Protocol = "canvas/v1"

// BridgeStatusMethod is the daemon-local status query (goal 3): the active
// canvas's extension identity + the connected control-page identities.
const BridgeStatusMethod = "bridge.status"

// GalleryV1Methods is the gallery/v1 method set (Wayfinder Ticket 014) — EXACT
// names. CLI subcommand == method. list/get/rename/delete/collections.* are
// PAIRED (Gate 1 — no canvas needed); load/save are ACTIVATED (canvas-bound).
var GalleryV1Methods = [...]string{
	"gallery.list",
	"gallery.get",
	"gallery.load",
	"gallery.save",
	"gallery.rename",
	"gallery.delete",
	"gallery.collections.list",
	"gallery.collections.create",
	"gallery.collections.rename",
	"gallery.collections.delete",
}

// GalleryV1Protocol is the gallery/v1 contract version string.
const GalleryV1Protocol = "gallery/v1"

// JSON-RPC server error codes (custom range -32000..-32099 per spec).
const (
	JSONRPCErrorNoActiveCanvas   = -32001
	JSONRPCErrorPageTimeout      = -32002
	JSONRPCErrorPageDisconnected = -32003
	// JSONRPCErrorAmbiguousTarget: paired-only op with N>1 control pages and no
	// active canvas — the agent must disambiguate (never silently guess).
	JSONRPCErrorAmbiguousTarget = -32004
	// JSONRPCErrorUserCancelled: blocking gallery op rejected on the page modal.
	JSONRPCErrorUserCancelled = -32005
	// JSONRPCErrorNotFound: gallery.get/load referenced a missing drawing id.
	JSONRPCErrorNotFound = -32006
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

// IsGalleryV1Method reports whether m is a gallery/v1 method.
func IsGalleryV1Method(m string) bool {
	for _, method := range GalleryV1Methods {
		if method == m {
			return true
		}
	}
	return false
}

// IsCanvasBoundMethod reports whether m routes to the ACTIVE slot only: the
// canvas/v1 set plus gallery.load/save (014 gates). No active canvas → -32001.
func IsCanvasBoundMethod(m string) bool {
	if IsCanvasV1Method(m) {
		return true
	}
	return m == "gallery.load" || m == "gallery.save"
}

// IsPairedOnlyMethod reports whether m needs no activated canvas (014 gates):
// routed to the active canvas's page when active, else to a control page
// (exactly one → route; multiple → -32004; none → -32001).
func IsPairedOnlyMethod(m string) bool {
	return IsGalleryV1Method(m) && !IsCanvasBoundMethod(m)
}

// AllMethods is the full callable set reported by commands.list (deduped).
func AllMethods() []string {
	seen := map[string]bool{}
	var out []string
	add := func(m string) {
		if !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	for _, m := range CanvasV1Methods {
		add(m)
	}
	for _, m := range GalleryV1Methods {
		add(m)
	}
	for m := range DaemonLocalMethods {
		add(m)
	}
	return out
}
