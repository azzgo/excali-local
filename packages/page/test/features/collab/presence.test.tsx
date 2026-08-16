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
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as excalidraw from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { deriveColor } from "collab-core";
import type { Member } from "collab-core";
import { LABEL_MODE_KEY, formatLabel, shortProfileId } from "@/features/collab/labels";
import { PresenceFeed } from "@/features/collab/presence";
import { useCollabSession } from "@/features/collab/use-collab-session";
import type {
  CollabIdentity,
  CollabRoomMeta,
  CollabSessionHandle,
  RosterMember,
} from "@/features/collab/use-collab-session";
import type { LabelMode } from "@/features/collab/labels";
import type { ServerConfig } from "@/features/collab/storage";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
  exportToBlob: vi.fn(),
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
    connect: vi.fn(),
    leave: vi.fn(),
    seed: vi.fn(),
    saveToGallery: vi.fn(async () => true),
    onLocalChange: vi.fn(),
    onLocalPointer: vi.fn(),
    ...overrides,
  };
}

const renderFeed = (session: CollabSessionHandle = makeSession()) =>
  render(<PresenceFeed session={session} />);

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
  test("full mode → `名·短id` (e.g. Ada·a3f, CJK names included)", () => {
    expect(formatLabel("Ada", "a3f9c2d1", "full")).toBe("Ada · a3f");
    expect(formatLabel("王小明", "9c1d2e3f", "full")).toBe("王小明 · 9c1");
  });

  test("quiet mode → short id only (username omitted, 055)", () => {
    expect(formatLabel("Ada", "a3f9c2d1", "quiet")).toBe("a3f");
    expect(formatLabel("王小明", "9c1d2e3f", "quiet")).toBe("9c1");
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

    // avatar dot = the member's 055 native color (deriveColor result)
    const dotMin = screen.getByTestId("collab-feed-dot-a3f9c2d1");
    expect((dotMin as HTMLElement).style.background).toBe("hsl(220, 100%, 83%)");
    // full labels: 名·短id
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("Min · a3f");
    expect(screen.getByTestId("collab-feed-label-9c1d2e3f").textContent).toBe("王小明 · 9c1");
    // self row is labeled "You"
    expect(screen.getByTestId("collab-feed-label-self-1").textContent).toBe("CollabYou");
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
    // the departed row lingers for the fade window at opacity 0
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

/* ------------------------------------------------------------------ */
/* label-mode toggle (055: 最全 default, quiet persists)                */
/* ------------------------------------------------------------------ */

describe("PresenceFeed — label mode toggle", () => {
  test("default is full; toggling quiet flips chips to short ids and persists", async () => {
    renderFeed();
    // default 最全 → full chips
    expect(screen.getByTestId("collab-label-mode-full").dataset.active).toBe("true");
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("Min · a3f");

    fireEvent.click(screen.getByTestId("collab-label-mode-quiet"));
    expect(screen.getByTestId("collab-label-mode-quiet").dataset.active).toBe("true");
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("a3f");
    // persisted (localStorage on the test path — getBrowser() is null)
    expect(JSON.parse(localStorage.getItem(LABEL_MODE_KEY) ?? "")).toBe("quiet");

    // back to full
    fireEvent.click(screen.getByTestId("collab-label-mode-full"));
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("Min · a3f");
    expect(JSON.parse(localStorage.getItem(LABEL_MODE_KEY) ?? "")).toBe("full");
  });

  test("a fresh mount hydrates the persisted mode (quiet survives)", async () => {
    localStorage.setItem(LABEL_MODE_KEY, JSON.stringify("quiet"));
    renderFeed();
    await waitFor(() =>
      expect(screen.getByTestId("collab-label-mode-quiet").dataset.active).toBe("true"),
    );
    expect(screen.getByTestId("collab-feed-label-a3f9c2d1").textContent).toBe("a3f");
  });
});

/* ------------------------------------------------------------------ */
/* cursor wiring (real hook, stub socket)                               */
/* ------------------------------------------------------------------ */

/** Stub socket (collab-core client.test.ts pattern). */
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

const KEY43 = "A".repeat(43);
const SERVER: ServerConfig = {
  relay: "http://127.0.0.1:1999",
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

function makeApi(): ExcalidrawImperativeAPI {
  return {
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
  } as unknown as ExcalidrawImperativeAPI;
}

/** Harness — the real useCollabSession under test. */
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
  return { handle: handle as unknown as CollabSessionHandle, unmount, ws };
}

describe("presence — cursor wiring (collaborators map, 049 §5 / 055)", () => {
  beforeEach(() => {
    StubSocket.reset();
  });

  test("welcome builds the collaborators map with id/username/color/socketId", async () => {
    const api = makeApi();
    const { unmount } = await renderHookHarness(api);

    // The FIRST updateScene with a collaborators Map may be the pre-welcome
    // empty map (hook boot); take the LAST one — welcome's rebuild.
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
    // 055: the local cursor is never a collaborator
    expect(call.collaborators.has("profile-1")).toBe(false);
    unmount();
  });

  test("a remote pointer lands in the collaborators map (updateScene)", async () => {
    const api = makeApi();
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

  test("quiet label mode omits username from the collaborators map; full re-adds it", async () => {
    const api = makeApi();
    const { unmount } = await renderHookHarness(api, "quiet");
    const lastCall = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(lastCall.collaborators.get("profile-2").username).toBeUndefined();
    unmount();
  });

  test("onLocalPointer broadcasts our own cursor (trailing-edge throttled, latest wins)", async () => {
    const api = makeApi();
    const { handle, unmount, ws } = await renderHookHarness(api);

    vi.useFakeTimers();
    act(() => {
      handle.onLocalPointer({ pointer: { x: 10, y: 20, tool: "pointer" }, button: "down" });
      handle.onLocalPointer({ pointer: { x: 30, y: 40, tool: "pointer" }, button: "up" });
    });
    // throttle window: nothing on the wire yet
    expect(ws.sent.filter((s) => isEnvelope(s, "pointer"))).toHaveLength(0);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const pointers = ws.sent.filter((s) => isEnvelope(s, "pointer"));
    expect(pointers).toHaveLength(1); // coalesced — the latest wins
    expect(JSON.parse(pointers[0]).p).toEqual({ x: 30, y: 40, tool: "pointer", button: "up" });
    vi.useRealTimers();
    unmount();
  });
});
