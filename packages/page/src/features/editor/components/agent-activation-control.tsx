/**
 * Agent Activation Control — the single state-driven entry point for the
 * agent-drive journey (Wayfinder 033/034 redesign).
 *
 * Rendered by the LOCAL editor only (Quick never shows it — Ticket 006).
 * The button is ALWAYS visible (unless the Options hide-toggle is on while the
 * feature is OFF — an active canvas must always have a visible stop control):
 *
 *   grey   = feature OFF        → click → enable modal; confirm opens master +
 *                                 pairing (Gate 0+1) and arms auto-activate
 *   amber  = waiting for bridge → paired but daemon not detected; click toggles
 *                                 the inline help card (two daemon-start paths)
 *   blue   = ready              → paired + daemon detected, not active. The
 *                                 cold-start path auto-activates past this; the
 *                                 warm path: click → (first time per canvas)
 *                                 consent modal → activate
 *   solid  = controlling        → click deactivates (no consent needed to stop)
 *
 * Cold-start (feature OFF → Turn On): one confirm opens master+pairing and, once
 * the bridge is detected, activates THIS canvas directly (the enable confirm
 * counts as its per-canvas consent — no second modal). The per-canvas consent
 * modal still applies on the warm path (feature already on, Activate a canvas).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  IconCheck,
  IconCopy,
  IconPlug,
  IconPlugConnectedX,
  IconRobot,
  IconRobotOff,
  IconX,
} from "@tabler/icons-react";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { cn, getBrowser } from "@/lib/utils";
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

type ButtonState = "off" | "coach" | "ready" | "active";

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
  // Open the extension Options page (where the agent feature can be turned
  // off). No-op in dev mode where getBrowser() returns null.
  const openOptions = () => {
    getBrowser()?.runtime?.openOptionsPage?.();
  };

  const bridge = useAgentBridge({
	  excalidrawAPI,
	  editorType,
	  onActivateError: handleActivateError,
  });

  // Displacement toast: the daemon moved agent control to another canvas
  // (a newer activation from any profile — Tickets 016/017). Fire once per
  // displacement, not on every render.
  const displacedShownRef = useRef(false);
  // Cold-start auto-activate arm flag (set on quick-enable; consumed by the
  // effect after handleQuickEnable). Declared with the other refs.
  const autoActivateArmedRef = useRef(false);
  useEffect(() => {
	  if (bridge.displaced && !displacedShownRef.current) {
		    displacedShownRef.current = true;
		    toast.info(t("AgentDisplaced"));
	  }
	  if (!bridge.displaced) displacedShownRef.current = false;
  }, [bridge.displaced, t]);

  // Quick-enable modal + inline bridge-start help card (component-local UI state).
  const [showEnable, setShowEnable] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Options hide-toggle: the button hides ONLY while the feature is OFF, so an
  // active canvas is never left without a visible stop control (034 invariant).
  const buttonHidden = !bridge.masterOn && bridge.hideButton;
  if (buttonHidden) return null;

  // --- adaptive state (mirrors the prototype: off → coach → ready → active) ---
  // "Daemon detected" = the control WS (or the active-slot WS) is connected.
  const daemonDetected =
    bridge.controlConnection === "connected" || bridge.connection === "connected";
  const isWebmcp = bridge.mode === "webmcp";
  // WebMCP mode (043): 2-state machine — unregistered (grey Register) /
  // registered (accent Unregister). Master OFF is still the kill-switch
  // (quick-enable modal); unpaired pairs on the same click.
  const buttonState: ButtonState = !bridge.masterOn
    ? "off"
    : isWebmcp
      ? bridge.webmcpRegistered
        ? "active"
        : "ready"
      : !bridge.paired || !daemonDetected
        ? "coach"
        : bridge.isActive
          ? "active"
          : "ready";

  const handleClick = () => {
    if (buttonState === "off") {
      // ① Feature OFF → quick-enable modal (journey short-circuit, 033 R2).
      setShowEnable(true);
      return;
    }
    if (isWebmcp) {
      // 043: the click IS the per-page exposure consent — no modal. Unpaired
      // opens pairing on the same click (same one-consent philosophy as 034's
      // quick-enable). Register failure stays unregistered + toast.
      if (bridge.webmcpRegistered) {
        void bridge.unregisterWebmcp();
      } else {
        if (!bridge.paired) bridge.pairAgent();
        void bridge.registerWebmcp().then((ok) => {
          if (!ok) toast.error(t("AgentWebmcpRegisterFailed"));
        });
      }
      return;
    }
    if (buttonState === "coach") {
      if (!bridge.paired) {
        // ② ON + unpaired → attempt to pair. The storage write triggers the
        // control WS dial; if the daemon isn't detected the coach card shows.
        bridge.pairAgent();
        setCoachOpen(true);
      } else {
        // ②b paired but the daemon isn't detected → toggle the coach card.
        setCoachOpen((v) => !v);
      }
      return;
    }
    if (bridge.isActive) {
      // ④ active → deactivate (no consent needed to stop).
      bridge.toggleActivation();
      return;
    }
    if (bridge.otherActive) {
      // ⑤ paired, another canvas is controlling → activating here takes over
      // (the SW arbiter enforces the single-active-canvas invariant).
      toast.info(t("AgentTakeOverHint"));
    }
    // ③ paired + idle → per-canvas consent modal → activate.
    bridge.toggleActivation();
  };

  const handleQuickEnable = () => {
    setShowEnable(false);
    bridge.quickEnableAgent();
    toast.success(t("AgentEnabledToast"));
    // Arm auto-activate: once the bridge is detected, skip the separate
    // "Activate" click and go straight to the (per-canvas) activation flow.
    autoActivateArmedRef.current = true;
  };

  // Cold-start auto-activate (removes the redundant "Activate" click): after
  // Turn On, once the bridge is detected we auto-request activation. The
  // per-canvas consent modal still applies the first time (Gate 2 invariant);
  // a re-activate of an already-consented canvas goes straight to Controlling.
  // One-shot per enable — cleared on fire.
  useEffect(() => {
    if (!autoActivateArmedRef.current) return;
    if (bridge.masterOn && bridge.paired && daemonDetected && !bridge.isActive) {
      autoActivateArmedRef.current = false;
      // Direct activation: the enable confirm already counted as this canvas's
      // per-canvas consent, so no second modal — straight to Controlling once
      // the bridge is detected.
      bridge.activateCurrentCanvas();
    }
  }, [bridge.masterOn, bridge.paired, daemonDetected, bridge.isActive, bridge.activateCurrentCanvas]);
  const handleCopyCommand = async (key: string) => {
    try {
      await navigator.clipboard.writeText(t(key));
      setCopiedCmd(key);
      setTimeout(() => setCopiedCmd((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      /* clipboard unavailable — the command stays selectable for manual copy */
    }
  };

  const renderCommandRow = (key: string) => (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5">
      <code className="flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-foreground select-all">
        {t(key)}
      </code>
      <button
        type="button"
        aria-label={t("AgentCoachCopy")}
        title={t("AgentCoachCopy")}
        onClick={() => handleCopyCommand(key)}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {copiedCmd === key ? (
          <IconCheck className="size-3.5" />
        ) : (
          <IconCopy className="size-3.5" />
        )}
      </button>
    </div>
  );

  const connectionLabel =
    bridge.connection === "connected"
      ? t("AgentControlConnected")
      : bridge.connection === "connecting"
        ? t("AgentControlConnecting")
        : bridge.connection === "reconnecting"
          ? t("AgentControlReconnecting")
          : "";

  // --- visual treatment (four tint states, tabler icons) ---------------------
  const tint: Record<ButtonState, string> = {
    off: "bg-transparent text-muted-foreground border-transparent hover:bg-accent hover:text-accent-foreground",
    coach:
      "bg-amber-50 text-amber-600 border-amber-300 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-700",
    ready:
      "bg-blue-50 text-blue-600 border-blue-300 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-700",
    active:
      "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:text-white dark:border-blue-600",
  };
  const label = isWebmcp
    ? buttonState === "off"
      ? t("AgentButtonLabel")
      : bridge.webmcpRegistered
        ? t("AgentButtonUnregister")
        : t("AgentButtonRegister")
    : buttonState === "active"
      ? t("AgentButtonControlling")
      : buttonState === "coach"
        ? t("AgentButtonSetup")
        : buttonState === "ready"
          ? t("AgentButtonActivate")
          : t("AgentButtonLabel");
  const tooltip = isWebmcp
    ? buttonState === "off"
      ? t("AgentTooltipOff")
      : bridge.webmcpRegistered
        ? t("AgentTooltipUnregister")
        : t("AgentTooltipRegister")
    : buttonState === "off"
      ? t("AgentTooltipOff")
      : buttonState === "coach"
        ? t("AgentTooltipSetup")
        : buttonState === "ready"
          ? bridge.otherActive
            ? t("AgentTooltipOtherActive")
            : t("AgentTooltipReady")
          : t("AgentTooltipActive");

  return (
    <>
      <div className="relative">
        <Hint label={tooltip} align="end" sideOffset={8}>
          <button
            type="button"
            onClick={handleClick}
            title={connectionLabel || undefined}
            data-testid="agent-activation-toggle"
            data-state={
              isWebmcp && bridge.masterOn
                ? bridge.webmcpRegistered
                  ? "registered"
                  : "unregistered"
                : buttonState
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-9 text-xs font-semibold transition-colors cursor-pointer",
              // WebMCP unregistered = muted grey (043); everything else uses
              // the ws+daemon 4-state tints.
              isWebmcp && !bridge.webmcpRegistered && buttonState !== "off"
                ? "bg-transparent text-muted-foreground border-transparent hover:bg-accent hover:text-accent-foreground"
                : tint[buttonState],
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                buttonState === "active" ? "bg-white" : "bg-current opacity-60",
              )}
            />
            {isWebmcp ? (
              bridge.webmcpRegistered ? (
                <IconPlugConnectedX className="size-4" />
              ) : (
                <IconPlug className="size-4" />
              )
            ) : bridge.isActive ? (
              <IconRobotOff className="size-4" />
            ) : (
              <IconRobot className="size-4" />
            )}
            <span className="whitespace-nowrap">{label}</span>
          </button>
        </Hint>

        {!isWebmcp && buttonState === "coach" && coachOpen && (
          <div
            data-testid="agent-coach-card"
            className="absolute right-0 top-full z-50 mt-2 w-[27rem] rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
          >
            <button
              type="button"
              aria-label={t("AgentDismiss")}
              onClick={() => setCoachOpen(false)}
              className="float-right text-muted-foreground hover:text-foreground"
            >
              <IconX className="size-4" />
            </button>
            <h4 className="mb-1 text-sm font-semibold text-foreground">{t("AgentCoachTitle")}</h4>
            <p className="mb-2 text-muted-foreground">
              {t("AgentCoachBody")}
            </p>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {t("AgentCoachOptionA")}
            </div>
            <p className="mb-2 text-muted-foreground">{t("AgentCoachOptionADesc")}</p>
            <div className="mb-1 mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {t("AgentCoachOptionB")}
            </div>
            <p className="mb-2 text-muted-foreground">{t("AgentCoachOptionBDesc")}</p>
            {renderCommandRow("AgentCoachCommand")}
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("AgentCoachFooter")}{" "}
              <button
                type="button"
                onClick={openOptions}
                className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              >
                {t("AgentCoachFooterLink")}
              </button>
              {t("AgentCoachFooterSuffix")}
            </p>
          </div>
        )}
      </div>

      {/* ① quick-enable modal (feature OFF short-circuit) */}
      <Modal
        open={showEnable}
        title={t("AgentEnableTitle")}
        onDismiss={() => setShowEnable(false)}
      >
        <p className="text-sm text-muted-foreground mb-6">
          {t("AgentEnableContent")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setShowEnable(false)}>
            {t("AgentEnableCancel")}
          </Button>
          <Button onClick={handleQuickEnable}>
            {t("AgentEnableConfirm")}
          </Button>
        </div>
      </Modal>

      {/* ③ per-canvas consent modal (034 R1: first-time per canvas) */}
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

      {/**
       * Gallery BLOCKING confirm (013/014): a global destructive gallery op
       * (delete/rename/collections.delete/collections.rename/save-overwrite)
       * waits on the user. Rendered on BOTH active and control-only paired
       * pages. The protocol layer stays non-blocking — the request is simply
       * held until the user decides (confirm → execute; cancel → -32005).
       */}
      <Modal
        open={bridge.galleryConfirm != null}
        title={t("AgentGalleryConfirmTitle")}
        onDismiss={() => bridge.cancelGallery()}
      >
        <p className="text-sm text-muted-foreground mb-6">
          {t("AgentGalleryConfirmContent", {
            method: bridge.galleryConfirm?.method ?? "",
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" data-testid="agent-gallery-cancel" onClick={() => bridge.cancelGallery()}>
            {t("Cancel")}
          </Button>
          <Button
            data-testid="agent-gallery-confirm"
            onClick={() => bridge.confirmGallery()}
          >
            {t("AgentConfirmButton")}
          </Button>
        </div>
      </Modal>
    </>
  );
};

export default AgentActivationControl;
