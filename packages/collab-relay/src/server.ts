/**
 * collab-relay — WS upgrade + signed-hello admission (goal 023 task 037).
 *
 * Authority: 049 §1/§2 (hello/welcome/error semantics, fatal-close posture),
 * 052 §3 (connection lifecycle: PartyKit auto-accepts the socket — no
 * reject-before-accept hook sees frame payloads — so admission is post-
 * accept close-on-fail; 2s hello grace timer), 057 §3/§5 (canonical hello
 * string; ADMISSION_INVALID reason text), 059 §2/§3 (v2 env ORG_PUBKEYS,
 * canon rebuild + Ed25519 verify vs EVERY registered pk; supersedes 052's
 * ORG_SECRETS comparison), 058 (org-key mode; the hello canon is not
 * touched by it).
 *
 * Scope seam (task 037 owns ONLY the admission gate): on success the
 * connection is welcomed with `snapshotAvailable: false` and `peers: []`.
 * The room DO — roster, peer{join|leave}, snapshot store/serve, live
 * message routing — lands in task 038; post-welcome frames are dropped
 * here.
 *
 * PartyKit module (object-literal) server form: the runtime dispatches
 * `onConnect(conn, room, ctx)` / `onMessage(msg, conn, room)` /
 * `onRequest(req, room)` — `room` gives access to `room.env` (the relay
 * env). Task 041 wires this into party.config.ts (route `/room/:shareId`).
 */

import type { Connection, PartyKitServer, Room } from "partykit/server"
import { PROTOCOL_VERSION, b64urlToBytes } from "collab-core"
import type { ErrorCode, HelloPayload, RelayMessage } from "collab-core"
import type { FrameGuardResult } from "./guards"

/** First-message grace window (052 §3): hello MUST arrive within 2s. */
export const HELLO_GRACE_MS = 2_000

/** 057 §5 verbatim: shared reason for unknown-org and failed-verify alike (059 §3). */
export const ADMISSION_REJECT_REASON =
  "admission signature rejected — the org key may have rotated; request a fresh server invite"

/**
 * Close codes for fatal errors (059 §3): 1003 = unsupported protocol
 * version, 1008 = policy violation (admission / room claim), 1009 =
 * message too big (RFC 6455 — the task-041 MESSAGE_TOO_LARGE close,
 * 049 §1 fatal set). Non-fatal codes never reach `refuse` and stay
 * undefined.
 */
const CLOSE_CODES: Record<ErrorCode, number | undefined> = {
  ADMISSION_INVALID: 1008,
  PROTOCOL_VERSION: 1003,
  ROOM_CLAIM_MISMATCH: 1008,
  SEED_REJECTED: undefined,
  CHUNK_INVALID: undefined,
  MESSAGE_TOO_LARGE: 1009,
  FILE_NOT_FOUND: undefined,
}

// ─── env (059 §2 v2 authoritative; 052 §2 legacy fallback) ──────────────────

/** Relay env. Values are JSON strings; v2 is authoritative when present. */
export interface RelayEnv {
  /** v2: JSON array of { org: string, pubkeys: string[] } — b64url Ed25519 pks (059 §2). */
  ORG_PUBKEYS?: string
  /** legacy (052 §2): JSON object org → b64url admission secret. */
  ORG_SECRETS?: string
}

/** Parsed relay env — maps ready for admission lookups. */
export interface RelayConfig {
  /** org label → registered Ed25519 public keys (rotation grace array). First entry wins for dup orgs. */
  orgPubkeys: Map<string, string[]>
  /** legacy org label → raw admission secret. */
  orgSecrets: Map<string, string>
}

/** Warn-once cache for duplicate org entries (059 §2: first wins + warn). */
const warnedDupOrgs = new Set<string>()

