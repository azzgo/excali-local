/**
 * room-gallery-wire — in-room whole-scene replace through the ordinary edit pipeline (task 086).
 *
 * Integration test (task 086): confirmed gallery load must broadcast via the ordinary
 * scene pipeline (ADR 0009 §1: no new wire message — receivers need zero special
 * casing; the existing apply/base-reset/persistSession path handles a full-scene edit).
 *
 * Covers:
 * (a) The loaded drawing's elements appear in the sent scene frame; the only data
 *     wire traffic beyond the dial handshake is the scene message (no seed, no
 *     pointer/present frames — old-client semantics = plain scene message).
 * (b) A peer session fed the relayed scene frame applies it via the existing
 *     remote-scene path (updateScene with those elements) — per-source seq gate
 *     passes for the first frame.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { Member } from "collab-core";
import { clearSession } from "collab-core";
import { useCollabSession } from "@/features/collab/use-collab-session";
import type { CollabIdentity, CollabRoomMeta } from "@/features/collab/use-collab-session";
import type { ServerConfig } from "@/features/collab/storage";
import { mintTestIdentity } from "./helpers";

// ---- Excalidraw mock (restoreAppState needed by broadcastScene) ----
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
  // restoreAppState is called inside broadcastScene — identity function for the test
  restoreAppState: (appState: unknown) => appState,
  // useThumbnail calls exportToBlob during render (not in useEffect), so it must return a resolved Promise
  exportToBlob: vi.fn().mockResolvedValue(new Blob([""], { type: "image/png" })),
}));

// Mock useThumbnail to avoid exportToBlob during render issue
vi.mock("@/features/gallery/hooks/use-thumbnail", () => ({
  useThumbnail: () => ({ generateThumbnail: vi.fn().mockResolvedValue("") }),
}));

// ---- Constants ----
const KEY43 = "A".repeat(43);
const SHARE_ID = "B".repeat(22);

// ---- Fixtures ----
const SERVER: ServerConfig = {
  relay: "http://127.0.0.1:1999",
  org: "dev",
  sk: KEY43,
  ck: KEY43,
};

const ROOM: CollabRoomMeta = {
  label: "Wire Test Room",
  labelKind: "named",
  tier: "team",
  invite: { shareId: SHARE_ID, tier: "team" },
};

// Minted once per file (Vitest single-process).
let IDENTITY: CollabIdentity;
beforeAll(async () => {
  IDENTITY = await mintTestIdentity();
});

const welcomeMessage = (
  snapshotAvailable = true,
  peers: Member[] = [],
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
      roomName: null,
      peers,
    },
  });

const isEnvelope = (raw: string, t: string) => {
  try {
    return JSON.parse(raw).t === t;
  } catch {
    return false;
  }
};

// ---- Stub socket (one per session — no sharing) ----
class StubSocket {
  readyState = 0;
  readonly sent: string[] = [];
  private listeners: Record<string, Set<(ev: unknown) => void>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };
  constructor(readonly url: string) {}
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

let sockets: StubSocket[] = [];
const lastSocket = () => sockets[sockets.length - 1];

// ---- API factory ----
// updateScene is a vi.fn() so tests can assert what the hook applies/broadcasts.
function makeApi(): { api: ExcalidrawImperativeAPI } {
  return {
    api: {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(() => []),
      getSceneElementsIncludingDeleted: vi.fn(() => []),
      getAppState: vi.fn(() => ({})),
      getFiles: vi.fn(() => ({})),
      addFiles: () => {},
    } as unknown as ExcalidrawImperativeAPI,
  };
}

function makeOptions(api: ExcalidrawImperativeAPI) {
  return {
    shareId: SHARE_ID,
    server: SERVER,
    room: ROOM,
    excalidrawAPI: api,
    identity: IDENTITY,
    wsFactory: () => {
      const s = new StubSocket("ws://x");
      sockets.push(s);
      return s;
    },
  };
}

// ---- Setup / teardown ----
beforeEach(async () => {
  sockets = [];
  localStorage.clear();
  await clearSession(SHARE_ID);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- Tests ----

/** Type-narrowed access to broadcastScene on the session handle. */
type BroadcastScene = (elements: readonly unknown[], files: BinaryFiles) => void;
const getBroadcastScene = (handle: ReturnType<typeof useCollabSession>): BroadcastScene => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handle as any)["broadcastScene"];
};

/** Dial a session, connect it, and return { ws, result, unmount }. */
async function dialSession(connId: string) {
  const { api } = makeApi();
  const { result, unmount } = renderHook(() => useCollabSession(makeOptions(api)));
  await waitFor(() => expect(lastSocket()).toBeDefined());
  const ws = lastSocket();
  await act(async () => {
    ws.open();
  });
  await act(async () => {
    ws.message(welcomeMessage(true, [], connId));
  });
  await waitFor(() => expect(result.current.ready).toBe(true));
  return { api, ws, result, unmount };
}

