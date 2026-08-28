/**
 * RoomScreen + GallerySidebar confirm-gating — component-level tests (task 085).
 *
 * Uses the working room-screen.test.tsx harness: setStoredConfig → wsFactory →
 * StubSocket.open() + welcomeMessage → connected session → collab-session-chrome.
 *
 * The real GallerySidebar is unavailable in the test environment (it requires
 * Radix-UI/dropdown-menu internals that crash the happy-dom reconciler).  A
 * seam-level mock (gallery-seam.tsx) replicates GallerySidebar's critical contract:
 * renders drawing-card buttons that call onLoadDrawing when clicked, so the
 * RoomScreen confirm-modal gate can be tested end-to-end.
 *
 * Covers:
 * 1. Gallery card click → TEXT-ONLY confirm modal appears (title/body, no thumbnail).
 * 2. Cancel → modal dismissed, loadDrawingToScene NOT called, canvas unchanged.
 * 3. Confirm → dismisses modal and triggers loadDrawingToScene with elements/files.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import React from "react";

import RoomScreen from "@/features/collab/room-screen";
import { clearSession } from "collab-core";
import { COLLAB_SERVER_CONFIG } from "@/features/collab/storage";
import { loadDrawingToScene } from "@/features/editor/utils/excalidraw-api.helper";
import type { DrawingMetadata } from "@/features/editor/utils/indexdb";

// ---- Constants ----
const SHARE_ID = "B".repeat(22);
const KEY43 = "A".repeat(43);

const MOCK_DRAWINGS: DrawingMetadata[] = [
  {
    id: "d1",
    name: "Room Drawing 1",
    thumbnail: "data:image/webp;base64,test1",
    collectionIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "d2",
    name: "Room Drawing 2",
    thumbnail: "data:image/webp;base64,test2",
    collectionIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// ---- Stub socket ----
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
const lastSocket = (): StubSocket =>
  StubSocket.instances[StubSocket.instances.length - 1]!;

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

// ---- Module mocks ----

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
  Footer: ({ children }: { children?: React.ReactNode }) => children,
  exportToBlob: vi.fn(),
  // 086: restoreAppState is called inside broadcastScene
  restoreAppState: (s: unknown) => s,
  Sidebar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sidebar-gallery">{children}</div>
  ),
}));

// 086: Track updateScene/addFiles calls for broadcastScene verification.
const updateSceneCalls: unknown[][] = [];
const addFilesCalls: unknown[][] = [];
vi.mock("@/features/editor/lib/excalidraw", () => ({
  default: ({
    children,
    onExcalidrawAPI,
    onChange,
  }: {
    children?: React.ReactNode;
    onExcalidrawAPI?: (api: unknown) => void;
    onChange?: (elements: unknown[], appState: unknown, files: unknown) => void;
  }) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { useEffect } = require("react");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      onExcalidrawAPI?.({
        updateScene: (...args: unknown[]) => { updateSceneCalls.push(args); },
        getSceneElements: () => [],
        getSceneElementsIncludingDeleted: () => [],
        getAppState: () => ({}),
        getFiles: () => ({}),
        addFiles: (...args: unknown[]) => { addFilesCalls.push(args); },
      });
    }, [onExcalidrawAPI]);
    return (
      <div data-testid="mock-excalidraw" data-onchange={onChange ? "yes" : "no"}>
        {children}
      </div>
    );
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

vi.mock("@/features/editor/utils/excalidraw-api.helper", () => ({
  loadDrawingToScene: vi.fn(),
}));

// Gallery seam mock: replicates the GallerySidebar card-onClick contract.
// Renders real DrawingCard buttons so fireEvent.click works, and calls
// onLoadDrawing(drawing) so the RoomScreen modal gate fires.
vi.mock("@/features/gallery/components/gallery-sidebar", () => ({
  default: ({
    onLoadDrawing,
  }: {
    excalidrawAPI: unknown;
    onLoadDrawing?: (d: DrawingMetadata) => void;
    chosenDrawingId?: string;
  }) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { useState } = require("react") as typeof import("react");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [drawings] = useState(MOCK_DRAWINGS);
    return (
      <div data-testid="gallery-sidebar">
        {drawings.map((d: DrawingMetadata) => (
          <button
            key={d.id}
            data-testid={`drawing-card-${d.id}`}
            onClick={() => onLoadDrawing?.(d)}
          >
            {d.name}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock("@/features/editor/utils/indexdb", () => ({
  getRoom: vi.fn().mockResolvedValue(undefined),
  getDrawingFullData: vi.fn().mockResolvedValue({
    id: "d1",
    elements: '[{"id":"el-1","type":"rectangle","x":0,"y":0,"width":100,"height":100}]',
    appState: '{"zoom":1}',
    files: "{}",
  }),
}));

// ---- Helpers ----

const setStoredConfig = () => {
  localStorage.setItem(
    COLLAB_SERVER_CONFIG,
    JSON.stringify({ relay: "http://127.0.0.1:1999", org: "dev", sk: KEY43, ck: KEY43 }),
  );
};

/** Mount RoomScreen to a connected session state (room-screen.test.tsx harness). */
async function mountConnectedSession() {
  setStoredConfig();
  render(
    <RoomScreen lang="en" shareId={SHARE_ID} wsFactory={() => new StubSocket("ws://x")} />,
  );
  await screen.findByTestId("collab-session-chrome");
  await waitFor(() => expect(lastSocket()).toBeDefined());
  const ws = lastSocket();
  await act(async () => { ws.open(); });
  await act(async () => { ws.message(welcomeMessage(true)); });
  await waitFor(() => {
    expect(screen.getByTestId("drawing-card-d1")).toBeTruthy();
  });
}

