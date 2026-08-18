/**
 * Shared IndexedDB helpers for the collab feature tests.
 *
 * fake-indexeddb persists across tests within one file, so each test starts by
 * clearing the stores it touches. The DB is opened with the owner's full v3
 * upgrade chain (packages/page/src/features/editor/utils/indexdb.ts /
 * collab-core cache.ts mirror the same chain) so the stores exist no matter
 * which module opened the database first — opening at v3 WITHOUT an upgrade
 * callback would create an empty database (fake-indexeddb quirk).
 */
import { openDB } from "idb";

async function openExcaliDB() {
  // v4 matches the owner chain (packages/page/src/features/editor/utils/
  // indexdb.ts / collab-core cache.ts) — opening at a lower version would
  // throw VersionError once the app has created the DB at v4.
  return openDB("excali", 4, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("drawings")) {
        const drawingsStore = db.createObjectStore("drawings", { keyPath: "id" });
        drawingsStore.createIndex("updatedAt", "updatedAt");
        drawingsStore.createIndex("collectionIds", "collectionIds", { multiEntry: true });
      }
      if (!db.objectStoreNames.contains("collections")) {
        const collectionsStore = db.createObjectStore("collections", { keyPath: "id" });
        collectionsStore.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("rooms")) {
        const roomsStore = db.createObjectStore("rooms", { keyPath: "id" });
        roomsStore.createIndex("lastJoined", "lastJoined");
      }
      if (!db.objectStoreNames.contains("collab-session")) {
        db.createObjectStore("collab-session", { keyPath: "roomId" });
      }
    },
  });
}

/** Clear the collab stores: `rooms` (048) + `collab-session` (053/061). */
export async function clearCollabStores(): Promise<void> {
  const db = await openExcaliDB();
  for (const room of await db.getAll("rooms")) await db.delete("rooms", room.id);
  for (const session of await db.getAll("collab-session")) {
    await db.delete("collab-session", session.roomId);
  }
  db.close();
}

/** Clear the gallery `drawings` store (seed-from-gallery picker tests). */
export async function clearDrawings(): Promise<void> {
  const db = await openExcaliDB();
  for (const drawing of await db.getAll("drawings")) await db.delete("drawings", drawing.id);
  db.close();
}
