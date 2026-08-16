/**
 * collab-core invite encodings — encode/parse for both invite kinds.
 *
 * Authoritative sources (Wayfinder decision records):
 * - 049 §4 — encodings + fragment-vs-paste rules; room invite payload
 *   `{shareId, tier, roomSecret?, fp?}`; room invites NEVER carry a server
 *   address (ADR invariant — the single configured relay makes routing
 *   unambiguous).
 * - 057 §2 — server invite AMENDED to `{relay, org, sk, ck}` (secret
 *   removed; prefix stays `excali-collab:v1:srv:`). sk = 43-char b64url
 *   RFC 8032 Ed25519 seed; ck = 43-char b64url 32-byte org content key.
 * - 060 §1 — loopback carve-out: `http:`/`ws:` accepted ONLY for the IP
 *   literals `127.0.0.1` / `[::1]` (with port), mirroring CSP v4 exactly;
 *   remote stays TLS-only.
 * - 054 Q1 — clipboard = sentence + code; the parser regex-extracts the
 *   `excali-collab:v1:` token so bare codes also paste fine.
 * - 058 §1.1 — malformed sk/ck (wrong length/encoding) fails at parse time
 *   with a named-field paste error, same as 049 §4 room-invite parsing.
 *
 * b64url = base64url without padding (049 §4).
 */

/** Extracts an invite token from arbitrary text (054 Q1: sentence + code). */
export const INVITE_TOKEN_RE = /excali-collab:v1:(?:srv|room):[A-Za-z0-9_-]+/

const TOKEN_PREFIX = "excali-collab:v1:"
const B64URL_CHARS_RE = /^[A-Za-z0-9_-]+$/
const KEY_BYTES = 32 // sk/ck/roomSecret are 32-byte keys (057 §1 / 050 §2)
const SHARE_ID_BYTES = 16 // shareId is a 128-bit capability token (049 §4)

/** Server invite payload (057 §2, amends 049 §4) — `secret` removed. */
export interface ServerInvite {
  /** relay base URL — https:/wss: any host; http:/ws: loopback IPs only (060) */
  relay: string
  /** org label shown beside the relay URL in trust confirmation (057 §2) */
  org: string
  /** org Ed25519 seed, 43-char b64url (32 bytes) — client-config only (057 §1) */
  sk: string
  /** org content key, 43-char b64url (32 bytes) — client-config only (057 §1) */
  ck: string
}

/** Room invite payload (049 §4, unchanged by 057). */
export interface RoomInvite {
  /** 128-bit random capability token (room id = permission), ~22-char b64url */
  shareId: string
  tier: "team" | "private"
  /** AES-GCM key material, 43-char b64url — present only for tier "private" */
  roomSecret?: string
  /** optional server fingerprint (short hash, warn-only) */
  fp?: string
}

export type ParseInviteResult =
  | ({ kind: "server" } & ServerInvite)
  | ({ kind: "room" } & RoomInvite)
  | { kind: "none" }
  | { kind: "error"; field: string; reason: string }

/** Parsed-invite preview (054 Q6): the payload carries no room name. */
export type InvitePreview =
  | { kind: "server"; org: string; relay: string; hasKeys: boolean }
  | { kind: "room"; tier: "team" | "private"; hasKey: boolean }

