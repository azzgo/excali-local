import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import AgentActivationControl from "@/features/editor/components/agent-activation-control";
import type { UseAgentBridgeResult } from "@/features/editor/hooks/use-agent-bridge";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const bridgeMock = vi.hoisted(() => {
  const base = (overrides: Partial<UseAgentBridgeResult> = {}): UseAgentBridgeResult => ({
    masterOn: true,
    paired: true,
    isActive: false,
    connection: "idle",
    connectedPort: null,
    swRestartOffer: false,
    showConfirm: false,
    canActivate: true,
    toggleActivation: vi.fn(),
    confirmActivation: vi.fn(),
    cancelConfirm: vi.fn(),
    acceptReconnect: vi.fn(),
    dismissReconnect: vi.fn(),
    ...overrides,
  });
  return { base };
});

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

describe("AgentActivationControl", () => {
  test("hidden when Layer 0 / Gate 1 closed (kill-switch) — nothing renders", () => {
    setOverrides({ canActivate: false, masterOn: false });
    renderControl();
    expect(screen.queryByTestId("agent-activation-toggle")).toBeNull();
    expect(screen.queryByTestId("agent-controlling-pill")).toBeNull();
  });

  test("shows the toggle when master ON + paired, no indicator while inactive", () => {
    setOverrides({});
    renderControl();
    expect(screen.getByTestId("agent-activation-toggle")).toBeTruthy();
    expect(screen.queryByTestId("agent-controlling-pill")).toBeNull();
  });

  test("active: renders the persistent 🤖 indicator", () => {
    setOverrides({ isActive: true, connection: "connected" });
    renderControl();
    expect(screen.getByTestId("agent-controlling-pill")).toBeTruthy();
    expect(screen.getByText("AgentControllingCanvas")).toBeTruthy();
  });

  test("first-time confirm modal renders Confirm/Cancel", async () => {
    setOverrides({ showConfirm: true });
    renderControl();
    expect(screen.getByText("AgentConfirmTitle")).toBeTruthy();
    expect(screen.getByText("AgentConfirmContent")).toBeTruthy();
  });

  test("SW-restart offer renders with Re-activate", () => {
    setOverrides({ swRestartOffer: true, isActive: false });
    renderControl();
    expect(screen.getByText("AgentSessionEndedTitle")).toBeTruthy();
    expect(screen.getByText("AgentReactivate")).toBeTruthy();
  });
});
