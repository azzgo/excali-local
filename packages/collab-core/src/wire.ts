/**
 * collab-core wire contract — protocol v1.
 *
 * Authoritative sources (Wayfinder decision records):
 * - 049 §0–§6 — {v,t,p} envelope, message table, chunk framing, TS skeleton
 * - 057 §1–§3 — Ed25519 key formats (seedToPkcs8), signed hello
 * - 058 §1.3/§2 — `snapshot` retired from the minted set; relay-stamped `from`
 *   lives at envelope level, never inside `p`
 * - 051 §2 — file sync messages (file-put / file-get / file / file-available /
 *   FILE_NOT_FOUND)
 *
 * Every frame is a single JSON text WS message. Sender identity is never a
 * client-supplied payload field: the relay stamps `from` (connId) at envelope
 * level on forwarded content frames; clients treat a missing `from` as a relay
 * bug and drop the frame.
 */

export const PROTOCOL_VERSION = 1 as const
export type ProtocolVersion = typeof PROTOCOL_VERSION

/** Generic {v,t,p} envelope (049 §0). */
export interface WireEnvelope<T extends string = string, P = unknown> {
  v: 1
  t: T
  p: P
}

/** Color pair consumed by Excalidraw collaborators (049 §1). */
export interface ColorPair {
  background: string
  stroke: string
}

/** Room member as relayed by welcome/peer (049 §1; connId is relay-stamped). */
export interface Member {
  profileId: string // install-uuid (mint-once)
  name: string // self-chosen display name
  color: ColorPair // derived from profileId
  connId: string // relay-stamped connection id
}

/** Hello payload (057 §3): membership proven by an Ed25519 signature. */
export interface HelloPayload {
  profileId: string
  name: string
  color: ColorPair
  privacy: "team" | "private"
  room: string // asserted shareId
  /** org label + b64url Ed25519 sig over the 057 §3 canonical hello string */
  admit: { org: string; sig: string }
  /** member Ed25519 public key, b64url (mint-once per install) */
  key: string
}

/** Welcome payload (049 §1): admission OK + room state summary. */
export interface WelcomePayload {
  profileId: string // echo of hello.profileId
  connId: string
  room: string
  privacy: "team" | "private"
  snapshotAvailable: boolean
  /** current shared room name — null before anyone named it (ADR 0004) */
  roomName: string | null
  peers: Member[]
}

export type ClientMessage =
  | { v: 1; t: "hello"; p: HelloPayload }
  | { v: 1; t: "seed"; p: { scene: unknown[]; seq: number } }
  | { v: 1; t: "scene"; p: { elements: unknown[]; seq: number } }
  | {
      v: 1
      t: "pointer"
      p: { x: number; y: number; tool: "pointer" | "laser"; button?: "up" | "down" }
    }
  | { v: 1; t: "file-put"; p: { fileId: string; mimeType: string; size: number } }
  | { v: 1; t: "file-get"; p: { fileId: string } }
  | { v: 1; t: "chunk"; p: { id: string; n: number; i: number; d: string } }
  | { v: 1; t: "room-name"; p: { name: string } }
  | { v: 1; t: "member-name"; p: { name: string } }
  | { v: 1; t: "ping"; p: {} } // in-session liveness probe (client→relay)
  | { v: 1; t: "room-probe"; p: {} }
export type RelayMessage =
  | { v: 1; t: "welcome"; p: WelcomePayload }
  | { v: 1; t: "peer"; p: { kind: "join" | "leave"; member?: Member } }
  | { v: 1; t: "scene"; p: { elements: unknown[]; seq: number }; from: string }
  | {
      v: 1
      t: "pointer"
      p: { x: number; y: number; tool: "pointer" | "laser"; button?: "up" | "down" }
      from: string
    }
  | { v: 1; t: "file"; p: { fileId: string; mimeType: string } }
  | { v: 1; t: "file-available"; p: { fileId: string; mimeType: string; size: number } }
  | { v: 1; t: "error"; p: { code: ErrorCode; reason: string; fatal?: boolean } }
  | { v: 1; t: "chunk"; p: { id: string; n: number; i: number; d: string } }
  | { v: 1; t: "room-name"; p: { name: string }; from: string }
  | { v: 1; t: "member-name"; p: { name: string }; from: string }
  | { v: 1; t: "pong"; p: {} } // in-session liveness answer (relay→client)
  | { v: 1; t: "room-probe"; p: RoomProbePayload }

