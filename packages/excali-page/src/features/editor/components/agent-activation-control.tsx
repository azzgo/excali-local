/**
 * Agent Activation Control — Gate 2 (per-canvas) UI inside TopRightToolbar.
 *
 * Only rendered by the LOCAL editor (Quick never shows it — Ticket 006).
 * Visible only when Layer 0 master is ON AND Gate 1 pairing is open; activating
 * shows a persistent "🤖 Agent controlling this canvas" pill and fires a
 * first-time-per-connection confirm modal (003 Q3). On SW restart the ephemeral
 * registry is wiped → the page offers one-click re-activate (never silent).
 */

import { useTranslation } from "react-i18next";
import { IconRobot, IconRobotOff } from "@tabler/icons-react";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { useAgentBridge } from "../hooks/use-agent-bridge";

interface AgentActivationControlProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  editorType: "local" | "quick";
}

const AgentActivationControl = ({
  excalidrawAPI,
  editorType,
}: AgentActivationControlProps) => {
  const [t] = useTranslation();
  const bridge = useAgentBridge({ excalidrawAPI, editorType });

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

      {bridge.showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all"
          onClick={() => bridge.cancelConfirm()}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
              {t("AgentConfirmTitle")}
            </h2>
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
          </div>
        </div>
      )}

      {bridge.swRestartOffer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all"
          onClick={() => bridge.dismissReconnect()}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
              {t("AgentSessionEndedTitle")}
            </h2>
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
          </div>
        </div>
      )}
    </>
  );
};

export default AgentActivationControl;
