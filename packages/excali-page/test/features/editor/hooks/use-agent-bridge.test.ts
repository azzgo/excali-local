import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getDefaultStore } from "jotai";
import { useAgentBridge } from "@/features/editor/hooks/use-agent-bridge";
import { currentLoadedDrawingIdAtom } from "@/features/gallery/store/gallery-atoms";
import {
	AB_ACTIVATE,
	AB_CANVAS_NAME,
	AB_DEACTIVATE,
	AB_DISPLACED,
	AB_READY,
	AB_STATE,
	AGENT_BRIDGE_STORAGE_KEY,
	AB_BRIDGE_STOP_REQUEST,
	PROFILE_ID_STORAGE_KEY,
} from "excali-shared";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const toastMock = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

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
    request: ReturnType<typeof vi.fn> = vi.fn(() =>
	  Promise.resolve({ ok: true }),
    );
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

// The fonts/v1 page dispatcher touches excali-fonts IndexedDB — mock the db
// exports (the dispatcher itself stays REAL and pure, like gallery/v1).
vi.mock("excali-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("excali-shared")>();
  return {
    ...actual,
    getFontConfig: vi.fn(async () => ({
      handwriting: null,
      normal: null,
      code: { type: "custom", family: "Code Font", data: new Uint8Array([1, 2, 3]) },
    })),
    updateFontSlot: vi.fn(async () => {}),
    clearFontSlot: vi.fn(async () => {}),
  };
});

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

const setConsent = (
  master: boolean,
  pairing: boolean,
  mode: "ws+daemon" | "webmcp" = "ws+daemon",
) => {
  harness.swState.storage[AGENT_BRIDGE_STORAGE_KEY] = {
    master,
    pairing,
    mode,
    hideButton: false,
  };
};

/** Install a fake document.modelContext (WebMCP imperative API) for a test. */
const installModelContext = () => {
  const ctx = {
    registerTool: vi.fn(async (_def: Record<string, unknown>) => {}),
    unregisterTool: vi.fn(async () => {}),
  };
  (document as unknown as { modelContext?: unknown }).modelContext = ctx;
  return ctx;
};

// The control session is dialed FIRST (paired, no activation) — the active
// session only exists after activation. Select by role; the effect may
// re-create sessions when deps flip, so prefer the LATEST instance.
const controlSession = () =>
  [...harness.MockSession.instances].reverse().find((s) => s.opts.role === "control-page");
const activeSession = () =>
  [...harness.MockSession.instances].reverse().find((s) => s.opts.role !== "control-page");

