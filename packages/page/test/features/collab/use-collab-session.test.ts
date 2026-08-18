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

// Keep the integration threshold explicit; the policy owns this implementation detail.
const AWAY_RESUME_MS = 5_000;

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
    getSceneElementsIncludingDeleted: vi.fn(() => []),
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

  test("first relay snapshot merges a local edit made before it arrived", async () => {
    const api = makeApi();
    const local = { id: "local", type: "freedraw" };
    const { result, unmount, ws } = await dialAndWelcome(api);
    await act(async () => {
      result.current.onLocalChange([local] as never, {} as never, {});
      ws.message(sceneMessage([], 1));
    });
    expect(api.updateScene).toHaveBeenLastCalledWith({
      elements: [local],
      collaborators: expect.any(Map),
      captureUpdate: "NEVER",
    });
    unmount();
  });

  test("rejects an older scene from the same relay source", async () => {
    const api = makeApi();
    const newer = { id: "newer", type: "rectangle", version: 2, versionNonce: 2 };
    const older = { id: "older", type: "rectangle", version: 1, versionNonce: 1 };
    const { unmount, ws } = await dialAndWelcome(api);
    await act(async () => {
      ws.message(sceneMessage([newer], 5, "conn-2"));
    });
    (api.updateScene as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      ws.message(sceneMessage([older], 4, "conn-2"));
    });
    expect(api.updateScene).not.toHaveBeenCalled();
    unmount();
  });

  test("does not apply the synced baseline over an unsent local edit", async () => {
    const api = makeApi();
    const base = { id: "base", type: "rectangle", version: 1, versionNonce: 1 };
    const local = { id: "local", type: "freedraw" };
    const { result, unmount, ws } = await dialAndWelcome(api);
    await act(async () => {
      ws.message(sceneMessage([base], 1, "conn-1"));
    });
    (api.updateScene as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      result.current.onLocalChange([base, local] as never, {} as never, {});
      ws.message(sceneMessage([base], 2, "conn-2"));
    });
    expect(api.updateScene).not.toHaveBeenCalled();
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

  test("roster survives the resume race: stale leave / rejoin with a fresh connId", async () => {
    const api = makeApi();
    const peer: Member = {
      profileId: "profile-2",
      name: "Min",
      color: { background: "hsl(220, 100%, 83%)", stroke: "hsl(220, 100%, 83%)" },
      connId: "conn-2",
    };
    const { result, unmount, ws } = await dialAndWelcome(api, { peers: [peer] });

    const peerEnvelope = (kind: "join" | "leave", connId: string) =>
      JSON.stringify({
        v: 1,
        t: "peer",
        p: { kind, member: { ...peer, connId } },
      });
    const pointerFrom = (connId: string) =>
      JSON.stringify({
        v: 1,
        t: "pointer",
        p: { x: 10, y: 20, tool: "pointer" },
        from: connId,
      });

    // BOTH orderings of the resume race must converge on the LIVE connId.
    for (const rejoinFirst of [true, false]) {
      if (rejoinFirst) {
        await act(async () => {
          ws.message(peerEnvelope("join", "conn-9")); // rejoin lands first
          ws.message(peerEnvelope("leave", "conn-2")); // stale leave arrives late
        });
      } else {
        await act(async () => {
          ws.message(peerEnvelope("leave", "conn-2")); // leave first…
          ws.message(peerEnvelope("join", "conn-9")); // …then the rejoin
        });
      }

      expect(
        result.current.peers.filter((p) => p.profileId === "profile-2"),
      ).toHaveLength(1);
      expect(
        result.current.peers.find((p) => p.profileId === "profile-2")?.connId,
      ).toBe("conn-9");

      // the LIVE connection's pointers still render — the old code dropped
      // the rejoined member entirely on the late leave (profileId-only evict)
      (api.updateScene as ReturnType<typeof vi.fn>).mockClear();
      await act(async () => {
        ws.message(pointerFrom("conn-9"));
      });
      const call = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(call.collaborators.get("profile-2")).toMatchObject({
        pointer: { x: 10, y: 20, tool: "pointer" },
      });
    }
    unmount();
  });

  test("welcome dedupes repeated same-profile peers (half-open old conn beside the fresh one)", async () => {
    const api = makeApi();
    // Forced-resume window: the relay roster still holds B's half-open OLD
    // connection (conn-2) when the fresh one (conn-9) joins — a fresh
    // welcome echoes BOTH. The roster must keep exactly one (the last).
    const stalePeer: Member = {
      profileId: "profile-2",
      name: "Min",
      color: { background: "hsl(220, 100%, 83%)", stroke: "hsl(220, 100%, 83%)" },
      connId: "conn-2",
    };
    const freshPeer: Member = { ...stalePeer, connId: "conn-9" };
    const { result, unmount, ws } = await dialAndWelcome(api, {
      peers: [stalePeer, freshPeer],
    });

    const entries = result.current.peers.filter((p) => p.profileId === "profile-2");
    expect(entries).toHaveLength(1); // one entry per profileId — no dup keys
    expect(entries[0].connId).toBe("conn-9"); // LAST wins — the fresh conn

    // the stale connection's late leave must NOT evict the live entry
    await act(async () => {
      ws.message(
        JSON.stringify({ v: 1, t: "peer", p: { kind: "leave", member: stalePeer } }),
      );
    });
    expect(
      result.current.peers.filter((p) => p.profileId === "profile-2"),
    ).toHaveLength(1);

    // pointer mapping is tied to the SURVIVING fresh connId
    (api.updateScene as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      ws.message(
        JSON.stringify({
          v: 1,
          t: "pointer",
          p: { x: 5, y: 6, tool: "pointer" },
          from: "conn-9",
        }),
      );
    });
    const call = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(call.collaborators.get("profile-2")).toMatchObject({
      pointer: { x: 5, y: 6, tool: "pointer" },
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
  });
});

