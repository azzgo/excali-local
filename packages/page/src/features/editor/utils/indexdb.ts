// get/save filed to indexdb
import { BinaryFileData } from "@excalidraw/excalidraw/types";
import { openDB } from "idb";

const DB_NAME = "excali";
const DB_VERSION = 4;
const STORE_NAME = "files";
const DRAWINGS_STORE = "drawings";
const COLLECTIONS_STORE = "collections";
const ROOMS_STORE = "rooms";
const COLLAB_SESSION_STORE = "collab-session";

async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      // v1: files store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      
      // v2: drawings and collections stores
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(DRAWINGS_STORE)) {
          const drawingsStore = db.createObjectStore(DRAWINGS_STORE, { keyPath: "id" });
          drawingsStore.createIndex("updatedAt", "updatedAt");
          drawingsStore.createIndex("collectionIds", "collectionIds", { multiEntry: true });
        }
        
        if (!db.objectStoreNames.contains(COLLECTIONS_STORE)) {
          const collectionsStore = db.createObjectStore(COLLECTIONS_STORE, { keyPath: "id" });
          collectionsStore.createIndex("createdAt", "createdAt");
        }
      }

      // v3: rooms + collab-session stores (Wayfinder 048 room list; 053/061
      // persistent per-room session cache with base scene for the three-way merge)
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(ROOMS_STORE)) {
          const roomsStore = db.createObjectStore(ROOMS_STORE, { keyPath: "id" });
          roomsStore.createIndex("lastJoined", "lastJoined");
        }

        if (!db.objectStoreNames.contains(COLLAB_SESSION_STORE)) {
          db.createObjectStore(COLLAB_SESSION_STORE, { keyPath: "roomId" });
        }
      }

      // v4 (ADR 0004): `rooms` entries gain `labelKind: "named" | "auto"`
      // provenance. Pre-existing entries (created before shared names existed)
      // are marked "auto" — conservative: no shared name may be pushed from
      // them; one manual rename (or a mirrored broadcast) re-arms an entry.
      // The async cursor loop keeps the versionchange transaction alive.
      if (oldVersion < 4 && db.objectStoreNames.contains(ROOMS_STORE)) {
        const roomsStore = tx.objectStore(ROOMS_STORE);
        let cursor = await roomsStore.openCursor();
        while (cursor !== null) {
          const value = cursor.value as { labelKind?: unknown };
          if (value.labelKind === undefined) {
            await cursor.update({ ...value, labelKind: "auto" });
          }
          cursor = await cursor.continue();
        }
      }
    },
  });
}

type FileItem = {
  id: string;
  content: BinaryFileData;
};

export async function batchSaveFile(files: Array<FileItem>) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  for (const file of files) {
    await tx.store.put(file);
  }
  await tx.done;
}

export async function getFiles(): Promise<FileItem[]> {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const files = await tx.store.getAll();
  await tx.done;
  return files;
}

export interface Drawing {
  id: string;
  name: string;
  elements: string;
  appState: string;
  files: string;
  thumbnail: string;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DrawingMetadata {
  id: string;
  name: string;
  thumbnail: string;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

export async function saveDrawing(drawing: Drawing): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readwrite");
  await tx.store.put(drawing);
  await tx.done;
}

export async function getDrawings(collectionId?: string): Promise<DrawingMetadata[]> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readonly");
  
  const metadata: DrawingMetadata[] = [];
  
  let cursor;
  if (collectionId) {
    const index = tx.store.index("collectionIds");
    cursor = await index.openCursor(collectionId);
  } else {
    cursor = await tx.store.openCursor();
  }
  
  while (cursor) {
    const drawing = cursor.value as Drawing;
    metadata.push({
      id: drawing.id,
      name: drawing.name,
      thumbnail: drawing.thumbnail,
      collectionIds: drawing.collectionIds,
      createdAt: drawing.createdAt,
      updatedAt: drawing.updatedAt,
    });
    cursor = await cursor.continue();
  }
  
  await tx.done;
  
  return metadata.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateDrawing(id: string, updates: Partial<Drawing>): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readwrite");
  const existing = await tx.store.get(id);
  
  if (existing) {
    await tx.store.put({ ...existing, ...updates, updatedAt: Date.now() });
  }
  
  await tx.done;
}

export async function deleteDrawing(id: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readwrite");
  await tx.store.delete(id);
  await tx.done;
}

export async function createCollection(collection: Collection): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readwrite");
  await tx.store.put(collection);
  await tx.done;
}

export async function updateCollection(id: string, updates: Partial<Collection>): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readwrite");
  const existing = await tx.store.get(id);
  
  if (existing) {
    await tx.store.put({ ...existing, ...updates });
  }
  
  await tx.done;
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readwrite");
  await tx.store.delete(id);
  await tx.done;
}

export async function getCollections(): Promise<Collection[]> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readonly");
  const collections = await tx.store.getAll();
  await tx.done;
  return collections.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getDrawingFullData(drawingId: string): Promise<Pick<Drawing, 'id' | 'elements' | 'appState' | 'files'>> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readonly");
  const drawing = await tx.store.get(drawingId);
  await tx.done;
  
  if (!drawing) {
    throw new Error("Drawing not found");
  }
  
  return {
    id: drawing.id,
    elements: drawing.elements,
    appState: drawing.appState,
    files: drawing.files,
  };
}

export async function getDrawingsFilesOnly(): Promise<Array<{ id: string; files: string }>> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readonly");
  
  const filesData: Array<{ id: string; files: string }> = [];
  let cursor = await tx.store.openCursor();
  
  while (cursor) {
    const drawing = cursor.value as Drawing;
    filesData.push({
      id: drawing.id,
      files: drawing.files,
    });
    cursor = await cursor.continue();
  }
  
  await tx.done;
  
  return filesData;
}

