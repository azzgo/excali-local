/**
 * Collab file sync (goal 023 task 052) — the page half of the file client.
 *
 * Hook-level tests against the REAL useCollabSession with a stubbed socket
 * (StubSocket, collab-core client.test.ts pattern), REAL WebCrypto Ed25519
 * (hello, member signer, AES-GCM file frames) and REAL fake-indexeddb. The
 * imperative API is a stub whose updateScene records elements and whose
 * addFiles records blobs — so getSceneElements/getFiles reflect the wire.
 *
 * Covers the 052 checklist:
 * - local file add → file-put header + file-data frame (sha256 content id);
 *   duplicate add does NOT re-upload (content-addressing dedup);
 * - remote scene with an image element → file-get; `file` + `file-data`
 *   frames → addFiles with the blob;
 * - FILE_NOT_FOUND → not-found placeholder (retried=false, missing set) →
 *   ONE automatic retry → blob arrives → addFiles + missing cleared;
 * - gallery save after hydration persists the blob dataURL and the
 *   loadDrawingToScene restore path re-adds it;
 * - team rooms ride a plaintext dataURL frame; private rooms ride a
 *   SignedFrame (encryptFile) — plus a full private decrypt round-trip;
 * - viewport-triggered lazy hydration fetches only in-view refs.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as excalidraw from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  b64urlToBytes,
  bytesToB64url,
  clearSession,
  dataURLToBytes,
  deriveContentKey,
  encryptFile,
  fileIdFor,
  seedToPkcs8,
} from "collab-core";
import { loadDrawingToScene } from "@/features/editor/utils/excalidraw-api.helper";
import { getDrawingFullData, getDrawings } from "@/features/editor/utils/indexdb";
import { useCollabSession } from "@/features/collab/use-collab-session";
import type { CollabIdentity, CollabRoomMeta } from "@/features/collab/use-collab-session";
import { buildMemberSigner } from "@/features/collab/use-collab-files";
import type { ServerConfig } from "@/features/collab/storage";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
  exportToBlob: vi.fn(),
  // loadDrawingToScene (gallery restore) runs appState through restoreAppState
  restoreAppState: (appState: unknown) => appState,
}));

/* ------------------------------------------------------------------ */
/* Stub socket (collab-core client.test.ts pattern)                    */
/* ------------------------------------------------------------------ */

class StubSocket {
  readyState = 0; // CONNECTING
  readonly sent: string[] = [];
  private listeners: Record<string, Set<(ev: unknown) => void>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };
  static instances: StubSocket[] = [];
  static reset(): void {
    StubSocket.instances = [];
  }
  constructor(readonly url: string) {
    StubSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    for (const fn of [...this.listeners.close]) fn({ code, reason });
  }
  open(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    for (const fn of [...this.listeners.open]) fn({});
  }
  message(data: string): void {
    for (const fn of [...this.listeners.message]) fn({ data });
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.add(fn);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.delete(fn);
  }
}

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

/** 32-byte base64url key (43 chars, no padding) — collab-core validates. */
const KEY43 = "A".repeat(43);
const SHARE_ID = "B".repeat(22);

const SERVER: ServerConfig = {
  relay: "http://127.0.0.1:1999", // loopback dev relay (060) — never probed
  org: "dev",
  sk: KEY43,
  ck: KEY43,
};

const ROOM_TEAM: CollabRoomMeta = {
  label: "Q3 planning",
  tier: "team",
  invite: { shareId: SHARE_ID, tier: "team" },
};

const ROOM_PRIVATE: CollabRoomMeta = {
  label: "Q3 planning",
  tier: "private",
  roomSecret: KEY43,
  invite: { shareId: SHARE_ID, tier: "private", roomSecret: KEY43 },
};

/** Mint a REAL member keypair so identity.pub matches identity.seed (the
 *  member signer rides pub on the wire and encryptContent self-verifies
 *  the pair, 058 §3.1). */