/* ------------------------------------------------------------------ */
/* programmatic-update echo guards (the collaborator-update loop)      */
/* ------------------------------------------------------------------ */

describe("use-collab-session — programmatic echo guards", () => {
  const peer: Member = {
    profileId: "profile-2",
    name: "Min",
    color: { background: "hsl(220, 100%, 83%)", stroke: "hsl(220, 100%, 83%)" },
    connId: "conn-2",
  };

  const pointerMessage = (from = "conn-2"): string =>
    JSON.stringify({
      v: 1,
      t: "pointer",
      p: { x: 120, y: 340, tool: "pointer" },
      from,
    });

  test("a collaborator update's DELAYED onChange echo with unchanged elements never rebroadcasts", async () => {
    const api = makeApi();
    const el = { id: "el-1", type: "rectangle", version: 1, versionNonce: 1 };
    const { result, unmount, ws } = await dialAndWelcome(api, { peers: [peer] });

    // remote scene applies, then a GENUINE local edit — the canvas now
    // diverges from the last remote scene, the exact state in which the
    // old guards (timing flag + lastRemoteSceneRef) misclassify
    // collaborator-update echoes as local edits.
    await act(async () => {
      ws.message(sceneMessage([el], 1, "conn-2"));
    });
    const edited = { ...el, version: 2 };
    await act(async () => {
      result.current.onLocalChange([edited] as never, {} as never, {});
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150)); // flush the 100ms sendScene throttle
    });
    const scenesAfterEdit = ws.sent.filter((s) => isEnvelope(s, "scene")).length;
    expect(scenesAfterEdit).toBe(1);

    // remote pointer → updateCollaborators → updateScene({ collaborators }).
    await act(async () => {
      ws.message(pointerMessage());
    });
    const call = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(call.collaborators).toBeInstanceOf(Map);

    // The echo: Excalidraw's onChange for that programmatic updateScene
    // fires from componentDidUpdate — a React Scheduler macrotask AFTER the
    // clearing microtask. Simulate that delayed arrival with the UNCHANGED
    // current element list.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20)); // past the microtask
    });
    await act(async () => {
      result.current.onLocalChange([edited] as never, {} as never, {});
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150)); // past the 100ms throttle
    });
    // No new scene frame — this echo used to rebroadcast the full scene
    // (seq+1) per pointer frame, ping-ponging stale scenes between members.
    expect(ws.sent.filter((s) => isEnvelope(s, "scene"))).toHaveLength(scenesAfterEdit);

    // positive control: a genuine edit (content changes) right after a
    // collaborator update still broadcasts — the guard must never eat one.
    const edited2 = { ...edited, version: 3 };
    await act(async () => {
      ws.message(pointerMessage());
      result.current.onLocalChange([edited2] as never, {} as never, {});
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(ws.sent.filter((s) => isEnvelope(s, "scene"))).toHaveLength(scenesAfterEdit + 1);
    unmount();
  });

  test("appState-only onChange (selection/viewport re-render) never rebroadcasts", async () => {
    const api = makeApi();
    const el = { id: "el-1", type: "rectangle", version: 1, versionNonce: 1 };
    const { result, unmount, ws } = await dialAndWelcome(api);

    await act(async () => {
      ws.message(sceneMessage([el], 1, "conn-2"));
    });
    const edited = { ...el, version: 2 };
    await act(async () => {
      result.current.onLocalChange([edited] as never, {} as never, {});
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    const scenesAfterEdit = ws.sent.filter((s) => isEnvelope(s, "scene")).length;

    // selection change / scroll re-render: same elements, new appState.
    await act(async () => {
      result.current.onLocalChange([edited] as never, { selectedElementIds: { "el-1": true } } as never, {});
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(ws.sent.filter((s) => isEnvelope(s, "scene"))).toHaveLength(scenesAfterEdit);
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

describe("use-collab-session — 056 Q6 admission freeze + live gate", () => {
  test("live is false until the socket opens, true once connected (banner gate)", async () => {
    const api = makeApi();
    const { result, unmount } = renderHook(() =>
      useCollabSession(makeHookOptions(api)),
    );
    await waitFor(() => expect(lastSocket()).toBeDefined());
    expect(result.current.live).toBe(false);
    const ws = lastSocket();
    await act(async () => {
      ws.open();
    });
    await act(async () => {
      ws.message(welcomeMessage());
    });
    await waitFor(() => expect(result.current.live).toBe(true));
    unmount();
  });

  test("config change under a live session does NOT re-dial (admission frozen)", async () => {
    const api = makeApi();
    const OTHER: ServerConfig = {
      relay: "https://other.example.com",
      org: "other",
      sk: KEY43,
      ck: KEY43,
    };
    const { result, rerender, unmount } = renderHook(
      (props: { server: ServerConfig }) =>
        useCollabSession({ ...makeHookOptions(api), server: props.server }),
      { initialProps: { server: SERVER } },
    );
    await waitFor(() => expect(lastSocket()).toBeDefined());
    const ws = lastSocket();
    await act(async () => {
      ws.open();
    });
    await act(async () => {
      ws.message(welcomeMessage());
    });
    await waitFor(() => expect(result.current.live).toBe(true));
    expect(isEnvelope(ws.sent[0] ?? "", "hello")).toBe(true);

    // Options switched servers while this session was live — the hook
    // must NOT tear down or re-dial (056 Q6: no auto-reconnect, no auto-
    // close; the amber banner + manual Reload is the only path).
    const socketsBefore = StubSocket.instances.length;
    await act(async () => {
      rerender({ server: OTHER });
    });
    expect(StubSocket.instances).toHaveLength(socketsBefore);
    expect(result.current.conn).toBe("connected");
    expect(result.current.live).toBe(true);
    unmount();
  });
});

/* ------------------------------------------------------------------ */
/* background/foreground resume (stale-socket recovery)                */
/* ------------------------------------------------------------------ */

describe("use-collab-session — background resume", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
  };

  const dispatchVisibility = () =>
    document.dispatchEvent(new Event("visibilitychange"));

  const dispatchPageShow = (persisted: boolean) => {
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: persisted });
    window.dispatchEvent(event);
  };

  const dispatchBlur = () => window.dispatchEvent(new Event("blur"));
  const dispatchFocus = () => window.dispatchEvent(new Event("focus"));

  /** Hide now, return to visible `elapsed` later. Date.now is spied only
   * around the synchronous dispatches — no fake timers, so waitFor/act
   * keep working with real scheduling. */
  const hideAndReturn = async (elapsed: number) => {
    const t0 = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(t0);
    setVisibility("hidden");
    await act(async () => {
      dispatchVisibility();
    });
    spy.mockReturnValue(t0 + elapsed);
    setVisibility("visible");
    await act(async () => {
      dispatchVisibility();
    });
    spy.mockRestore();
  };

  afterEach(() => {
    setVisibility("visible");
  });

  test("hidden ≥ AWAY_RESUME_MS → visible forces one fresh dial and the session recovers", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);
    const socketsBefore = StubSocket.instances.length;

    await hideAndReturn(AWAY_RESUME_MS + 1000);

    await waitFor(() =>
      expect(StubSocket.instances.length).toBe(socketsBefore + 1),
    );
    expect(ws.readyState).toBe(3); // stale socket replaced
    const ws2 = lastSocket();
    await act(async () => {
      ws2.open();
    });
    const hello2 = JSON.parse(ws2.sent[0]);
    expect(hello2.t).toBe("hello");
    expect(hello2.p.profileId).toBe(IDENTITY.profileId); // same identity
    await act(async () => {
      ws2.message(welcomeMessage(true, [], "conn-2"));
    });
    await waitFor(() => expect(result.current.conn).toBe("connected"));
    unmount();
  });

  test("quick hide/visible (< AWAY_RESUME_MS) keeps the live socket", async () => {
    const api = makeApi();
    const { result, unmount } = await dialAndWelcome(api);
    await hideAndReturn(500);
    expect(StubSocket.instances).toHaveLength(1);
    expect(result.current.conn).toBe("connected");
    unmount();
  });

  test("blur → focus with visibilityState staying visible resumes after the threshold (macOS app switch)", async () => {
    const api = makeApi();
    const { unmount, ws } = await dialAndWelcome(api);
    // the window stays on screen while another app is frontmost — never
    // hidden, only blurred. Returning focuses it; no visibilitychange fires.
    setVisibility("visible");

    const t0 = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(t0);
    await act(async () => {
      dispatchBlur();
    });
    spy.mockReturnValue(t0 + AWAY_RESUME_MS + 1000);
    await act(async () => {
      dispatchFocus();
    });
    spy.mockRestore();

    expect(StubSocket.instances).toHaveLength(2); // one fresh dial
    expect(ws.readyState).toBe(3); // stale socket replaced
    unmount();
  });

  test("app-switch return storm: blur/hidden away, focus/visible/pageshow return — exactly one dial", async () => {
    const api = makeApi();
    const { unmount } = await dialAndWelcome(api);
    const t0 = Date.now();
    const spy = vi.spyOn(Date, "now");

    // switching away: blur first, then the window is fully occluded → hidden
    spy.mockReturnValue(t0);
    await act(async () => {
      dispatchBlur();
      setVisibility("hidden");
      dispatchVisibility();
    });

    // returning: focus, visible AND a BFCache pageshow can all fire together
    spy.mockReturnValue(t0 + AWAY_RESUME_MS + 1000);
    setVisibility("visible");
    await act(async () => {
      dispatchFocus();
      dispatchVisibility();
      dispatchPageShow(true);
    });
    spy.mockRestore();

    expect(StubSocket.instances).toHaveLength(2); // exactly one fresh dial
    unmount();
  });

  test("quick blur → focus (< AWAY_RESUME_MS) keeps the live socket", async () => {
    const api = makeApi();
    const { result, unmount } = await dialAndWelcome(api);
    const t0 = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(t0);
    await act(async () => {
      dispatchBlur();
    });
    spy.mockReturnValue(t0 + 500);
    await act(async () => {
      dispatchFocus();
    });
    spy.mockRestore();
    expect(StubSocket.instances).toHaveLength(1);
    expect(result.current.conn).toBe("connected");
    unmount();
  });

  test("BFCache pageshow (persisted=true) resumes; the initial-load pageshow does not", async () => {
    const api = makeApi();
    const { unmount } = await dialAndWelcome(api);

    await act(async () => {
      dispatchPageShow(false); // initial load — never resume
    });
    expect(StubSocket.instances).toHaveLength(1);

    await act(async () => {
      dispatchPageShow(true); // BFCache restore — the world was frozen
    });
    expect(StubSocket.instances).toHaveLength(2);
    unmount();
  });

  test("duplicate restore events within the cooldown do not storm", async () => {
    const api = makeApi();
    const { unmount } = await dialAndWelcome(api);
    const t0 = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(t0);
    setVisibility("hidden");
    await act(async () => {
      dispatchVisibility();
    });
    spy.mockReturnValue(t0 + AWAY_RESUME_MS + 1000);
    setVisibility("visible");
    await act(async () => {
      // visibilitychange + pageshow can BOTH fire on one restore
      dispatchVisibility();
      dispatchPageShow(true);
    });
    spy.mockRestore();
    expect(StubSocket.instances).toHaveLength(2); // exactly one fresh dial
    unmount();
  });

  test("teardown removes the listeners — nothing dials after unmount", async () => {
    const api = makeApi();
    const { unmount } = await dialAndWelcome(api);
    unmount();
    await hideAndReturn(AWAY_RESUME_MS + 1000);
    await act(async () => {
      dispatchPageShow(true);
    });
    expect(StubSocket.instances).toHaveLength(1);
  });

  test("explicit leave() is not resurrected", async () => {
    const api = makeApi();
    const { result, unmount } = await dialAndWelcome(api);
    await act(async () => {
      result.current.leave();
    });
    await hideAndReturn(AWAY_RESUME_MS + 1000);
    expect(StubSocket.instances).toHaveLength(1);
    unmount();
  });

  test("a fatal rejection is not resurrected", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);
    await act(async () => {
      ws.message(
        JSON.stringify({
          v: 1,
          t: "error",
          p: { code: "ADMISSION_INVALID", reason: "bad org", fatal: true },
        }),
      );
    });
    await waitFor(() => expect(result.current.conn).toBe("rejected"));
    await hideAndReturn(AWAY_RESUME_MS + 1000);
    expect(StubSocket.instances).toHaveLength(1);
    unmount();
  });

  test("a fresh welcome clears the stale reconnect hint (061: ladder restarts)", async () => {
    const api = makeApi();
    const { result, unmount, ws } = await dialAndWelcome(api);
    // server drop → retry scheduled → the hint appears next to the conn dot
    await act(async () => {
      ws.close(1006);
    });
    expect(result.current.reconnect).toEqual({ attempt: 0, delayMs: 1000 });

    // the 1s backoff fires → fresh dial → fresh welcome
    await waitFor(() => expect(StubSocket.instances).toHaveLength(2), {
      timeout: 4000,
    });
    const ws2 = lastSocket();
    await act(async () => {
      ws2.open();
    });
    await act(async () => {
      ws2.message(welcomeMessage(true, [], "conn-2"));
    });
    await waitFor(() => expect(result.current.conn).toBe("connected"));
    // the retry hint is gone — it must not linger next to a green dot
    expect(result.current.reconnect).toBeNull();
    unmount();
  });

  test("resume always targets the live client across session-effect re-runs (StrictMode/HMR churn)", async () => {
    const api = makeApi();
    const { result, rerender, unmount } = renderHook(
      (props: { room: CollabRoomMeta }) =>
        useCollabSession({ ...makeHookOptions(api), room: props.room }),
      { initialProps: { room: ROOM } },
    );
    await waitFor(() => expect(lastSocket()).toBeDefined());
    const ws1 = lastSocket();
    await act(async () => {
      ws1.open();
    });
    await act(async () => {
      ws1.message(welcomeMessage());
    });
    await waitFor(() => expect(result.current.conn).toBe("connected"));

    // session-effect re-run (dep identity change — StrictMode/HMR churn):
    // the old client tears down and a fresh one boots through an async gap.
    // First let the effect flush (cleanup ran: clientRef null; the re-run
    // IIFO is awaiting IndexedDB on a macrotask).
    await act(async () => {
      rerender({ room: { ...ROOM } });
    });
    // Fire away→present SYNCHRONOUSLY inside the gap — clientRef.current is
    // null, so the resume must no-op (no crash, no resurrection dial).
    const t0 = Date.now();
    const spy = vi.spyOn(Date, "now");
    await act(async () => {
      spy.mockReturnValue(t0);
      setVisibility("hidden");
      dispatchVisibility();
      spy.mockReturnValue(t0 + AWAY_RESUME_MS + 1000);
      setVisibility("visible");
      dispatchVisibility();
    });
    spy.mockRestore();

    // the re-run effect dials its own fresh client — and ONLY one: the
    // null-window resume above added no extra dial and resurrected nothing
    await waitFor(() => expect(StubSocket.instances).toHaveLength(2));
    expect(ws1.readyState).toBe(3); // the replaced client is closed
    const ws2 = lastSocket();
    await act(async () => {
      ws2.open();
    });
    await act(async () => {
      ws2.message(welcomeMessage(true, [], "conn-live"));
    });
    await waitFor(() => expect(result.current.conn).toBe("connected"));

    // a later away→present resume targets the NEW client — exactly one dial
    await hideAndReturn(AWAY_RESUME_MS + 1000);
    expect(StubSocket.instances).toHaveLength(3);
    expect(ws2.readyState).toBe(3); // its stale socket was replaced
    unmount();
  });
});
