/**
 * use-collab-session — session hook tests (task 044).
 *
 * The CollabClient transport is stubbed via the injectable wsFactory (same
 * StubSocket pattern as collab-core's client.test.ts); the session cache and
 * the gallery run against a REAL IndexedDB (fake-indexeddb via test/setup.ts)
 * and the hello signature is REAL WebCrypto Ed25519 (Node's webcrypto in the
 * test env). Only @excalidraw/excalidraw is mocked (CaptureUpdateAction +
 * exportToBlob — the tgz module itself is not loadable in happy-dom).
 *
 * Covers the task's hook checklist: hello payload correctness, onScene →
 * updateScene (CaptureUpdateAction.NEVER), local onChange throttle + cache;
 * plus the 061 §3 re-activation merge, the 061 rule-B auto-seed, roster/
 * pointer presence and saveToGallery persistence.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as excalidraw from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { clearSession, loadSession, saveSession } from "collab-core";
import type { Member } from "collab-core";
import { getDrawingFullData, getDrawings } from "@/features/editor/utils/indexdb";
import { useCollabSession } from "@/features/collab/use-collab-session";
import type { CollabIdentity, CollabRoomMeta } from "@/features/collab/use-collab-session";
import type { ServerConfig } from "@/features/collab/storage";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
  exportToBlob: vi.fn(),
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

const ROOM: CollabRoomMeta = {
  label: "Q3 planning",
  tier: "team",
  invite: { shareId: SHARE_ID, tier: "team" },
};

const IDENTITY: CollabIdentity = {
  profileId: "profile-1",
  name: "Ada",
  seed: KEY43,
  pub: "pub-1",
};

const lastSocket = () => StubSocket.instances[StubSocket.instances.length - 1];

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
      peers,
    },
  });

const sceneMessage = (elements: unknown[], seq = 1, from = "conn-1"): string =>
  JSON.stringify({ v: 1, t: "scene", p: { elements, seq }, from });

const isEnvelope = (raw: string, t: string) => {
  try {
    return JSON.parse(raw).t === t;
  } catch {
    return false;
  }
};

function makeApi(): ExcalidrawImperativeAPI {
  return {
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
  } as unknown as ExcalidrawImperativeAPI;
}

function makeHookOptions(api: ExcalidrawImperativeAPI) {
  return {
    shareId: SHARE_ID,
    server: SERVER,
    room: ROOM,
    excalidrawAPI: api,
    identity: IDENTITY,
    wsFactory: (url: string) => new StubSocket(url),
  };
}

/** Render the hook, wait for the dial, open the socket and greet. */
async function dialAndWelcome(
  api: ExcalidrawImperativeAPI,
  { snapshotAvailable = true, peers = [] as Member[] } = {},
) {
  const { result, unmount } = renderHook(() =>
    useCollabSession(makeHookOptions(api)),
  );
  await waitFor(() => expect(lastSocket()).toBeDefined());
  const ws = lastSocket();
  await act(async () => {
    ws.open();
  });
  expect(isEnvelope(ws.sent[0] ?? "", "hello")).toBe(true);
  await act(async () => {
    ws.message(welcomeMessage(snapshotAvailable, peers));
  });
  return { result, unmount, ws };
}

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
/* connect + hello                                                      */
/* ------------------------------------------------------------------ */

describe("use-collab-session — connect", () => {
  test("sends a hello with the correct payload on open (057 §3)", async () => {
    const api = makeApi();
    const { unmount } = renderHook(() => useCollabSession(makeHookOptions(api)));
    await waitFor(() => expect(lastSocket()).toBeDefined());
    const ws = lastSocket();
    await act(async () => {
      ws.open();
    });

    expect(ws.sent).toHaveLength(1);
    const hello = JSON.parse(ws.sent[0]);
    expect(hello.v).toBe(1);
    expect(hello.t).toBe("hello");
    expect(hello.p).toMatchObject({
      profileId: IDENTITY.profileId,
      name: IDENTITY.name,
      color: { background: expect.any(String), stroke: expect.any(String) },
      privacy: "team",
      room: SHARE_ID,
      admit: { org: "dev", sig: expect.any(String) },
      key: IDENTITY.pub,
    });
    // Real Ed25519 signature over the 057 §3 canonical hello — non-empty.
    expect(hello.p.admit.sig.length).toBeGreaterThan(40);
    unmount();
  });

  test("welcome populates the roster (self first) and snapshotAvailable", async () => {
    const api = makeApi();
    const peer: Member = {
      profileId: "profile-2",
      name: "Min",
      color: { background: "hsl(220, 100%, 83%)", stroke: "hsl(220, 100%, 83%)" },
      connId: "conn-2",
    };
    const { result, unmount } = await dialAndWelcome(api, { peers: [peer] });

    expect(result.current.snapshotAvailable).toBe(true);
    expect(result.current.peers.map((p) => p.profileId)).toEqual([
      IDENTITY.profileId,
      "profile-2",
    ]);
    expect(result.current.peers[0]).toMatchObject({ self: true, name: "Ada" });
    expect(result.current.peers[1]).toMatchObject({
      self: false,
      name: "Min",
      connId: "conn-2",
    });
    unmount();
  });

  test("empty room (no snapshot, no cache) → seed-offer position", async () => {
    const api = makeApi();
    const { result, unmount } = await dialAndWelcome(api, {
      snapshotAvailable: false,
    });
    await waitFor(() => expect(result.current.emptyRoom).toBe(true));
    expect(result.current.snapshotAvailable).toBe(false);
    unmount();
  });
});