/* ------------------------------------------------------------------ */
/* base64url helpers (no padding, per 049 §4)                          */
/* ------------------------------------------------------------------ */

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** true when s is a base64url string decoding to exactly n bytes (058 §1.1). */
function isB64urlOfLength(s: unknown, n: number): s is string {
  if (typeof s !== "string" || !B64URL_CHARS_RE.test(s)) return false
  try {
    return b64urlDecode(s).length === n
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* relay URL validation (049 §4 https/wss rule + 060 §1 loopback carve) */
/* ------------------------------------------------------------------ */

/**
 * Validate a relay URL against the 060 §1 rule (mirrors CSP v4):
 * `https:`/`wss:` always OK; `http:`/`ws:` ONLY for the IP literals
 * `127.0.0.1` / `[::1]` with a port (dev loop standardizes on
 * `http://127.0.0.1:1999`); anything else is rejected. `localhost` by
 * name is deliberately NOT accepted (060 §1). Returns null when valid,
 * otherwise an error-reason string.
 */
export function validateRelayUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return "not a parseable URL — use https:// or wss:// (http://127.0.0.1:1999 for local testing)"
  }
  const scheme = u.protocol.slice(0, -1) // strip trailing ":"
  if (scheme === "https" || scheme === "wss") return null
  if (scheme === "http" || scheme === "ws") {
    const host = u.hostname
    if (host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      if (u.port === "") {
        return "loopback relay URLs must include a port (e.g. http://127.0.0.1:1999)"
      }
      return null
    }
    return "http:/ws: relay URLs are only allowed for loopback (127.0.0.1 / [::1]) — use https:// or wss:// for remote relays"
  }
  return `unsupported scheme "${scheme}" — use https:// or wss:// (http://127.0.0.1:1999 for local testing)`
}

/* ------------------------------------------------------------------ */
/* encoding                                                             */
/* ------------------------------------------------------------------ */

/** Encode a server invite (057 §2): `excali-collab:v1:srv:<b64url JSON>`. */
export function encodeServerInvite(invite: ServerInvite): string {
  const relayErr = validateRelayUrl(invite.relay)
  if (relayErr !== null) {
    throw new Error(`encodeServerInvite: relay rejected: ${relayErr}`)
  }
  if (typeof invite.org !== "string" || invite.org.length === 0) {
    throw new Error("encodeServerInvite: org must be a non-empty string")
  }
  if (!isB64urlOfLength(invite.sk, KEY_BYTES)) {
    throw new Error("encodeServerInvite: sk must be a 43-char base64url Ed25519 seed (32 bytes)")
  }
  if (!isB64urlOfLength(invite.ck, KEY_BYTES)) {
    throw new Error("encodeServerInvite: ck must be a 43-char base64url content key (32 bytes)")
  }
  const payload = JSON.stringify({
    relay: invite.relay,
    org: invite.org,
    sk: invite.sk,
    ck: invite.ck,
  })
  return `${TOKEN_PREFIX}srv:${b64urlEncode(new TextEncoder().encode(payload))}`
}

/** Encode a room invite (049 §4): `excali-collab:v1:room:<b64url JSON>`. */
export function encodeRoomInvite(invite: RoomInvite): string {
  if (!isB64urlOfLength(invite.shareId, SHARE_ID_BYTES)) {
    throw new Error("encodeRoomInvite: shareId must be a base64url 128-bit id (22 chars, 16 bytes)")
  }
  if (invite.tier !== "team" && invite.tier !== "private") {
    throw new Error(`encodeRoomInvite: tier must be "team" or "private", got ${JSON.stringify(invite.tier)}`)
  }
  if (invite.roomSecret !== undefined) {
    if (invite.tier === "team") {
      throw new Error('encodeRoomInvite: roomSecret is only valid for tier "private"')
    }
    if (!isB64urlOfLength(invite.roomSecret, KEY_BYTES)) {
      throw new Error("encodeRoomInvite: roomSecret must be a 43-char base64url key (32 bytes)")
    }
  }
  if (invite.fp !== undefined && (typeof invite.fp !== "string" || invite.fp.length === 0)) {
    throw new Error("encodeRoomInvite: fp must be a non-empty string")
  }
  const payload: Record<string, string> = { shareId: invite.shareId, tier: invite.tier }
  if (invite.roomSecret !== undefined) payload.roomSecret = invite.roomSecret
  if (invite.fp !== undefined) payload.fp = invite.fp
  return `${TOKEN_PREFIX}room:${b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`
}

/* ------------------------------------------------------------------ */
/* parsing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Parse invite text (054 Q1: sentence + code, or a bare code) into a
 * discriminated result. The pasted string is treated as a single opaque
 * capability token — copy failures, truncation, or a mismatched tier are
 * surfaced as a paste-time parse error with the failing field named
 * (049 §4). Malformed sk/ck (wrong length/encoding) fail with the field
 * named (058 §1.1).
 */