async function mintTestIdentity(): Promise<CollabIdentity> {
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

// top-level await is fine in vitest (ESM)
const IDENTITY: CollabIdentity = await mintTestIdentity();

const lastSocket = () => StubSocket.instances[StubSocket.instances.length - 1];

const welcomeMessage = (
  snapshotAvailable = true,
  connId = "conn-1",
): string =>
  JSON.stringify({
    v: 1,
    t: "welcome",
    p: {
      profileId: IDENTITY.profileId,
      connId,
      room: SHARE_ID,
      privacy: "team",
      snapshotAvailable,
      peers: [],
    },
  });

const sceneMessage = (elements: unknown[], seq = 1): string =>
  JSON.stringify({ v: 1, t: "scene", p: { elements, seq }, from: "conn-1" });

const fileHeaderMessage = (fileId: string, mimeType: string): string =>
  JSON.stringify({ v: 1, t: "file", p: { fileId, mimeType } });

const fileDataMessage = (p: unknown): string =>
  JSON.stringify({ v: 1, t: "file-data", p });

const notFoundMessage = (): string =>
  JSON.stringify({ v: 1, t: "error", p: { code: "FILE_NOT_FOUND", fatal: false } });

const isEnvelope = (raw: string, t: string) => {
  try {
    return JSON.parse(raw).t === t;
  } catch {
    return false;
  }
};

const envelopeOf = (raw: string) => JSON.parse(raw) as Record<string, unknown>;

const sentOfType = (ws: StubSocket, t: string) => ws.sent.filter((s) => isEnvelope(s, t));

/** Stub imperative API: updateScene records elements, addFiles records blobs
 *  into getFiles — mirrors the real editor's file registry. */
function makeApi(appState: Record<string, unknown> = {}) {
  const elementsStore: unknown[] = [];
  const filesStore: Record<string, { mimeType: string; dataURL: string; created: number }> = {};
  const api = {
    updateScene: vi.fn((patch: { elements?: unknown[] }) => {
      if (Array.isArray(patch.elements)) {
        elementsStore.length = 0;
        elementsStore.push(...patch.elements);
      }
    }),
    getSceneElements: vi.fn(() => elementsStore),
    getSceneElementsIncludingDeleted: vi.fn(() => elementsStore),
    getAppState: vi.fn(() => appState),
    getFiles: vi.fn(() => filesStore),
    addFiles: vi.fn((files: unknown) => {
      const list = Array.isArray(files) ? files : Object.values(files as Record<string, unknown>);
      for (const f of list as Array<{ id: string; mimeType?: string; dataURL?: string; created?: number }>) {
        if (f.dataURL !== undefined) {
          filesStore[f.id] = {
            mimeType: f.mimeType ?? "",
            dataURL: f.dataURL,
            created: f.created ?? Date.now(),
          };
        }
      }
    }),
  } as unknown as ExcalidrawImperativeAPI & {
    updateScene: ReturnType<typeof vi.fn>;
    getSceneElements: ReturnType<typeof vi.fn>;
    getAppState: ReturnType<typeof vi.fn>;
    getFiles: ReturnType<typeof vi.fn>;
    addFiles: ReturnType<typeof vi.fn>;
  };
  return api;
}

function makeHookOptions(api: ExcalidrawImperativeAPI, room: CollabRoomMeta) {
  return {
    shareId: SHARE_ID,
    server: SERVER,
    room,
    excalidrawAPI: api,
    identity: IDENTITY,
    wsFactory: (url: string) => new StubSocket(url),
  };
}

/** Render the hook, wait for the dial, open the socket and greet. */
async function dialAndWelcome(api: ExcalidrawImperativeAPI, room: CollabRoomMeta = ROOM_TEAM) {
  const { result, unmount } = renderHook(() =>
    useCollabSession(makeHookOptions(api, room)),
  );
  await waitFor(() => expect(lastSocket()).toBeDefined());
  const ws = lastSocket();
  await act(async () => {
    ws.open();
  });
  await act(async () => {
    ws.message(welcomeMessage());
  });
  return { result, unmount, ws };
}

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

const imageElement = (fileId: string, x = 0, y = 0, width = 100, height = 100) => ({
  id: `el-${fileId.slice(0, 6)}`,
  type: "image",
  fileId,
  x,
  y,
  width,
  height,
  version: 1,
  versionNonce: 1,
});

beforeEach(async () => {
  StubSocket.reset();
  await clearSession(SHARE_ID);
  vi.mocked(excalidraw.exportToBlob).mockReset();
});

afterEach(() => {
  StubSocket.reset();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* local upload                                                         */
/* ------------------------------------------------------------------ */

describe("collab file sync — local upload", () => {
  test("file add → file-put header + file-data frame (sha256 id); duplicate add does not re-upload", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);

    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const files = { [fileId]: { id: fileId, mimeType: "image/png", dataURL: PNG_DATA_URL, created: 1 } };
    await act(async () => {
      result.current.onLocalChange([imageElement(fileId)] as never, {} as never, files as never);
    });

    // file-put header FIRST, then the file-data body (051 §2)
    await waitFor(() => expect(sentOfType(ws, "file-put")).toHaveLength(1));
    const putIdx = ws.sent.findIndex((s) => isEnvelope(s, "file-put"));
    const put = envelopeOf(ws.sent[putIdx]);
    expect(put.p).toEqual({
      fileId,
      mimeType: "image/png",
      size: dataURLToBytes(PNG_DATA_URL).length,
    });
    const data = envelopeOf(ws.sent[putIdx + 1]);
    expect(data.t).toBe("file-data");
    expect(data.p).toBe(PNG_DATA_URL); // team room: plaintext dataURL rides the wire

    // duplicate add: the blob is cached now — no re-upload (dedup, 051 §3)
    await act(async () => {
      result.current.onLocalChange([imageElement(fileId)] as never, {} as never, files as never);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sentOfType(ws, "file-put")).toHaveLength(1);
    unmount();
  });

  test("a files-map key that is not the content hash is skipped (no wrong-id upload)", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // legacy id (patched-tgz sha1-hex style) — NOT the sha256 content id
    const legacyId = "deadbeef";
    const files = { [legacyId]: { id: legacyId, mimeType: "image/png", dataURL: PNG_DATA_URL, created: 1 } };
    await act(async () => {
      result.current.onLocalChange([imageElement(legacyId)] as never, {} as never, files as never);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sentOfType(ws, "file-put")).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    unmount();
  });

  test("private room: file-data p is a SignedFrame (c/iv/sig/signer), not the plaintext string", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api, ROOM_PRIVATE);

    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const files = { [fileId]: { id: fileId, mimeType: "image/png", dataURL: PNG_DATA_URL, created: 1 } };
    await act(async () => {
      result.current.onLocalChange([imageElement(fileId)] as never, {} as never, files as never);
    });

    await waitFor(() => expect(sentOfType(ws, "file-put")).toHaveLength(1));
    const putIdx = ws.sent.findIndex((s) => isEnvelope(s, "file-put"));
    const data = envelopeOf(ws.sent[putIdx + 1]);
    expect(data.t).toBe("file-data");
    // 052: team vs private — team p is a string, private p is an object
    expect(typeof data.p).toBe("object");
    const frame = data.p as Record<string, unknown>;
    expect(typeof frame.c).toBe("string");
    expect(typeof frame.iv).toBe("string");
    expect(typeof frame.sig).toBe("string");
    expect(frame.signer).toMatchObject({
      profileId: IDENTITY.profileId,
      key: expect.any(String),
    });
    // the ciphertext never contains the plaintext
    expect(frame.c).not.toContain("iVBOR");
    unmount();
  });
});

