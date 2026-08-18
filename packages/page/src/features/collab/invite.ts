/**
 * Invite clipboard + paste-severity helpers (Wayfinder 054 Q1/Q4/Q5/Q9, 060 §1).
 *
 * Clipboard format (054 Q1, locked): **sentence + code** — the sentence survives
 * being pasted into chat, and the parser regex-extracts the `excali-collab:v1:…`
 * token, so the paste box accepts the whole sentence OR a bare code. "Copy code
 * only" is the share-step secondary button. Clipboard writes ride user-activation
 * (`navigator.clipboard.writeText` on click — no `clipboardWrite` permission,
 * ADR 0003); if the async API rejects, fall back to `execCommand("copy")`.
 *
 * Paste severity grammar (054 Q4/Q5/Q9, locked):
 *   no-key       → red + Join disabled          (private room w/o roomSecret)
 *   fp-mismatch  → amber + Continue anyway      (warn-only per 048, fp never routes)
 *   unreachable  → red + Retry / Save-anyway    (Q9 live dial; server may not be
 *                                                deployed yet — save-anyway exists
 *                                                for exactly that)
 *   ok           → nothing
 *
 * Reachability (054 Q9 / 060 §1): `dialServer` probes the relay with a short
 * WebSocket handshake timeout; loopback URLs (`http://127.0.0.1:…`) SKIP the probe
 * and render as a neutral "local relay" badge, never as an error state.
 *
 * Encoding/parsing is NOT reimplemented here — collab-core owns the wire format
 * (`invites.ts`); this module wraps it for the page's clipboard/severity needs.
 */
import {
  INVITE_TOKEN_RE,
  encodeRoomInvite,
  encodeServerInvite,
  parseInvite,
  type ParseInviteResult,
  type RoomInvite,
  type ServerInvite,
} from "collab-core";
import { copyText, dialServer, DIAL_TIMEOUT_MS } from "collab-core/ui";
import type { TFunction } from "i18next";
import type { ServerConfig } from "./storage";

export type InviteKind = "server" | "room";

/** t() from react-i18next (page side) — i18next's own type so components pass `t` straight in. */
export type Translate = TFunction;

/** 054 Q9: prototype shows "checking… ⏱ timeout 8s". */
export { DIAL_TIMEOUT_MS, copyText, dialServer } from "collab-core/ui";

/* ------------------------------------------------------------------ */
/* sentence + code (054 Q1)                                             */
/* ------------------------------------------------------------------ */
/** The invite code itself (collab-core encodes; this never reimplements). */
export function inviteCode(kind: InviteKind, payload: ServerInvite | RoomInvite): string {
  return kind === "server"
    ? encodeServerInvite(payload as ServerInvite)
    : encodeRoomInvite(payload as RoomInvite);
}

/**
 * The 054 Q1 sentence prefix. Room invites interpolate the room label + tier
 * label (`CollabShareClipboard`; `meta.name` required for rooms); server invites
 * interpolate the org label (`CollabServerClipboard`).
 */
export function inviteSentence(
  t: Translate,
  kind: InviteKind,
  payload: ServerInvite | RoomInvite,
  meta: { name?: string } = {},
): string {
  if (kind === "server") {
    return t("CollabServerClipboard", { org: (payload as ServerInvite).org });
  }
  const room = payload as RoomInvite;
  const tier = t(room.tier === "private" ? "CollabTierLabelPrivate" : "CollabTierLabelTeam");
  return t("CollabShareClipboard", { name: meta.name ?? "", tier });
}

/** Full clipboard payload: sentence + "\n" + code. */
export function inviteClipboardText(
  t: Translate,
  kind: InviteKind,
  payload: ServerInvite | RoomInvite,
  meta: { name?: string } = {},
): string {
  return `${inviteSentence(t, kind, payload, meta)}\n${inviteCode(kind, payload)}`;
}

/** Copy the sentence+code invite (share step primary, session chrome re-copy). */
export async function copyInvite(
  t: Translate,
  kind: InviteKind,
  payload: ServerInvite | RoomInvite,
  meta: { name?: string } = {},
): Promise<boolean> {
  return copyText(inviteClipboardText(t, kind, payload, meta));
}