/**
 * Room probe answer (ADR 0004): a shareId-keyed pre-join query, no admission,
 * no roster side effects — the designated cheap read path. `roomName` is null
 * when the room has no name (or the DO was evicted since the last name).
 */
export interface RoomProbePayload {
  roomName: string | null
  snapshotAvailable: boolean
  peerCount: number
}

/** ADR 0004 validation: trimmed room names are non-empty and ≤ this many chars. */
export const ROOM_NAME_MAX_LENGTH = 100

/** ADR 0006 validation: trimmed member names are non-empty and ≤ this many chars. */
export const MEMBER_NAME_MAX_LENGTH = 40

/**
 * @deprecated RETIRED from the minted set (058 §1.3) — kept in TS only as
 * documentation. No party ever synthesizes a signed snapshot: the relay serves
 * the stored signed envelope verbatim with `t` preserved ("seed" | "scene").
 * Never emit or accept this type on the wire.
 */
export interface SnapshotMessage {
  v: 1
  t: "snapshot"
  p: { elements: unknown[]; seq: number }
}

export type ErrorCode =
  | "ADMISSION_INVALID"
  | "PROTOCOL_VERSION"
  | "ROOM_CLAIM_MISMATCH"
  | "SEED_REJECTED"
  | "CHUNK_INVALID"
  | "MESSAGE_TOO_LARGE"
  | "FILE_NOT_FOUND"

/**
 * Derive a member color from a profileId (Wayfinder 055 native rule).
 * Java-style string hash over chars — (o << 5) - o + charCodeAt, 32-bit wrap —
 * then hue = (hash % 37) * 10, returned as `hsl(hue, 100%, 83%)`.
 *
 * `Math.abs` on the hash keeps the hue non-negative, matching Excalidraw's
 * own native rule (Ta = hsl(Math.abs(hash) % 37 * 10, 100%, 83%)) so the same
 * profileId always yields the SAME color in our roster dots AND Excalidraw's
 * UserList avatars (task 075).
 */
export function deriveColor(profileId: string): string {
  let h = 0
  for (let i = 0; i < profileId.length; i++) {
    h = ((h << 5) - h + profileId.charCodeAt(i)) | 0
  }
  const hue = (Math.abs(h) % 37) * 10
  return `hsl(${hue}, 100%, 83%)`
}

/** 16-byte Ed25519 PKCS#8 DER prefix (057 §1): 302e020100300506032b657004220420 */
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00,
  0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
])

/**
 * Wrap a 32-byte RFC 8032 Ed25519 seed in PKCS#8 (057 §1) so WebCrypto
 * `importKey("pkcs8", …)` can consume it: fixed 16-byte DER prefix || seed.
 */
export function seedToPkcs8(seed: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(PKCS8_PREFIX.length + seed.length)
  out.set(PKCS8_PREFIX, 0)
  out.set(seed, PKCS8_PREFIX.length)
  return out
}

/**
 * 057 §3 canonical hello string — the exact bytes the org seed signs:
 *
 *   `excali-collab/v1:hello:` + JSON.stringify({ v:1, t:"hello",
 *     p:{ profileId, name, color, privacy, room, org, key } })
 *
 * i.e. the full hello payload minus `admit.sig`, with `admit.org` hoisted
 * to `org`, fixed property order, plain `JSON.stringify`, UTF-8. SINGLE
 * implementation shared by the signing client and the verifying relay
 * (057 §3: "single collab-core implementation" — the zero-drift rule).
 *
 * Plain JSON.stringify is safe because signer and verifier are the same
 * package (no RFC 8785 needed, 057 §3 precedent); the wire-parsed object
 * preserves the sender's property order, so a hello round-trips byte-
 * identically through JSON.parse/JSON.stringify.
 */
export function helloCanon(hello: HelloPayload): string {
  return (
    "excali-collab/v1:hello:" +
    JSON.stringify({
      v: 1,
      t: "hello",
      p: {
        profileId: hello.profileId,
        name: hello.name,
        color: hello.color,
        privacy: hello.privacy,
        room: hello.room,
        org: hello.admit.org,
        key: hello.key,
      },
    })
  )
}
