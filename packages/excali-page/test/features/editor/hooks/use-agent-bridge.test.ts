import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAgentBridge } from "@/features/editor/hooks/use-agent-bridge";
import {
	AB_ACTIVATE,
	AB_DEACTIVATE,
	AB_DISPLACED,
	AB_READY,
	AB_STATE,
	AGENT_BRIDGE_STORAGE_KEY,
	PROFILE_ID_STORAGE_KEY,
} from "excali-shared";

// ---------------------------------------------------------------------------
// Hoisted harness: a stable fake browser (same object every getBrowser() call),
// a scriptable runtime + storage, and a mock of the WS client lib.
// ---------------------------------------------------------------------------

const harness = vi.hoisted(() => {
  const swState = {
    swInstanceId: "sw-1",
    activeTabId: null as number | null,
    myTabId: 1,
    sendMessages: [] as unknown[],
    runtimeListeners: [] as Array<(msg: unknown) => void>,
    storageListeners: [] as Array<
      (changes: Record<string, { newValue?: unknown }>, area: string) => void
    >,
    storage: {} as Record<string, unknown>,
  };

  const stateReply = () => ({
    type: AB_STATE,
    swInstanceId: swState.swInstanceId,
    activeTabId: swState.activeTabId,
    isActive: swState.activeTabId === swState.myTabId,
  });

  const browser = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: swState.storage[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) =>
          Object.assign(swState.storage, obj),
        ),
      },
      onChanged: {
        addListener: vi.fn(
          (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void) =>
            swState.storageListeners.push(fn),
        ),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((fn: (msg: unknown) => void) =>
          swState.runtimeListeners.push(fn),
        ),
        removeListener: vi.fn(),
      },
      sendMessage: vi.fn((msg: { type: string }) => {
        swState.sendMessages.push(msg);
        if (msg.type === AB_READY || msg.type === "AGENT_BRIDGE_HEARTBEAT") {
          return Promise.resolve(stateReply());
        }
        if (msg.type === AB_ACTIVATE) return Promise.resolve({ granted: true });
        if (msg.type === AB_DEACTIVATE) return Promise.resolve(true);
        return Promise.resolve(undefined);
      }),
    },
  };

  class MockSession {
	static instances: MockSession[] = [];
	opts: {
	  onStatus?: (s: string, info?: unknown) => void;
	  onInbound?: (msg: Record<string, unknown>) => void;
	  role?: string;
	  profileId?: string;
	};
	started = false;
	stopped = false;
	currentStatus = "idle";
	sent: unknown[] = [];
	constructor(opts: {
	  onStatus?: (s: string, info?: unknown) => void;
	  onInbound?: (msg: Record<string, unknown>) => void;
	  role?: string;
	  profileId?: string;
	}) {
	  this.opts = opts;
	  MockSession.instances.push(this);
    }
    start() {
	  this.started = true;
    }
    stop() {
	  this.stopped = true;
	  this.currentStatus = "stopped";
    }
    ping() {
	  return Promise.resolve(true);
    }
    sendJSON(obj: unknown) {
	  this.sent.push(obj);
    }
  }

  return { swState, browser, MockSession };
});

vi.mock("@/lib/utils", () => ({
	getBrowser: () => harness.browser,
}));

// The canvas/v1 helpers import the patched-tgz module (its dev chunk has
// extensionless imports vitest can't resolve) — the dispatcher's real
// behavior is covered by canvas-v1 unit tests with injected fakes.
vi.mock("@/features/editor/lib/canvas-v1-helpers", () => ({
	buildCanvasV1Helpers: () => ({
	  convertToExcalidrawElements: vi.fn(),
	  getCommonBounds: vi.fn(),
	  exportPng: vi.fn(),
	  exportSvg: vi.fn(),
	}),
}));

vi.mock("@/features/editor/lib/agent-bridge-client", () => ({
  AgentBridgeSession: harness.MockSession,
  AgentBridgeClient: class {},
  findBridgePort: vi.fn(),
}));