/**
 * Parse the relay env (059 §2). ORG_PUBKEYS is authoritative: when the var
 * is present, the legacy ORG_SECRETS path is disabled entirely —
 * empty/malformed ⇒ all admissions fail. When ORG_PUBKEYS is absent,
 * ORG_SECRETS (052 §2 shape: org → secret object) is the fallback.
 * Never throws: malformed env degrades to an empty registry.
 */
export function parseRelayEnv(env: RelayEnv, warn: (msg: string) => void = console.warn): RelayConfig {
  const orgPubkeys = new Map<string, string[]>()
  const orgSecrets = new Map<string, string>()

  const rawPubkeys = typeof env.ORG_PUBKEYS === "string" ? env.ORG_PUBKEYS.trim() : ""
  if (rawPubkeys !== "") {
    let entries: unknown = null
    try {
      entries = JSON.parse(rawPubkeys)
    } catch (e) {
      warn(`ORG_PUBKEYS is not valid JSON — all admissions fail (059 §2): ${e instanceof Error ? e.message : String(e)}`)
    }
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (entry === null || typeof entry !== "object") {
          warn("ORG_PUBKEYS contains a non-object entry — skipped")
          continue
        }
        const { org, pubkeys } = entry as { org?: unknown; pubkeys?: unknown }
        if (typeof org !== "string" || org === "" || !Array.isArray(pubkeys)) {
          warn(`ORG_PUBKEYS entry ${typeof org === "string" ? `"${org}"` : "without an org"} is malformed — skipped`)
          continue
        }
        if (orgPubkeys.has(org)) {
          if (!warnedDupOrgs.has(org)) {
            warnedDupOrgs.add(org)
            warn(`ORG_PUBKEYS duplicate org "${org}" — first entry wins (059 §2)`)
          }
          continue
        }
        orgPubkeys.set(org, pubkeys.filter((pk): pk is string => typeof pk === "string"))
      }
    } else if (entries !== null) {
      warn("ORG_PUBKEYS must be a JSON array — all admissions fail (059 §2)")
    }
    return { orgPubkeys, orgSecrets }
  }

  const rawSecrets = typeof env.ORG_SECRETS === "string" ? env.ORG_SECRETS.trim() : ""
  if (rawSecrets !== "") {
    let obj: unknown = null
    try {
      obj = JSON.parse(rawSecrets)
    } catch (e) {
      warn(`ORG_SECRETS is not valid JSON — all admissions fail (052 §2): ${e instanceof Error ? e.message : String(e)}`)
    }
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [org, secret] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof secret === "string" && secret !== "") orgSecrets.set(org, secret)
        else warn(`ORG_SECRETS entry "${org}" is not a non-empty string — skipped`)
      }
    } else if (obj !== null) {
      warn("ORG_SECRETS must be a JSON object — all admissions fail (052 §2)")
    }
  }
  return { orgPubkeys, orgSecrets }
}

// ─── canonical hello string (057 §3) ────────────────────────────────────────

/**
 * The exact canonical hello string, UTF-8 encoded and Ed25519-signed with
 * the org seed (057 §3, verbatim):
 *
 *   `excali-collab/v1:hello:` + JSON.stringify({ v:1, t:"hello",
 *     p:{ profileId, name, color, privacy, room, org, key } })
 *
 * i.e. the full hello payload MINUS `admit.sig`, with `admit.org` hoisted
 * to `org`, fixed property order, plain `JSON.stringify` (no RFC 8785 —
 * signer and verifier rebuild the same shape, 057 §3 precedent). The relay
 * rebuilds the identical string from the received fields and verifies
 * against every registered pk for the org (rotation grace, 057 §4).
 *
 * NOTE (self-contained vs collab-core): collab-core's uncommitted working
 * tree also carries `helloCanon` (twice — wire.ts pass-through and
 * envelope.ts fixed-order rebuild) plus `verifyEd25519`/`signHello` from a
 * parallel in-flight task. This local copy keeps collab-relay committed-
 * state-consistent against the COMMITTED collab-core; when/if the
 * collab-core additions land, switch to the single shared implementation
 * (057 §3 zero-drift rule). The wire.ts copy matches this one (color
 * passed through as received); the envelope.ts copy re-serializes
 * `{background, stroke}` — they agree for every well-formed client.
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

/**
 * Ed25519 verify of a hello's admission sig against ONE org public key
 * (059 §3 step 4 — the loop calls this per registered pk; any pass
 * admits). Never throws: malformed sig/pk b64 or wrong lengths simply
 * fail that key.
 */
