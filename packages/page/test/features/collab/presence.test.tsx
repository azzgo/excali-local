/**
 * Presence tests (task 045 — Wayfinder 055).
 *
 * Covers:
 * - formatLabel / shortProfileId in both label modes (pure unit).
 * - PresenceFeed: rows with 055 derived colors, full labels (`名·短id`),
 *   self-outline ring, fade-out of departed members (~250ms).
 * - The label-mode toggle: default 最全 → quiet flips the chips to short ids
 *   and persists (localStorage on the test path); a fresh mount hydrates.
 * - Cursor wiring through the REAL session hook (stub socket + fake api):
 *   the collaborators map carries {id, username, color, socketId} per peer,
 *   remote pointers land in the map, quiet mode omits `username`, and
 *   onLocalPointer broadcasts our own cursor (trailing-edge throttled).
 *
 * Task 082: presence row dual actions + Present self toggle:
 * - non-self rows: hover reveals jump + follow icons
 * - jump grayed when no lastKnownViewport; enabled + calls applyViewport when present
 * - follow icon only on presenting rows; clicking toggles follow (setFollowTarget)
 * - self row: Present toggle (startPresenting/stopPresenting)
 * - SessionChrome (via PresenceFeed) stays interactive while presentingSelf
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as excalidraw from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { deriveColor } from "collab-core";
import type { Member } from "collab-core";
import { LABEL_MODE_KEY, formatLabel, shortProfileId } from "@/features/collab/labels";
import { PresenceFeed, pickJumpTarget } from "@/features/collab/presence";
import { useCollabSession } from "@/features/collab/use-collab-session";
import type {
  CollabIdentity,
  CollabRoomMeta,
  CollabSessionHandle,
  RosterMember,
} from "@/features/collab/use-collab-session";
import type { LabelMode } from "@/features/collab/labels";
import type { ServerConfig } from "@/features/collab/storage";
import { mintTestIdentity } from "./helpers";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
  exportToBlob: vi.fn(),
  default: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

const SHARE_ID = "B".repeat(22);

const PEERS: RosterMember[] = [
  { profileId: "self-1", name: "Ada", color: "hsl(0, 100%, 83%)", connId: "conn-self", self: true },
  { profileId: "a3f9c2d1", name: "Min", color: "hsl(220, 100%, 83%)", connId: "conn-a", self: false },
  { profileId: "9c1d2e3f", name: "王小明", color: "hsl(40, 100%, 83%)", connId: "conn-b", self: false },
];

function makeApi(): ExcalidrawImperativeAPI {
  return {
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
  } as unknown as ExcalidrawImperativeAPI;
}

function makeSession(overrides: Partial<CollabSessionHandle> = {}): CollabSessionHandle {
  return {
    ready: true,
    conn: "connected",
    live: true,
    reconnect: null,
    lastError: null,
    lastSyncedAt: null,
    snapshotAvailable: true,
    emptyRoom: false,
    peers: PEERS,
    hadOfflineEdits: false,
    resets: null,
    roomName: null,
    rename: vi.fn(() => true),
    selfName: "Ada",
    renameSelf: vi.fn(() => true),
    connect: vi.fn(),
    leave: vi.fn(),
    seed: vi.fn(),
    broadcastScene: vi.fn(),
    onLocalChange: vi.fn(),
    onLocalPointer: vi.fn(),
    missingFileIds: new Set(),
    onLocalViewportChange: vi.fn(),
    // 080
    presentingSelf: false,
    followTargetId: null,
    startPresenting: vi.fn(),
    stopPresenting: vi.fn(),
    setFollowTarget: vi.fn(),
    ...overrides,
  };
}

const renderFeed = (
  session: CollabSessionHandle = makeSession(),
  props: { onEditSelfName?: () => void; excalidrawAPI?: ExcalidrawImperativeAPI | null } = {},
) =>
  render(<PresenceFeed session={session} {...props} />);

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* formatLabel (both modes)                                             */
/* ------------------------------------------------------------------ */