/* ------------------------------------------------------------------ */
/* remote scenes                                                        */
/* ------------------------------------------------------------------ */

describe("use-collab-session — remote scenes", () => {
  test("onScene applies the elements via updateScene with CaptureUpdateAction.NEVER", async () => {
    const api = makeApi();
    const el = { id: "el-1", type: "rectangle", version: 1, versionNonce: 1 };
    const { result, unmount, ws } = await dialAndWelcome(api);
    await act(async () => {
      ws.message(sceneMessage([el], 1));
    });

    expect(api.updateScene).toHaveBeenCalledWith({
      elements: [el],
      collaborators: expect.any(Map),
      captureUpdate: "NEVER",
    });
    expect(result.current.snapshotAvailable).toBe(true);
    // the snapshot became the cache base (053 rule A)
    const session = await loadSession(SHARE_ID);
    expect(session?.edited.elements).toEqual([el]);
    expect(session?.base?.elements).toEqual([el]);
    unmount();
  });

  test("remote pointer updates the collaborators map (055 native cursors)", async () => {
    const api = makeApi();
    const peer: Member = {
      profileId: "profile-2",
      name: "Min",
      color: { background: "hsl(220, 100%, 83%)", stroke: "hsl(220, 100%, 83%)" },
      connId: "conn-2",
    };
    const { unmount, ws } = await dialAndWelcome(api, { peers: [peer] });
    (api.updateScene as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      ws.message(
        JSON.stringify({
          v: 1,
          t: "pointer",
          p: { x: 120, y: 340, tool: "pointer" },
          from: "conn-2",
        }),
      );
    });

    const call = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(call.captureUpdate).toBe("NEVER");
    const collaborator = call.collaborators.get("profile-2");
    expect(collaborator).toMatchObject({
      id: "profile-2",
      username: "Min",
      pointer: { x: 120, y: 340, tool: "pointer" },
    });
    unmount();
  });

  test("061 §3 re-activation: offline edits + snapshot → three-way merge + resets + rebroadcast", async () => {
    const baseEl = { id: "el-1", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 1, versionNonce: 1 };
    const oursEl = { ...baseEl, version: 2, versionNonce: 2 };
    const theirsEl = { ...baseEl, version: 3, versionNonce: 3, x: 99 };
    await saveSession(SHARE_ID, {
      edited: { elements: [oursEl], appState: { viewBackgroundColor: "#fff" } },
      base: { elements: [baseEl], appState: {} },
    });

    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);

    // the cached edited scene painted the canvas first (local-first)
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ elements: [oursEl] }),
    );
    expect(result.current.hadOfflineEdits).toBe(true);

    (api.updateScene as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      ws.message(sceneMessage([theirsEl], 5));
    });

    // edit-edit → online wins; the merged scene applied + reset stashed
    const lastCall = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(lastCall.elements).toEqual([theirsEl]);
    expect(result.current.resets).toMatchObject({ count: 1, ids: ["el-1"] });
    // merged scene rebroadcast (061 §2/§3 — peers converge) — the client's
    // sendScene carries its own 100ms trailing-edge throttle.
    await waitFor(() =>
      expect(ws.sent.filter((s) => isEnvelope(s, "scene"))).toHaveLength(1),
    );
    // cache: merged scene is now both edited and base
    const session = await loadSession(SHARE_ID);
    expect(session?.edited.elements).toEqual([theirsEl]);
    unmount();
  });

  test("061 rule A: pure cache (base null) is overwritten by the snapshot", async () => {
    const staged = { id: "el-staged", type: "rectangle", version: 1, versionNonce: 1 };
    const remote = { id: "el-remote", type: "diamond", version: 1, versionNonce: 1 };
    await saveSession(SHARE_ID, {
      edited: { elements: [staged], appState: {} },
      base: null,
    });

    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);
    expect(result.current.hadOfflineEdits).toBe(false);

    (api.updateScene as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      ws.message(sceneMessage([remote], 2));
    });
    expect(result.current.resets).toBeNull();
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ elements: [remote] }),
    );
    unmount();
  });
});