export async function verifyHelloSig(hello: HelloPayload, pubkeyB64url: string): Promise<boolean> {
  try {
    const canon = new TextEncoder().encode(helloCanon(hello))
    const sigBytes = b64urlToBytes(hello.admit.sig)
    if (sigBytes.length !== 64) return false // Ed25519 sigs are 64 bytes
    const keyBytes = b64urlToBytes(pubkeyB64url)
    if (keyBytes.length !== 32) return false // Ed25519 pubkeys are 32 bytes
    const pubKey = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"])
    return crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, canon)
  } catch {
    return false
  }
}

/** Constant-time UTF-8 comparison for the legacy ORG_SECRETS path (052 §2). */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

// ─── admission gate (pure, unit-testable) ───────────────────────────────────

export type AdmissionResult =
  | { ok: true; hello: HelloPayload }
  | { ok: false; code: ErrorCode; reason: string }

/**
 * Pure admission gate — no PartyKit involved. Check order per the task
 * spec (052/057/058): (a) room claim — `p.room` must equal the URL's
 * `<shareId>`; (b) org admission — ORG_PUBKEYS Ed25519 verify against
 * every registered pk (any match admits; rotation grace) with the legacy
 * ORG_SECRETS comparison as fallback; (c) unknown org / no matching key ⇒
 * ADMISSION_INVALID with 057 §5's reason text.
 *
 * `shareId` comes from the connection URL (`/room/<shareId>`, see
 * `deriveShareId`); when omitted the room-claim check is skipped — the
 * PartyKit handler always passes it.
 */
export async function admitHello(hello: HelloPayload, env: RelayEnv, shareId?: string): Promise<AdmissionResult> {
  // (a) room claim (059 §3 step 5; ordered first per the task spec)
  if (shareId !== undefined && hello.room !== shareId) {
    return {
      ok: false,
      code: "ROOM_CLAIM_MISMATCH",
      reason: `hello.room "${hello.room}" does not match the connection's room "${shareId}"`,
    }
  }

  const config = parseRelayEnv(env)
  const org = hello.admit.org

  // (b) v2: org's registered pubkeys — verify against EVERY pk (rotation grace)
  const pubkeys = config.orgPubkeys.get(org)
  if (pubkeys !== undefined) {
    for (const pk of pubkeys) {
      if (await verifyHelloSig(hello, pk)) return { ok: true, hello }
    }
    // (c) known org, no matching key — rotation hint, 057 §5 verbatim
    return { ok: false, code: "ADMISSION_INVALID", reason: ADMISSION_REJECT_REASON }
  }

  // (b legacy) 052 §2 fallback: hello.admit.sig compared as the raw secret
  const secret = config.orgSecrets.get(org)
  if (secret !== undefined) {
    if (constantTimeEqual(hello.admit.sig, secret)) return { ok: true, hello }
    return {
      ok: false,
      code: "ADMISSION_INVALID",
      reason: "admission secret rejected — the org secret may have rotated; request a fresh server invite",
    }
  }

  // (c) unknown org — same code, reason carries the label (059 §3)
  return {
    ok: false,
    code: "ADMISSION_INVALID",
    reason: `unknown org "${org}" — no public keys or secret registered for it (059 §2)`,
  }
}

// ─── first-message codec gate ───────────────────────────────────────────────

