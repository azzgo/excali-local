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
	};
	started = false;
	stopped = false;
	currentStatus = "idle";
	constructor(opts: {
	  onStatus?: (s: string, info?: unknown) => void;
	  onInbound?: (msg: Record<string, unknown>) => void;
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
  }

  return { swState, browser, MockSession };
});

vi.mock("@/lib/utils", () => ({
  getBrowser: () => harness.browser,
}));

vi.mock("@/features/editor/lib/agent-bridge-client", () => ({
  AgentBridgeSession: harness.MockSession,
  AgentBridgeClient: class {},
  findBridgePort: vi.fn(),
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

    // WS session started + window.excaliAPI exposed with the excalidrawAPI
    expect(harness.MockSession.instances.length).toBeGreaterThan(0);
    expect(harness.MockSession.instances[0].started).toBe(true);
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
    await waitFor(() => expect(result.current.isActive).toBe(false));
    await waitFor(() => expect(window.excaliAPI).toBeUndefined());
    expect(harness.MockSession.instances[0].stopped).toBe(true);
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
	// the session (no reconnect), tell the SW (AB_DISPLACED), and flip the UI.
	act(() => {
	  harness.MockSession.instances[0].opts.onInbound?.({ type: "displaced" });
	});
	await waitFor(() => expect(result.current.isActive).toBe(false));
	expect(result.current.displaced).toBe(true);
	expect(harness.MockSession.instances[0].stopped).toBe(true);
	expect(
	  harness.swState.sendMessages.some((m: any) => m.type === AB_DISPLACED),
	).toBe(true);
	await waitFor(() => expect(window.excaliAPI).toBeUndefined());

	// Re-activating clears the displaced notice.
	act(() => result.current.toggleActivation());
	act(() => result.current.confirmActivation());
	await waitFor(() => expect(result.current.displaced).toBe(false));
  });
});