describe("presence — formatLabel", () => {
  test("formatLabel is always `名·短id` (075 — quiet only gates the UserList)", () => {
    expect(formatLabel("Ada", "a3f9c2d1")).toBe("Ada · a3f");
    expect(formatLabel("王小明", "9c1d2e3f")).toBe("王小明 · 9c1");
  });

  test("shortProfileId takes the first 3 chars", () => {
    expect(shortProfileId("a3f9c2d1")).toBe("a3f");
  });
});

/* ------------------------------------------------------------------ */
/* PresenceFeed list                                                    */
/* ------------------------------------------------------------------ */

describe("PresenceFeed — collaborators list (055)", () => {
  test("renders every member with the derived color dot + full label", () => {
    renderFeed();
    const rows = screen.getAllByTestId(/^collab-feed-row-/);
    expect(rows).toHaveLength(3);

    const dotMin = screen.getByTestId("collab-feed-dot-a3f9c2d1");
    expect((dotMin as HTMLElement).style.background).toBe("hsl(220, 100%, 83%)");
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("Min · a3f");
    expect(screen.getByTestId("collab-feed-label-9c1d2e3f").textContent).toBe("王小明 · 9c1");
    expect(screen.getByTestId("collab-feed-label-self-1").textContent).toBe("AdaCollabSelfMarker");
  });

  test("self row is outlined (055)", () => {
    renderFeed();
    const selfRow = screen.getByTestId("collab-feed-row-self-1");
    expect(selfRow.dataset.self).toBe("true");
    const selfDot = screen.getByTestId("collab-feed-dot-self-1");
    expect(selfDot.className).toContain("ring-2");
    expect(screen.getByTestId("collab-feed-row-a3f9c2d1").dataset.self).toBeUndefined();
  });

  test("departed members fade out (~250ms) then leave the list", async () => {
    const session = makeSession();
    const { rerender } = renderFeed(session);
    expect(screen.getAllByTestId(/^collab-feed-row-/)).toHaveLength(3);

    rerender(<PresenceFeed session={makeSession({ peers: PEERS.slice(0, 2) })} />);
    const gone = screen.getByTestId("collab-feed-row-9c1d2e3f");
    expect(gone.className).toContain("opacity-0");
    await waitFor(
      () => expect(screen.queryByTestId("collab-feed-row-9c1d2e3f")).toBeNull(),
      { timeout: 1000 },
    );
  });

  test("empty roster shows the empty note", () => {
    renderFeed(makeSession({ peers: [] }));
    expect(screen.getByTestId("collab-feed-empty")).toBeTruthy();
    expect(screen.queryByTestId("collab-feed-list")).toBeNull();
  });
});