export function parseInvite(text: string): ParseInviteResult {
  const match = INVITE_TOKEN_RE.exec(text)
  if (!match) return { kind: "none" }
  const body = match[0].slice(TOKEN_PREFIX.length)
  const kind = body.startsWith("srv:") ? "srv" : "room"
  const encoded = body.slice(kind === "srv" ? 4 : 5) // "srv:" = 4 chars, "room:" = 5

  if (!B64URL_CHARS_RE.test(encoded)) {
    return { kind: "error", field: "payload", reason: "invite body is not valid base64url" }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(encoded)))
  } catch {
    return { kind: "error", field: "payload", reason: "invite payload is not valid JSON" }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "error", field: "payload", reason: "invite payload must be a JSON object" }
  }
  const record = parsed as Record<string, unknown>

  if (kind === "srv") {
    if (typeof record.relay !== "string") {
      return { kind: "error", field: "relay", reason: "relay must be a string URL" }
    }
    const relayErr = validateRelayUrl(record.relay)
    if (relayErr !== null) {
      return { kind: "error", field: "relay", reason: relayErr }
    }
    if (typeof record.org !== "string" || record.org.length === 0) {
      return { kind: "error", field: "org", reason: "org must be a non-empty string" }
    }
    if (!isB64urlOfLength(record.sk, KEY_BYTES)) {
      return {
        kind: "error",
        field: "sk",
        reason: "sk must be a 43-char base64url Ed25519 seed (32 bytes)",
      }
    }
    if (!isB64urlOfLength(record.ck, KEY_BYTES)) {
      return {
        kind: "error",
        field: "ck",
        reason: "ck must be a 43-char base64url content key (32 bytes)",
      }
    }
    return {
      kind: "server",
      relay: record.relay,
      org: record.org,
      sk: record.sk,
      ck: record.ck,
    }
  }

  // room
  if (!isB64urlOfLength(record.shareId, SHARE_ID_BYTES)) {
    return {
      kind: "error",
      field: "shareId",
      reason: "shareId must be a base64url 128-bit id (22 chars, 16 bytes)",
    }
  }
  if (record.tier !== "team" && record.tier !== "private") {
    return { kind: "error", field: "tier", reason: 'tier must be "team" or "private"' }
  }
  const tier = record.tier
  let roomSecret: string | undefined
  if (record.roomSecret !== undefined) {
    if (!isB64urlOfLength(record.roomSecret, KEY_BYTES)) {
      return {
        kind: "error",
        field: "roomSecret",
        reason: "roomSecret must be a 43-char base64url key (32 bytes)",
      }
    }
    if (tier === "team") {
      return { kind: "error", field: "roomSecret", reason: 'roomSecret is only valid for tier "private"' }
    }
    roomSecret = record.roomSecret
  }
  if (record.fp !== undefined && (typeof record.fp !== "string" || record.fp.length === 0)) {
    return { kind: "error", field: "fp", reason: "fp must be a non-empty string" }
  }
  const result: { kind: "room"; shareId: string; tier: "team" | "private"; roomSecret?: string; fp?: string } = {
    kind: "room",
    shareId: record.shareId,
    tier,
  }
  if (roomSecret !== undefined) result.roomSecret = roomSecret
  if (typeof record.fp === "string") result.fp = record.fp
  return result
}

/**
 * Preview of a successfully parsed invite (054 Q6): the payload carries no
 * room name, so the preview shows org + relay + key presence for server
 * invites and tier + key presence only for room invites.
 */
export function parsePreview(
  invite: ({ kind: "server" } & ServerInvite) | ({ kind: "room" } & RoomInvite),
): InvitePreview {
  if (invite.kind === "server") {
    return {
      kind: "server",
      org: invite.org,
      relay: invite.relay,
      hasKeys: Boolean(invite.sk && invite.ck),
    }
  }
  return { kind: "room", tier: invite.tier, hasKey: Boolean(invite.roomSecret) }
}
