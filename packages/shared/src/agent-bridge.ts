/**
 * Agent Bridge — shared protocol constants + token helpers.
 *
 * Consumed by all three packages (shell background/popup/options via chrome.i18n
 * pages, editor page app) and by the Go bridge daemon (mirrored in
 * `packages/bridge/internal/contract/contract.go` — keep both in sync;
 * this module is the source of truth; the Go side mirrors it by hand; code-gen to
 * drop the manual mirror is a tracked follow-up).
 *
 * Three-layer consent (Wayfinder Ticket 003 + click-through):
 *   Layer 0  master   Options, GLOBAL, PERSISTED via chrome.storage, default ON (new installs)
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
  /** Layer 0 — feature master switch (Options). Default ON for new installs; OFF is a kill-switch. */
  master: boolean;
  /** Gate 1 — paired connection (canvas button). Gates ALL agent control. */
  pairing: boolean;
  /**
   * Hide the canvas AI button (Options). Default OFF = button shown. Only
   * adjustable while master is OFF — an active canvas must always have a
   * visible stop control (Wayfinder 034 locked invariant).
   */
  hideButton: boolean;
  /**
   * Active control route (Wayfinder 043/044): "ws+daemon" (default — the Go
   * bridge daemon over loopback WS) or "webmcp" (expose canvas commands to
   * Chrome's built-in AI via document.modelContext.registerTool; no daemon).
   * Mutually exclusive: switching away tears that route's exposure down
   * immediately; the new route never auto-engages — exposure is always the
   * user's next explicit per-canvas act.
   */
  mode: AgentBridgeMode;
}

export type AgentBridgeMode = "ws+daemon" | "webmcp";

export const AGENT_BRIDGE_MODE_WS = "ws+daemon" as const;
export const AGENT_BRIDGE_MODE_WEBMCP = "webmcp" as const;

/**
 * Fresh-install default (used whenever chrome.storage holds no value). master
 * ON so the Agent button is visible out of the box — but pairing (Gate 1) and
 * per-canvas activation (Gate 2) still require the user's explicit consent.
 * Existing installs keep whatever they persisted (OFF stays OFF).
 */
