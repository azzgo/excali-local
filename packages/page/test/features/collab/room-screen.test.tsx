/**
 * RoomScreen tests (task 044 — the session surface for `#room/<shareId>`).
 *
 * Excalidraw is mocked (the tgz module cannot mount in happy-dom) — the mock
 * hands the imperative API to the screen so the session hook connects; the
 * WebSocket transport is stubbed via the injected wsFactory. The room meta
 * comes from the REAL `excali` DB (fake-indexeddb via setup.ts) and the
 * session cache is real.
 *
 * Covers: boot states (loading / no server configured / invalid shareId),
 * the chrome above the canvas, the conn-banner slot seam (046/047), and the
 * seed prompt for an empty room (rule C) with seed broadcast.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import RoomScreen from "@/features/collab/room-screen";
import { clearSession } from "collab-core";
import { COLLAB_SERVER_CONFIG } from "@/features/collab/storage";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
  exportToBlob: vi.fn(),
}));

// The lazy Excalidraw wrapper — a stub that exposes a minimal imperative API
// so the session hook can connect and apply scenes.
vi.mock("@/features/editor/lib/excalidraw", () => ({
  default: ({
    onExcalidrawAPI,
    onChange,
  }: {
    onExcalidrawAPI?: (api: unknown) => void;
    onChange?: (elements: unknown[], appState: unknown, files: unknown) => void;
  }) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { useEffect } = require("react");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      onExcalidrawAPI?.({
        updateScene: vi.fn(),
        getSceneElements: () => [],
        getSceneElementsIncludingDeleted: () => [],
        getAppState: () => ({}),
        getFiles: () => ({}),
        addFiles: () => {},
      });
    }, [onExcalidrawAPI]);
    return <div data-testid="mock-excalidraw" data-onchange={onChange ? "yes" : "no"} />;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const KEY43 = "A".repeat(43);
const SHARE_ID = "B".repeat(22);

const setStoredConfig = () => {
  localStorage.setItem(
    COLLAB_SERVER_CONFIG,
    JSON.stringify({ relay: "http://127.0.0.1:1999", org: "dev", sk: KEY43, ck: KEY43 }),
  );
};

/** Stub socket (collab-core client.test.ts pattern). */
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

const lastSocket = () => StubSocket.instances[StubSocket.instances.length - 1];
const welcomeMessage = (snapshotAvailable: boolean): string =>
  JSON.stringify({
    v: 1,
    t: "welcome",
    p: {
      profileId: "any",
      connId: "conn-1",
      room: SHARE_ID,
      privacy: "team",
      snapshotAvailable,
      peers: [],
    },
  });

beforeEach(async () => {
  StubSocket.reset();
  localStorage.clear();
  await clearSession(SHARE_ID);
});

afterEach(() => {
  cleanup();
});

describe("RoomScreen — boot states", () => {
  test("no server configured → notice + shareId, no session", async () => {
    render(<RoomScreen lang="en" shareId={SHARE_ID} />);
    await screen.findByText("CollabLandingNoServer");
    expect(screen.getByTestId("collab-room")).toBeTruthy();
    expect(screen.getByTestId("collab-room-shareid").textContent).toBe(SHARE_ID);
    expect(screen.queryByTestId("collab-session-chrome")).toBeNull();
    expect(screen.queryByTestId("mock-excalidraw")).toBeNull();
  });

  test("malformed shareId → invalid-room card", async () => {
    setStoredConfig();
    render(<RoomScreen lang="en" shareId="not a token!" />);
    await screen.findByText("CollabInvalidInvite");
    expect(screen.queryByTestId("mock-excalidraw")).toBeNull();
  });

  test("configured → chrome above the canvas + banner slot seam", async () => {
    setStoredConfig();
    render(<RoomScreen lang="en" shareId={SHARE_ID} wsFactory={() => new StubSocket("ws://x")} />);
    await screen.findByTestId("collab-session-chrome");
    // the room label defaults to the short shareId (no stored room entry)
    expect(screen.getByTestId("collab-room-label").textContent).toBe(SHARE_ID.slice(0, 6));
    // canvas mounts below the chrome; 046/047 banner strip reserved
    expect(screen.getByTestId("mock-excalidraw")).toBeTruthy();
    expect(screen.getByTestId("collab-conn-banner-slot")).toBeTruthy();
    // the session dials the room WS
    await waitFor(() => expect(lastSocket()).toBeDefined());
  });
});

describe("RoomScreen — session + seed prompt", () => {
  test("empty room (no snapshot, no cache) → seed prompt; Start blank seeds", async () => {
    setStoredConfig();
    render(
      <RoomScreen lang="en" shareId={SHARE_ID} wsFactory={() => new StubSocket("ws://x")} />,
    );
    await screen.findByTestId("collab-session-chrome");
    await waitFor(() => expect(lastSocket()).toBeDefined());
    const ws = lastSocket();
    await act(async () => {
      ws.open();
    });
    await act(async () => {
      ws.message(welcomeMessage(false)); // snapshotAvailable:false → seed offer
    });

    await screen.findByTestId("collab-seed-prompt");
    expect(screen.getByText("CollabSeedTitle")).toBeTruthy();

    fireEvent.click(screen.getByTestId("collab-seed-blank"));
    await waitFor(() =>
      expect(ws.sent.some((s) => JSON.parse(s).t === "seed")).toBe(true),
    );
    // prompt dismissed after the seed
    await waitFor(() => expect(screen.queryByTestId("collab-seed-prompt")).toBeNull());
  });

  test("cached scene auto-seeds an empty room — no prompt (061 rule B)", async () => {
    setStoredConfig();
    render(
      <RoomScreen lang="en" shareId={SHARE_ID} wsFactory={() => new StubSocket("ws://x")} />,
    );
    await screen.findByTestId("collab-session-chrome");
    await waitFor(() => expect(lastSocket()).toBeDefined());
    const ws = lastSocket();
    await act(async () => {
      ws.open();
    });
    await act(async () => {
      ws.message(welcomeMessage(true)); // alive room with a snapshot
    });
    await act(async () => {
      ws.message(
        JSON.stringify({
          v: 1,
          t: "scene",
          p: { elements: [{ id: "el-1", type: "rectangle" }], seq: 1 },
          from: "conn-1",
        }),
      );
    });
    // snapshot applied to the canvas → chrome renders; no seed prompt
    await waitFor(() =>
      expect(
        (screen.getByTestId("mock-excalidraw").dataset as Record<string, string>).onchange,
      ).toBeDefined(),
    );
    expect(screen.queryByTestId("collab-seed-prompt")).toBeNull();
  });
});