const fireStorageChange = (
  master: boolean,
  pairing: boolean,
  mode: "ws+daemon" | "webmcp" = "ws+daemon",
) => {
  act(() => {
    for (const fn of harness.swState.storageListeners) {
      fn(
        {
          [AGENT_BRIDGE_STORAGE_KEY]: {
            newValue: { master, pairing, mode, hideButton: false },
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
  delete (document as unknown as { modelContext?: unknown }).modelContext;
  getDefaultStore().set(currentLoadedDrawingIdAtom, null);
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

	test("activation race (regression): SW broadcasts STATE(active) while ACTIVATE is in flight → no self-DEACTIVATE, session sticks", async () => {
		setConsent(true, true);
		const api = { updateScene: vi.fn() };
		const { result } = renderLocal(api);
		await waitFor(() => expect(result.current.canActivate).toBe(true));

		// Model the REAL SW ordering: in the SW's ACTIVATE handler,
		// broadcastState() runs BEFORE sendResponse({granted:true}), so the
		// STATE(active) broadcast can arrive while the granted reply is still
		// pending. Defer the ACTIVATE reply to reproduce that window.
		const origImpl = harness.browser.runtime.sendMessage.getMockImplementation();
		let resolveActivate: ((v: unknown) => void) | null = null;
		harness.browser.runtime.sendMessage.mockImplementation(((
			msg: { type: string },
		) => {
			harness.swState.sendMessages.push(msg);
			if (msg.type === AB_ACTIVATE) {
				return new Promise((res) => {
					resolveActivate = () => res({ granted: true });
				});
			}
			if (msg.type === AB_READY || msg.type === "AGENT_BRIDGE_HEARTBEAT") {
				return Promise.resolve({
					type: AB_STATE,
					swInstanceId: harness.swState.swInstanceId,
					activeTabId: harness.swState.activeTabId,
					isActive: harness.swState.activeTabId === harness.swState.myTabId,
				});
			}
			if (msg.type === AB_DEACTIVATE) return Promise.resolve(true);
			return Promise.resolve(undefined);
		}) as never);
		try {
			act(() => result.current.toggleActivation());
			act(() => result.current.confirmActivation()); // ACTIVATE sent, reply pending
			await waitFor(() =>
				expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(true),
			);

			// The broadcast lands BEFORE the granted reply resolves.
			broadcast({ swInstanceId: harness.swState.swInstanceId, activeTabId: 1, isActive: true });
			await act(async () => {
				await Promise.resolve(); // flush microtasks — the bug fired DEACTIVATE here
			});
			expect(harness.swState.sendMessages.some((m: any) => m.type === AB_DEACTIVATE)).toBe(false);

			// The granted reply finally lands; the session must stick.
			act(() => resolveActivate?.({ granted: true }));
			await waitFor(() => expect(result.current.isActive).toBe(true));
			expect(window.excaliAPI?.excalidrawAPI).toBe(api);
			expect(harness.swState.sendMessages.some((m: any) => m.type === AB_DEACTIVATE)).toBe(false);
		} finally {
			harness.browser.runtime.sendMessage.mockImplementation(origImpl as never);
		}
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

  test("SW restart (same consented canvas): silent re-claim — WS session survives, no offer", async () => {
    setConsent(true, true);
    const api = { updateScene: vi.fn() };
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
    expect(result.current.swRestartOffer).toBe(false);
    expect(window.excaliAPI).toBeDefined();

    // New SW instance boots: registry wiped, broadcasts inactive. This canvas
    // was already consented this pairing (034 R1) → the hook re-claims the
    // slot SILENTLY (task 005): no offer banner, isActive NOT flipped false,
    // and the page<->daemon WS data session survives untouched.
    harness.swState.swInstanceId = "sw-2";
    broadcast({ swInstanceId: "sw-2", activeTabId: null, isActive: false });
    await waitFor(() =>
      expect(
        harness.swState.sendMessages.filter((m: any) => m.type === AB_ACTIVATE).length,
      ).toBe(2),
    );
    expect(result.current.swRestartOffer).toBe(false);
    expect(result.current.isActive).toBe(true);
    expect(activeSession()!.stopped).toBe(false);
    expect(window.excaliAPI?.excalidrawAPI).toBe(api);

    // The new SW grants + broadcasts STATE(active) → still active, no ghost
    // DEACTIVATE self-heal (the session was claimed before the broadcast).
    broadcast({ swInstanceId: "sw-2", activeTabId: 1, isActive: true });
    expect(result.current.isActive).toBe(true);
    expect(
      harness.swState.sendMessages.some((m: any) => m.type === AB_DEACTIVATE),
    ).toBe(false);
    expect(activeSession()!.stopped).toBe(false);
  });

  test("SW restart (different / un-consented canvas): offer re-activate, never silent", async () => {
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

    // The active drawing switched to a NOT-yet-consented canvas → a SW restart
    // must NOT silently activate it: old offer + teardown behavior (isActive
    // flips false, WS session stops) — no silent AB_ACTIVATE.
    act(() => getDefaultStore().set(currentLoadedDrawingIdAtom, "drawing-b"));
    harness.swState.swInstanceId = "sw-2";
    broadcast({ swInstanceId: "sw-2", activeTabId: null, isActive: false });
    await waitFor(() => expect(result.current.swRestartOffer).toBe(true));
    await waitFor(() => expect(result.current.isActive).toBe(false));
    expect(activeSession()!.stopped).toBe(true);
    await waitFor(() => expect(window.excaliAPI).toBeUndefined());
    expect(
      harness.swState.sendMessages.filter((m: any) => m.type === AB_ACTIVATE).length,
    ).toBe(1); // only the original activation — nothing silent

    // The offer is still actionable: one-click re-activate clears it and
    // sends a fresh ACTIVATE.
    act(() => result.current.acceptReconnect());
    await waitFor(() => expect(result.current.swRestartOffer).toBe(false));
    expect(
      harness.swState.sendMessages.filter((m: any) => m.type === AB_ACTIVATE).length,
    ).toBe(2);
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
    harness.browser.runtime.sendMessage.mockImplementation((() =>
      Promise.reject(new Error("no SW"))
    ) as never);
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
      harness.browser.runtime.sendMessage.mockImplementation(
        (original ?? (() => Promise.resolve(undefined))) as never,
      );
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
		const response = session.sent[0] as {
		  jsonrpc: string;
		  id: number;
		  result: unknown;
		  error?: unknown;
		};
		expect(response).toMatchObject({
		  jsonrpc: "2.0",
		  id: 5,
		  result: { elements: [{ id: "a" }], appState: {}, files: {} },
		});
		expect(response.error).toBeUndefined();
  });

  test("inbound destructive RPC: fires a sonner toast (no on-page warning)", async () => {
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
	toastMock.warning.mockClear();
	await act(async () => {
	  session.opts.onInbound?.({ jsonrpc: "2.0", id: 6, method: "elements.clear", params: {} });
	});
	// Destructive op → sonner toast (no on-page warning). The hook test's t is
	// the pass-through (returns the key), so the warning carries the locale key.
	expect(toastMock.warning).toHaveBeenCalledWith("AgentDestructiveOp");
	expect(api.updateScene).toHaveBeenCalledWith({ elements: [], captureUpdate: "IMMEDIATELY" });
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
    const galleryResponse = session.sent[0] as { error?: unknown };
    expect(session.sent[0]).toMatchObject({ jsonrpc: "2.0", id: 7, result: [] });
    expect(galleryResponse.error).toBeUndefined();
  });

  test("control connection dispatches fonts/v1 (real dispatcher, mocked excali-fonts db)", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(controlSession()).toBeDefined());
    const session = controlSession()!;

    // fonts.get → trimmed config: the custom code slot keeps family, drops data.
    await act(async () => {
      session.opts.onInbound?.({ jsonrpc: "2.0", id: 11, method: "fonts.get", params: {} });
    });
    await waitFor(() => expect(session.sent.length).toBeGreaterThan(0));
    const resp = session.sent[0] as {
      jsonrpc: string;
      id: number;
      result: { code: { type: string; family: string; data?: unknown } };
      error?: unknown;
    };
    expect(resp.id).toBe(11);
    expect(resp.error).toBeUndefined();
    expect(resp.result.code).toMatchObject({ type: "custom", family: "Code Font" });
    expect(resp.result.code.data).toBeUndefined(); // trimmed — no bytes on the wire
  });

  test("fonts.clear on the control connection shows the blocking confirm modal", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(controlSession()).toBeDefined());
    const session = controlSession()!;

    await act(async () => {
      session.opts.onInbound?.({ jsonrpc: "2.0", id: 12, method: "fonts.clear", params: { slot: "code" } });
    });
    await waitFor(() => expect(result.current.galleryConfirm).not.toBeNull());
    expect(result.current.galleryConfirm?.method).toBe("fonts.clear");

    act(() => result.current.confirmGallery()); // same goal-3 confirm infra
    await waitFor(() => expect(session.sent.length).toBe(1));
    const resp = session.sent[0] as { result: { requiresReload?: boolean } };
    expect(resp.result).toMatchObject({ requiresReload: true });
    expect(session.sent[0]).toMatchObject({ jsonrpc: "2.0", id: 12 });
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

  // ------------------------------------------------------------------
  // Wayfinder 033/034 — redesigned journey (canvas button owns pairing)
  // ------------------------------------------------------------------

  test("hideButton is read from storage and exposed", async () => {
    harness.swState.storage[AGENT_BRIDGE_STORAGE_KEY] = { master: true, pairing: true, hideButton: true };
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.masterOn).toBe(true));
    expect(result.current.hideButton).toBe(true);
  });

  test("quick-enable opens master + pairing together from the canvas button", async () => {
    harness.swState.storage[AGENT_BRIDGE_STORAGE_KEY] = { master: false, pairing: false, hideButton: true };
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.masterOn).toBe(false));

    // One canvas-button action opens both gates (master + pairing); the
    // "enabled but not paired" intermediate state is gone.
    act(() => result.current.quickEnableAgent());
    await waitFor(() => {
      const s = harness.swState.storage[AGENT_BRIDGE_STORAGE_KEY] as Record<string, boolean>;
      expect(s.master).toBe(true);
      expect(s.pairing).toBe(true);
      expect(s.hideButton).toBe(true); // merged, never clobbered
    });

    // pairAgent stays available for the Options path (master ON there resets
    // pairing to false); here it is idempotent.
    act(() => result.current.pairAgent());
    await waitFor(() => {
      const s = harness.swState.storage[AGENT_BRIDGE_STORAGE_KEY] as Record<string, boolean>;
      expect(s.pairing).toBe(true);
      expect(s.hideButton).toBe(true);
    });
  });

  test("otherActive: SW registry points at another canvas", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));
    expect(result.current.otherActive).toBe(false);

    broadcast({ swInstanceId: "sw-1", activeTabId: 2, isActive: false });
    await waitFor(() => expect(result.current.otherActive).toBe(true));

    broadcast({ swInstanceId: "sw-1", activeTabId: null, isActive: false });
    await waitFor(() => expect(result.current.otherActive).toBe(false));
  });

  test("per-canvas consent (034 R1): asks once per canvas, auto after; re-asks on a new canvas", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));

    // canvas A (default "unsaved") — first activation asks.
    act(() => result.current.toggleActivation());
    expect(result.current.showConfirm).toBe(true);
    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(true),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));

    // deactivate, then re-activate the SAME canvas → no modal (auto).
    act(() => result.current.toggleActivation());
    await waitFor(() => expect(result.current.isActive).toBe(false));
    act(() => result.current.toggleActivation());
    expect(result.current.showConfirm).toBe(false);
    await waitFor(() =>
      expect(harness.swState.sendMessages.filter((m: any) => m.type === AB_ACTIVATE).length).toBe(2),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));

    // deactivate + switch to canvas B → the modal asks again.
    act(() => result.current.toggleActivation());
    await waitFor(() => expect(result.current.isActive).toBe(false));
    act(() => getDefaultStore().set(currentLoadedDrawingIdAtom, "drawing-b"));
    act(() => result.current.toggleActivation());
    expect(result.current.showConfirm).toBe(true);
  });

  test("re-pair resets the per-canvas consent map (asks again)", async () => {
    setConsent(true, true);
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));

    act(() => result.current.toggleActivation());
    act(() => result.current.confirmActivation());
    await waitFor(() =>
      expect(harness.swState.sendMessages.some((m: any) => m.type === AB_ACTIVATE)).toBe(true),
    );
    broadcast({ swInstanceId: "sw-1", activeTabId: 1, isActive: true });
    await waitFor(() => expect(result.current.isActive).toBe(true));

    // deactivate; unpair then re-pair (a NEW connection) → consent asks again.
    act(() => result.current.toggleActivation());
    await waitFor(() => expect(result.current.isActive).toBe(false));
    fireStorageChange(true, false); // unpair
    await waitFor(() => expect(result.current.paired).toBe(false));
    fireStorageChange(true, true); // re-pair
    await waitFor(() => expect(result.current.paired).toBe(true));

    act(() => result.current.toggleActivation());
    expect(result.current.showConfirm).toBe(true);
  });

  test("AB_CANVAS_NAME: reports the current canvas name to the popup", async () => {
    setConsent(true, true);
    getDefaultStore().set(currentLoadedDrawingIdAtom, "d1");
    const { result } = renderLocal({});
    await waitFor(() => expect(result.current.canActivate).toBe(true));

    // The gallery DB is mocked (empty) — the fallback is the localized label.
    let reply: unknown;
    act(() => {
      for (const fn of harness.swState.runtimeListeners) {
        (fn as (m: unknown, s: unknown, r: (v: unknown) => void) => void)({ type: AB_CANVAS_NAME }, undefined, (v) => { reply = v; });
      }
    });
    await waitFor(() => expect(reply).toEqual({ name: "New Drawing" }));

    // A saved drawing resolves its real name from the gallery DB.
    const getDrawingsMock = (await import("@/features/editor/utils/indexdb")).getDrawings as ReturnType<typeof vi.fn>;
    getDrawingsMock.mockResolvedValueOnce([
      { id: "d1", name: "My Canvas", thumbnail: "", collectionIds: [], createdAt: 0, updatedAt: 0 },
    ]);
    let reply2: unknown;
    act(() => {
      for (const fn of harness.swState.runtimeListeners) {
        (fn as (m: unknown, s: unknown, r: (v: unknown) => void) => void)({ type: AB_CANVAS_NAME }, undefined, (v) => { reply2 = v; });
      }
    });
    await waitFor(() => expect(reply2).toEqual({ name: "My Canvas" }));
  });

  // ------------------------------------------------------------------
  // 045 — extension-initiated daemon stop (AB_BRIDGE_STOP_REQUEST)
  // ------------------------------------------------------------------

  const fireBridgeStop = (): Promise<unknown> =>
    new Promise((resolve) => {
      act(() => {
        for (const fn of harness.swState.runtimeListeners) {
          (fn as (m: unknown, s: unknown, r: (v: unknown) => void) => void)(
            { type: AB_BRIDGE_STOP_REQUEST },
            undefined,
            resolve,
          );
        }
      });
    });

  test("AB_BRIDGE_STOP_REQUEST: active canvas relays bridge.stop → {ok:true}", async () => {
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

	const session = activeSession()!;
	const reply = await fireBridgeStop();
	expect(reply).toEqual({ ok: true });
	expect(session.request).toHaveBeenCalledWith("bridge.stop", {});
  });

  test("AB_BRIDGE_STOP_REQUEST: no active session → {ok:false, reason:'no-active-session'}", async () => {
	setConsent(true, true);
	const { result } = renderLocal({});
	await waitFor(() => expect(result.current.canActivate).toBe(true));
	// paired but NOT activated → only a control session exists, no active slot.
	expect(activeSession()).toBeUndefined();
	const reply = await fireBridgeStop();
	expect(reply).toEqual({ ok: false, reason: "no-active-session" });
  });

  test("AB_BRIDGE_STOP_REQUEST: daemon error (-32007) → {ok:false, reason}", async () => {
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

	activeSession()!.request.mockResolvedValueOnce({
	  ok: false,
	  reason: "bridge.stop requires the active-page role",
	  code: -32007,
	});
	const reply = await fireBridgeStop();
	expect(reply).toEqual({
	  ok: false,
	  reason: "bridge.stop requires the active-page role",
	});
  });

  // ------------------------------------------------------------------
  // Wayfinder 043/044 — WebMCP exposure + active control route
  // ------------------------------------------------------------------

  test("mode switch (ws+daemon → webmcp): WS sessions tear down, no dials", async () => {
	setConsent(true, true, "ws+daemon");
	const api = { updateScene: vi.fn() };
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
	expect(activeSession()!.stopped).toBe(false);

	// The route flips to webmcp → the WS effect cleanup stops every session
	// (no daemon exists in WebMCP mode); the SW already cleared the registry.
	fireStorageChange(true, true, "webmcp");
	await waitFor(() => expect(result.current.mode).toBe("webmcp"));
	await waitFor(() => expect(activeSession()!.stopped).toBe(true));
	await waitFor(() => expect(controlSession()!.stopped).toBe(true));
	await waitFor(() => expect(window.excaliAPI).toBeUndefined());
  });

  test("AB_MODE_CHANGED relay updates the route without polling", async () => {
	setConsent(true, true, "ws+daemon");
	const { result } = renderLocal({});
	await waitFor(() => expect(result.current.mode).toBe("ws+daemon"));
	act(() => {
	  for (const fn of harness.swState.runtimeListeners) {
	    fn({ type: "AGENT_BRIDGE_MODE_CHANGED", mode: "webmcp" });
	  }
	});
	await waitFor(() => expect(result.current.mode).toBe("webmcp"));
  });

  test("WebMCP register: click-consent flow — registerTool succeeds → registered", async () => {
	setConsent(true, true, "webmcp");
	const ctx = installModelContext();
	const api = { updateScene: vi.fn() };
	const { result } = renderLocal(api);
	await waitFor(() => expect(result.current.mode).toBe("webmcp"));

	expect(result.current.webmcpRegistered).toBe(false);
	await act(async () => {
	  expect(await result.current.registerWebmcp()).toBe(true);
	});
	expect(result.current.webmcpRegistered).toBe(true);
	expect(ctx.registerTool).toHaveBeenCalledTimes(1);
	const def = ctx.registerTool.mock.calls[0]?.[0] as unknown as {
	  name?: string;
	  inputSchema?: { properties?: { method?: { enum?: string[] } } };
	};
	expect(def?.name).toBe("excali_canvas");
	expect(def?.inputSchema?.properties?.method?.enum).toContain("scene.get");
	expect(def?.inputSchema?.properties?.method?.enum).not.toContain("commands.list");
  });

  test("WebMCP register failure: stays unregistered, returns false", async () => {
	setConsent(true, true, "webmcp");
	const ctx = installModelContext();
	ctx.registerTool.mockRejectedValueOnce(new Error("no permission"));
	const { result } = renderLocal({});
	await waitFor(() => expect(result.current.mode).toBe("webmcp"));

	await act(async () => {
	  expect(await result.current.registerWebmcp()).toBe(false);
	});
	expect(result.current.webmcpRegistered).toBe(false);
  });

  test("WebMCP kill-switch: master OFF unregisters immediately", async () => {
	setConsent(true, true, "webmcp");
	const ctx = installModelContext();
	const { result } = renderLocal({});
	await waitFor(() => expect(result.current.mode).toBe("webmcp"));

	await act(async () => {
	  await result.current.registerWebmcp();
	});
	expect(result.current.webmcpRegistered).toBe(true);

	fireStorageChange(false, false, "webmcp"); // Layer 0 kill-switch
	await waitFor(() => expect(result.current.masterOn).toBe(false));
	await waitFor(() => expect(result.current.webmcpRegistered).toBe(false));
	expect(ctx.unregisterTool).toHaveBeenCalledWith("excali_canvas");
  });

  test("WebMCP unregister: explicit withdrawal clears the registration", async () => {
	setConsent(true, true, "webmcp");
	const ctx = installModelContext();
	const { result } = renderLocal({});
	await waitFor(() => expect(result.current.mode).toBe("webmcp"));

	await act(async () => {
	  await result.current.registerWebmcp();
	});
	expect(result.current.webmcpRegistered).toBe(true);

	await act(async () => {
	  await result.current.unregisterWebmcp();
	});
	expect(result.current.webmcpRegistered).toBe(false);
	expect(ctx.unregisterTool).toHaveBeenCalledWith("excali_canvas");
  });
});