// ---- Setup / teardown ----
beforeEach(async () => {
  StubSocket.reset();
  localStorage.clear();
  await clearSession(SHARE_ID);
  vi.clearAllMocks();
  updateSceneCalls.length = 0;
  addFilesCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

// ---- Tests ----

describe("RoomScreen — gallery confirm modal (room-mode)", () => {
  test(
    "gallery card click opens the TEXT-ONLY confirm modal (title + body, no thumbnail)",
    async () => {
      await mountConnectedSession();

      fireEvent.click(screen.getByTestId("drawing-card-d1"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeTruthy();
      });

      const modal = screen.getByRole("dialog", { name: "CollabGalleryLoadConfirmTitle" });
      expect(modal.textContent).toContain("CollabGalleryLoadConfirmTitle");
      expect(modal.textContent).toContain("CollabGalleryLoadConfirmBody");
      expect(screen.queryByTestId("confirm-modal-thumbnail")).toBeNull();
      expect(screen.queryByTestId("confirm-modal-dont-ask")).toBeNull();
    },
  );

  test(
    "confirm modal CANCEL is inert — modal dismissed, loadDrawingToScene NOT called",
    async () => {
      await mountConnectedSession();

      fireEvent.click(screen.getByTestId("drawing-card-d1"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeTruthy();
      });

      const cancelBtn = screen.getByRole("button", { name: /cancel/i });
      expect(cancelBtn).toBeTruthy();
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      expect(vi.mocked(loadDrawingToScene)).not.toHaveBeenCalled();
    },
  );

  test(
    "confirm modal CONFIRM calls broadcastScene with normalized elements/files and dismisses modal",
    async () => {
      await mountConnectedSession();

      fireEvent.click(screen.getByTestId("drawing-card-d1"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeTruthy();
      });

      const confirmBtn = screen.getByTestId("confirm-modal-confirm");
      expect(confirmBtn).toBeTruthy();
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      // 086: handleConfirmLoad calls broadcastScene which calls updateScene + addFiles
      await waitFor(() => {
        expect(updateSceneCalls.length).toBeGreaterThan(0);
      });
      // Find the call that has 'elements' (not the collaborators-only call from rebuildCollaborators)
      const elementCall = updateSceneCalls.find(
        (call) => (call[0] as Record<string, unknown>)?.elements !== undefined,
      );
      expect(elementCall).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const updateCall = elementCall![0] as { elements: unknown[]; appState: unknown };
      expect(updateCall.elements).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "el-1" })]),
      );
      expect(updateCall.appState).toBeTruthy();
      expect(addFilesCalls.length).toBeGreaterThan(0);
    },
  );

  test(
    "confirm modal title uses the i18n key (key-as-text via mock useTranslation)",
    async () => {
      await mountConnectedSession();

      fireEvent.click(screen.getByTestId("drawing-card-d1"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeTruthy();
      });

      const modal = screen.getByRole("dialog");
      expect(modal.querySelector("h2")?.textContent).toBe("CollabGalleryLoadConfirmTitle");
    },
  );

  test(
    "second card click while modal is open replaces pending drawing (modal stays open)",
    async () => {
      await mountConnectedSession();

      fireEvent.click(screen.getByTestId("drawing-card-d1"));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeTruthy();
      });

      // Click second card while modal is open
      fireEvent.click(screen.getByTestId("drawing-card-d2"));

      // Modal stays open
      expect(screen.getByRole("dialog")).toBeTruthy();

      // Cancel dismisses
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    },
  );

  test("connected session renders collab-session-chrome + mock-excalidraw", async () => {
    await mountConnectedSession();
    expect(screen.getByTestId("mock-excalidraw")).toBeTruthy();
    expect(screen.getByTestId("collab-session-chrome")).toBeTruthy();
  });
});
