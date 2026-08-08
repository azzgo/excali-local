import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import AgentActivationControl from "@/features/editor/components/agent-activation-control";
import type { UseAgentBridgeResult } from "@/features/editor/hooks/use-agent-bridge";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const bridgeMock = vi.hoisted(() => {
	const base = (overrides: Partial<UseAgentBridgeResult> = {}): UseAgentBridgeResult => ({
	  masterOn: true,
	  paired: true,
	  hideButton: false,
	  isActive: false,
	  otherActive: false,
	  connection: "idle",
	  connectedPort: null,
	  profileId: "11111111-2222-4333-8444-555555555555",
	  controlConnection: "idle",
	  swRestartOffer: false,
	  displaced: false,
	  destructiveFlash: null,
	  galleryConfirm: null,
	  confirmGallery: vi.fn(),
	  cancelGallery: vi.fn(),
	  showConfirm: false,
	  canActivate: true,
	  quickEnableAgent: vi.fn(),
	  pairAgent: vi.fn(),
	  toggleActivation: vi.fn(),
	  confirmActivation: vi.fn(),
	  cancelConfirm: vi.fn(),
	  acceptReconnect: vi.fn(),
	  dismissReconnect: vi.fn(),
	  ...overrides,
	});
	return { base };
});

const toastMock = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/features/editor/hooks/use-agent-bridge", () => ({
  useAgentBridge: (opts: { editorType: "local" | "quick" }) => {
    const overrides = (globalThis as unknown as {
      __agentBridgeOverrides?: Partial<UseAgentBridgeResult>;
    }).__agentBridgeOverrides;
    if (opts.editorType === "quick") {
      return bridgeMock.base({ canActivate: false });
    }
    return bridgeMock.base(overrides);
  },
}));

const setOverrides = (overrides: Partial<UseAgentBridgeResult>) => {
  (globalThis as unknown as { __agentBridgeOverrides?: Partial<UseAgentBridgeResult> }).__agentBridgeOverrides =
    overrides;
};

const renderControl = () =>
  render(
    <AgentActivationControl excalidrawAPI={{} as never} editorType="local" />,
  );

// vitest runs without globals → testing-library's auto-cleanup doesn't
// register; render() accumulates DOM across tests without this.
afterEach(cleanup);

// A "paired + daemon up" baseline: control WS connected, nothing active.
const ready = {
  masterOn: true,
  paired: true,
  controlConnection: "connected",
} as const;

