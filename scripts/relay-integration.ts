/**
 * relay-integration — the Wayfinder-060 emulation matrix against `partykit dev`,
 * driving real wire-protocol clients (collab-core codec: signHello,
 * helloCanon, serializeEnvelope, ChunkAssembler) over real WebSockets.
 *
 * Run: `pnpm relay:integration` (tsx scripts/relay-integration.ts).
 *
 * Dev loop (060 §2/§3):
 *   - Two-terminal flow: `pnpm relay:dev` in terminal 1 (seeds .dev-keys.json
 *     + .env, spawns partykit dev on http://127.0.0.1:1999), then this script
 *     in terminal 2 — it DETECTS the running dev server and drives it.
 *   - Self-spawn flow: no dev server running → the script spawns its own
 *     `partykit dev` (with --var ORG_PUBKEYS for the key-rotation phases),
 *     waits for readiness, runs the matrix, and kills it on exit.
 *   - Room-death emulation (060 §3): `.partykit/state` persists by default;
 *     wipe it BETWEEN rounds to simulate fresh-room eviction:
 *       rm -rf packages/collab-relay/.partykit/state
 *   - NOT representative locally (060 §3 — do not read failures into these):
 *     DO hibernation (dev never hibernates) and eviction timing.
 *
 * IMPORTANT path finding (task 041): partykit 0.0.115 only routes WS upgrades
 * to the main worker's room DO via `/party/<shareId>` (or `/parties/main/…`)
 * — the legacy `/room/<shareId>` path is 404'd by the dev server. The relay
 * accepts `/party/` (server.ts deriveShareId), and collab-core's buildRoomUrl
 * + CollabClient now emit/validate the `/party/` main-route (fixed after a
 * 404-retry loop surfaced in manual testing); this script builds its room
 * URLs through buildRoomUrl so client and matrix can never drift apart.
 *
 * Matrix (041 spec):
 *   C1 two-client join    — both hello with a valid org sig → both welcomed,
 *                           peer{join} deltas flow.
 *   C2 seed race          — two concurrent seeds on an empty room → one
 *                           stored, the other SEED_REJECTED (non-fatal);
 *                           a late joiner reloads the snapshot.
 *   C3 reconnect          — A drops, B broadcasts, A re-hellos → welcome +
 *                           snapshot resync recovers B's scene.
 *   C4 key rotation       — ORG_PUBKEYS [old] → [old,new] (grace) →
 *                           [new]: old-signer rejected ADMISSION_INVALID +
 *                           close 1008, new-signer admitted.
 *   C5 guards             — >256KB frame → MESSAGE_TOO_LARGE fatal + close
 *                           1009; 230KB non-chunk → CHUNK_INVALID non-fatal
 *                           (conn survives); 250-msg flood → rate-guard
 *                           CHUNK_INVALID errors, conn + room survive.
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildRoomUrl,
  ChunkAssembler,
  PROTOCOL_VERSION,
  b64urlToBytes,
  bytesToB64url,
  seedToPkcs8,
  serializeEnvelope,
  signHello,
} from "../packages/collab-core/src/index"
import type { ChunkFrame, HelloPayload, WireEnvelope } from "../packages/collab-core/src/index"

// ─── paths / identity ────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const RELAY_DIR = path.join(REPO_ROOT, "packages", "collab-relay")
const KEYS_PATH = path.join(REPO_ROOT, ".dev-keys.json")

const DEV_PORT = 1999
const RELAY = `http://127.0.0.1:${DEV_PORT}`
const ROOM_PATH_PREFIX = `/party/` // partykit 0.0.115 main-route (see header)

interface DevKeys {
  seed: string
  org: string
  ck: string
}

function loadDevKeys(): DevKeys {
  if (!existsSync(KEYS_PATH)) {
    console.error(
      `relay-integration: ${KEYS_PATH} not found — run \`pnpm relay:dev\` once first (it seeds .dev-keys.json + .env, 060 §2).`,
    )
    process.exit(2)
  }
  const keys = JSON.parse(readFileSync(KEYS_PATH, "utf8")) as Partial<DevKeys>
  if (typeof keys.seed !== "string" || keys.seed === "" || typeof keys.org !== "string" || keys.org === "") {
    console.error(`relay-integration: ${KEYS_PATH} is malformed — delete it and run \`pnpm relay:dev\`.`)
    process.exit(2)
  }
  return { seed: keys.seed, org: keys.org, ck: typeof keys.ck === "string" ? keys.ck : "" }
}

/** Derive the 32-byte Ed25519 public key from a seed (057 §1 — same as relay-dev.ts). */
async function derivePk(seedB64url: string): Promise<string> {
  const pkcs8 = seedToPkcs8(b64urlToBytes(seedB64url))
  const privKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"])
  const jwk = (await crypto.subtle.exportKey("jwk", privKey)) as { x: string }
  return bytesToB64url(b64urlToBytes(jwk.x))
}