/** Copy the bare code only (share-step secondary button, 054 Q1). */
export async function copyInviteCode(
  kind: InviteKind,
  payload: ServerInvite | RoomInvite,
): Promise<boolean> {
  return copyText(inviteCode(kind, payload));
}

/* ------------------------------------------------------------------ */
/* paste parsing (054 Q1: sentence+code OR bare code)                   */
/* ------------------------------------------------------------------ */

/** The raw `excali-collab:v1:(srv|room):…` token inside arbitrary text, if any. */
export function extractInviteToken(text: string): string | null {
  return INVITE_TOKEN_RE.exec(text)?.[0] ?? null;
}

/**
 * Parse pasted invite text. Accepts the full sentence+code clipboard payload OR
 * a bare code — collab-core's `parseInvite` regex-extracts the token either way.
 * Result is the collab-core discriminated union (`kind: "server" | "room" |
 * "none" | "error"`).
 */
export function parsePastedInvite(text: string): ParseInviteResult {
  return parseInvite(text);
}

/* ------------------------------------------------------------------ */
/* severity (054 Q4/Q5/Q9)                                              */
/* ------------------------------------------------------------------ */

export type DialResult = "ok" | "unreachable" | "skipped";

/**
 * Paste severity class per 054:
 * - `error` — no invite token found (`reason: "none"`) or malformed payload
 *   (`reason: "<field>: <detail>"`, collab-core parse error).
 * - `no-key` — private room invite without `roomSecret` → red + Join disabled.
 * - `fp-mismatch` — room invite `fp` present and ≠ the fingerprint of the
 *   configured relay → amber + Continue anyway (048 warn-only, fp never routes).
 * - `unreachable` — `ctx.dial === "unreachable"` → red + Retry/Save-anyway
 *   (`inviteKind` selects the srv-unreach vs join-srvdown copy).
 * - `ok` — nothing to warn about.
 *
 * Precedence: parse error > no-key > unreachable > fp-mismatch > ok.
 * Loopback relays (060) never produce `unreachable` — `dialServer` returns
 * `"skipped"` for them and the UI renders the neutral "local relay" badge.
 */
export type PasteSeverity =
  | { kind: "ok" }
  | { kind: "no-key" }
  | { kind: "fp-mismatch" }
  | { kind: "unreachable"; inviteKind: "server" | "room" }
  | { kind: "error"; reason: "none" | string };

export function pasteSeverity(
  parsed: ParseInviteResult,
  ctx: { server: ServerConfig | null; dial?: DialResult },
): PasteSeverity {
  if (parsed.kind === "none") return { kind: "error", reason: "none" };
  if (parsed.kind === "error") return { kind: "error", reason: `${parsed.field}: ${parsed.reason}` };

  const unreachable = ctx.dial === "unreachable";
  if (parsed.kind === "room") {
    // 054 Q4: no-key = red + Join disabled — no continue path exists
    if (parsed.tier === "private" && !parsed.roomSecret) return { kind: "no-key" };
    // 054 Q9: nobody answered beats the warn-only fp hint
    if (unreachable) return { kind: "unreachable", inviteKind: "room" };
    // 048/054 Q5: fp is a staleness signal — mismatch is warn-only, never routing
    if (parsed.fp !== undefined && ctx.server !== null && parsed.fp !== fingerprint(ctx.server.relay)) {
      return { kind: "fp-mismatch" };
    }
    return { kind: "ok" };
  }
  // server invite (sk/ck are parse-validated, so no-key cannot occur)
  if (unreachable) return { kind: "unreachable", inviteKind: "server" };
  return { kind: "ok" };
}

/* ------------------------------------------------------------------ */
/* server fingerprint (048)                                             */
/* ------------------------------------------------------------------ */

/**
 * Short server fingerprint for room invites (048: fp = staleness signal only,
 * warn-only, never routing). Same Java-style string hash collab-core uses for
 * `deriveColor` (wire.ts) — deterministic across clients, no crypto strength
 * needed since fp never gates anything. Collab-core treats fp as an opaque
 * non-empty string; this page-side convention mints (043 create flow) and checks
 * (pasteSeverity) it identically. 8 lowercase hex chars.
 */
export function fingerprint(relay: string): string {
  let h = 0;
  for (let i = 0; i < relay.length; i++) {
    h = ((h << 5) - h + relay.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
