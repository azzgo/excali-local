/**
 * Agent Bridge — shared protocol constants + token helpers.
 *
 * Consumed by all three packages (shell background/popup/options via chrome.i18n
 * pages, editor page app) and by the Go bridge daemon (mirrored in
 * `packages/excali-bridge/internal/contract/contract.go` — keep both in sync;
 * single source of truth TBD: code-gen vs documented duplication).
 *
 * Three-layer consent (Wayfinder Ticket 003 + click-through):
 *   Layer 0  master   Options, GLOBAL, PERSISTED via chrome.storage, default OFF
 *   Gate 1   pairing  popup/options, GLOBAL, persisted via chrome.storage
 *   Gate 2   activate editor page (Local only), per-canvas, EPHEMERAL (SW memory)
 *
 * Transport (Tickets 008/010/012): the activated Local editor page dials OUT to
 * ws://127.0.0.1:<port> (loopback only), mints a ≥128-bit per-activation-session
 * handshake token (Ticket 011 layer 3+4), completes the handshake, and exposes
 * window.excaliAPI. The background SW is the control plane ONLY (activation
 * registry, single-active-canvas invariant) — it never sees the token.
 *
 * Leg B wire framing is the WS message `type` field below. The Go daemon is the
 * cross-profile single-active-canvas arbiter (Tickets 016/017): it holds ≤1 active
 * page and sends the `displaced` control message (WS_DISPLACED) to a page whose
 * slot is taken over by a newer activation.
 */

// ---------------------------------------------------------------------------
// Consent state (chrome.storage.local)
// ---------------------------------------------------------------------------

export const AGENT_BRIDGE_STORAGE_KEY = "agentBridge";

/**
 * chrome.storage.local key for the per-profile identity uuid (Option A, goal 3):
 * minted ONCE per profile (lazily, on first need) and persisted, so every page
 * connection in this profile presents the same id. Store-install extension ids
 * are identical across profiles, so `chrome-extension://<id>` origin alone
 * cannot distinguish profiles — this uuid can.
 */
export const PROFILE_ID_STORAGE_KEY = "agentBridgeProfileId";

/** Handshake field carrying the per-profile uuid (page + control-page roles). */
export const WS_PROFILE_ID_FIELD = "profileId";

export interface AgentBridgeStorage {
  /** Layer 0 — feature master switch (Options). Default OFF = kill-switch. */
  master: boolean;
  /** Gate 1 — paired connection (popup). Gates ALL agent control. */
  pairing: boolean;
}

export const AGENT_BRIDGE_DEFAULT_STORAGE: AgentBridgeStorage = {
  master: false,
  pairing: false,
};

// ---------------------------------------------------------------------------
// WS transport (Leg B: page → daemon)
// ---------------------------------------------------------------------------

/** Daemon binds the first free port in this small fixed range; the page scans it. */
export const BRIDGE_PORTS = [17331, 17332, 17333, 17334, 17335] as const;

/** ≥128-bit per-activation-session handshake token (we mint 256 bits). */
export const BRIDGE_TOKEN_BYTES = 32;

export const BRIDGE_HANDSHAKE_TIMEOUT_MS = 3000;

export const BRIDGE_PING_TIMEOUT_MS = 3000;

export const BRIDGE_RECONNECT_BASE_MS = 1000;

export const BRIDGE_RECONNECT_MAX_MS = 15000;

/** Page → SW heartbeat interval while an activation is live (keeps SW + epoch alive). */
export const AGENT_BRIDGE_HEARTBEAT_MS = 20000;

// WS message types (Leg B protocol framing — minimal custom JSON-RPC-ish)
export const WS_HANDSHAKE = "handshake";
export const WS_HANDSHAKE_OK = "handshake_ok";
export const WS_HANDSHAKE_ERROR = "handshake_error";
export const WS_PING = "ping";
export const WS_PONG = "pong";
/** Server → page: this page's active slot was taken by a newer activation (016/017). */
export const WS_DISPLACED = "displaced";

/**
 * Handshake connection role. The page client does NOT send this (absent = "page").
 * The Go daemon's own agent CLI (Leg A) sends "agent" so it is authenticated but
 * never claims the single active-page slot — otherwise a CLI ping would displace
 * the active canvas (Tickets 016/017).
 *
 * Goal 3 (Option A): a paired-but-not-activated Local editor page dials a CONTROL
 * connection with role "control-page" — it never claims the active slot, and unlike
 * the active slot it is NOT a singleton (one control connection per paired profile).
 */
export const WS_ROLE_PAGE = "page";
export const WS_ROLE_CONTROL_PAGE = "control-page";
export const WS_ROLE_AGENT = "agent";


/** Leg A (agent CLI ↔ daemon) JSON-RPC protocol version, negotiated at handshake. */
export const LEG_A_PROTOCOL_VERSION = "1";


// ---------------------------------------------------------------------------
// Control plane (chrome.runtime messages, SW ↔ editor page)
// ---------------------------------------------------------------------------

/** Page → SW: editor tab booted; SW replies with { tabId, swInstanceId, activeTabId, isActive }. */
export const AB_READY = "AGENT_BRIDGE_READY";