/* ------------------------------------------------------------------ */
/* local edits                                                          */
/* ------------------------------------------------------------------ */

describe("use-collab-session — local edits", () => {
  test("onChange throttles the broadcast (one scene) and caches edited + base", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);
    const el1 = { id: "el-1", type: "rectangle", version: 1, versionNonce: 1 };
    const el2 = { id: "el-1", type: "rectangle", version: 2, versionNonce: 2 };

    vi.useFakeTimers();
    act(() => {
      result.current.onLocalChange([el1] as never, {} as never, {});
      result.current.onLocalChange([el2] as never, {} as never, {});
    });
    // 100ms trailing-edge throttle: rapid calls coalesce — one broadcast.
    expect(ws.sent.filter((s) => isEnvelope(s, "scene"))).toHaveLength(0);
    // runAllTimersAsync fires the throttle + the debounced cache write AND
    // drains fake-indexeddb's setTimeout(0) scheduling (setImmediate is not
    // exposed in happy-dom, so idb falls back to setTimeout).
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const scenes = ws.sent.filter((s) => isEnvelope(s, "scene"));
    expect(scenes).toHaveLength(1);
    expect(JSON.parse(scenes[0]).p.elements).toEqual([el2]); // latest wins
    vi.useRealTimers();

    // debounced cache write: edited saved, base = the last synced snapshot
    const session = await loadSession(SHARE_ID);
    expect(session?.edited.elements).toEqual([el2]);
    unmount();
    unmount();
  });
});

/* ------------------------------------------------------------------ */
/* seed + save                                                          */
/* ------------------------------------------------------------------ */

describe("use-collab-session — seed + saveToGallery", () => {
  test("061 rule B: cached scene auto-seeds an empty room (no prompt)", async () => {
    const staged = { id: "el-staged", type: "rectangle", version: 1, versionNonce: 1 };
    await saveSession(SHARE_ID, {
      edited: { elements: [staged], appState: {} },
      base: null,
    });
    const api = makeApi();
    (api.getSceneElements as ReturnType<typeof vi.fn>).mockReturnValue([staged]);

    const { result, unmount, ws } = await dialAndWelcome(api, {
      snapshotAvailable: false,
    });
    await waitFor(() =>
      expect(ws.sent.some((s) => isEnvelope(s, "seed"))).toBe(true),
    );
    // cache-seed path: no seed prompt
    expect(result.current.emptyRoom).toBe(false);
    unmount();
  });

  test("seed() broadcasts the current canvas (first seed wins, 049 §2)", async () => {
    const api = makeApi();
    const el = { id: "el-1", type: "rectangle", version: 1, versionNonce: 1 };
    (api.getSceneElements as ReturnType<typeof vi.fn>).mockReturnValue([el]);
    const { result, unmount, ws } = await dialAndWelcome(api, {
      snapshotAvailable: false,
    });
    await waitFor(() => expect(result.current.emptyRoom).toBe(true));

    await act(async () => {
      result.current.seed();
    });
    const seeds = ws.sent.filter((s) => isEnvelope(s, "seed"));
    expect(seeds).toHaveLength(1);
    expect(JSON.parse(seeds[0]).p.scene).toEqual([el]);
    expect(result.current.emptyRoom).toBe(false);
    unmount();
  });

  test("saveToGallery persists the current scene to the gallery (061)", async () => {
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(
      new Blob(["mock"], { type: "image/webp" }),
    );
    const api = makeApi();
    const el = { id: "el-1", type: "rectangle", version: 1, versionNonce: 1 };
    (api.getSceneElements as ReturnType<typeof vi.fn>).mockReturnValue([el]);
    (api.getAppState as ReturnType<typeof vi.fn>).mockReturnValue({ viewBackgroundColor: "#fff" });
    const { result, unmount } = await dialAndWelcome(api);

    const ok = await act(async () => result.current.saveToGallery());
    expect(ok).toBe(true);

    const drawings = await getDrawings();
    expect(drawings).toHaveLength(1);
    expect(drawings[0].id).toBe(`room-${SHARE_ID}`);
    const full = await getDrawingFullData(`room-${SHARE_ID}`);
    expect(JSON.parse(full.elements)).toEqual([el]);
    expect(JSON.parse(full.appState)).toEqual({ viewBackgroundColor: "#fff" });
    unmount();
  });

  test("leave() closes the client and drops the session cache", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);
    await act(async () => {
      result.current.leave();
    });
    expect(ws.readyState).toBe(3); // closed
    expect(result.current.conn).toBe("idle");
    expect(await loadSession(SHARE_ID)).toBeUndefined();
    unmount();
  });
});
