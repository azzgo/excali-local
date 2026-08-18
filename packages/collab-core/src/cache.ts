/**
 * collab-core session/room cache — thin IndexedDB wrapper.
 *
 * The stores live in the shared `excali` DB (v3) so the page gallery and the
 * collab editor see the same data. The page module
 * `packages/page/src/features/editor/utils/indexdb.ts` is the OWNER of this DB
 * layout (DB_NAME, DB_VERSION, store names, keyPaths); the constants below are
 * duplicated here because collab-core must stay package-independent (it cannot
 * import the page package). Keep them in sync with the owner.
 *
 * Why persistent IndexedDB (Wayfinder):
 * - 048 — the room list lives in the `excali` DB v3 `rooms` store (keyPath id,
 *   lastJoined index).
 * - 053 — the session cache must be PERSISTENT (IndexedDB) for bookmark /
 *   refresh re-activation of `#room/<shareId>`.
 * - 061 — the cache retains the BASE scene (last synced) alongside the edited
 *   scene for the client-side three-way merge on re-entry / recovery.
 */

import { openDB } from "idb"

/** Mirrors packages/page/src/features/editor/utils/indexdb.ts (owner). */
const DB_NAME = "excali"
const DB_VERSION = 4
const ROOMS_STORE = "rooms"
const COLLAB_SESSION_STORE = "collab-session"
/**
 * Open the `excali` DB at v4. The upgrade mirrors the owner's full additive
 * chain (v1 files / v2 drawings+collections / v3 rooms+collab-session / v4
 * rooms labelKind backfill) so a fresh database is complete no matter which
 * module opens it first. All creation is `contains()`-guarded and additive —
 * existing data is untouched. The v4 data migration (ADR 0004) is async but
 * keeps the versionchange transaction alive via its cursor request chain.
 */
async function openCacheDB() {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" })
      }

      if (!db.objectStoreNames.contains("drawings")) {
        const drawingsStore = db.createObjectStore("drawings", { keyPath: "id" })
        drawingsStore.createIndex("updatedAt", "updatedAt")
        drawingsStore.createIndex("collectionIds", "collectionIds", { multiEntry: true })
      }

      if (!db.objectStoreNames.contains("collections")) {
        const collectionsStore = db.createObjectStore("collections", { keyPath: "id" })
        collectionsStore.createIndex("createdAt", "createdAt")
      }

      if (!db.objectStoreNames.contains(ROOMS_STORE)) {
        const roomsStore = db.createObjectStore(ROOMS_STORE, { keyPath: "id" })
        roomsStore.createIndex("lastJoined", "lastJoined")
      }

      if (!db.objectStoreNames.contains(COLLAB_SESSION_STORE)) {
        db.createObjectStore(COLLAB_SESSION_STORE, { keyPath: "roomId" })
      }

      // v4 (ADR 0004): rooms gain `labelKind: "named" | "auto"` provenance.
      // Pre-existing entries (created before shared names existed) are marked
      // "auto" — conservative: no shared name may be pushed from them; one
      // manual rename (or a mirrored broadcast) re-arms an entry.
      if (oldVersion < 4 && db.objectStoreNames.contains(ROOMS_STORE)) {
        const store = tx.objectStore(ROOMS_STORE)
        let cursor = await store.openCursor()
        while (cursor !== null) {
          const value = cursor.value as { labelKind?: unknown }
          if (value.labelKind === undefined) {
            await cursor.update({ ...value, labelKind: "auto" })
          }
          cursor = await cursor.continue()
        }
      }
    },
  })
}

/** A collab scene snapshot: elements + appState (+ optional embedded files). */
export interface CollabScene {
  elements: unknown[]
  appState: unknown
  files?: Record<string, unknown>
}

/**
 * Per-room collab session cache (061): `edited` is the working scene, `base`
 * is the last synced scene retained for the three-way merge — null when
 * nothing has been synced yet.
 */
export interface CollabSession {
  roomId: string
  edited: CollabScene
  base: CollabScene | null
  updatedAt: number
}

/** Room list entry (048): one per room created/joined on this install. */
export interface RoomEntry {
  /** shareId — the room's public id (also the invite's room claim). */
  id: string
  label: string
  /** privacy tier: team = org-visible, private = room key. */
  tier: "team" | "private"
  /** server fingerprint (048): staleness signal only, warn-only, never routing. */
  fp?: string
  pinned: boolean
  lastJoined: number
  /** the full invite payload string — the invite IS the room (053). */
  invite: string
  /**
   * label provenance (ADR 0004): "named" = a real shared name (create-time or
   * mirrored from the relay) — pushable when a dead room is re-seeded; "auto" =
   * a generated fallback (short shareId) — never pushed. Pre-migration entries
   * read as absent → treated as "auto" at the call sites.
   */
  labelKind: "named" | "auto"
  /**
   * per-room display name (060): a one-time COPY of the profile default at
   * room entry. Absent = not yet copied (the session falls back to the
   * profile default). No index, no schema bump — purely advisory.
   */
  myName?: string
}

/** Persist (or overwrite) a room's session cache, stamping updatedAt. */
export async function saveSession(
  roomId: string,
  scene: { edited: CollabScene; base: CollabScene | null },
): Promise<void> {
  const db = await openCacheDB()
  const tx = db.transaction(COLLAB_SESSION_STORE, "readwrite")
  await tx.store.put({ roomId, ...scene, updatedAt: Date.now() })
  await tx.done
}

/** Load a room's session cache, or undefined when nothing is cached. */
export async function loadSession(roomId: string): Promise<CollabSession | undefined> {
  const db = await openCacheDB()
  const tx = db.transaction(COLLAB_SESSION_STORE, "readonly")
  const session = await tx.store.get(roomId)
  await tx.done
  return session
}

/** Drop a room's session cache (e.g. after a clean leave / gallery save). */
export async function clearSession(roomId: string): Promise<void> {
  const db = await openCacheDB()
  const tx = db.transaction(COLLAB_SESSION_STORE, "readwrite")
  await tx.store.delete(roomId)
  await tx.done
}

/** Create or update a room list entry. */
export async function saveRoomMeta(entry: RoomEntry): Promise<void> {
  const db = await openCacheDB()
  const tx = db.transaction(ROOMS_STORE, "readwrite")
  await tx.store.put(entry)
  await tx.done
}

/** All room entries, most recently joined first. */
export async function listRooms(): Promise<RoomEntry[]> {
  const db = await openCacheDB()
  const tx = db.transaction(ROOMS_STORE, "readonly")
  const rooms = await tx.store.getAll()
  await tx.done
  return rooms.sort((a, b) => b.lastJoined - a.lastJoined)
}

/** Delete a room list entry. The session cache is left untouched. */
export async function deleteRoom(roomId: string): Promise<void> {
  const db = await openCacheDB()
  const tx = db.transaction(ROOMS_STORE, "readwrite")
  await tx.store.delete(roomId)
  await tx.done
}