describe("PresenceFeed — self-name edit (ADR 0006)", () => {
  test("self row has an edit button that calls onEditSelfName", () => {
    const onEditSelfName = vi.fn();
    renderFeed(makeSession({ selfName: "Ada Prime" }), { onEditSelfName });
    const editButton = screen.getByTestId("collab-selfname-edit");
    expect(editButton).toBeTruthy();
    fireEvent.click(editButton);
    expect(onEditSelfName).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* label-mode toggle (055: 最全 default, quiet persists)                */
/* ------------------------------------------------------------------ */

describe("PresenceFeed — show-user-list checkbox (075)", () => {
  test("default is checked (full); unchecking hides the UserList (quiet) and persists", async () => {
    renderFeed();
    const checkbox = screen.getByTestId("collab-show-userlist-checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(checkbox.dataset.checked).toBe("true");
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("Min · a3f");

    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(checkbox.dataset.checked).toBeUndefined();
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("Min · a3f");
    expect(JSON.parse(localStorage.getItem(LABEL_MODE_KEY) ?? "")).toBe("quiet");

    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(localStorage.getItem(LABEL_MODE_KEY) ?? "")).toBe("full");
  });

  test("a fresh mount hydrates the persisted mode (quiet survives → unchecked)", async () => {
    localStorage.setItem(LABEL_MODE_KEY, JSON.stringify("quiet"));
    renderFeed();
    await waitFor(() =>
      expect(screen.getByTestId("collab-show-userlist-checkbox").getAttribute("aria-checked")).toBe("false"),
    );
  });
});

/* ------------------------------------------------------------------ */
/* cursor wiring (real hook, stub socket)                               */
/* ------------------------------------------------------------------ */

class StubSocket {
  readyState = 0;
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

const KEY43 = "A".repeat(43);
const SERVER: ServerConfig = {
  relay: "http://127.0.0.1:1999",
  org: "dev",
  sk: KEY43,
  ck: KEY43,
};
const ROOM: CollabRoomMeta = {
  label: "Q3 planning",
  labelKind: "named",
  tier: "team",
  invite: { shareId: SHARE_ID, tier: "team" },
};
const IDENTITY: CollabIdentity = await mintTestIdentity();
const PEER: Member = {
  profileId: "profile-2",
  name: "Min",
  color: { background: "hsl(220, 100%, 83%)", stroke: "hsl(220, 100%, 83%)" },
  connId: "conn-2",
};

const lastSocket = () => StubSocket.instances[StubSocket.instances.length - 1];

const welcomeMessage = (peers: Member[] = []): string =>
  JSON.stringify({
    v: 1,
    t: "welcome",
    p: {
      profileId: IDENTITY.profileId,
      connId: "conn-1",
      room: SHARE_ID,
      privacy: "team",
      snapshotAvailable: true,
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

function makeApiReal(): ExcalidrawImperativeAPI {
  return {
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
  } as unknown as ExcalidrawImperativeAPI;
}

function HookHarness({
  labelMode,
  api,
  onHandle,
}: {
  labelMode?: LabelMode;
  api: ExcalidrawImperativeAPI;
  onHandle: (session: CollabSessionHandle) => void;
}) {
  const session = useCollabSession({
    shareId: SHARE_ID,
    server: SERVER,
    room: ROOM,
    excalidrawAPI: api,
    identity: IDENTITY,
    wsFactory: (url: string) => new StubSocket(url),
    labelMode,
  });
  const onHandleRef = useRef(onHandle);
  onHandleRef.current = onHandle;
  useEffect(() => {
    onHandleRef.current(session);
  });
  return null;
}

async function renderHookHarness(api: ExcalidrawImperativeAPI, labelMode?: LabelMode) {
  let handle: CollabSessionHandle | null = null;
  const { unmount } = render(
    <HookHarness labelMode={labelMode} api={api} onHandle={(s) => (handle = s)} />,
  );
  await waitFor(() => expect(lastSocket()).toBeDefined());
  const ws = lastSocket();
  await act(async () => {
    ws.open();
  });
  expect(isEnvelope(ws.sent[0] ?? "", "hello")).toBe(true);
  await act(async () => {
    ws.message(welcomeMessage([PEER]));
  });
  await waitFor(() => expect(handle).not.toBeNull());
  const latest = () => handle as unknown as CollabSessionHandle;
  return { handle: latest(), latest, unmount, ws };
}

describe("presence — cursor wiring (collaborators map, 049 §5 / 055)", () => {
  beforeEach(() => {
    StubSocket.reset();
  });

  test("welcome builds the collaborators map with id/username/color/socketId", async () => {
    const api = makeApiReal();
    const { unmount } = await renderHookHarness(api);

    const mapCalls = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { collaborators?: unknown })?.collaborators instanceof Map,
    );
    const call = mapCalls[mapCalls.length - 1]?.[0] as {
      collaborators: Map<string, unknown>;
    };
    const collaborator = call.collaborators.get("profile-2");
    expect(collaborator).toMatchObject({
      id: "profile-2",
      username: "Min",
      color: {
        background: deriveColor("profile-2"),
        stroke: deriveColor("profile-2"),
      },
      socketId: "profile-2",
    });
    expect(call.collaborators.has("profile-1")).toBe(true);
    const self = call.collaborators.get("profile-1") as { pointer?: unknown };
    expect(self.pointer).toBeUndefined();
    unmount();
  });

  test("a remote pointer lands in the collaborators map (updateScene)", async () => {
    const api = makeApiReal();
    const { unmount, ws } = await renderHookHarness(api);
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

  test("a remote pointer records the peer's last-known pointer on the roster (082 — jump target)", async () => {
    const api = makeApiReal();
    const { latest, unmount, ws } = await renderHookHarness(api);

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
    const p2 = latest().peers.find((p) => p.profileId === "profile-2");
    expect(p2?.lastKnownPointer).toEqual({ x: 120, y: 340 });
    // later pointer frames update the ref twin, not React state (no re-render
    // storm on the ~16ms pointer stream)
    await act(async () => {
      ws.message(
        JSON.stringify({
          v: 1,
          t: "pointer",
          p: { x: 999, y: 888, tool: "pointer" },
          from: "conn-2",
        }),
      );
    });
    const p2Again = latest().peers.find((p) => p.profileId === "profile-2");
    expect(p2Again?.lastKnownPointer).toEqual({ x: 120, y: 340 });
    unmount();
  });

  test("onLocalPointer broadcasts our own cursor (trailing-edge throttled, latest wins)", async () => {
    const api = makeApiReal();
    const { handle, unmount, ws } = await renderHookHarness(api);

    vi.useFakeTimers();
    act(() => {
      handle.onLocalPointer({ pointer: { x: 10, y: 20, tool: "pointer" }, button: "down" });
      handle.onLocalPointer({ pointer: { x: 30, y: 40, tool: "pointer" }, button: "up" });
    });
    expect(ws.sent.filter((s) => isEnvelope(s, "pointer"))).toHaveLength(0);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const pointers = ws.sent.filter((s) => isEnvelope(s, "pointer"));
    expect(pointers).toHaveLength(1);
    expect(JSON.parse(pointers[0]).p).toEqual({ x: 30, y: 40, tool: "pointer", button: "up" });
    vi.useRealTimers();
    unmount();
  });
});

/* ------------------------------------------------------------------ */
/* task 082: presence row dual actions + Present self toggle           */
/* ------------------------------------------------------------------ */

describe("PresenceFeed — row actions (082: cursor jump + follow toggle)", () => {
  const selfRow: RosterMember = {
    profileId: "self-1", name: "Ada", color: "hsl(0, 100%, 83%)", connId: "conn-self", self: true,
  };
  const presenterWithViewport: RosterMember = {
    profileId: "a3f9c2d1", name: "Min", color: "hsl(220, 100%, 83%)",
    connId: "conn-a", self: false, presenting: true,
    lastKnownViewport: { x: 100, y: 200, z: 1 },
  };
  const peerWithPointer: RosterMember = {
    profileId: "9c1d2e3f", name: "王小明", color: "hsl(40, 100%, 83%)",
    connId: "conn-b", self: false,
    lastKnownPointer: { x: 40, y: 60 },
  };
  const peerWithoutData: RosterMember = {
    profileId: "8f8f8f8f", name: "Zoe", color: "hsl(10, 100%, 83%)",
    connId: "conn-c", self: false,
  };

  test("hover reveals dual icons on non-self row", () => {
    const session = makeSession({
      peers: [selfRow, presenterWithViewport, peerWithPointer],
    });
    renderFeed(session, { excalidrawAPI: makeApi() });

    // Icons hidden by default
    expect(screen.queryByTestId("collab-row-jump-a3f9c2d1")).toBeNull();
    expect(screen.queryByTestId("collab-row-follow-a3f9c2d1")).toBeNull();

    // Hover row → icons appear
    const row = screen.getByTestId("collab-feed-row-a3f9c2d1");
    fireEvent.mouseEnter(row);
    expect(screen.getByTestId("collab-row-jump-a3f9c2d1")).toBeTruthy();
    expect(screen.getByTestId("collab-row-follow-a3f9c2d1")).toBeTruthy();
  });

  test("jump icon is disabled/grayed when the row has neither viewport nor pointer", () => {
    const session = makeSession({
      peers: [selfRow, presenterWithViewport, peerWithoutData],
    });
    renderFeed(session, { excalidrawAPI: makeApi() });

    const row = screen.getByTestId("collab-feed-row-8f8f8f8f");
    fireEvent.mouseEnter(row);
    const jumpBtn = screen.getByTestId("collab-row-jump-8f8f8f8f");
    expect(jumpBtn).toBeTruthy();
    expect(jumpBtn.getAttribute("aria-disabled")).toBe("true");
  });

  test("jump enabled for a presenter with a live viewport; clicking applies it once", () => {
    const api = makeApi();
    const session = makeSession({
      peers: [selfRow, presenterWithViewport, peerWithPointer],
    });
    renderFeed(session, { excalidrawAPI: api });

    const row = screen.getByTestId("collab-feed-row-a3f9c2d1");
    fireEvent.mouseEnter(row);
    const jumpBtn = screen.getByTestId("collab-row-jump-a3f9c2d1");
    expect(jumpBtn).toBeTruthy();
    expect(jumpBtn.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(jumpBtn);
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    const call = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.appState.scrollX).toBe(100);
    expect(call.appState.scrollY).toBe(200);
    expect(call.appState.zoom.value).toBe(1);
  });

  test("jump enabled for a NON-presenting member with a known pointer; the hop keeps the current zoom", () => {
    const api = makeApi();
    (api.getAppState as ReturnType<typeof vi.fn>).mockReturnValue({ zoom: { value: 2 } });
    const session = makeSession({
      peers: [selfRow, peerWithPointer],
    });
    renderFeed(session, { excalidrawAPI: api });

    const row = screen.getByTestId("collab-feed-row-9c1d2e3f");
    fireEvent.mouseEnter(row);
    const jumpBtn = screen.getByTestId("collab-row-jump-9c1d2e3f");
    expect(jumpBtn.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(jumpBtn);
    const call = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // hop lands on the LAST KNOWN POINTER position (055 stream)
    expect(call.appState.scrollX).toBe(40);
    expect(call.appState.scrollY).toBe(60);
    // the jumper's own zoom is kept (no z on pointer hops, ADR 0008)
    expect(call.appState.zoom.value).toBe(2);
  });

  test("jump disabled when the row itself has no data — even when it is the follow target", () => {
    const presentingNoData: RosterMember = {
      ...peerWithoutData, presenting: true,
    };
    const session = makeSession({
      peers: [selfRow, presentingNoData],
      followTargetId: "8f8f8f8f",
    });
    renderFeed(session, { excalidrawAPI: makeApi() });

    const row = screen.getByTestId("collab-feed-row-8f8f8f8f");
    fireEvent.mouseEnter(row);
    const jumpBtn = screen.getByTestId("collab-row-jump-8f8f8f8f");
    expect(jumpBtn.getAttribute("aria-disabled")).toBe("true");
  });

  test("jump uses the CLICKED row's own viewport — never the follow target's (follow B, click A → A)", () => {
    const api = makeApi();
    const session = makeSession({
      // following 9c1d2e3f (B), clicking a3f9c2d1 (A): A's presenter viewport must win
      peers: [selfRow, presenterWithViewport, peerWithPointer],
      followTargetId: "9c1d2e3f",
    });
    renderFeed(session, { excalidrawAPI: api });

    const row = screen.getByTestId("collab-feed-row-a3f9c2d1");
    fireEvent.mouseEnter(row);
    const jumpBtn = screen.getByTestId("collab-row-jump-a3f9c2d1");
    fireEvent.click(jumpBtn);
    const call = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.appState.scrollX).toBe(100); // A's own viewport
  });

  test("follow icon shown only on presenting rows", () => {
    const session = makeSession({
      peers: [selfRow, presenterWithViewport, peerWithPointer],
    });
    renderFeed(session, { excalidrawAPI: makeApi() });

    // Presenting row: follow icon on hover
    const presentingRow = screen.getByTestId("collab-feed-row-a3f9c2d1");
    fireEvent.mouseEnter(presentingRow);
    expect(screen.getByTestId("collab-row-follow-a3f9c2d1")).toBeTruthy();

    // Non-presenting row: no follow icon on hover
    const nonPresRow = screen.getByTestId("collab-feed-row-9c1d2e3f");
    fireEvent.mouseEnter(nonPresRow);
    expect(screen.queryByTestId("collab-row-follow-9c1d2e3f")).toBeNull();
  });

  test("clicking follow icon calls setFollowTarget(profileId)", () => {
    const session = makeSession({
      peers: [selfRow, presenterWithViewport],
      followTargetId: null,
    });
    renderFeed(session, { excalidrawAPI: makeApi() });

    const row = screen.getByTestId("collab-feed-row-a3f9c2d1");
    fireEvent.mouseEnter(row);
    const followBtn = screen.getByTestId("collab-row-follow-a3f9c2d1");
    fireEvent.click(followBtn);
    expect(session.setFollowTarget).toHaveBeenCalledWith("a3f9c2d1");
  });

  test("following a presenter shows active-follow visual state", () => {
    const session = makeSession({
      peers: [selfRow, presenterWithViewport],
      followTargetId: "a3f9c2d1",
    });
    renderFeed(session, { excalidrawAPI: makeApi() });

    const row = screen.getByTestId("collab-feed-row-a3f9c2d1");
    fireEvent.mouseEnter(row);
    const followBtn = screen.getByTestId("collab-row-follow-a3f9c2d1");
    expect(followBtn.dataset.followActive).toBe("true");
  });

  test("clicking active follow icon calls setFollowTarget(null) (silent unfollow)", () => {
    const session = makeSession({
      peers: [selfRow, presenterWithViewport],
      followTargetId: "a3f9c2d1",
    });
    renderFeed(session, { excalidrawAPI: makeApi() });

    const row = screen.getByTestId("collab-feed-row-a3f9c2d1");
    fireEvent.mouseEnter(row);
    const followBtn = screen.getByTestId("collab-row-follow-a3f9c2d1");
    expect(followBtn.dataset.followActive).toBe("true");
    fireEvent.click(followBtn);
    expect(session.setFollowTarget).toHaveBeenCalledWith(null);
  });
});

/* ------------------------------------------------------------------ */
/* pickJumpTarget — ADR 0008 truth table (pure unit)                   */
/* ------------------------------------------------------------------ */

describe("pickJumpTarget (ADR 0008 cursor-jump rule)", () => {
  const base: RosterMember = {
    profileId: "p1", name: "Min", color: "hsl(220, 100%, 83%)", connId: "c1", self: false,
  };

  test("presenting member → live presenter viewport (zoom carried)", () => {
    const row = {
      ...base,
      presenting: true,
      lastKnownViewport: { x: 11, y: 22, z: 1.5 },
      lastKnownPointer: { x: 1, y: 2 },
    };
    expect(pickJumpTarget(row)).toEqual({ x: 11, y: 22, z: 1.5 });
  });

  test("presenting member without a viewport yet → falls back to last known pointer", () => {
    const row = { ...base, presenting: true, lastKnownPointer: { x: 7, y: 8 } };
    expect(pickJumpTarget(row)).toEqual({ x: 7, y: 8 });
  });

  test("non-presenting member → last known pointer (no zoom)", () => {
    const row = { ...base, lastKnownPointer: { x: 40, y: 60 } };
    expect(pickJumpTarget(row)).toEqual({ x: 40, y: 60 });
  });

  test("a non-presenting member's stale presenter viewport is NOT a jump target (pointer stream only)", () => {
    const row = { ...base, lastKnownViewport: { x: 11, y: 22, z: 1.5 } };
    expect(pickJumpTarget(row)).toBeNull();
  });

  test("nothing known → null (button grayed)", () => {
    expect(pickJumpTarget(base)).toBeNull();
  });
});
