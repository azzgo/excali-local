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
import { bytesToB64url } from "collab-core";
import type { CollabIdentity } from "@/features/collab/use-collab-session";

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

/**
 * Mint a REAL Ed25519 member keypair so identity.pub matches identity.seed
 * (buildMemberSigner imports the pkcs8-wrapped seed and rides `pub` on the
 * wire; encryptContent self-verifies the pair, 058 §3.1).
 *
 * Any test that mounts the REAL useCollabSession MUST use this (or an
 * equivalent real keypair): a fake pub like "pub-1" makes buildMemberSigner
 * throw inside createRoomFileHydrator, and every dialing session spams
 * `[collab] file sync unavailable: invalid base64url length 5` (hidden by
 * vitest until a failure/verbose run).
 */
export async function mintTestIdentity(): Promise<CollabIdentity> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  return {
    profileId: "profile-1",
    name: "Ada",
    seed: bytesToB64url(new Uint8Array(pkcs8).slice(16)),
    pub: bytesToB64url(new Uint8Array(raw)),
  };
}