/** Runtime shape guard for a hello payload (057 §3) — the relay's codec check before admission. */
export function isHelloPayload(x: unknown): x is HelloPayload {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false
  const h = x as Record<string, unknown>
  const color = h.color
  const admit = h.admit
  return (
    typeof h.profileId === "string" &&
    h.profileId !== "" &&
    typeof h.name === "string" &&
    color !== null &&
    typeof color === "object" &&
    typeof (color as Record<string, unknown>).background === "string" &&
    typeof (color as Record<string, unknown>).stroke === "string" &&
    (h.privacy === "team" || h.privacy === "private") &&
    typeof h.room === "string" &&
    h.room !== "" &&
    admit !== null &&
    typeof admit === "object" &&
    typeof (admit as Record<string, unknown>).org === "string" &&
    (admit as Record<string, unknown>).org !== "" &&
    typeof (admit as Record<string, unknown>).sig === "string" &&
    (admit as Record<string, unknown>).sig !== "" &&
    typeof h.key === "string" &&
    h.key !== ""
  )
}

export type FirstMessageParse =
  | { ok: true; kind: "hello"; hello: HelloPayload }
  | { ok: true; kind: "probe" }
  | { ok: false; code: "PROTOCOL_VERSION" | "ADMISSION_INVALID"; reason: string }

/**
 * Codec gate for the FIRST message on a connection (049 §1 / 052 §3):
 * normally a v1 `hello`; the room probe (ADR 0004) is the one exception —
 * a `room-probe` frame dials the room WITHOUT admission, so the pre-join
 * query never touches the roster. Structural failures (non-JSON, non-object,
 * wrong `v`) are PROTOCOL_VERSION; a well-formed v1 envelope that is neither
 * hello nor room-probe, or a hello with a malformed payload, is
 * ADMISSION_INVALID.
 */
export function parseFirstMessage(raw: string): FirstMessageParse {
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return { ok: false, code: "PROTOCOL_VERSION", reason: "first message is not valid JSON" }
  }
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    return { ok: false, code: "PROTOCOL_VERSION", reason: "first message is not a JSON object" }
  }
  const m = msg as Record<string, unknown>
  if (m.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "PROTOCOL_VERSION",
      reason: `unsupported protocol version ${JSON.stringify(m.v)} — expected ${PROTOCOL_VERSION}`,
    }
  }
  // ADR 0004: the room probe is the shareId-keyed pre-join query — dialed
  // without admission, never enters the roster. Anything else on the wire
  // first is malformed for this connection's purpose.
  if (m.t === "room-probe") {
    return { ok: true, kind: "probe" }
  }
  if (m.t !== "hello") {
    return { ok: false, code: "ADMISSION_INVALID", reason: `first message must be hello (got ${JSON.stringify(m.t)})` }
  }
  if (!isHelloPayload(m.p)) {
    return { ok: false, code: "ADMISSION_INVALID", reason: "hello payload is missing required fields (057 §3)" }
  }
  return { ok: true, kind: "hello", hello: m.p }
}

// ─── connection plumbing ────────────────────────────────────────────────────

/**
 * Extract the `<shareId>` from a `/room/<shareId>` WS URL (049 §2 route)
 * or from partykit 0.0.115's own room routes — `/party/<shareId>` (the
 * main worker) and `/parties/main/<shareId>` (task 041 finding, verified
 * against the dev runtime: the facade's `getRoomAndPartyFromPathname`
 * only maps `/party/` and `/parties/` paths to a room DO, so the wire
 * contract's `/room/` path is NOT servable by this runtime; kept for
 * gateway compatibility and the unit tests).
 */
