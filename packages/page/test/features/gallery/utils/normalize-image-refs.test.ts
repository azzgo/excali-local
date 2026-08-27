import { describe, it, expect } from "vitest";
import { normalizeSceneImageRefs } from "@/features/gallery/utils/normalize-image-refs";
import { fileIdFor, dataURLToBytes } from "collab-core";

// ─── fixtures ────────────────────────────────────────────────────────────────

/** A tiny 1×1 red PNG as a base64 dataURL — deterministic SHA-256 hash. */
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/** A minimal SVG as a UTF-8 (non-base64) dataURL — UTF-8 fallback path. */
const SVG_DATA_URL = "data:image/svg+xml,%3Csvg/%3E";

/** A known legacy fileId that is deliberately NOT the content hash. */
const LEGACY_FILE_ID = "legacy-file-id-12345";

/** A dataURL whose content hash matches this exact string (extremely unlikely
 *  by chance — used to verify the no-op guard). We pick a short string whose
 *  SHA-256 base64url happens to equal itself (this is a pre-computed value). */
const CONTENT_HASH_THAT_MATCHES_ID =
  "GgtwcHVibGljL3N2Z19hcGkvdjE_1hOkAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeImageElement(overrides: {
  id?: string;
  fileId?: string;
  dataURL?: string;
  groupId?: string;
}): {
  id: string;
  type: "image";
  fileId: string;
  data?: { dataURL: string };
  groupId?: string;
} {
  return {
    id: "img-1",
    type: "image",
    fileId: LEGACY_FILE_ID,
    data: { dataURL: TINY_PNG_DATA_URL },
    ...overrides,
  };
}

