/**
 * Agent Activation Control — Gate 2 (per-canvas) UI inside TopRightToolbar.
 *
 * Only rendered by the LOCAL editor (Quick never shows it — Ticket 006).
 * Visible only when Layer 0 master is ON AND Gate 1 pairing is open; activating
 * shows a persistent "🤖 Agent controlling this canvas" pill and fires a
 * first-time-per-connection confirm modal (003 Q3). On SW restart the ephemeral
 * registry is wiped → the page offers one-click re-activate (never silent).
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IconRobot, IconRobotOff } from "@tabler/icons-react";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Modal } from "@/components/ui/modal";
import {
  useAgentBridge,
  type AgentBridgeActivateError,
} from "../hooks/use-agent-bridge";

interface AgentActivationControlProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  editorType: "local" | "quick";
}

const AgentActivationControl = ({
  excalidrawAPI,
  editorType,
}: AgentActivationControlProps) => {
  const [t] = useTranslation();

  // Surface activation failures (SW unreachable / consent denied) as a toast
  // instead of the toggle silently doing nothing (review P2).
  const handleActivateError = useCallback(
    (reason: AgentBridgeActivateError) => {
      const key =
        reason === "transport"
          ? "AgentActivateFailedTransport"
          : reason === "consent-off"
            ? "AgentActivateFailedConsent"
            : "AgentActivateFailedNotActivatable";
      toast.error(t(key));
    },
    [t],
  );

  const bridge = useAgentBridge({
    excalidrawAPI,
    editorType,
    onActivateError: handleActivateError,
  });

  // Kill-switch (Layer 0 OFF) / Gate 1 closed → nothing renders.
  if (!bridge.canActivate) return null;

  const connectionLabel =
    bridge.connection === "connected"
      ? t("AgentControlConnected")
      : bridge.connection === "connecting"
        ? t("AgentControlConnecting")
        : bridge.connection === "reconnecting"
          ? t("AgentControlReconnecting")
          : "";

  return (
    <>
      {bridge.isActive && (
        <div
          data-testid="agent-controlling-pill"
          className="flex items-center gap-1.5 rounded-full bg-blue-600 text-white text-xs font-medium px-3 py-1.5 shadow-sm"
          title={connectionLabel}
        >
          <IconRobot className="size-4" />
          <span>{t("AgentControllingCanvas")}</span>
        </div>
      )}
      <Hint
        label={
          bridge.isActive
            ? t("AgentControlDeactivate")
            : t("AgentControlActivate")
        }
        align="end"
        sideOffset={8}
      >
        <Button
          variant={bridge.isActive ? "default" : "ghost"}
          onClick={() => bridge.toggleActivation()}
          title={connectionLabel || undefined}
          data-testid="agent-activation-toggle"
        >
          {bridge.isActive ? (
            <IconRobotOff className="size-4" />
          ) : (
            <IconRobot className="size-4" />
          )}
        </Button>
      </Hint>

      <Modal
        open={bridge.showConfirm}
        title={t("AgentConfirmTitle")}
        onDismiss={() => bridge.cancelConfirm()}
      >
        <p className="text-sm text-muted-foreground mb-6">
          {t("AgentConfirmContent")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => bridge.cancelConfirm()}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => bridge.confirmActivation()}>
            {t("AgentConfirmButton")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={bridge.swRestartOffer}
        title={t("AgentSessionEndedTitle")}
        onDismiss={() => bridge.dismissReconnect()}
      >
        <p className="text-sm text-muted-foreground mb-6">
          {t("AgentSessionEndedContent")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => bridge.dismissReconnect()}>
            {t("AgentDismiss")}
          </Button>
          <Button onClick={() => bridge.acceptReconnect()}>
            {t("AgentReactivate")}
          </Button>
        </div>
      </Modal>
    </>
  );
};

export default AgentActivationControl;