// The gallery dispatcher is PURE — use the real one with mocked IndexedDB so
// hook tests observe the genuine inbound → confirm-gate → response path.
vi.mock("@/features/editor/utils/indexdb", () => ({
  getDrawings: vi.fn(async () => []),
  getDrawingFullData: vi.fn(),
  getCollections: vi.fn(async () => []),
  saveDrawing: vi.fn(),
  updateDrawing: vi.fn(),
  deleteDrawing: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
}));
vi.mock("@/features/editor/utils/excalidraw-api.helper", () => ({
  loadDrawingToScene: vi.fn(),
}));
vi.mock("@/features/gallery/hooks/use-thumbnail", () => ({
  useThumbnail: () => ({ generateThumbnail: vi.fn(async () => "data:image/webp;base64,x") }),
}));
vi.mock("@/features/gallery/hooks/use-gallery", () => ({
  useGallery: () => ({ setCurrentLoadedDrawingId: vi.fn() }),
}));

const renderLocal = (excalidrawAPI: unknown = {}) =>
  renderHook(() =>
    useAgentBridge({ excalidrawAPI: excalidrawAPI as never, editorType: "local" }),
  );

const renderQuick = () =>
  renderHook(() =>
    useAgentBridge({ excalidrawAPI: {} as never, editorType: "quick" }),
  );

const broadcast = (state: {
  swInstanceId: string;
  activeTabId: number | null;
  isActive: boolean;
}) => {
  act(() => {
    for (const fn of harness.swState.runtimeListeners) {
      fn({ type: AB_STATE, ...state });
    }
  });
};

const setConsent = (master: boolean, pairing: boolean) => {
  harness.swState.storage[AGENT_BRIDGE_STORAGE_KEY] = { master, pairing };
};

// The control session is dialed FIRST (paired, no activation) — the active
// session only exists after activation. Select by role; the effect may
// re-create sessions when deps flip, so prefer the LATEST instance.
const controlSession = () =>
  [...harness.MockSession.instances].reverse().find((s) => s.opts.role === "control-page");
const activeSession = () =>
  [...harness.MockSession.instances].reverse().find((s) => s.opts.role !== "control-page");

const fireStorageChange = (master: boolean, pairing: boolean) => {
  act(() => {
    for (const fn of harness.swState.storageListeners) {
      fn(
        {
          [AGENT_BRIDGE_STORAGE_KEY]: {
            newValue: { master, pairing },
          },
        },
        "local",
      );
    }
  });
};

beforeEach(() => {
  harness.swState.swInstanceId = "sw-1";
  harness.swState.activeTabId = null;
  harness.swState.sendMessages = [];
  harness.swState.runtimeListeners = [];
  harness.swState.storageListeners = [];
  harness.swState.storage = {};
  harness.MockSession.instances = [];
  window.excaliAPI = undefined;
  delete window.excaliAPI;
});