export function deriveShareId(uri: string): string | null {
  try {
    const pathname = new URL(uri).pathname.replace(/\/+$/, "")
    const room = /^\/room\/([^/]+)$/.exec(pathname)?.[1]
    const party = /^\/party\/([^/]+)$/.exec(pathname)?.[1]
    const partiesMain = /^\/parties\/main\/([^/]+)$/.exec(pathname)?.[1]
    const match = [room, party, partiesMain].find((m) => m !== undefined)
    if (match === undefined) return null
    try {
      return decodeURIComponent(match)
    } catch {
      return null
    }
  } catch {
    return null
  }
}

/** Read the relay env off a PartyKit room (values are JSON strings; absent → undefined). */
function relayEnv(room: Room): RelayEnv {
  const env = room.env
  return {
    ORG_PUBKEYS: typeof env.ORG_PUBKEYS === "string" ? env.ORG_PUBKEYS : undefined,
    ORG_SECRETS: typeof env.ORG_SECRETS === "string" ? env.ORG_SECRETS : undefined,
  }
}

interface PendingConnection {
  /** shareId from the connection URL — the room-claim target (059 §3 step 5). */
  shareId: string
  welcomed: boolean
  timer: ReturnType<typeof setTimeout>
}

/**
 * Task-041 composition seam (index.ts): optional hooks that replace the
 * stub-welcome + drop-post-welcome behavior with the room DO (RoomState +
 * FileStore) and the guards. All callbacks are optional — a hook-less
 * server behaves exactly as before (the unit-test contract).
 */
export interface RelayServerHooks {
  /**
   * Runs on EVERY string frame before anything else (pre- AND post-welcome).
   * Return a failed FrameGuardResult to refuse: fatal results send
   * error{fatal:true} + close; non-fatal send error{fatal:false} and keep
   * the connection (041 guards.ts).
   */
  frameGuard?(conn: Connection, frame: string): FrameGuardResult | undefined
  /**
   * Admission success — REPLACES the stub welcome. The room DO joins here
   * (RoomState.join sends the real welcome with snapshot + peers).
   */
  onAdmitted?(conn: Connection, room: Room, hello: HelloPayload): void | Promise<void>
  /** Post-welcome frame routing — the room DO's message path (038/041). */
  onMessage?(frame: string, conn: Connection, room: Room): void | Promise<void>
  /**
   * Room probe (ADR 0004): a `room-probe` FIRST message — the shareId-keyed
   * pre-join query. No admission, no roster side effect: the room DO answers
   * from its storage and the connection is closed. When the hook is absent,
   * the server answers with the empty-room facts so the contract stays total.
   */
  onProbe?(conn: Connection, room: Room): void | Promise<void>
  /** Connection teardown — the room DO's leave path (038/041). */
  onClose?(conn: Connection): void
}

/**
 * Build the relay PartyKit server (module/object-literal form — callbacks
 * receive the room, giving access to room.env). A fresh instance per call
 * keeps per-connection pending state isolated (tests create their own).
 *
 * Connection lifecycle (052 §3 / 059 §3): PartyKit auto-accepts the
 * socket; onConnect arms a 2s grace timer for the first message, which
 * MUST be hello. Admission failures send `error { fatal: true }` and then
 * close (1003 for PROTOCOL_VERSION, 1008 for ADMISSION_INVALID /
 * ROOM_CLAIM_MISMATCH). Success emits `welcome` with
 * `snapshotAvailable: false` and `peers: []` — or, when task 041's
 * hooks are wired, hands off to the room DO via onAdmitted/onMessage/
 * onClose.
 */
