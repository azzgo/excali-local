/**
 * collab-relay PartyKit entry (task 037) + room-DO composition (task 041).
 *
 * The default export is the PartyKit `Server`-shaped object (module /
 * object-literal form — `PartyKitServer`): task 041 wires it into
 * partykit.json with the `/party/<shareId>` route (see deriveShareId in
 * server.ts for the path finding — partykit 0.0.115 only maps `/party/`
 * and `/parties/` paths to a room DO). PartyKit's HTTP entry point for
 * this shape is `onRequest` (there is no `fetch` method on the
 * object-literal server; the WS upgrade itself is handled by the platform
 * and surfaces as `onConnect`).
 *
 * Task 041 composition: createCollabServer() composes
 *   - server.ts admission (signed-hello gate, grace timer, fatal closes),
 *   - room.ts RoomState (roster, welcome/peer deltas, first-seed-wins
 *     snapshot in room.storage, scene relay, chunk reassembly),
 *   - files.ts FileStore (content-addressed put/get, 20MB cap),
 *   - guards.ts (per-message size gate + per-conn rate flood guard).
 * The composition lives in the server hooks (RelayServerHooks); every
 * helper stays re-exported for tests.
 *
 * Room DO model: each `/party/<shareId>` room is one Durable Object.
 * RoomState rehydrates the snapshot from room.storage on join, so DO
 * hibernation wakes (052 §4) rebuild state from storage.
 *
 * DO-isolation note (verified live on partykit 0.0.115): workerd packs
 * every room DO of a project into the SAME isolate, with ONE module
 * instance — so a module-scoped `Map<shareId, RoomHost>` is SHARED across
 * DO instances. A recreated/restarted DO delivers a NEW `Room` object, and
 * continuing to use a cached host (holding the OLD room's `storage` and
 * `Connection` objects) from the new DO throws workerd's "Cannot perform
 * I/O on behalf of a different Durable Object" and silently fails storage
 * reads. The host registry is therefore keyed by the `Room` OBJECT
 * (WeakMap) — one host per DO instance — and connections are mapped to
 * their host the same way. `room`/`conn` objects are stable within their
 * DO instance, so each room gets exactly one host and every I/O (storage,
 * send, broadcast) stays on the DO that owns it.
 */
import type { Connection, PartyKitServer, Room } from "partykit/server"
import type { HelloPayload } from "collab-core"
import { createFileStore } from "./files"
import type { FileStore } from "./files"
import { RateGuard, RATE_REJECT_REASON, assertFrameSize } from "./guards"
import { RoomState } from "./room"
import type { RoomHooks, RoomStorage } from "./room"
import { createRelayServer } from "./server"
import type { MemberKey } from "./verify"

/** One room DO's composed state — built lazily on the first admitted connection. */
interface RoomHost {
  roomId: string
  state: RoomState
  files: FileStore
  /** live connections (connId → PartyKit Connection) — the send/broadcast targets */
  conns: Map<string, Connection>
  /** connId → admitted member key (058 §3.2 store-verify identity, from hello.key) */
  memberKeys: Map<string, MemberKey>
  /** task 041 flood guard — one per room, buckets per conn */
  rate: RateGuard
}

/**
 * Build the composed relay server. A fresh instance per call keeps the
 * host registry isolated (tests create their own).
 *
 * See the header note on DO isolation: hosts are keyed by the `Room`
 * OBJECT (WeakMap), so a recreated DO gets a fresh host backed by its own
 * storage/connections and never performs I/O on another DO's objects.
 */
export function createCollabServer(): PartyKitServer {
  const hosts = new WeakMap<Room, RoomHost>()
  /** Connection → its room host — close-time leave + guard routing. */
  const connHost = new WeakMap<Connection, RoomHost>()

  const getHost = (room: Room): RoomHost => {
    let host = hosts.get(room)
    if (host === undefined) {
      const shareId = room.id
      host = {} as RoomHost
      const hooks: RoomHooks = {
        send: (connId, frame) => host!.conns.get(connId)?.send(frame),
        broadcast: (frame, exceptConnId) => {
          for (const [connId, conn] of host!.conns) {
            if (connId !== exceptConnId) conn.send(frame)
          }
        },
      }
      const storage = room.storage as unknown as RoomStorage
      host.roomId = shareId
      host.conns = new Map()
      host.memberKeys = new Map()
      host.rate = new RateGuard()
      host.files = createFileStore({ roomId: shareId, storage, hooks })
      host.state = new RoomState({ roomId: shareId, hooks, storage, fileStore: host.files, memberKeys: host.memberKeys })
      hosts.set(room, host)
    }
    return host
  }

  return createRelayServer({
    /** 041 guards: size gate on every frame; rate flood guard post-admission. */
    frameGuard(conn, frame) {
      const size = assertFrameSize(frame)
      if (!size.ok) return size
      const host = connHost.get(conn)
      if (host !== undefined && !host.rate.allow(conn.id)) {
        return { ok: false, code: "CHUNK_INVALID", reason: RATE_REJECT_REASON, fatal: false }
      }
      return { ok: true }
    },

    /** Admission success → room DO join (welcome + snapshot + peer{join}). */
    async onAdmitted(conn, room, hello) {
      const host = getHost(room)
      host.conns.set(conn.id, conn)
      connHost.set(conn, host)
      await host.state.join(conn.id, hello)
    },

    /** Post-welcome frames → room DO routing (scene/seed/pointer/chunk/files). */
    async onMessage(frame, conn) {
      const host = connHost.get(conn)
      if (host === undefined) return // unknown / pre-admission connection
      await host.state.message(conn.id, frame)
    },

    /**
     * ADR 0004 room probe: answer from the room DO's own state and close — no
     * admission, no roster entry, no member-visible side effect. `getHost` is
     * deliberately used WITHOUT connHost/conns registration, so the probe
     * connection never appears in the room (and its close is a no-op).
     */
    async onProbe(conn, room) {
      const host = getHost(room)
      const facts = await host.state.probe()
      conn.send(JSON.stringify({ v: 1, t: "room-probe", p: facts }))
    },

    /** Teardown → room DO leave (peer{leave} broadcast) + flood-guard cleanup. */
    onClose(conn) {
      const host = connHost.get(conn)
      connHost.delete(conn)
      if (host === undefined) return
      host.conns.delete(conn.id)
      host.rate.reset(conn.id)
      host.state.leave(conn.id)
      host.files.leave(conn.id)
    },
  })
}

/** The relay server singleton — partykit.json `main` default-export. */
export const relayServer: PartyKitServer = createCollabServer()

export default relayServer

export * from "./server"
export type { HelloPayload }
export type { Connection, PartyKitServer, Room }