export const AGENT_BRIDGE_DEFAULT_STORAGE: AgentBridgeStorage = {
  master: true,
  pairing: false,
  hideButton: false,
  mode: "ws+daemon",
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

/** First-round (attempt 0) retry sleep when the scan round finds no daemon: the
 * cold-start window re-probes quickly (a freshly started daemon is detected +
 * auto-activated within ~5s) instead of paying the full exponential backoff.
 * Attempts >= 1 keep BRIDGE_RECONNECT_BASE_MS * 2**attempt capped at MAX.
 * Page-side only — the Go daemon does not mirror this constant. */
export const BRIDGE_RECONNECT_FIRST_MS = 200;

export const BRIDGE_RECONNECT_MAX_MS = 15000;

/** Page → daemon WS keepalive: periodic app-level ping while connected (proactive liveness; a failed ping closes the socket so the reconnect loop re-dials). */
export const BRIDGE_KEEPALIVE_MS = 20000;

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
 * Server → page: a peer device is offering a canvas (Peering, ADR 0013). The
 * payload is a TransferOffer — a DESCRIPTION only, never scene content — and the
 * page answers with the `peers.transferRespond` request. The daemon never
 * decides on its own: with no page connected the offer waits out expiresAt and
 * the sender is told the peer did not answer.
 */
export const WS_TRANSFER_OFFER = "transfer_offer";

/**
 * The transfer offer a page sees pushed from the daemon (WS_TRANSFER_OFFER).
 * The same fields ride the LAN wire, but a page never sees the wire — it sees
 * this projection, with the receiver's own deadline in expiresAt.
 */
export interface TransferOfferNotice {
  type: string;
  transferId: string;
  alias: string;
  fingerprint: string;
  elementCount: number;
  bytes: number;
  canvasName: string;
  /** Epoch ms; the countdown displays the remaining time from this value. */
  expiresAt: number;
}

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

export const AB_HEARTBEAT = "AGENT_BRIDGE_HEARTBEAT";
/**
 * Popup → SW state query (Wayfinder 034): the popup needs the live registry
 * (activeTabId) to render its Paired/Controlling indicator. The SW replies
 * with an AB_STATE-shaped payload plus canvasName, resolved by relaying an
 * AB_CANVAS_NAME ask to the active editor tab.
 */
export const AB_STATE_QUERY = "AGENT_BRIDGE_STATE_QUERY";
/** SW → active editor tab: what is the current canvas name? (popup indicator.) */
export const AB_CANVAS_NAME = "AGENT_BRIDGE_CANVAS_NAME";

/**
 * SW → every editor tab (Wayfinder 043/044): the Active control route
 * (AgentBridgeStorage.mode) changed. The page tears its current route's
 * exposure down immediately (WS sessions / WebMCP registration); the new
 * route never auto-engages.
 */
export const AB_MODE_CHANGED = "AGENT_BRIDGE_MODE_CHANGED";

/**
 * Options → SW → active editor page: user clicked "Stop daemon" (045). The SW
 * relays to the active tab (never touches the wire itself); the page sends the
 * daemon-local JSON-RPC `bridge.stop` on its live active-slot WS and replies
 * `{ok: true}` once the daemon confirms, or `{ok: false, reason}` otherwise.
 */
export const AB_BRIDGE_STOP_REQUEST = "AGENT_BRIDGE_BRIDGE_STOP_REQUEST";

export interface AgentBridgeStatePayload {
  type: typeof AB_STATE;
  /** SW boot instance id — regenerated on every SW restart (registry wiped). */
  swInstanceId: string;
  /** The currently activated editor tab, or null. */
  activeTabId: number | null;
  /** true when this message is addressed to the activated tab. */
  isActive: boolean;
  /**
   * Popup-only (AB_STATE_QUERY reply): the active canvas's drawing name, or
   * null when no canvas is active / the name couldn't be resolved.
   */
  canvasName?: string | null;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/**
 * Honest WebMCP feature-detect (Wayfinder 043/044 + E2E finding).
 * `'modelContext' in document` is TRUE on chrome-extension:// pages even
 * though Chrome ≤156 blocks the API there: registerTool/getTools throw
 * `SecurityError: document.modelContext cannot be used when document.domain
 * is enabled.` (extension origins are treated as document.domain-enabled;
 * extension-origin support is flagged 'ongoing development' upstream, and
 * Chrome 157 is the default-enable milestone — but whether it lifts this
 * block for extension pages is not verifiable from here).
 *
 * So presence is NOT usability: probe the API once — a throwing call proves
 * the block → report unavailable. Absence or a non-throwing call → report
 * usable. Synchronous; async getTools rejections are swallowed (a rejected
 * probe still means 'present, may work' — only a sync SecurityError proves
 * the document.domain block).
 */
export function isWebmcpUsable(): boolean {
  try {
    const doc = (document ?? undefined) as unknown as {
      modelContext?: { getTools?: () => unknown };
    } | undefined;
    const nav = (navigator ?? undefined) as unknown as {
      modelContext?: { getTools?: () => unknown };
    } | undefined;
    const mc = doc?.modelContext ?? nav?.modelContext;
    if (!mc) return false;
    try {
      const r = mc.getTools?.();
      if (r && typeof (r as Promise<unknown>)?.catch === "function") {
        (r as Promise<unknown>).catch(() => {}); // swallow async rejection
      }
    } catch {
      return false; // SecurityError: API present but blocked on this origin
    }
    return true;
  } catch {
    return false;
  }
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

// ---------------------------------------------------------------------------
// Peering — cross-machine Canvas transfer (ADR 0013), LAN listener, autostart
// ---------------------------------------------------------------------------

/**
 * The Peering method set (ADR 0013, docs/PEERING.md) — every one of them is
 * DAEMON-LOCAL: the Bridge daemon owns discovery, the LAN listener and the
 * transfer state, so answering them needs no page and reads no canvas.
 *
 * The peers.* methods are the loopback CONTROL surface of a Canvas transfer;
 * the payloads they drive (offer/accept/reject/chunk) travel on the separate
 * LAN listener surface — the two never share a capability set.
 */
export const PEERING_METHODS = [
  "peers.list",
  "peers.transferOffer",
  "peers.transferStatus",
  "peers.transferRespond",
] as const;

/**
 * The LAN listener switch (daemon-local): the daemon's second, separately
 * switched listening surface — off by default, opened by an explicit user act,
 * carrying Canvas transfer only.
 */
export const LAN_METHODS = [
  "lan.status",
  "lan.on",
  "lan.off",
] as const;

/**
 * Autostart registration (daemon-local): the daemon owns the login item; the
 * Presence host and the extension's Options page only act through it.
 */
export const AUTOSTART_METHODS = [
  "autostart.status",
  "autostart.on",
  "autostart.off",
] as const;

/** IsPeeringMethod reports whether m is a Peering (Canvas transfer) method. */
export function IsPeeringMethod(m: string): boolean {
  return (PEERING_METHODS as readonly string[]).includes(m);
}

// ---------------------------------------------------------------------------
// LAN surface — the peer ↔ peer wire types (never on the loopback surface)
// ---------------------------------------------------------------------------

/**
 * A Peer device discovered on the LAN (mDNS announcement). The Device
 * fingerprint IDENTIFIES a machine — so a machine can ignore its own
 * announcement — and authenticates nothing.
 */
export interface PeerInfo {
  /** The device's human-readable alias. */
  alias: string;
  /** The announced Device fingerprint (identification only, never auth). */
  fingerprint: string;
  /** The address the peer announced. */
  address: string;
  /** The peer's LAN listener port (system-assigned, ephemeral). */
  port: number;
  /** The peer's peering protocol version. */
  protocolVersion: string;
}

/**
 * A Transfer offer — the pre-acceptance DESCRIPTION of an incoming Canvas
 * transfer.
 *
 * Boundary constraint (ADR 0013): the offer carries metadata ONLY. It has no
 * element content and no thumbnail field, and none may be added — a thumbnail
 * is content, and rendering one would read the canvas before acceptance.
 */
export interface TransferOffer {
  transferId: string;
  /** The sending device's alias. */
  alias: string;
  /** The sending device's Device fingerprint (identification only). */
  fingerprint: string;
  /** How many elements the canvas holds — a count, not the elements. */
  elementCount: number;
  /** The estimated scene size in bytes — an estimate, not the bytes. */
  bytes: number;
  /** The canvas's local name on the sending machine. */
  canvasName: string;
  /**
   * Epoch milliseconds at which this offer stops being acceptable — the
   * receiver's own deadline, not the sender's clock. The receiver displays the
   * remaining time from this value and never computes its own: a page-side timer
   * drifts from the daemon's, and the offer would be refused while the UI still
   * showed time left.
   */
  expiresAt: number;
}

/**
 * The receiver's acceptance: a per-transfer token bound to the source address
 * and to a deadline.
 */
export interface TransferAccept {
  transferId: string;
  token: string;
}

/** The receiver's refusal — the sender's canvas is left untouched. */
export interface TransferReject {
  transferId: string;
  reason: string;
}

/** One chunk of the opaque scene bytes (the daemon never parses the scene). */
export interface TransferChunk {
  transferId: string;
  /** The chunk's position in the carry. */
  seq: number;
  /** How many chunks the carry carries in total. */
  total: number;
  /** The chunk payload, base64-encoded. */
  dataBase64: string;
}

/** The end of a carry: the whole scene's sha256 (integrity is checked once). */
export interface TransferDone {
  transferId: string;
  sha256: string;
}

/**
 * Peering limits (docs/PEERING.md → Numbers): a 200KB chunk, a 64MB
 * whole-scene cap, a 60s in-memory offer deadline.
 */
export const TRANSFER_CHUNK_BYTES = 200 * 1024;
export const TRANSFER_SCENE_MAX_BYTES = 64 * 1024 * 1024;
export const TRANSFER_OFFER_TTL_MS = 60_000;

/** The peering protocol version a peer announces (mDNS TXT + PeerInfo). */
export const PEERING_PROTOCOL_VERSION = "1";

/** The mDNS/DNS-SD service type the LAN listener advertises. */
export const LAN_MDNS_SERVICE = "_excali-bridge._tcp";

/** Daemon-local JSON-RPC methods (no page involved). */
export const DAEMON_LOCAL_METHODS = [
  "ping",
  "commands.list",
  "protocol.version",
  "bridge.status",
  "bridge.stop",
  ...PEERING_METHODS,
  ...LAN_METHODS,
  ...AUTOSTART_METHODS,
] as const;

/**
 * bridge.status — daemon-local status query: the active canvas's extension
 * identity (per-profile uuid) + the connected control-page identities, so the
 * agent always knows its context (goal 3 status query).
 */
export const BRIDGE_STATUS_METHOD = "bridge.status";


/**
 * bridge.stop — daemon-local JSON-RPC method (045): the paired + ACTIVE page
 * asks the daemon to gracefully shut down. Authority: the caller must be the
 * single active `role=page` connection (s.active == cl on the server); any
 * other peer gets JSON_RPC_ERROR_REQUIRES_ACTIVE_PAGE (-32007).
 */
export const BRIDGE_STOP_METHOD = "bridge.stop";
// ---------------------------------------------------------------------------
// fonts/v1 command set (Wayfinder Ticket 015, refined — goal 4)
// ---------------------------------------------------------------------------

/**
 * The fonts/v1 method set — EXACT names per Ticket 015 (refined). CLI
 * subcommand == method. fonts.system.list is DAEMON-LOCAL (the Go daemon
 * enumerates OS-installed fonts — cross-browser, no permission prompt; it
 * supersedes Ticket 015's queryLocalFonts). get/assign/install/clear are
 * PAIRED (Gate 1 — they touch the excali-fonts FontConfig IndexedDB record
 * the daemon can't read, so they route to the page).
 */
export const FONTS_V1_METHODS = [
  "fonts.get",
  "fonts.system.list",
  "fonts.assign",
  "fonts.install",
  "fonts.clear",
] as const;

/** The fonts/v1 contract version string. */
export const FONTS_V1_PROTOCOL = "fonts/v1";

/**
 * fonts/v1 methods that ROUTE TO THE PAGE (everything except the daemon-local
 * fonts.system.list).
 */
export const FONTS_PAGE_METHODS = [
  "fonts.get",
  "fonts.assign",
  "fonts.install",
  "fonts.clear",
] as const;

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

/** bridge.* daemon-local method requires the single active-page role (045). */
export const JSON_RPC_ERROR_REQUIRES_ACTIVE_PAGE = -32007;

/** A Transfer offer passed its 60s in-memory deadline before it was answered. */
export const JSON_RPC_ERROR_OFFER_EXPIRED = -32008;

/** A transfer token was wrong, replayed, or bound to another source address. */
export const JSON_RPC_ERROR_INVALID_TOKEN = -32009;

/** The scene exceeds the 64MB whole-scene transfer cap. */
export const JSON_RPC_ERROR_SCENE_TOO_LARGE = -32010;

/** The peer device is not reachable (no announcement, or it went away). */
export const JSON_RPC_ERROR_PEER_UNREACHABLE = -32011;
