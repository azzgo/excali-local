/**
 * normalizeSceneImageRefs — gallery utility
 *
 * Rewrites every image element's `fileId` from legacy/arbitrary identifiers to
 * content-addressed hashes (SHA-256 base64url of the decoded dataURL bytes).
 * The files map is rekeyed to match. Non-image elements are left untouched.
 *
 * When a file entry is missing or its dataURL cannot be parsed, the element is
 * left AS-IS and a human-readable warning is pushed to `warns` — the function
 * never throws.
 *
 * Two-pass idempotent: if the input is already normalized (every image fileId
 * already equals the content hash of its dataURL), the function is a no-op and
 * `warns` is empty.
 *
 * Pure: no API access, no DOM, no side effects. The only async dependency is
 * `fileIdFor` from collab-core (SHA-256 via WebCrypto).
 */

import { dataURLToBytes, fileIdFor } from "collab-core";

/** Excalidraw scene image element (subset of what the editor emits). */
interface ImageElement {
  id: string;
  type: "image";
  fileId: string;
  data: { dataURL: string };
}

/** A file blob stored in the Excalidraw scene files map. */
interface SceneFile {
  mimeType: string;
  dataURL: string;
  created?: number;
  lastRetrieved?: number;
}

/** Result of normalizeSceneImageRefs. */
export interface NormalizeResult {
  /** Elements with fileIds rewritten to content hashes. */
  elements: ImageElement[];
  /** Files map rekeyed to content hashes. */
  files: Record<string, SceneFile>;
  /** Human-readable warnings for elements left AS-IS. */
  warns: string[];
}

/**
 * Normalize image-element fileId references in an Excalidraw scene.
 *
 * @param elements  Raw scene elements (image + non-image).
 * @param files     Scene files map keyed by (possibly legacy) fileId.
 * @returns Result with rewritten elements, rekeyed files map, and warnings.
 */
export async function normalizeSceneImageRefs(
  elements: readonly unknown[],
  files: Record<string, SceneFile>
): Promise<NormalizeResult> {
  const warns: string[] = [];

  // Build the rekeyed files map + a content-hash → canonicalFileId lookup table.
  // All fileIds in newFiles are content hashes; the map lets us skip re-work
  // when the same blob appears under multiple legacy keys.
  const newFiles: Record<string, SceneFile> = {};
  const hashToCanonical = new Map<string, string>(); // contentHash → canonicalFileId

  // First pass: derive the canonical content-hash fileId for every file entry.
  for (const [oldFileId, file] of Object.entries(files)) {
    let bytes: Uint8Array;
    try {
      bytes = dataURLToBytes(file.dataURL);
    } catch {
      // dataURLToBytes falls back to TextEncoder for non-base64 strings so it
      // never actually throws, but keep the guard as defensive belt-and-braces.
      warns.push(
        `file "${oldFileId}": could not decode dataURL — kept under original key`
      );
      newFiles[oldFileId] = file;
      continue;
    }

    const canonicalId = await fileIdFor(bytes);
    hashToCanonical.set(canonicalId, canonicalId);
    newFiles[canonicalId] = { ...file };
  }

  // Second pass: rewrite image-element fileIds.
  const rewritten: ImageElement[] = [];

  for (const el of elements) {
    if (!isImageElement(el)) {
      // Non-image elements (frames, arrows, rectangles, etc.) are untouched.
      rewritten.push(el as ImageElement);
      continue;
    }

    const file = files[el.fileId];
    if (file === undefined) {
      // No file entry for this element's fileId — leave AS-IS and warn.
      warns.push(
        `image element "${el.id}" references missing file "${el.fileId}" — left AS-IS`
      );
      rewritten.push(el);
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = dataURLToBytes(file.dataURL);
    } catch {
      warns.push(
        `image element "${el.id}" (fileId "${el.fileId}"): unparseable dataURL — left AS-IS`
      );
      rewritten.push(el);
      continue;
    }

    const canonicalId = hashToCanonical.get(await fileIdFor(bytes)) ?? await fileIdFor(bytes);

    // Idempotency guard: if the element already points to the canonical hash
    // (already normalized), leave it untouched.
    if (el.fileId === canonicalId) {
      rewritten.push(el);
    } else {
      rewritten.push({ ...el, fileId: canonicalId });
    }
  }

  return { elements: rewritten, files: newFiles, warns };
}

/** Type guard for Excalidraw image elements. */
function isImageElement(el: unknown): el is ImageElement {
  return (
    el !== null &&
    typeof el === "object" &&
    (el as Record<string, unknown>).type === "image" &&
    typeof (el as Record<string, unknown>).fileId === "string" &&
    (el as Record<string, unknown>).data !== undefined
  );
}
