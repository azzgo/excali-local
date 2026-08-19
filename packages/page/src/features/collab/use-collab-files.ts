/**
 * Collab file sync (goal 023 task 052) — the page half of the collab-core
 * file client (051): upload local inserts, hydrate peers' blobs on demand,
 * FILE_NOT_FOUND placeholder + ONE automatic retry, gallery keeps the blobs.
 *
 * The heavy lifting lives in collab-core's FileHydrator (files.ts). This
 * module only:
 * - builds the hydrator for the room tier — private rooms get the 050
 *   content key (deriveContentKey) + the member Ed25519 signer (058 §3.1);
 *   team rooms ride plaintext dataURLs (052: team vs private);
 * - decides which local blobs are NEW (no cached entry) and uploads them
 *   fire-and-forget (FileTooLargeError and friends never escape into React);
 * - filters scene elements to the visible viewport for the lazy on-demand
 *   fetch (051 §4: hydrate when an element enters the viewport).
 *
 * Content addressing (051 §3): fileId = base64url(sha256(content bytes)).
 * The page passes `generateIdForFile` to the Excalidraw mount so newly
 * inserted images get content-addressed ids (the patched tgz default is a
 * sha1-hex id); a files-map key that does NOT match its content hash
 * (legacy ids from pre-collab sessions) is skipped with a warn — uploading
 * under the wrong id would strand every peer at FILE_NOT_FOUND forever
 * (the relay is content-blind and keys by the claimed id, 051 §8).
 */
import { FileHydrator, FileTooLargeError, b64urlToBytes, dataURLToBytes, deriveContentKey, fileIdFor, seedToPkcs8 } from "collab-core";
import type { CollabClient, ContentSigner, FileReadyInfo } from "collab-core";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { CollabIdentity, CollabRoomMeta } from "./use-collab-session";

/* ------------------------------------------------------------------ */
/* hydrator construction (052 §API — key/signer rules)                 */
/* ------------------------------------------------------------------ */

/** Member Ed25519 signer from the identity (058 §3.1 — mirrors
 *  buildClient's org-key import; mintMemberKeypair mints seed + pub as a
 *  pair). The raw public key comes from the identity record — WebCrypto
 *  cannot derive an Ed25519 public key from a private key, and the raw
 *  export format is public-key-only. encryptContent self-verifies the sig
 *  against the attached public key (058 §3.1), so a drifted pair fails
 *  locally instead of poisoning the room. */
export async function buildMemberSigner(identity: CollabIdentity): Promise<ContentSigner> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    seedToPkcs8(b64urlToBytes(identity.seed)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return {
    profileId: identity.profileId,
    privateKey,
    publicKey: b64urlToBytes(identity.pub),
  };
}

export interface CreateRoomFileHydratorInput {
  client: CollabClient;
  room: CollabRoomMeta;
  /** asserted shareId — the canon room for encrypted frames (058 §2.1) */
  shareId: string;
  identity: CollabIdentity;
  /** fired whenever a blob arrives (first fetch or the 051 §4 retry) — the
   *  session feeds it to addFiles so the placeholder re-renders */
  onFileReady: (file: FileReadyInfo) => void;
  /** fetch-side failures (a GcmAuthError is the 054 stale-key signal) */
  onError: (error: Error) => void;
}

/** Create the room FileHydrator. PRIVATE rooms require the 050 content key
 *  (deriveContentKey({baseSecret: roomSecret, shareId})); EVERY tier builds the
 *  member Ed25519 signer, because every file-get carries a membership signature
 *  (the file-get authorization gate) — team AND private rooms sign (member sig
 *  proves room membership). Team rooms pass key=null (plaintext dataURLs ride
 *  the wire, 051 §8). */
export async function createRoomFileHydrator(input: CreateRoomFileHydratorInput): Promise<FileHydrator> {
  const { client, room, shareId, identity, onFileReady, onError } = input;
  const privacy = room.tier;
  let key: CryptoKey | null = null;
  // the member Ed25519 signer is built for EVERY tier (file-get gate): private
  // rooms use it for file-body signing too (058 §3.1), team rooms for file-gets.
  const signer = await buildMemberSigner(identity);
  if (privacy === "private") {
    // buildClient already rejected a private room without its roomSecret
    // (054 no-key → fatal E2E_AUTH_FAILED) — the secret is guaranteed here.
    key = await deriveContentKey({ baseSecret: room.roomSecret!, shareId });
  }
  return new FileHydrator({ client, privacy, roomId: shareId, key, signer, onFileReady, onError });
}

/* ------------------------------------------------------------------ */
/* local upload (052 §2)                                               */
/* ------------------------------------------------------------------ */

/**
 * Upload every blob in the onChange files map that is NEW — i.e. has no
 * cached entry in the hydrator (cached ⇒ already uploaded by us or
 * hydrated from the relay; putFile registers locally, so the dedup is
 * free, 051 §3). Fire-and-forget: awaited in a loop, every failure
 * (FileTooLargeError included, 051 §7) is console.warn'd — never thrown
 * into React. The element already carries the fileId ref; the scene
 * broadcast carries references only, so there is nothing else to send.
 */
export async function uploadNewLocalFiles(hydrator: FileHydrator, files: BinaryFiles): Promise<void> {
  for (const [fileId, data] of Object.entries(files)) {
    if (hydrator.cached(fileId) !== undefined) continue;
    try {
      // Honest content addressing: the wire id IS the content hash. A
      // files-map key that isn't (legacy sha1-hex ids from pre-collab
      // sessions) would strand peers at FILE_NOT_FOUND — skip with a warn.
      const derived = await fileIdFor(dataURLToBytes(data.dataURL));
      if (derived !== fileId) {
        console.warn(
          `[collab] skipping upload of ${fileId}: content hash is ${derived} — not content-addressed, peers cannot fetch it`,
        );
        continue;
      }
      await hydrator.putFile({ mimeType: data.mimeType, dataURL: data.dataURL });
    } catch (err) {
      console.warn(
        `[collab] file upload failed for ${fileId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* viewport filter (052 §3 — the lazy on-demand trigger)               */
/* ------------------------------------------------------------------ */

export interface SceneRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Visible scene rect for the current viewport (Excalidraw transform:
 *  screen = (scene + scroll) * zoom  →  scene = screen / zoom - scroll). */
export function visibleSceneRect(
  scrollX: number,
  scrollY: number,
  zoomValue: number,
  width: number,
  height: number,
): SceneRect {
  return {
    x1: -scrollX / zoomValue,
    y1: -scrollY / zoomValue,
    x2: width / zoomValue - scrollX,
    y2: height / zoomValue - scrollY,
  };
}

/** fileIds of image elements whose (axis-aligned) bounds intersect the
 *  rect. Rotated elements use their unrotated AABB — a prefetch hint only;
 *  the apply-time prefetch covers anything the viewport scan misses. */
export function fileIdsInRect(elements: readonly unknown[], rect: SceneRect): string[] {
  const out: string[] = [];
  for (const raw of elements) {
    const el = raw as {
      fileId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    } | null;
    if (el === null || typeof el !== "object") continue;
    if (typeof el.fileId !== "string" || el.fileId === "") continue;
    const { x, y, width, height } = el;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      continue;
    }
    if (x + width < rect.x1 || x > rect.x2 || y + height < rect.y1 || y > rect.y2) continue;
    out.push(el.fileId);
  }
  return out;
}