async function orgKeyFromSeed(seedB64url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", seedToPkcs8(b64urlToBytes(seedB64url)), { name: "Ed25519" }, false, ["sign"])
}

/** A fresh in-memory org keypair (rotation case: the "new" org key). */
async function freshOrgKeypair(): Promise<{ seed: string; pk: string; key: CryptoKey }> {
  const seed = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
  const pk = await derivePk(seed)
  return { seed, pk, key: await orgKeyFromSeed(seed) }
}

// ─── dev-server lifecycle ────────────────────────────────────────────────────

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port })
    sock.once("connect", () => {
      sock.destroy()
      resolve(true)
    })
    sock.once("error", () => resolve(false))
  })
}

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const tick = async (): Promise<boolean> => {
    if (await portBusy(port)) return true
    if (Date.now() > deadline) return false
    await new Promise((r) => setTimeout(r, 400))
    return tick()
  }
  return tick()
}

function waitForPortFree(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const tick = async (): Promise<void> => {
    if (!(await portBusy(port))) return
    if (Date.now() > deadline) throw new Error(`port ${port} did not free within ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 300))
    return tick()
  }
  return tick()
}

class DevProcess {
  private child: ReturnType<typeof spawn> | null = null
  private out = ""

  /** Spawn `partykit dev` with --var overrides and wait until it serves WS. */
  static async start(orgPubkeysJson: string, onLog: (line: string) => void): Promise<DevProcess> {
    const dev = new DevProcess()
    const args = [
      "--filter",
      "./packages/collab-relay",
      "exec",
      "partykit",
      "dev",
      "--var",
      `ORG_PUBKEYS=${orgPubkeysJson}`,
    ]
    const child = spawn("pnpm", args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    })
    dev.child = child
    const read = (chunk: Buffer | string) => {
      dev.out += String(chunk)
      for (const line of dev.out.split("\n").slice(0, -1)) onLog(line)
      dev.out = dev.out.split("\n").slice(-1)[0]
    }
    child.stdout?.on("data", read)
    child.stderr?.on("data", read)
    child.on("exit", (code) => {
      dev.child = null
      onLog(`[dev] exited with code ${code}`)
    })

    await waitForPortFree(DEV_PORT, 15_000) // never bind over a live socket (rotation restarts)
    const ready = await waitForPort(DEV_PORT, 90_000)
    if (!ready) {
      dev.stop()
      throw new Error("partykit dev did not open the relay port within 90s")
    }
    // the port accepts TCP once the proxy is up; give the first build a moment
    await new Promise((r) => setTimeout(r, 1500))
    return dev
  }

  stop(): void {
    if (this.child !== null) {
      this.child.kill("SIGTERM")
      this.child = null
    }
  }
}

// ─── the wire client ─────────────────────────────────────────────────────────

interface ClientOptions {
  url: string
  profileId: string
  name: string
  room: string
  org: string
  orgKey: CryptoKey
  memberKey: string
  privacy?: "team" | "private"
  /** dial timeout before the client gives up (ms) */
  dialTimeoutMs?: number
}

interface WireFrame {
  v: number
  t: string
  p: any
  from?: string
}

const DEFAULT_WAIT_MS = 10_000

/**
 * A minimal wire-protocol client over the real collab-core codec (signHello
 * for admission, serializeEnvelope for sends, ChunkAssembler for receives).
 * CollabClient (collab-core) cannot be used here: its constructor hardcodes
 * the `/room/<shareId>` path, which partykit 0.0.115 does not serve (see
 * the header finding).
 */
class WireClient {
  private ws: WebSocket | null = null
  private readonly assembler = new ChunkAssembler()
  private readonly frames: WireFrame[] = []
  private readonly closeEvents: { code?: number; reason?: string }[] = []
  private readonly waiters: { pred: (f: WireFrame) => boolean; resolve: (f: WireFrame | undefined) => void }[] = []
  private closed = false

  constructor(private readonly opts: ClientOptions) {}

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /** Every decoded wire frame received so far (post chunk reassembly). */
  get received(): readonly WireFrame[] {
    return this.frames
  }

  /** Close events (code/reason) seen so far. */
  get closes(): readonly { code?: number; reason?: string }[] {
    return this.closeEvents
  }

  private push(frame: WireFrame): void {
    this.frames.push(frame)
    for (const w of this.waiters) {
      if (w.pred(frame)) {
        w.resolve(frame)
      }
    }
    this.waiters.length = 0 // one-shot waiters
  }

  /** Resolve the FIRST frame matching pred, or undefined on timeout. */
  waitFor(pred: (f: WireFrame) => boolean, timeoutMs: number = DEFAULT_WAIT_MS): Promise<WireFrame | undefined> {
    const hit = this.frames.find(pred)
    if (hit !== undefined) return Promise.resolve(hit)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.length = 0
        resolve(undefined)
      }, timeoutMs)
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer)
          resolve(f)
        },
      })
    })
  }

  waitForClose(timeoutMs: number = DEFAULT_WAIT_MS): Promise<{ code?: number; reason?: string } | undefined> {
    if (this.closeEvents.length > 0) return Promise.resolve(this.closeEvents[0])
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs)
      const check = setInterval(() => {
        if (this.closeEvents.length > 0) {
          clearTimeout(timer)
          clearInterval(check)
          resolve(this.closeEvents[0])
        }
      }, 25)
    })
  }

  /** Dial + send the signed hello. Resolves once the socket is open (welcome follows). */
  async connect(): Promise<void> {
    const hello = await this.buildHello()
    const ws = new WebSocket(this.opts.url)
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`dial timeout after ${this.opts.dialTimeoutMs ?? 10_000}ms (${this.opts.url})`))
      }, this.opts.dialTimeoutMs ?? 10_000)
      ws.addEventListener("open", () => {
        clearTimeout(timer)
        ws.send(JSON.stringify(hello))
        resolve()
      })
      ws.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new Error(`WebSocket error on dial (${this.opts.url})`))
      })
      ws.addEventListener("close", (e) => {
        clearTimeout(timer)
        this.closed = true
        this.closeEvents.push({ code: e.code, reason: String(e.reason ?? "") })
      })
      ws.addEventListener("message", (e) => this.handleRaw(String(e.data)))
    })
  }

  private async buildHello(): Promise<{ v: number; t: "hello"; p: HelloPayload }> {
    const payload: HelloPayload = {
      profileId: this.opts.profileId,
      name: this.opts.name,
      color: { background: "#ffffff", stroke: "#000000" },
      privacy: this.opts.privacy ?? "team",
      room: this.opts.room,
      admit: { org: this.opts.org, sig: "" },
      key: this.opts.memberKey,
    }
    payload.admit.sig = await signHello(payload, this.opts.orgKey) // real collab-core signing
    return { v: PROTOCOL_VERSION, t: "hello", p: payload }
  }

  private handleRaw(raw: string): void {
    let env: WireEnvelope
    try {
      env = JSON.parse(raw) as WireEnvelope
    } catch {
      return // non-JSON frame — drop
    }
    if (env?.t === "chunk") {
      const completed = this.assembler.feed(env as unknown as ChunkFrame)
      if (completed === null) return
      env = completed
    }
    this.push(env as WireFrame)
  }

  /** Send one envelope through the real chunk codec (049 §3 transparent framing). */
  sendEnvelope(env: { v: number; t: string; p: unknown }): void {
    const ws = this.ws
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const res = serializeEnvelope(env)
    if (res.chunked) {
      for (const frame of res.frames) ws.send(JSON.stringify(frame))
    } else {
      ws.send(JSON.stringify(env))
    }
  }

  /** Raw single-frame send — guard cases only (a deliberately un-chunked frame). */
  rawSend(frame: string): void {
    this.ws?.send(frame)
  }

  close(): void {
    this.closed = true
    try {
      this.ws?.close()
    } catch {
      /* already closed */
    }
  }

  get wasClosed(): boolean {
    return this.closed
  }
}

function sceneFrame(elements: unknown[], seq: number): { v: number; t: "scene"; p: { elements: unknown[]; seq: number } } {
  return { v: PROTOCOL_VERSION, t: "scene", p: { elements, seq } }
}

function seedFrame(scene: unknown[], seq: number): { v: number; t: "seed"; p: { scene: unknown[]; seq: number } } {
  return { v: PROTOCOL_VERSION, t: "seed", p: { scene, seq } }
}

// ─── the matrix ──────────────────────────────────────────────────────────────

interface CaseResult {
  name: string
  ok: boolean
  detail: string
}

const results: CaseResult[] = []

function pass(name: string, detail: string): void {
  results.push({ name, ok: true, detail })
  console.log(`  ✓ ${name} — ${detail}`)
}

function fail(name: string, detail: string): void {
  results.push({ name, ok: false, detail })
  console.error(`  ✗ ${name} — ${detail}`)
}

async function runCase(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    pass(name, "ok")
  } catch (e) {
    fail(name, `exception: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Shared client identity factory — unique per case. `room` is NOT included: the caller sets it (must equal the URL shareId). */
function identity(org: string, orgKey: CryptoKey, tag: string) {
  const profileId = `relay-it-${tag}`
  return {
    profileId,
    name: `IT ${tag}`,
    org,
    orgKey,
    memberKey: bytesToB64url(crypto.getRandomValues(new Uint8Array(32))),
  }
}

function roomUrl(shareId: string): string {
  return buildRoomUrl(`http://127.0.0.1:${DEV_PORT}`, shareId)
}

// C1 — two-client join
async function caseTwoClientJoin(org: string, orgKey: CryptoKey): Promise<void> {
  const shareId = `it-c1-${Date.now().toString(36)}`
  const a = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c1a") })
  const b = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c1b") })
  await a.connect()
  await b.connect()

  const welcomeA = await a.waitFor((f) => f.t === "welcome")
  const welcomeB = await b.waitFor((f) => f.t === "welcome")
  if (welcomeA === undefined || welcomeB === undefined) {
    throw new Error(
      `welcome missing (A: ${welcomeA === undefined}, B: ${welcomeB === undefined}) — A err: ${JSON.stringify(a.received[0])}, B err: ${JSON.stringify(b.received[0])}`,
    )
  }
  if (welcomeA.p.snapshotAvailable !== false) {
    throw new Error(`A's welcome should be snapshotAvailable:false — got ${JSON.stringify(welcomeA.p)}`)
  }
  const bPeers = welcomeB.p.peers as { profileId: string }[]
  if (!bPeers.some((m) => m.profileId === a.opts.profileId)) {
    throw new Error(`B's welcome.peers should contain A — got ${JSON.stringify(bPeers)}`)
  }
  const peerJoinB = await a.waitFor((f) => f.t === "peer" && f.p.kind === "join")
  if (peerJoinB === undefined || (peerJoinB.p.member as { profileId?: string }).profileId !== b.opts.profileId) {
    throw new Error(`A should receive peer{join B} — got ${JSON.stringify(peerJoinB)}`)
  }
  a.close()
  b.close()
}

// C2 — seed race: two concurrent seeds, one stored, one SEED_REJECTED; late joiner reloads
async function caseSeedRace(org: string, orgKey: CryptoKey): Promise<void> {
  const shareId = `it-c2-${Date.now().toString(36)}`
  const a = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c2a") })
  const b = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c2b") })
  await a.connect()
  await b.connect()
  if ((await a.waitFor((f) => f.t === "welcome")) === undefined || (await b.waitFor((f) => f.t === "welcome")) === undefined) {
    throw new Error("one of A/B never got welcome")
  }

  // concurrent seeds — back-to-back, same tick
  const aScene = [{ id: "a1" }, { id: "a2" }]
  const bScene = [{ id: "b1" }, { id: "b2" }]
  a.sendEnvelope(seedFrame(aScene, 1))
  b.sendEnvelope(seedFrame(bScene, 1))

  const rejectedA = await a.waitFor((f) => f.t === "error" && f.p.code === "SEED_REJECTED")
  const rejectedB = await b.waitFor((f) => f.t === "error" && f.p.code === "SEED_REJECTED")
  if ((rejectedA === undefined) === (rejectedB === undefined)) {
    throw new Error(
      `exactly one seed must be rejected — A:${rejectedA === undefined ? "won" : "rejected"}, B:${rejectedB === undefined ? "won" : "rejected"}`,
    )
  }
  const loserRejected = rejectedA ?? rejectedB
  if (loserRejected.p.fatal !== false) {
    throw new Error(`SEED_REJECTED must be non-fatal — got ${JSON.stringify(loserRejected.p)}`)
  }
  // both sides see the winning scene broadcast (sender included — 049 §2)
  const sceneA = await a.waitFor((f) => f.t === "scene")
  const sceneB = await b.waitFor((f) => f.t === "scene")
  if (sceneA === undefined || sceneB === undefined) throw new Error("winning scene broadcast missing")
  const winner = (rejectedA === undefined ? aScene : bScene).map((e) => JSON.stringify(e))
  for (const [who, s] of [
    ["A", sceneA],
    ["B", sceneB],
  ] as const) {
    const got = (s.p.elements as unknown[]).map((e) => JSON.stringify(e))
    if (JSON.stringify(got) !== JSON.stringify(winner)) {
      throw new Error(`${who} should see the winning scene — got ${JSON.stringify(got)} vs winner ${JSON.stringify(winner)}`)
    }
  }

  // late joiner reloads the stored snapshot
  const c = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c2c") })
  await c.connect()
  const welcomeC = await c.waitFor((f) => f.t === "welcome")
  if (welcomeC === undefined || welcomeC.p.snapshotAvailable !== true) {
    throw new Error(`C's welcome should say snapshotAvailable:true — got ${JSON.stringify(welcomeC?.p)}`)
  }
  const snapshot = await c.waitFor((f) => f.t === "scene")
  if (snapshot === undefined) throw new Error("C never received the snapshot scene")
  const got = (snapshot.p.elements as unknown[]).map((e) => JSON.stringify(e))
  if (JSON.stringify(got) !== JSON.stringify(winner)) {
    throw new Error(`C's snapshot should be the winning scene — got ${JSON.stringify(got)}`)
  }
  a.close()
  b.close()
  c.close()
}

// C3 — reconnect: A drops, B broadcasts, A re-hellos and resyncs from the snapshot
async function caseReconnect(org: string, orgKey: CryptoKey): Promise<void> {
  const shareId = `it-c3-${Date.now().toString(36)}`
  const ident = identity(org, orgKey, "c3a")
  const a = new WireClient({ url: roomUrl(shareId), room: shareId, ...ident })
  const b = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c3b") })
  await a.connect()
  if ((await a.waitFor((f) => f.t === "welcome")) === undefined) throw new Error("A never welcomed")
  a.sendEnvelope(seedFrame([{ id: "a0" }], 1)) // A seeds the room

  await b.connect()
  const welcomeB = await b.waitFor((f) => f.t === "welcome")
  if (welcomeB === undefined || welcomeB.p.snapshotAvailable !== true) {
    throw new Error(`B should find A's snapshot — got ${JSON.stringify(welcomeB?.p)}`)
  }
  if ((await b.waitFor((f) => f.t === "scene")) === undefined) throw new Error("B never got the snapshot")

  // A drops; B broadcasts a newer scene
  a.close()
  await new Promise((r) => setTimeout(r, 300)) // let the leave settle
  b.sendEnvelope(sceneFrame([{ id: "a0" }, { id: "b1" }], 2))

  // A reconnects with the SAME profileId → fresh welcome + snapshot resync
  const a2 = new WireClient({ url: roomUrl(shareId), room: shareId, ...ident })
  await a2.connect()
  const welcomeA2 = await a2.waitFor((f) => f.t === "welcome")
  if (welcomeA2 === undefined || welcomeA2.p.snapshotAvailable !== true) {
    throw new Error(`A's reconnect welcome should carry the snapshot — got ${JSON.stringify(welcomeA2?.p)}`)
  }
  const resync = await a2.waitFor((f) => f.t === "scene")
  if (resync === undefined) throw new Error("A never received the resync snapshot")
  const elements = (resync.p.elements as unknown[]).map((e) => JSON.stringify(e))
  if (JSON.stringify(elements) !== JSON.stringify([JSON.stringify({ id: "a0" }), JSON.stringify({ id: "b1" })])) {
    throw new Error(`A's resync should recover B's scene — got ${JSON.stringify(elements)}`)
  }
  a2.close()
  b.close()
}

// C4 — key rotation: grace ([old,new]) then removal ([new] only)
async function caseKeyRotation(org: string, oldKey: CryptoKey, newKey: CryptoKey, newPk: string): Promise<void> {
  const shareId = `it-c4-${Date.now().toString(36)}`
  const graceEnv = JSON.stringify([{ org, pubkeys: [oldPk, newPk] }])
  const removedEnv = JSON.stringify([{ org, pubkeys: [newPk] }])

  // grace phase: old-signer AND new-signer both admitted
  console.log(`    [rotation] restarting dev with ORG_PUBKEYS=[old,new] (grace)`)
  const devGrace = await DevProcess.start(graceEnv, (l) => console.log(`      ${l}`))
  try {
    const oldSigner = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, oldKey, "c4old") })
    const newSigner = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, newKey, "c4new") })
    await oldSigner.connect()
    await newSigner.connect()
    if ((await oldSigner.waitFor((f) => f.t === "welcome")) === undefined) {
      throw new Error("old-signer should be admitted during the grace window (057 §4)")
    }
    if ((await newSigner.waitFor((f) => f.t === "welcome")) === undefined) {
      throw new Error("new-signer should be admitted during the grace window")
    }
    oldSigner.close()
    newSigner.close()
  } finally {
    devGrace.stop()
  }

  // removed phase: old-signer rejected with ADMISSION_INVALID + close 1008
  console.log(`    [rotation] restarting dev with ORG_PUBKEYS=[new] (old removed)`)
  const devRemoved = await DevProcess.start(removedEnv, (l) => console.log(`      ${l}`))
  try {
    const shareId2 = `it-c4b-${Date.now().toString(36)}`
    const oldSigner = new WireClient({ url: roomUrl(shareId2), room: shareId2, ...identity(org, oldKey, "c4old2") })
    const newSigner = new WireClient({ url: roomUrl(shareId2), room: shareId2, ...identity(org, newKey, "c4new2") })
    await oldSigner.connect()
    const err = await oldSigner.waitFor((f) => f.t === "error" && f.p.code === "ADMISSION_INVALID")
    if (err === undefined || err.p.fatal !== true) {
      throw new Error(`old-signer should get error{ADMISSION_INVALID, fatal:true} — got ${JSON.stringify(err)}`)
    }
    const close = await oldSigner.waitForClose()
    if (close === undefined || close.code !== 1008) {
      throw new Error(`old-signer should be closed with 1008 — got ${JSON.stringify(close)}`)
    }
    await newSigner.connect()
    if ((await newSigner.waitFor((f) => f.t === "welcome")) === undefined) {
      throw new Error("new-signer should still be admitted after the old key is dropped")
    }
    oldSigner.close()
    newSigner.close()
  } finally {
    devRemoved.stop()
  }
}