export async function clearGalleryData(): Promise<void> {
  const db = await initDB();
  const tx = db.transaction([STORE_NAME, DRAWINGS_STORE, COLLECTIONS_STORE], "readwrite");
  await tx.objectStore(STORE_NAME).clear();
  await tx.objectStore(DRAWINGS_STORE).clear();
  await tx.objectStore(COLLECTIONS_STORE).clear();
  await tx.done;
}

// ---------------------------------------------------------------------------
// v3: collab room list + per-room session cache (Wayfinder 048 / 053 / 061)
//
// These stores are the storage owner for the collab feature. collab-core
// mirrors this DB layout (packages/collab-core/src/cache.ts) and must stay in
// sync — the page module here is the source of truth.
// ---------------------------------------------------------------------------

/**
 * Collab room list entry (Wayfinder 048: `excali` DB v3 `rooms` store).
 * One entry per room the user has created or joined on this install.
 */
export interface RoomEntry {
  /** shareId — the room's public id (also the invite's room claim). */
  id: string;
  /** human label for the My Rooms list. */
  label: string;
  /** privacy tier: team = org-visible, private = room key. */
  tier: "team" | "private";
  /** server fingerprint (048): staleness signal only, warn-only, never routing. */
  fp?: string;
  pinned: boolean;
  lastJoined: number;
  /** the full invite payload string — the invite IS the room (053). */
  invite: string;
  /**
   * label provenance (ADR 0004): "named" = a real shared name (create-time or
   * mirrored from the relay) — pushable when a dead room is re-seeded; "auto" =
   * a generated fallback (short shareId) — never pushed. Pre-migration entries
   * read as absent → treated as "auto" at the call sites.
   */
  labelKind: "named" | "auto";
  /**
   * per-room display name (060/070): a one-time COPY of the profile default
   * at room entry, later replaced by an in-room rename (ADR 0006). Absent =
   * not yet copied (the session falls back to the profile default).
   */
  myName?: string;
}

/** A collab scene snapshot: elements + appState (+ optional embedded files). */
export interface CollabScene {
  elements: unknown[];
  appState: unknown;
  files?: Record<string, unknown>;
}

/**
 * Per-room collab session cache (Wayfinder 053/061: `excali` DB v3
 * `collab-session` store). `edited` is the working scene; `base` is the last
 * synced scene retained for the client-side three-way merge (061 Q4b) — null
 * when nothing has been synced yet.
 */
export interface CollabSession {
  roomId: string;
  edited: CollabScene;
  base: CollabScene | null;
  updatedAt: number;
}

export async function getRoom(shareId: string): Promise<RoomEntry | undefined> {
  const db = await initDB();
  const tx = db.transaction(ROOMS_STORE, "readonly");
  const room = await tx.store.get(shareId);
  await tx.done;
  return room;
}

export async function putRoom(room: RoomEntry): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(ROOMS_STORE, "readwrite");
  await tx.store.put(room);
  await tx.done;
}

/** ADR 0004 mirror write: update ONLY the label + labelKind fields of a room
 * entry, preserving every other field verbatim (pinned, lastJoined, invite,
 * tier, fp). The read+write happens in ONE transaction, so a concurrent
 * saveRoomMeta (e.g. the join screen) can never be clobbered by a stale
 * get-room → put-whole-entry read-modify-write that resurrects old values.
 * No-op (no write) when the shareId has no entry yet. */
export async function patchRoomName(shareId: string, label: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(ROOMS_STORE, "readwrite");
  const entry = await tx.store.get(shareId);
  if (entry !== undefined) {
    await tx.store.put({ ...entry, label, labelKind: "named" });
  }
  await tx.done;
}

/** ADR 0006 mirror write (task 070): update ONLY the myName field of a room
 * entry, preserving every other field verbatim (label, labelKind, pinned,
 * lastJoined, invite, tier, fp). The read+write happens in ONE transaction,
 * so a concurrent saveRoomMeta can never be clobbered by a stale
 * get-room → put-whole-entry read-modify-write that resurrects old values.
 * No-op (no write) when the shareId has no entry yet.
 */
export async function patchRoomMyName(shareId: string, myName: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(ROOMS_STORE, "readwrite");
  const entry = await tx.store.get(shareId);
  if (entry !== undefined) {
    await tx.store.put({ ...entry, myName });
  }
  await tx.done;
}

export async function deleteRoom(shareId: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(ROOMS_STORE, "readwrite");
  await tx.store.delete(shareId);
  await tx.done;
}

/** All room entries, most recently joined first. */
export async function listRooms(): Promise<RoomEntry[]> {
  const db = await initDB();
  const tx = db.transaction(ROOMS_STORE, "readonly");
  const rooms = await tx.store.getAll();
  await tx.done;
  return rooms.sort((a, b) => b.lastJoined - a.lastJoined);
}

export async function getSession(roomId: string): Promise<CollabSession | undefined> {
  const db = await initDB();
  const tx = db.transaction(COLLAB_SESSION_STORE, "readonly");
  const session = await tx.store.get(roomId);
  await tx.done;
  return session;
}

export async function putSession(session: CollabSession): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLAB_SESSION_STORE, "readwrite");
  await tx.store.put(session);
  await tx.done;
}

export async function deleteSession(roomId: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLAB_SESSION_STORE, "readwrite");
  await tx.store.delete(roomId);
  await tx.done;
}
