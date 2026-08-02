/**
 * Agent Bridge — shared protocol constants + token helpers.
 *
 * Consumed by all three packages (shell background/popup/options via chrome.i18n
 * pages, editor page app, and the throwaway stub harness under scripts/).
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
 */

// ---------------------------------------------------------------------------
// Consent state (chrome.storage.local)
// ---------------------------------------------------------------------------

export const AGENT_BRIDGE_STORAGE_KEY = "agentBridge";

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