/** SW → page: activation state broadcast (single source of truth = SW). */
export const AB_STATE = "AGENT_BRIDGE_STATE";

/** Page → SW: request activation for this tab (SW re-verifies consent gates). */
export const AB_ACTIVATE = "AGENT_BRIDGE_ACTIVATE";

/** Page → SW: tear down this tab's activation. */
export const AB_DEACTIVATE = "AGENT_BRIDGE_DEACTIVATE";

/**
 * Page → SW: this tab was displaced by the daemon — a newer activation (from any
 * profile) took the cross-profile single-active slot (Tickets 016/017). SW clears
 * activeTabId and broadcasts, exactly like AB_DEACTIVATE; the page distinguishes
 * the cause because displacement is not the user deactivating.
 */
export const AB_DISPLACED = "AGENT_BRIDGE_DISPLACED";

/** Page → SW: keepalive + epoch probe while active; SW replies with current state. */
export const AB_HEARTBEAT = "AGENT_BRIDGE_HEARTBEAT";

export interface AgentBridgeStatePayload {
  type: typeof AB_STATE;
  /** SW boot instance id — regenerated on every SW restart (registry wiped). */
  swInstanceId: string;
  /** The currently activated editor tab, or null. */
  activeTabId: number | null;
  /** true when this message is addressed to the activated tab. */
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const HEX = /^[0-9a-f]+$/;

/** Mint a ≥128-bit (256-bit) hex token for the WS handshake. Never logged. */
export function mintBridgeToken(): string {
  const bytes = new Uint8Array(BRIDGE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Validate a handshake token is well-formed and ≥128 bits (64 hex chars = 256 bits). */
export function isValidBridgeToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length >= BRIDGE_TOKEN_BYTES * 2 &&
    HEX.test(token)
  );
}

// ---------------------------------------------------------------------------
// canvas/v1 command set (Wayfinder Ticket 007) + Leg-A JSON-RPC errors
// ---------------------------------------------------------------------------

/**
 * The canvas/v1 method set — EXACT names per Ticket 007. CLI subcommand == method.
 * READ: scene.get / scene.elements / scene.state / scene.bounds /
 *       scene.exportPng / scene.exportSvg
 * WRITE: scene.update / elements.add / elements.clear / scene.reset / files.add /
 *        tool.setActive / view.scrollTo / history.clear
 * META: commands.list / protocol.version (resolved by the daemon locally)
 */
export const CANVAS_V1_METHODS = [
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
] as const;

// ---------------------------------------------------------------------------
// gallery/v1 command set (Wayfinder Ticket 014) + routing classes
// ---------------------------------------------------------------------------

/**
 * The gallery/v1 method set — EXACT names per Ticket 014. CLI subcommand == method.
 * list/get/rename/delete/collections.* are PAIRED (Gate 1 — no canvas needed);
 * load/save are ACTIVATED (canvas-bound — need the active canvas).
 */
export const GALLERY_V1_METHODS = [
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
] as const;

/** The gallery/v1 contract version string. */
export const GALLERY_V1_PROTOCOL = "gallery/v1";

/**
 * Canvas-bound methods: routed to the ACTIVE slot only (goal 2 unchanged),
 * including gallery.load/save (014 gates). No active canvas → -32001, never hang.
 */
export const CANVAS_BOUND_METHODS = [
  ...CANVAS_V1_METHODS,
  "gallery.load",
  "gallery.save",
] as const;

/**
 * Paired-only methods: need no activated canvas (014 gates). Routed to the active
 * canvas's page when one is active, else to a control page (exactly one → route;
 * multiple → -32004 disambiguation error — NEVER a silent guess).
 */
export const PAIRED_ONLY_METHODS = [
  "gallery.list",
  "gallery.get",
  "gallery.rename",
  "gallery.delete",
  "gallery.collections.list",
  "gallery.collections.create",
  "gallery.collections.rename",
  "gallery.collections.delete",
] as const;

/** Daemon-local JSON-RPC methods (no page involved). */
export const DAEMON_LOCAL_METHODS = [
  "ping",
  "commands.list",
  "protocol.version",
  "bridge.status",
] as const;

/**
 * bridge.status — daemon-local status query: the active canvas's extension
 * identity (per-profile uuid) + the connected control-page identities, so the
 * agent always knows its context (goal 3 status query).
 */
export const BRIDGE_STATUS_METHOD = "bridge.status";

// JSON-RPC server error codes (custom range -32000..-32099 per spec).
export const JSON_RPC_ERROR_NO_ACTIVE_CANVAS = -32001;
export const JSON_RPC_ERROR_PAGE_TIMEOUT = -32002;
export const JSON_RPC_ERROR_PAGE_DISCONNECTED = -32003;
/** Paired-only op with N>1 control pages and no active canvas — disambiguate. */
export const JSON_RPC_ERROR_AMBIGUOUS_TARGET = -32004;
/** Blocking gallery op rejected by the user on the page's confirm modal. */
export const JSON_RPC_ERROR_USER_CANCELLED = -32005;
/** gallery.get / load referenced a drawing id that does not exist. */
export const JSON_RPC_ERROR_NOT_FOUND = -32006;