describe("useAgentBridge", () => {
  test("default: master OFF → kill-switch — no agent UI state, registers with SW only", async () => {
    const { result } = renderLocal();
    await waitFor(() => expect(harness.swState.sendMessages.length).toBeGreaterThan(0));
    expect(harness.swState.sendMessages[0]).toEqual({ type: AB_READY });
    expect(result.current.masterOn).toBe(false);
    expect(result.current.paired).toBe(false);
    expect(result.current.canActivate).toBe(false);
    expect(result.current.isActive).toBe(false);
  });

  test("master ON + paired → canActivate, toggle visible", async () => {
    setConsent(true, true);
    const { result } = renderLocal();
    await waitFor(() => expect(result.current.masterOn).toBe(true));
    expect(result.current.paired).toBe(true);
    expect(result.current.canActivate).toBe(true);
  });

  test("activation flow: toggle → first-time confirm → ACTIVATE → STATE(isActive) → WS session + window.excaliAPI", async () => {
    setConsent(true, true);
    const api = { updateScene: vi.fn() };
    const { result } = renderLocal(api);
    await waitFor(() => expect(result.current.canActivate).toBe(true));

    act(() => result.current.toggleActivation());
    expect(result.current.showConfirm).toBe(true); // first-time-per-connection

    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
        true,
      ),
    );
    expect(result.current.showConfirm).toBe(false);

    // SW grants + broadcasts STATE active for this tab
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));

    // WS sessions started (control on paired + active on activation) +
    // window.excaliAPI exposed with the excalidrawAPI
    expect(harness.MockSession.instances.length).toBeGreaterThan(0);
    expect(harness.MockSession.instances.every((s) => s.started)).toBe(true);
    expect(window.excaliAPI?.excalidrawAPI).toBe(api);
  });

  test("deactivate: toggle when active sends DEACTIVATE and drops WS + API", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));
    act(() => result.current.toggleActivation());
    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
        true,
      ),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));
    expect(window.excaliAPI).toBeDefined();

    act(() => result.current.toggleActivation());
    expect(
      harness.swState.sendMessages.some((m: any) => m.type === AB_DEACTIVATE),
    ).toBe(true);
    await waitFor(() => expect(result.current.isActive).toBe(false));
    await waitFor(() => expect(window.excaliAPI).toBeUndefined());
  });

  test("single-active-canvas invariant: another tab activating deactivates this one", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));
    act(() => result.current.toggleActivation());
    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
        true,
      ),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));
    expect(window.excaliAPI).toBeDefined();

    // tab B activates → SW broadcasts STATE active elsewhere
    broadcast({ swInstanceId: "sw-1", activeTabId: 2, isActive: false });
    await waitFor(() => expect(window.excaliAPI).toBeUndefined());
    // The ACTIVE session stops; the CONTROL session persists (still paired).
    expect(activeSession()!.stopped).toBe(true);
    expect(controlSession()!.stopped).toBe(false);
  });

  test("kill-switch: master OFF tears everything down immediately", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));
    act(() => result.current.toggleActivation());
    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
        true,
      ),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));
    expect(window.excaliAPI).toBeDefined();

    fireStorageChange(false, false); // Layer 0 kill-switch
    await waitFor(() => expect(result.current.masterOn).toBe(false));
    await waitFor(() => expect(result.current.canActivate).toBe(false));
    await waitFor(() => expect(window.excaliAPI).toBeUndefined());
    expect(harness.MockSession.instances[0].stopped).toBe(true);
  });

  test("unpair (Gate 1 off) also tears down control", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));
    act(() => result.current.toggleActivation());
    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
        true,
      ),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));

    fireStorageChange(true, false);
    await waitFor(() => expect(result.current.paired).toBe(false));
    await waitFor(() => expect(result.current.canActivate).toBe(false));
    await waitFor(() => expect(window.excaliAPI).toBeUndefined());
  });

  test("SW restart: registry wiped → page offers one-click re-activate, never silent", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));
    act(() => result.current.toggleActivation());
    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
        true,
      ),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));
    expect(result.current.swRestartOffer).toBe(false);

    // new SW instance boots: registry wiped, broadcasts inactive
    broadcast({ swInstanceId: "sw-2", activeTabId: null, isActive: false });
    await waitFor(() => expect(result.current.swRestartOffer).toBe(true));
    await waitFor(() => expect(result.current.isActive).toBe(false));

    // one-click re-activate
    act(() => result.current.acceptReconnect());
    await waitFor(() => expect(result.current.swRestartOffer).toBe(false));
    expect(
      harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE),
    ).toBe(true);
  });

  test("stale activation after page reload: SW points at this tab but no session → DEACTIVATE", async () => {
    setConsent(true, true);
    // SW registry survived (activeTabId is us) but this fresh page boot has no session
    harness.swState.activeTabId = 1;
    renderLocal({});
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_DEACTIVATE)).toBe(
        true,
      ),
    );
  });

  test("Quick editor never activates and never talks to the SW", async () => {
    setConsent(true, true);
    const { result } = renderQuick();
    await waitFor(() => expect(result.current.canActivate).toBe(false));
    act(() => result.current.toggleActivation());
    expect(
      harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE),
    ).toBe(false);
    expect(result.current.isActive).toBe(false);
  });

  test("activation failure: SW unreachable → onActivateError('transport')", async () => {
    setConsent(true, true);
    const original = harness.browser.runtime.sendMessage.getMockImplementation();
    harness.browser.runtime.sendMessage.mockImplementation(() =>
      Promise.reject(new Error("no SW")),
    );
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAgentBridge({
        excalidrawAPI: {} as never,
        editorType: "local",
        onActivateError: onError,
      }),
    );
    try {
      await waitFor(() => expect(result.current.canActivate).toBe(true));
      act(() => result.current.toggleActivation());
      act(() => result.current.confirmActivation());
      await waitFor(() => expect(onError).toHaveBeenCalledWith("transport"));
    } finally {
      harness.browser.runtime.sendMessage.mockImplementation(original);
	}
  });

  test("displaced: daemon takes the slot (another profile) → session stops, AB_DISPLACED to SW, UI flips", async () => {
	setConsent(true, true);
	const { result } = renderLocal({});
	await waitFor(() => expect(result.current.canActivate).toBe(true));
	act(() => result.current.toggleActivation());
	act(() => result.current.confirmActivation());
	await waitFor(() =>
	  expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
	    true,
	  ),
	);
	broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
	await waitFor(() => expect(result.current.isActive).toBe(true));
	expect(window.excaliAPI).toBeDefined();

	// The daemon sends {type:"displaced"} on the live WS → the hook must stop
	// the ACTIVE session (no reconnect), tell the SW (AB_DISPLACED), flip the UI.
	act(() => {
	  activeSession()!.opts.onInbound?.({ type: "displaced" });
	});
	await waitFor(() => expect(result.current.isActive).toBe(false));
	expect(result.current.displaced).toBe(true);
	expect(activeSession()!.stopped).toBe(true);
	// The control connection is untouched by active-slot displacement.
	expect(controlSession()!.stopped).toBe(false);
	expect(
	  harness.swState.sendMessages.some((m: any) => m.type === AB_DISPLACED),
	).toBe(true);
	await waitFor(() => expect(window.excaliAPI).toBeUndefined());

	// Re-activating clears the displaced notice.
	act(() => result.current.toggleActivation());
	act(() => result.current.confirmActivation());
	await waitFor(() => expect(result.current.displaced).toBe(false));
  });

  test("inbound canvas/v1 RPC: dispatches to excalidrawAPI, sends the correlated response", async () => {
	setConsent(true, true);
	const api = {
	  getSceneElements: () => [{ id: "a" }],
	  getAppState: () => ({}),
	  getFiles: () => ({}),
	};
	const { result } = renderLocal(api);
	await waitFor(() => expect(result.current.canActivate).toBe(true));
	act(() => result.current.toggleActivation());
	act(() => result.current.confirmActivation());
	await waitFor(() =>
	  expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
	    true,
	  ),
	);
	broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
	await waitFor(() => expect(result.current.isActive).toBe(true));

	const session = harness.MockSession.instances[0];
	await act(async () => {
	  session.opts.onInbound?.({ jsonrpc: "2.0", id: 5, method: "scene.get", params: {} });
	});
	await waitFor(() => expect(session.sent.length).toBeGreaterThan(0));
	expect(session.sent[0]).toMatchObject({
	  jsonrpc: "2.0",
	  id: 5,
	  result: { elements: [{ id: "a" }], appState: {}, files: {} },
	});
	expect(session.sent[0].error).toBeUndefined();
  });

  test("inbound destructive RPC: fires the one-shot destructive flash", async () => {
	setConsent(true, true);
	const api = {
	  updateScene: vi.fn(),
	  resetScene: vi.fn(),
	  history: { clear: vi.fn() },
	  getSceneElements: () => [],
	  getAppState: () => ({}),
	  getFiles: () => ({}),
	};
	const { result } = renderLocal(api);
	await waitFor(() => expect(result.current.canActivate).toBe(true));
	act(() => result.current.toggleActivation());
	act(() => result.current.confirmActivation());
	await waitFor(() =>
	  expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(
	    true,
	  ),
	);
	broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
	await waitFor(() => expect(result.current.isActive).toBe(true));

	const session = activeSession()!;
	await act(async () => {
	  session.opts.onInbound?.({ jsonrpc: "2.0", id: 6, method: "elements.clear", params: {} });
	});
	await waitFor(() => expect(result.current.destructiveFlash).not.toBeNull());
	expect(result.current.destructiveFlash?.method).toBe("elements.clear");
	expect(api.updateScene).toHaveBeenCalledWith({ elements: [], captureUpdate: "IMMEDIATELY" });

	// Flash auto-clears.
	await waitFor(() => expect(result.current.destructiveFlash).toBeNull(), { timeout: 3000 });
  });

  // ------------------------------------------------------------------
  // Goal 3 — paired-control connection (Option A)
  // ------------------------------------------------------------------

  test("paired (master+paired) dials a CONTROL session WITHOUT activation", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.masterOn).toBe(true));
    await waitFor(() => expect(controlSession()).toBeDefined());

    // Control session present + started, role control-page, no activation.
    expect(controlSession()!.opts.role).toBe("control-page");
    expect(controlSession()!.started).toBe(true);
    expect(activeSession()).toBeUndefined();
    expect(result.current.isActive).toBe(false);
    expect(window.excaliAPI).toBeUndefined(); // control only — no excaliAPI
  });

  test("profileId is minted once and persisted in chrome.storage.local", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.profileId).not.toBeNull());
    // Minted lazily on first need and persisted.
    expect(harness.browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [PROFILE_ID_STORAGE_KEY]: result.current.profileId,
      }),
    );
    // A second hook (another tab, same profile) reuses the persisted id.
    const firstId = result.current.profileId;
    const { result: second } = renderLocal({});
    await waitFor(() => expect(second.current.profileId).toBe(firstId));
  });

  test("control connection dispatches gallery/v1 (real dispatcher, mocked IndexedDB)", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(controlSession()).toBeDefined());

    const session = controlSession()!;
    await act(async () => {
      session.opts.onInbound?.({ jsonrpc: "2.0", id: 7, method: "gallery.list", params: {} });
    });
    await waitFor(() => expect(session.sent.length).toBeGreaterThan(0));
    expect(session.sent[0]).toMatchObject({ jsonrpc: "2.0", id: 7, result: [] });
    expect(session.sent[0].error).toBeUndefined();
  });

  test("blocking gallery op shows the confirm modal; confirm executes, cancel returns -32005", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(controlSession()).toBeDefined());
    const session = controlSession()!;

    // gallery.delete is BLOCKING → the confirm gate fires; the request stays
    // pending until the user decides (page-side UX gate, 013/014).
    await act(async () => {
      session.opts.onInbound?.({ jsonrpc: "2.0", id: 8, method: "gallery.delete", params: { id: "d1" } });
    });
    await waitFor(() => expect(result.current.galleryConfirm).not.toBeNull());
    expect(result.current.galleryConfirm?.method).toBe("gallery.delete");
    expect(result.current.galleryConfirm?.params).toEqual({ id: "d1" });
    expect(session.sent.length).toBe(0); // still pending

    // User confirms → the op executes and the correlated response goes back.
    act(() => result.current.confirmGallery());
    await waitFor(() => expect(session.sent.length).toBeGreaterThan(0));
    expect(session.sent[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 8,
      result: { id: "d1", deleted: true },
    });
    await waitFor(() => expect(result.current.galleryConfirm).toBeNull());
  });

  test("blocking gallery op cancelled → -32005 cancelled by user", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(controlSession()).toBeDefined());
    const session = controlSession()!;

    await act(async () => {
      session.opts.onInbound?.({ jsonrpc: "2.0", id: 9, method: "gallery.delete", params: { id: "d2" } });
    });
    await waitFor(() => expect(result.current.galleryConfirm).not.toBeNull());

    act(() => result.current.cancelGallery());
    await waitFor(() => expect(session.sent.length).toBe(1));
    expect(session.sent[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32005, message: expect.stringContaining("cancelled") },
    });
    await waitFor(() => expect(result.current.galleryConfirm).toBeNull());
  });

  test("control connection displaced (same-profile newer dial) → session stops, no reconnect", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(controlSession()).toBeDefined());
    const session = controlSession()!;

    act(() => {
      session.opts.onInbound?.({ type: "displaced" });
    });
    expect(session.stopped).toBe(true);
    // Displacing the control connection must NOT touch activation state.
    expect(result.current.isActive).toBe(false);
    expect(result.current.displaced).toBe(false);
  });
});