describe("086: in-room whole-scene replace through the ordinary edit pipeline", () => {
  test(
    "(a) confirmed load sends an ordinary scene frame (no seed, no other wire types)",
    { timeout: 10000 },
    async () => {
      const { saveDrawing } = await import("@/features/editor/utils/indexdb");
      const DRAWING_ELEMENTS = [
        { id: "el-loaded-1", type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
        { id: "el-loaded-2", type: "ellipse", x: 200, y: 300, width: 80, height: 80 },
      ];
      await saveDrawing({
        id: "drawing-to-load-086",
        name: "Load Me 086",
        elements: JSON.stringify(DRAWING_ELEMENTS),
        appState: '{"zoom":1}',
        files: "{}",
        thumbnail: "",
        collectionIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const { ws, result, unmount } = await dialSession("conn-self");

      // broadcastScene is added by the 086 implementation.
      const broadcastScene = getBroadcastScene(result.current);
      expect(typeof broadcastScene).toBe("function");

      // Broadcast the loaded drawing as a REAL local edit: broadcastScene clears
      // the echo guard + applies the scene; onLocalChange simulates the onChange
      // echo the real Excalidraw would fire (mock api.updateScene does not).
      act(() => {
        broadcastScene(DRAWING_ELEMENTS, {});
        result.current.onLocalChange(DRAWING_ELEMENTS as never, {} as never, {});
      });
      // Flush the 100ms trailing-edge sendScene throttle (real timers — the
      // established pattern in use-collab-session.test.ts).
      await new Promise((resolve) => setTimeout(resolve, 150));

      // ASSERTION (a): scene frame carries the loaded elements verbatim.
      const selfSceneFrames = ws.sent.filter((s) => isEnvelope(s, "scene"));
      expect(selfSceneFrames.length).toBeGreaterThanOrEqual(1);
      const loadedEls = JSON.parse(selfSceneFrames[0]!).p.elements;
      expect(loadedEls).toEqual(DRAWING_ELEMENTS);

      // ASSERTION (c): no seed/pointer/present frames — the replace rides the
      // ordinary scene pipeline only (ADR 0009 §1). hello + room-name are the
      // normal dial handshake, not data-plane replacement traffic.
      const dataPlane = ws.sent
        .map((raw) => {
          try {
            return JSON.parse(raw).t;
          } catch {
            return "?";
          }
        })
        .filter((t) => t !== "hello" && t !== "room-name");
      expect(dataPlane).toEqual(["scene"]);

      unmount();
    },
  );

  test(
    "(b) a peer fed the relayed frame applies it via the existing remote-scene path",
    { timeout: 10000 },
    async () => {
      const DRAWING_ELEMENTS = [
        { id: "el-loaded-1", type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
      ];

      // Step 1: loader session broadcasts the replace; capture the emitted frame.
      const loaderApi = makeApi();
      const { result: loaderResult, unmount: loaderUnmount } = renderHook(() =>
        useCollabSession(makeOptions(loaderApi.api)),
      );
      await waitFor(() => expect(lastSocket()).toBeDefined());
      const loaderWs = lastSocket();
      await act(async () => {
        loaderWs.open();
      });
      await act(async () => {
        loaderWs.message(welcomeMessage(true, [], "conn-loader"));
      });
      await waitFor(() => expect(loaderResult.current.ready).toBe(true));

      const broadcastScene = getBroadcastScene(loaderResult.current);
      act(() => {
        broadcastScene(DRAWING_ELEMENTS, {});
        loaderResult.current.onLocalChange(DRAWING_ELEMENTS as never, {} as never, {});
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const selfSceneFrames = loaderWs.sent.filter((s) => isEnvelope(s, "scene"));
      expect(selfSceneFrames.length).toBeGreaterThanOrEqual(1);
      const scenePayload = JSON.parse(selfSceneFrames[selfSceneFrames.length - 1]!).p;
      loaderUnmount();

      // Step 2: a fresh peer session receives the frame relayed with from: conn-loader.
      const { api: peerApi, ws: peerWs, unmount: peerUnmount } = await dialSession("conn-peer");

      await act(async () => {
        peerWs.message(
          JSON.stringify({ v: 1, t: "scene", p: scenePayload, from: "conn-loader" }),
        );
      });

      // ASSERTION (b): peer applied the replace through the ordinary apply path.
      expect(peerApi.updateScene).toHaveBeenCalled();
      const peerCall = (peerApi.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(peerCall.elements).toEqual(DRAWING_ELEMENTS);
      expect(peerCall.captureUpdate).toBe("NEVER");

      peerUnmount();
    },
  );
});