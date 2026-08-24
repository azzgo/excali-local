/**
 * collab-relay partyserver entry (task 037/041) — room-DO composition.
 *
 * Runtime: partyserver 0.5.x on workerd (Cloudflare Workers Durable Objects).
 * The default export is a plain `{ fetch }` handler that hand-routes
 * `/party/<shareId>` → one DO per shareId (`idFromName`), preserving the
 * client's wire-contract path exactly (collab-core `buildRoomUrl` dials
 * `party/<shareId>` — a ONE-segment route; partyserver's own
 * `routePartykitRequest` expects a two-segment `/party/:server/:name`, so it
 * is NOT used). Non-`/party/` paths 404 at the fetch layer; plain HTTP that
 * reaches the DO 404s via the overridden `onRequest`.
 *
 * DO-instance model: each room DO is one `CollabRoomServer` instance, so the
 * composed state (conns, memberKeys, rate, files, state) is per-instance —
 * the legacy partykit module-level `WeakMap<Room, RoomHost>` registry is
 * gone. Hibernation (`static options = { hibernate: true }`) mirrors the
 * documented production semantics: in-memory fields are rebuilt on wake
 * (`ensureComposed`), storage and WebSockets survive; sockets whose roster
 * was lost hit the ghost-connection recovery (close → client redials →
 * re-hello → re-join).
 *
 * Wire/admission/room logic (server.ts / room.ts / files.ts / guards.ts /
 * verify.ts) is runtime-agnostic and unchanged.
 */
import { Server } from "partyserver"
import type { Connection, ConnectionContext, WSMessage } from "partyserver"
import type { HelloPayload } from "collab-core"
import { createFileStore } from "./files"
import type { FileStore } from "./files"
import { RateGuard, RATE_REJECT_REASON, assertFrameSize } from "./guards"
import { RoomState } from "./room"
import type { RoomHooks, RoomStorage } from "./room"
import { createRelayServer, deriveShareId } from "./server"
import type { RelayEnv, ServerHandlers } from "./server"
import { createRelayLog } from "./relay-log"
import type { MemberKey } from "./verify"

const hostLog = createRelayLog("host")

/**
 * Workers runtime globals the router uses (tsconfig types keep node-only;
 * @cloudflare/workers-types is not pulled in). WebSocketPair: {0: client, 1: server}.
 */
declare const WebSocketPair: new () => {
  0: WebSocket & { accept(): void }
  1: WebSocket & { accept(): void }
}
declare global {
  interface ResponseInit {
    webSocket?: WebSocket | null
  }
}
export {}

/** Relay env + the DO binding the router needs (structural type — no workers-types dependency). */
export interface RelayEnvExt extends RelayEnv {
  RelayRoom: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Promise<Response> }
  }
}

/** Composed per-room state + the admission handlers, built lazily per DO instance. */
interface Composed {
  handlers: ServerHandlers
  state: RoomState
  files: FileStore
}

/**
 * One room DO: admission (server.ts) composed with the room state machine
 * (room.ts) + file store (files.ts) + guards. Instance fields are per-room —
 * no module-scoped registry needed.
 */
export class CollabRoomServer extends Server<RelayEnvExt> {
  // Hibernation mirrors the documented production semantics: in-memory fields
  // are discarded on ~10s idle, storage + WebSockets survive (new_sqlite_classes
  // DOs); on wake the fresh instance rebuilds state via ensureComposed and any
  // socket whose roster was lost hits the ghost-connection recovery.
  static options = { hibernate: true }


  private composed: Composed | undefined

  /** Live connection targets (connId → partyserver Connection) — the send/broadcast hooks. */
  private conns = new Map<string, Connection>()

  /** connId → admitted member key (058 §3.2 store-verify identity, from hello.key). */
  private memberKeys = new Map<string, MemberKey>()

  /** Flood guard — one per room, buckets per conn. */
  private rate = new RateGuard()

  /** The RoomLike surface the handlers bind (id from the DO name, env + storage from the DO).
   * partyserver exposes `.env` / `.ctx` at runtime; the typed surface is opaque here,
   * so access them through a structural cast. */
  private doCtx(): { storage: unknown } {
    return (this as unknown as { ctx: { storage: unknown } }).ctx
  }

  private roomLike() {
    const self = this as unknown as { env: RelayEnvExt }
    return {
      id: this.name,
      env: self.env,
      storage: this.doCtx().storage as unknown as RoomStorage,
    }
  }