describe("AgentActivationControl", () => {
  test("button renders even when the feature is OFF (state-driven entry)", () => {
    setOverrides({ masterOn: false, paired: false, canActivate: false });
    renderControl();
    expect(screen.getByTestId("agent-activation-toggle")).toBeTruthy();
    expect(screen.queryByTestId("agent-controlling-pill")).toBeNull();
  });

  test("hidden only when the Options hide-toggle is on AND the feature is OFF", () => {
    setOverrides({ masterOn: false, paired: false, hideButton: true, canActivate: false });
    renderControl();
    expect(screen.queryByTestId("agent-activation-toggle")).toBeNull();
    cleanup();
    // An active canvas can never hide the stop control (034 invariant): the
    // button IS the stop control and stays visible in every state.
    setOverrides({ ...ready, hideButton: true, isActive: true });
    renderControl();
    expect(screen.getByTestId("agent-activation-toggle")).toBeTruthy();
  });

  test("quick-enable: feature OFF → click opens the enable modal; confirm calls quickEnableAgent", () => {
    const quickEnableAgent = vi.fn();
    setOverrides({ masterOn: false, paired: false, canActivate: false, quickEnableAgent });
    renderControl();
    act(() => {
      screen.getByTestId("agent-activation-toggle").click();
    });
    expect(screen.getByText("AgentEnableTitle")).toBeTruthy();
    screen.getByText("AgentEnableConfirm").click();
    expect(quickEnableAgent).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith("AgentEnabledToast");
  });

  test("coach: ON + unpaired → click pairs and opens the coach-install card", () => {
    const pairAgent = vi.fn();
    setOverrides({ masterOn: true, paired: false, canActivate: false, pairAgent });
    renderControl();
    act(() => {
      screen.getByTestId("agent-activation-toggle").click();
    });
    expect(pairAgent).toHaveBeenCalled();
    expect(screen.getByTestId("agent-coach-card")).toBeTruthy();
    expect(screen.getByText("AgentCoachCommand")).toBeTruthy();
    // Two-step guidance: install the skill, then invoke it to start the daemon.
    expect(screen.getByText("AgentCoachStep1")).toBeTruthy();
    expect(screen.getByText("AgentCoachStep2")).toBeTruthy();
    expect(screen.getByText("AgentCoachDaemonCommand")).toBeTruthy();
    // ✕ closes the card
    act(() => {
      screen.getByLabelText("AgentDismiss").click();
    });
    expect(screen.queryByTestId("agent-coach-card")).toBeNull();
  });

  test("coach: paired but daemon not detected → click toggles the coach card", () => {
    setOverrides({ ...ready, controlConnection: "reconnecting" });
    renderControl();
    act(() => {
      screen.getByTestId("agent-activation-toggle").click();
    });
    expect(screen.getByTestId("agent-coach-card")).toBeTruthy();
    act(() => {
      screen.getByTestId("agent-activation-toggle").click();
    });
    expect(screen.queryByTestId("agent-coach-card")).toBeNull();
  });

  test("ready: paired + daemon up + idle → click activates via the consent gate", () => {
    const toggleActivation = vi.fn();
    setOverrides({ ...ready, toggleActivation });
    renderControl();
    screen.getByTestId("agent-activation-toggle").click();
    expect(toggleActivation).toHaveBeenCalled();
  });

  test("another canvas active → click toasts the take-over hint then activates", () => {
    const toggleActivation = vi.fn();
    setOverrides({ ...ready, otherActive: true, toggleActivation });
    renderControl();
    screen.getByTestId("agent-activation-toggle").click();
    expect(toastMock.info).toHaveBeenCalledWith("AgentTakeOverHint");
    expect(toggleActivation).toHaveBeenCalled();
  });

  test("active: the Controlling button is the single control — no emoji pill, click deactivates", () => {
    const toggleActivation = vi.fn();
    setOverrides({ ...ready, isActive: true, connection: "connected", toggleActivation });
    renderControl();
    // The emoji pill is gone — the "Controlling" button is the one control.
    expect(screen.queryByTestId("agent-controlling-pill")).toBeNull();
    const toggle = screen.getByTestId("agent-activation-toggle");
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("data-state")).toBe("active");
    toggle.click();
    expect(toggleActivation).toHaveBeenCalled();
  });

  test("first-time consent modal renders Confirm/Cancel", async () => {
    setOverrides({ ...ready, showConfirm: true });
    renderControl();
    expect(screen.getByText("AgentConfirmTitle")).toBeTruthy();
    expect(screen.getByText("AgentConfirmContent")).toBeTruthy();
  });

  test("SW-restart offer renders with Re-activate", () => {
	setOverrides({ ...ready, swRestartOffer: true, isActive: false });
	renderControl();
	expect(screen.getByText("AgentSessionEndedTitle")).toBeTruthy();
	expect(screen.getByText("AgentReactivate")).toBeTruthy();
  });

  test("displaced: fires the displacement toast once", () => {
	setOverrides({ ...ready, displaced: true });
	renderControl();
	expect(toastMock.info).toHaveBeenCalledWith("AgentDisplaced");
  });

  test("destructive canvas/v1 op: renders the non-blocking amber flash", () => {
	setOverrides({ ...ready, destructiveFlash: { method: "elements.clear", key: 1 } });
	renderControl();
	const flash = screen.getByTestId("agent-destructive-flash");
	expect(flash).toBeTruthy();
	expect(flash.textContent).toContain("AgentDestructiveOp");
  });

  test("gallery BLOCKING confirm: renders the modal; Confirm/Cancel wired", () => {
	const confirmGallery = vi.fn();
	const cancelGallery = vi.fn();
	setOverrides({
	  ...ready,
	  galleryConfirm: { method: "gallery.delete", params: { id: "d1" }, key: 7 },
	  confirmGallery,
	  cancelGallery,
	});
	renderControl();
	expect(screen.getByText("AgentGalleryConfirmTitle")).toBeTruthy();
	expect(screen.getByText("AgentGalleryConfirmContent")).toBeTruthy();
	const confirmBtn = screen.getByTestId("agent-gallery-confirm");
	confirmBtn.click();
	expect(confirmGallery).toHaveBeenCalled();
	screen.getByTestId("agent-gallery-cancel").click();
	expect(cancelGallery).toHaveBeenCalled();
  });
});