// C5 — guards: MESSAGE_TOO_LARGE fatal + close; CHUNK_INVALID non-fatal; rate flood; room survives
async function caseGuards(org: string, orgKey: CryptoKey): Promise<void> {
  const shareId = `it-c5-${Date.now().toString(36)}`

  // a) >256KB single frame → MESSAGE_TOO_LARGE fatal + close(1009)
  const a = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c5a") })
  await a.connect()
  if ((await a.waitFor((f) => f.t === "welcome")) === undefined) throw new Error("A never welcomed")
  const big = JSON.stringify(sceneFrame([{ blob: "x".repeat(300 * 1024) }], 1))
  a.rawSend(big)
  const err = await a.waitFor((f) => f.t === "error" && f.p.code === "MESSAGE_TOO_LARGE")
  if (err === undefined || err.p.fatal !== true) {
    throw new Error(`expected error{MESSAGE_TOO_LARGE, fatal:true} — got ${JSON.stringify(err)}`)
  }
  const close = await a.waitForClose()
  if (close === undefined || close.code !== 1009) {
    throw new Error(`expected close(1009) after MESSAGE_TOO_LARGE — got ${JSON.stringify(close)}`)
  }

  // b) room survives: a fresh client joins the same room fine
  const b = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c5b") })
  await b.connect()
  if ((await b.waitFor((f) => f.t === "welcome")) === undefined) throw new Error("room died after the fatal guard close")

  // c) 230KB non-chunk frame → CHUNK_INVALID non-fatal, conn survives
  const mid = JSON.stringify(sceneFrame([{ blob: "y".repeat(230 * 1024) }], 2))
  b.rawSend(mid)
  const chunkErr = await b.waitFor((f) => f.t === "error" && f.p.code === "CHUNK_INVALID")
  if (chunkErr === undefined || chunkErr.p.fatal === true) {
    throw new Error(`expected non-fatal CHUNK_INVALID — got ${JSON.stringify(chunkErr)}`)
  }
  b.sendEnvelope(sceneFrame([{ id: "small" }], 3)) // still alive?
  await new Promise((r) => setTimeout(r, 400))
  if (b.closes.length > 0) {
    throw new Error(`conn should survive a non-fatal CHUNK_INVALID — got ${JSON.stringify(b.closes[0])}`)
  }

  // d) rate flood: 250 frames in a burst → rate-guard CHUNK_INVALID errors, conn + room survive
  const c = new WireClient({ url: roomUrl(shareId), room: shareId, ...identity(org, orgKey, "c5c") })
  await c.connect()
  if ((await c.waitFor((f) => f.t === "welcome")) === undefined) throw new Error("C never welcomed")
  const t0 = Date.now()
  for (let i = 0; i < 250; i++) {
    c.rawSend(JSON.stringify(sceneFrame([{ seq: i }], 100 + i)))
  }
  const sentMs = Date.now() - t0
  const rateErr = await c.waitFor((f) => f.t === "error" && f.p.code === "CHUNK_INVALID", DEFAULT_WAIT_MS)
  if (rateErr === undefined) {
    throw new Error(`expected ≥1 rate-guard CHUNK_INVALID after a 250-frame burst (sent in ${sentMs}ms)`)
  }
  await new Promise((r) => setTimeout(r, 400))
  if (c.closes.length > 0) {
    throw new Error(`flooded conn should survive the rate guard — got ${JSON.stringify(c.closes[0])}`)
  }
  c.sendEnvelope(sceneFrame([{ id: "after-flood" }], 999))
  await new Promise((r) => setTimeout(r, 400))
  if (c.closes.length > 0) throw new Error("conn closed after a post-flood scene")
  a.close()
  b.close()
  c.close()
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const keys = loadDevKeys()
  const oldPk = await derivePk(keys.seed)
  const oldKey = await orgKeyFromSeed(keys.seed)
  const org = keys.org
  const newPair = await freshOrgKeypair()

  console.log(`relay-integration: org "${org}", relay ${RELAY}${ROOM_PATH_PREFIX}<shareId>`)
  console.log(`relay-integration: keys from ${KEYS_PATH} (${newPair.pk === oldPk ? "" : "old pk "}${oldPk.slice(0, 12)}…; rotation new pk ${newPair.pk.slice(0, 12)}…)`)

  const busy = await portBusy(DEV_PORT)
  let dev: DevProcess | null = null
  if (busy) {
    console.log(`relay-integration: port ${DEV_PORT} already serves a dev relay — two-terminal flow (060 §2).`)
    console.log(`relay-integration: the rotation case (C4) needs env control and will be SKIPPED (restart \`pnpm relay:dev\` with --var ORG_PUBKEYS to run it).`)
  } else {
    console.log(`relay-integration: spawning \`partykit dev\` (self-spawn flow — 060 §2)…`)
    const baseEnv = JSON.stringify([{ org, pubkeys: [oldPk] }])
    dev = await DevProcess.start(baseEnv, (l) => console.log(`  [dev] ${l}`))
  }

  try {
    // sanity: the loaded keys must admit against whatever relay we drive
    const probeShareId = `it-probe-${Date.now().toString(36)}`
    const probe = new WireClient({
      url: roomUrl(probeShareId),
      room: probeShareId,
      profileId: "it-probe",
      name: "probe",
      org,
      orgKey: oldKey,
      memberKey: "probe-member-key",
    })
    await probe.connect()
    const probeErr = await probe.waitFor((f) => f.t === "error" && f.p.code === "ADMISSION_INVALID", 5_000)
    if (probeErr !== undefined) {
      throw new Error(`admission probe failed: ${probeErr.p.reason} — run \`pnpm relay:dev\` to reseed .env with the current keys`)
    }
    probe.close()

    await runCase("C1 two-client join", () => caseTwoClientJoin(org, oldKey))
    await runCase("C2 seed race (first-seed-wins + snapshot reload)", () => caseSeedRace(org, oldKey))
    await runCase("C3 reconnect (drop → broadcast → resync)", () => caseReconnect(org, oldKey))
    if (!busy) {
      await runCase("C4 key rotation (grace then removal)", () => caseKeyRotation(org, oldKey, newPair.key, newPair.pk))
    } else {
      console.log(`  – C4 key rotation — SKIPPED (foreign dev server; needs --var env control)`)
      results.push({ name: "C4 key rotation", ok: true, detail: "SKIPPED (foreign dev server)" })
    }
    await runCase("C5 guards (MESSAGE_TOO_LARGE / CHUNK_INVALID / rate flood)", () => caseGuards(org, oldKey))
  } finally {
    dev?.stop()
    await new Promise((r) => setTimeout(r, 300))
  }

  console.log("")
  const failed = results.filter((r) => !r.ok)
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : ` — ${r.detail}`}`)
  }
  console.log(`relay-integration: ${results.length - failed.length}/${results.length} cases passed`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(`relay-integration: fatal: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