  /** Build the composed state exactly once per DO instance (idempotent across hibernation wakes). */
  private ensureComposed(): Composed {
    if (this.composed !== undefined) return this.composed
    const shareId = this.name
    const hooks: RoomHooks = {
      send: (connId, frame) => this.conns.get(connId)?.send(frame),
      broadcast: (frame, exceptConnId) => {
        for (const [connId, conn] of this.conns) {
          if (connId !== exceptConnId) conn.send(frame)
        }
      },
    }
    const storage = this.doCtx().storage as unknown as RoomStorage
    const files = createFileStore({ roomId: shareId, storage, hooks })
    const state = new RoomState({
      roomId: shareId,
      hooks,
      storage,
      fileStore: files,
      memberKeys: this.memberKeys,
    })
    const composed: Composed = {
      handlers: createRelayServer({
        /** Guards: size gate on every frame; rate flood guard post-admission. */
        frameGuard: (conn, frame) => {
          const size = assertFrameSize(frame)
          if (!size.ok) return size
          if (!this.rate.allow(conn.id)) {
            return { ok: false, code: "CHUNK_INVALID", reason: RATE_REJECT_REASON, fatal: false }
          }
          return { ok: true }
        },
        /** Admission success → room DO join (welcome + snapshot + peer{join}). */
        onAdmitted: async (conn, room, hello) => {
          this.conns.set(conn.id, conn)
          hostLog.debug("admitted conn", { connId: conn.id, roomId: room.id })
          await state.join(conn.id, hello)
        },
        /** Post-welcome frames → room DO routing (scene/seed/pointer/chunk/files). */
        onMessage: async (frame, conn) => {
          // GHOST-CONNECTION RECOVERY: a post-welcome frame from a conn with no
          // membership means the WS survived a DO restart/hibernation but this
          // instance's conns/roster were rebuilt empty — the transport
          // (ping/pong) is alive while the data plane is silently dropped.
          // Close the ghost so the client redials and re-hellos, re-establishing
          // roster membership. Non-fatal close ⇒ the client schedules a reconnect.
          if (this.conns.has(conn.id)) {
            hostLog.debug("routing frame to room", { connId: conn.id, roomId: this.name })
            await state.message(conn.id, frame)
            return
          }
          hostLog.warn("closing ghost connection (no membership after DO restart)", { connId: conn.id })
          try {
            conn.close(1000, "session lost — resync please")
          } catch {
            /* already closed — nothing to do */
          }
        },
        /** Room probe (ADR 0004): answer from the room's own state — no admission, no roster entry. */
        onProbe: async (conn, room) => {
          const facts = await state.probe()
          conn.send(JSON.stringify({ v: 1, t: "room-probe", p: facts }))
        },
        /** Teardown → room DO leave (peer{leave} broadcast) + flood-guard cleanup. */
        onClose: (conn) => {
          this.conns.delete(conn.id)
          this.rate.reset(conn.id)
          state.leave(conn.id)
          files.leave(conn.id)
        },
      }),
      state,
      files,
    }
    this.composed = composed
    return composed
  }

  onConnect(conn: Connection, ctx: ConnectionContext): void {
    this.ensureComposed().handlers.onConnect(conn, this.roomLike(), ctx)
  }

  async onMessage(conn: Connection, message: WSMessage): Promise<void> {
    await this.ensureComposed().handlers.onMessage(message, conn, this.roomLike())
  }

  onClose(conn: Connection): void {
    const composed = this.composed
    if (composed === undefined) return // never reached the handlers layer (e.g. hibernation-surviving socket)
    this.conns.delete(conn.id)
    this.rate.reset(conn.id)
    composed.state.leave(conn.id)
    composed.files.leave(conn.id)
  }

  onRequest(): Response {
    // The room endpoint is WS-only: any plain HTTP request reaching the DO is a 404.
    return new Response("not found", { status: 404 })
  }
}

const RELAY_ROOT_REASON = "excali-collab relay alive — dial a /party/<shareId> room";

/** The relay entry — wrangler.jsonc `main` default-export. */
export default {
  async fetch(request: Request, env: RelayEnvExt): Promise<Response> {
    // Bare-root WS (reachability dial — incl. stale clients that probe the root
    // instead of /party/<shareId>): answer the handshake so the server reads as
    // reachable, then close immediately (no room → nothing else happens).
    const pathname = new URL(request.url).pathname.replace(/\/+$/, "")
    if (pathname === "" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair()
      pair[0].accept()
      pair[0].close(1000, RELAY_ROOT_REASON)
      return new Response(null, { status: 101, webSocket: pair[1] })
    }
    const shareId = deriveShareId(request.url)
    if (shareId === null) return new Response("not found", { status: 404 })
    // The wire contract is WS-only: refuse plain HTTP at the router.
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("not an upgrade", { status: 404 })
    }
    const id = env.RelayRoom.idFromName(shareId)
    // CLONE the request before the DO RPC, exactly like partyserver's own
    // routePartykitRequest does (`req = new Request(req)`). Handing the entry
    // upgrade Request object straight to stub.fetch loses its `Upgrade` header
    // on production (observed: the DO falls into onRequest → 404); a fresh
    // Request copies the headers verbatim and re-arms the upgrade at the DO.
    return env.RelayRoom.get(id).fetch(new Request(request.url, request))
  },
} satisfies { fetch(request: Request, env: RelayEnvExt): Promise<Response> }


export type { HelloPayload }