export function createRelayServer(hooks: RelayServerHooks = {}): PartyKitServer {
  const pending = new Map<string, PendingConnection>()

  const refuse = (conn: Connection, code: ErrorCode, reason: string, fatal = true): void => {
    const closeCode = fatal ? CLOSE_CODES[code] : undefined
    conn.send(JSON.stringify({ v: 1, t: "error", p: { code, reason, fatal } } satisfies RelayMessage))
    if (closeCode !== undefined) conn.close(closeCode, code)
  }

  return {
    onConnect(conn, _room, _ctx) {
      const shareId = deriveShareId(conn.uri)
      if (shareId === null) {
        refuse(conn, "ADMISSION_INVALID", "connection URL does not carry a /room/<shareId> path")
        return
      }
      const timer = setTimeout(() => {
        pending.delete(conn.id)
        try {
          conn.close(1008, "hello timeout")
        } catch {
          /* already closed */
        }
      }, HELLO_GRACE_MS)
      pending.set(conn.id, { shareId, welcomed: false, timer })
    },

    async onMessage(message, conn, room) {
      const rec = pending.get(conn.id)
      if (rec === undefined) return // unknown connection

      // task 041 guard seam: size + rate on EVERY string frame, pre- and post-welcome
      if (typeof message === "string") {
        const guard = hooks.frameGuard?.(conn, message)
        if (guard !== undefined && !guard.ok) {
          refuse(conn, guard.code, guard.reason, guard.fatal)
          if (guard.fatal) pending.delete(conn.id)
          return
        }
      }

      if (rec.welcomed) {
        // post-welcome routing is task 038/041's room DO — hand off when wired
        if (typeof message === "string") await hooks.onMessage?.(message, conn, room)
        return
      }
      clearTimeout(rec.timer)

      if (typeof message !== "string") {
        refuse(conn, "PROTOCOL_VERSION", "binary frames are not part of protocol v1")
        pending.delete(conn.id)
        return
      }

      const parsed = parseFirstMessage(message)
      if (!parsed.ok) {
        refuse(conn, parsed.code, parsed.reason)
        pending.delete(conn.id)
        return
      }

      // ADR 0004 room probe: a shareId-keyed pre-join query, no admission,
      // no roster side effect. One-shot: the hook answers, then the
      // connection is closed (a lingering probe socket would hold the DO
      // awake — the opposite of "cheap").
      if (parsed.kind === "probe") {
        pending.delete(conn.id)
        if (hooks.onProbe !== undefined) {
          await hooks.onProbe(conn, room)
        } else {
          conn.send(
            JSON.stringify({
              v: 1,
              t: "room-probe",
              p: { roomName: null, snapshotAvailable: false, peerCount: 0 },
            } satisfies RelayMessage),
          )
        }
        try {
          conn.close(1000, "probe complete")
        } catch {
          /* already closed */
        }
        return
      }

      const result = await admitHello(parsed.hello, relayEnv(room), rec.shareId)
      if (!result.ok) {
        refuse(conn, result.code, result.reason)
        pending.delete(conn.id)
        return
      }

      // Admitted — welcome (049 §1); the room DO (041) sends the real
      // welcome with snapshot + peers; the hook-less stub stays for tests.
      const hello = result.hello
      if (hooks.onAdmitted !== undefined) {
        await hooks.onAdmitted(conn, room, hello)
      } else {
        const welcome: RelayMessage = {
          v: 1,
          t: "welcome",
          p: {
            profileId: hello.profileId,
            connId: conn.id,
            room: hello.room,
            privacy: hello.privacy,
            snapshotAvailable: false,
            roomName: null,
            peers: [],
          },
        }
        conn.send(JSON.stringify(welcome))
      }
      rec.welcomed = true
    },

    onClose(conn) {
      const rec = pending.get(conn.id)
      if (rec !== undefined) {
        clearTimeout(rec.timer)
        pending.delete(conn.id)
      }
      // peer{leave} broadcast lands with task 038/041's roster machinery.
      hooks.onClose?.(conn)
    },

    onRequest() {
      // The room endpoint is WS-only: any plain HTTP request is a 404
      // (partykit routes /room/<shareId> here; other paths never reach the
      // party — 049 §2 route).
      return new Response("not found", { status: 404 })
    },
  }
}

/** The relay server singleton — `src/index.ts` default-export for task 041's party.config.ts. */
export const relayServer: PartyKitServer = createRelayServer()