/* ------------------------------------------------------------------ */
/* on-demand hydration                                                  */
/* ------------------------------------------------------------------ */

describe("collab file sync — on-demand hydration", () => {
  test("remote image element → file-get; file + file-data → addFiles with the blob (team plaintext)", async () => {
    const api = makeApi();
    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const el = imageElement(fileId);
    const { result, unmount, ws } = await dialAndWelcome(api);

    await act(async () => {
      ws.message(sceneMessage([el], 1));
    });
    // scene-load prefetch: file-get for the referenced blob (051 §4)
    await waitFor(() => expect(sentOfType(ws, "file-get")).toHaveLength(1));
    expect(envelopeOf(ws.sent.find((s) => isEnvelope(s, "file-get"))!).p).toEqual({ fileId });

    // relay answers: `file` header, then the data frame
    await act(async () => {
      ws.message(fileHeaderMessage(fileId, "image/png"));
      ws.message(fileDataMessage(PNG_DATA_URL));
    });
    await waitFor(() =>
      expect(api.addFiles).toHaveBeenCalledWith([
        { id: fileId, mimeType: "image/png", dataURL: PNG_DATA_URL, created: expect.any(Number) },
      ]),
    );
    // the blob is in the editor's file registry (getFiles) — the gallery
    // save path picks it up from there
    expect(api.getFiles()[fileId].dataURL).toBe(PNG_DATA_URL);
    unmount();
  });

  test("FILE_NOT_FOUND → placeholder (missing set, retried=false) → ONE auto-retry → blob → addFiles + cleared", async () => {
    const api = makeApi();
    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const el = imageElement(fileId);
    const { result, unmount, ws } = await dialAndWelcome(api);

    await act(async () => {
      ws.message(sceneMessage([el], 1));
    });
    await waitFor(() => expect(sentOfType(ws, "file-get")).toHaveLength(1));

    vi.useFakeTimers();
    // first miss: relay has no blob → not-found (retried=false) + ONE retry
    // scheduled inside the hydrator (051 §4)
    await act(async () => {
      ws.message(notFoundMessage());
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.missingFileIds.has(fileId)).toBe(true);

    // the single automatic retry after FILE_RETRY_DELAY_MS
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const gets = sentOfType(ws, "file-get");
    expect(gets).toHaveLength(2);

    // retry succeeds → onFileReady → addFiles re-renders the placeholder
    await act(async () => {
      ws.message(fileHeaderMessage(fileId, "image/png"));
      ws.message(fileDataMessage(PNG_DATA_URL));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.addFiles).toHaveBeenCalledWith([
      { id: fileId, mimeType: "image/png", dataURL: PNG_DATA_URL, created: expect.any(Number) },
    ]);
    expect(result.current.missingFileIds.has(fileId)).toBe(false);
    unmount();
  });

  test("private room: encrypted file-data decrypts to the blob (full round-trip)", async () => {
    const api = makeApi();
    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const el = imageElement(fileId);
    const { result, unmount, ws } = await dialAndWelcome(api, ROOM_PRIVATE);

    await act(async () => {
      ws.message(sceneMessage([el], 1));
    });
    await waitFor(() => expect(sentOfType(ws, "file-get")).toHaveLength(1));

    // the relay answers with the same SignedFrame shape the upload sent:
    // encryptFile with the 050 content key + the member signer
    const key = await deriveContentKey({ baseSecret: ROOM_PRIVATE.roomSecret!, shareId: SHARE_ID });
    const signer = await buildMemberSigner(IDENTITY);
    const frame = await encryptFile(PNG_DATA_URL, key, SHARE_ID, fileId, signer);
    await act(async () => {
      ws.message(fileHeaderMessage(fileId, "image/png"));
      ws.message(fileDataMessage(frame));
    });
    await waitFor(() =>
      expect(api.addFiles).toHaveBeenCalledWith([
        { id: fileId, mimeType: "image/png", dataURL: PNG_DATA_URL, created: expect.any(Number) },
      ]),
    );
    unmount();
  });

  test("viewport scan hydrates only in-view image refs (lazy on-demand, 051 §4)", async () => {
    const api = makeApi({
      width: 800,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    });
    const fileA = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const fileB = await fileIdFor(dataURLToBytes("data:image/png;base64,AAAA"));
    const elA = imageElement(fileA, 10, 10, 100, 100); // in view
    const elB = imageElement(fileB, 1500, 10, 100, 100); // far right — out of view
    const { result, unmount, ws } = await dialAndWelcome(api);

    // first scene: no files → nothing to fetch
    await act(async () => {
      ws.message(sceneMessage([{ id: "el-0", type: "rectangle", x: 0, y: 0, width: 5, height: 5, version: 1, versionNonce: 1 }], 1));
    });
    // live scene: both refs observed; the post-apply viewport scan fetches
    // only the one currently visible
    await act(async () => {
      ws.message(sceneMessage([elA, elB], 2));
    });
    const gets = sentOfType(ws, "file-get");
    expect(gets).toHaveLength(1);
    expect(envelopeOf(gets[0]).p).toEqual({ fileId: fileA });

    // scrolling the viewport right brings B into view → file-get B
    await act(async () => {
      result.current.onLocalViewportChange(-1500, 0, { value: 1 } as never);
    });
    await waitFor(() => expect(sentOfType(ws, "file-get")).toHaveLength(2));
    const getsAfter = sentOfType(ws, "file-get");
    expect(envelopeOf(getsAfter[1]).p).toEqual({ fileId: fileB });
    unmount();
  });
});

/* ------------------------------------------------------------------ */
/* gallery persistence                                                  */
/* ------------------------------------------------------------------ */

describe("collab file sync — gallery keeps the blobs", () => {
  test("save after hydration persists the blob dataURL; loadDrawingToScene restores it", async () => {
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(
      new Blob(["mock"], { type: "image/webp" }),
    );
    const api = makeApi();
    (api.getAppState as ReturnType<typeof vi.fn>).mockReturnValue({ viewBackgroundColor: "#fff" });
    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const el = imageElement(fileId);
    const { result, unmount, ws } = await dialAndWelcome(api);

    await act(async () => {
      ws.message(sceneMessage([el], 1));
    });
    await waitFor(() => expect(sentOfType(ws, "file-get")).toHaveLength(1));
    await act(async () => {
      ws.message(fileHeaderMessage(fileId, "image/png"));
      ws.message(fileDataMessage(PNG_DATA_URL));
    });
    await waitFor(() => expect(api.addFiles).toHaveBeenCalled());

    const ok = await act(async () => result.current.saveToGallery());
    expect(ok).toBe(true);
    const drawings = await getDrawings();
    expect(drawings).toHaveLength(1);
    const full = await getDrawingFullData(`room-${SHARE_ID}`);
    const savedFiles = JSON.parse(full.files) as Record<string, { dataURL: string; mimeType: string }>;
    expect(savedFiles[fileId].dataURL).toBe(PNG_DATA_URL);
    expect(savedFiles[fileId].mimeType).toBe("image/png");

    // restore path (excalidraw-api.helper — the gallery's loadDrawingToScene)
    const api2 = makeApi();
    loadDrawingToScene(api2, [el], { viewBackgroundColor: "#fff" }, savedFiles);
    expect(api2.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ elements: [el] }),
    );
    expect(api2.addFiles).toHaveBeenCalledWith(savedFiles);
    unmount();
  });

  test("the collab session cache stays refs-only — blobs never enter it", async () => {
    const api = makeApi();
    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const el = imageElement(fileId);
    const { result, unmount, ws } = await dialAndWelcome(api);

    await act(async () => {
      ws.message(sceneMessage([el], 1));
    });
    // local change with a blob in the onChange files map — a GENUINE local
    // insert: the elements must differ from the just-applied remote scene,
    // otherwise the content echo guard correctly suppresses it as a remote
    // echo (real inserts always create/modify an element).
    const localEl = imageElement(fileId, 10, 10);
    await act(async () => {
      result.current.onLocalChange(
        [localEl] as never,
        {} as never,
        { [fileId]: { id: fileId, mimeType: "image/png", dataURL: PNG_DATA_URL, created: 1 } } as never,
      );
    });
    await waitFor(() => expect(sentOfType(ws, "file-put")).toHaveLength(1));

    const { loadSession } = await import("collab-core");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150)); // past the 100ms persist debounce
    });
    const session = await loadSession(SHARE_ID);
    expect(session?.edited.elements).toEqual([localEl]);
    expect(session?.edited.files).toBeUndefined();
    unmount();
  });

  test("echo guard: onChange replaying a just-applied remote scene never rebroadcasts", async () => {
    const api = makeApi();
    const fileId = await fileIdFor(dataURLToBytes(PNG_DATA_URL));
    const el = imageElement(fileId);
    const { result, unmount, ws } = await dialAndWelcome(api);

    // remote scene arrives (from the other member) and is applied
    await act(async () => {
      ws.message(sceneMessage([el], 1));
    });
    // Excalidraw fires onChange for the programmatic updateScene — with the
    // SAME elements. The content echo guard must recognize it (the timing
    // guard may have already cleared: React commit happens after the
    // clearing microtask) and never rebroadcast: a rebroadcast would carry
    // seq+1, defeat the relay's byte-dup suppression, and ping-pong stale
    // scenes back to the sender (mid-drag snap-back / typed-text backspace).
    await act(async () => {
      result.current.onLocalChange([el] as never, {} as never, {} as never);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150)); // past the 100ms sendScene throttle
    });
    expect(sentOfType(ws, "scene")).toHaveLength(0);

    // positive control: a GENUINE local edit (elements differ) broadcasts
    const edited = imageElement(fileId, 40, 40);
    await act(async () => {
      result.current.onLocalChange([edited] as never, {} as never, {} as never);
    });
    await waitFor(() => expect(sentOfType(ws, "scene")).toHaveLength(1));
    unmount();
  });
});