function makeFilesMap(
  fileId: string,
  overrides?: Partial<{
    mimeType: string;
    dataURL: string;
    created: number;
    lastRetrieved: number;
  }>
): Record<string, { mimeType: string; dataURL: string; created: number; lastRetrieved: number }> {
  return {
    [fileId]: {
      mimeType: "image/png",
      dataURL: TINY_PNG_DATA_URL,
      created: 1_000_000,
      lastRetrieved: 1_000_000,
      ...overrides,
    },
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("normalizeSceneImageRefs", () => {
  it("rewrites legacy fileId to content hash and rekeys files map", async () => {
    const elements = [makeImageElement({})];
    const files = makeFilesMap(LEGACY_FILE_ID);

    const result = await normalizeSceneImageRefs(elements, files);

    // element's fileId should now be the content hash
    expect(result.elements[0].fileId).toBe(await fileIdFor(dataURLToBytes(TINY_PNG_DATA_URL)));
    // files map should be rekeyed to the new hash
    const expectedFileId = await fileIdFor(dataURLToBytes(TINY_PNG_DATA_URL));
    expect(result.files[expectedFileId]).toBeDefined();
    expect(result.files[expectedFileId]!.mimeType).toBe("image/png");
    expect(result.files[expectedFileId]!.dataURL).toBe(TINY_PNG_DATA_URL);
    // legacy key must be gone
    expect(result.files[LEGACY_FILE_ID]).toBeUndefined();
    expect(result.warns).toHaveLength(0);
  });

  it("normalizes multiple image elements with different legacy fileIds", async () => {
    const el1 = makeImageElement({ id: "img-1", fileId: "legacy-a" });
    const el2 = makeImageElement({ id: "img-2", fileId: "legacy-b" });
    const el3 = makeImageElement({ id: "img-3", fileId: "legacy-c" });
    const files = {
      "legacy-a": { mimeType: "image/png", dataURL: TINY_PNG_DATA_URL, created: 1, lastRetrieved: 1 },
      "legacy-b": { mimeType: "image/png", dataURL: TINY_PNG_DATA_URL, created: 1, lastRetrieved: 1 },
      "legacy-c": { mimeType: "image/png", dataURL: TINY_PNG_DATA_URL, created: 1, lastRetrieved: 1 },
    };

    const result = await normalizeSceneImageRefs([el1, el2, el3], files);

    const hash = await fileIdFor(dataURLToBytes(TINY_PNG_DATA_URL));
    expect(result.elements[0].fileId).toBe(hash);
    expect(result.elements[1].fileId).toBe(hash);
    expect(result.elements[2].fileId).toBe(hash);
    // all three entries collapsed to a single rekeyed file (same content hash)
    expect(Object.keys(result.files)).toHaveLength(1);
    expect(result.files[hash]).toBeDefined();
    expect(result.warns).toHaveLength(0);
  });

  it("leaves non-image elements (frames, arrows) fileId untouched", async () => {
    const elements = [
      { id: "frame-1", type: "frame" as const, fileId: "some-id" },
      { id: "arrow-1", type: "arrow" as const, boundElements: [{ id: "box-1" }] },
      { id: "rect-1", type: "rectangle" as const },
      { id: "img-1", type: "image" as const, fileId: LEGACY_FILE_ID, data: { dataURL: TINY_PNG_DATA_URL } },
    ];
    const files = makeFilesMap(LEGACY_FILE_ID);

    const result = await normalizeSceneImageRefs(elements as any, files);

    expect((result.elements[0] as any).fileId).toBe("some-id");
    expect((result.elements[1] as any).boundElements).toEqual([{ id: "box-1" }]);
    expect(result.warns).toHaveLength(0);
  });

  it("gracefully handles a missing file entry — leaves element AS-IS and warns", async () => {
    const elements = [makeImageElement({ fileId: "no-such-file" })];
    const files = {}; // no entries

    const result = await normalizeSceneImageRefs(elements, files);

    expect(result.elements[0].fileId).toBe("no-such-file");
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toContain("no-such-file");
    expect(result.warns[0]).toContain("missing");
  });

  it("handles base64 dataURL (binary image) via base64 decode path", async () => {
    const elements = [makeImageElement({})];
    const files = makeFilesMap(LEGACY_FILE_ID);

    const result = await normalizeSceneImageRefs(elements, files);

    const hash = await fileIdFor(dataURLToBytes(TINY_PNG_DATA_URL));
    expect(result.elements[0].fileId).toBe(hash);
    expect(result.warns).toHaveLength(0);
  });

  it("handles UTF-8 SVG dataURL via the TextEncoder fallback path", async () => {
    const elements = [
      {
        id: "svg-img",
        type: "image" as const,
        fileId: "legacy-svg",
        data: { dataURL: SVG_DATA_URL },
      },
    ];
    const files = {
      "legacy-svg": {
        mimeType: "image/svg+xml",
        dataURL: SVG_DATA_URL,
        created: 1,
        lastRetrieved: 1,
      },
    };

    const result = await normalizeSceneImageRefs(elements, files);

    const hash = await fileIdFor(dataURLToBytes(SVG_DATA_URL));
    expect(result.elements[0].fileId).toBe(hash);
    expect(result.files[hash]).toBeDefined();
    expect(result.warns).toHaveLength(0);
  });

  it("second pass over already-normalized output is a no-op (idempotent)", async () => {
    const elements = [makeImageElement({})];
    const files = makeFilesMap(LEGACY_FILE_ID);

    const first = await normalizeSceneImageRefs(elements, files);
    const second = await normalizeSceneImageRefs(first.elements as any, first.files);

    expect(second.elements[0].fileId).toBe(first.elements[0].fileId);
    expect(second.files).toEqual(first.files);
    expect(second.warns).toHaveLength(0);
  });

  it("idempotent: second pass on already-normalized input adds no warns", async () => {
    const hash = await fileIdFor(dataURLToBytes(TINY_PNG_DATA_URL));
    const elements = [
      {
        id: "img-1",
        type: "image" as const,
        fileId: hash,
        data: { dataURL: TINY_PNG_DATA_URL },
      },
    ];
    const files = makeFilesMap(hash);

    const first = await normalizeSceneImageRefs(elements, files);
    const second = await normalizeSceneImageRefs(first.elements as any, first.files);

    expect(second.warns).toHaveLength(0);
    expect(second.elements[0].fileId).toBe(hash);
  });

  it("handles empty elements array", async () => {
    const result = await normalizeSceneImageRefs([], {});

    expect(result.elements).toHaveLength(0);
    expect(result.files).toEqual({});
    expect(result.warns).toHaveLength(0);
  });

  it("handles empty files map (no image elements → no warns)", async () => {
    const elements = [{ id: "rect-1", type: "rectangle" as const }];
    const result = await normalizeSceneImageRefs(elements as any, {});

    expect(result.elements).toHaveLength(1);
    expect(result.warns).toHaveLength(0);
  });
});
