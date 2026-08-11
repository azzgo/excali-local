import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../lib/utils";
import {
  AB_BRIDGE_STOP_REQUEST,
  AB_STATE,
  AB_STATE_QUERY,
  AGENT_BRIDGE_STORAGE_KEY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  type AgentBridgeStorage,
  type AgentBridgeStatePayload,
} from "excali-shared";
import { toast } from "sonner";
import { probeDaemonHealth } from "../lib/bridge-probe";

/**
 * Layer 0 — "Agent control" master switch + hide-button toggle (Options),
 * plus the daemon-stop pill (Wayfinder 040/045).
 *
 * Persisted via chrome.storage.local, DEFAULT OFF. OFF is a kill-switch: it hides
 * all agent UI in the popup + editor and tears down any pairing/activation (the
 * background SW reacts to the same storage change and clears its registry).
 *
 * "Hide the AI button on canvas" (Wayfinder 034 locked invariant) is adjustable
 * ONLY while the master is OFF: an active canvas must always have a visible stop
 * control, so turning master ON forces the canvas button visible.
 *
 * Daemon-stop pill (040/045): a small dot pinned right in the header.
 *   - Green pulsing dot + hover-expand "Stop daemon" when /health is OK AND the
 *     SW has an activeTabId (the active page is the stop authority).
 *   - Grey non-interactive dot when the daemon is down (title: "Daemon not
 *     running") or running but no canvas is active (title: "Stop needs an
 *     active canvas").
 *   - No pill at all until a connection has occurred at least once (040
 *     gating): health never OK and never seen → plain header.
 * Click → confirm modal → SW relays AB_BRIDGE_STOP_REQUEST to the active tab →
 * the page sends `bridge.stop` over its live WS → daemon replies + shuts down.
 */
const AgentControl = () => {
  const [isOn, setIsOn] = useState(false);
  const [hideButton, setHideButton] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // --- daemon-stop pill state (040/045) ------------------------------------
  const [health, setHealth] = useState<{ ok: boolean; port: number | null }>({
    ok: false,
    port: null,
  });
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  // Set true once /health ever answered OK — gates the pill's visibility
  // (#040: no pill before a connection has occurred at least once).
  const seenDaemonRef = useRef(false);
  const [seenDaemon, setSeenDaemon] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopping, setStopping] = useState(false);

  const refreshDaemon = useCallback(async () => {
    const h = await probeDaemonHealth();
    setHealth(h);
    if (h.ok && !seenDaemonRef.current) {
      seenDaemonRef.current = true;
      setSeenDaemon(true);
    }
    try {
      const reply = (await browser.runtime.sendMessage({
        type: AB_STATE_QUERY,
      })) as Partial<AgentBridgeStatePayload> | undefined;
      if (reply?.type === AB_STATE) {
        setActiveTabId(reply.activeTabId ?? null);
      }
    } catch {
      /* SW busy/restarting — keep the last known registry */
    }
  }, []);

  useEffect(() => {
    refreshDaemon();
    // Same cadence as the popup indicator; the pill must stay live.
    const id = setInterval(refreshDaemon, 4000);
    return () => clearInterval(id);
  }, [refreshDaemon]);

  const writeStorage = useCallback((patch: Partial<AgentBridgeStorage>) => {
    browser.storage.local
      .get(AGENT_BRIDGE_STORAGE_KEY)
      .then((result) => {
        const stored = result[AGENT_BRIDGE_STORAGE_KEY] as
          | AgentBridgeStorage
          | undefined;
        const current = stored ?? AGENT_BRIDGE_DEFAULT_STORAGE;
        return browser.storage.local.set({
          [AGENT_BRIDGE_STORAGE_KEY]: { ...current, ...patch },
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    browser.storage.local
      .get(AGENT_BRIDGE_STORAGE_KEY)
      .then((result) => {
        const stored = result[AGENT_BRIDGE_STORAGE_KEY] as
          | AgentBridgeStorage
          | undefined;
        const current = stored ?? AGENT_BRIDGE_DEFAULT_STORAGE;
        setIsOn(current.master);
        setHideButton(current.hideButton);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleMasterToggle = () => {
    const next = !isOn;
    setIsOn(next);
    // Flipping master OFF (or re-enabling) resets pairing; hideButton is kept,
    // but master ON forces the canvas button visible (034 invariant).
    writeStorage({ master: next, pairing: false });
  };

  const handleHideToggle = () => {
    if (isOn) return; // adjustable only while the master is OFF
    const next = !hideButton;
    setHideButton(next);
    writeStorage({ hideButton: next });
  };

  // --- daemon-stop flow (045) ----------------------------------------------
  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      const reply = (await browser.runtime.sendMessage({
        type: AB_BRIDGE_STOP_REQUEST,
      })) as { ok?: boolean; reason?: string } | undefined;
      if (reply?.ok) {
        // The daemon replies then shuts down (flush window); flip the pill to
        // its stopped state immediately — the next health poll confirms.
        setHealth({ ok: false, port: null });
        toast(t("AgentStopDaemonToast"), { duration: 4000 });
      } else {
        toast(t("AgentStopDaemonFailed", reply?.reason ?? "unknown"), {
          duration: 4000,
        });
      }
    } catch {
      toast(t("AgentStopDaemonFailed", "SW unreachable"), { duration: 4000 });
    } finally {
      setStopping(false);
      setShowStopModal(false);
    }
  }, []);

  const switchKnob = (on: boolean) => (
    <span
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
        on ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </span>
  );

  // --- pill derivation (#040 states + #045 gating) -------------------------
  const pillVisible = seenDaemon || health.ok;
  const pillStoppable = health.ok && activeTabId != null;
  const pillTitle = health.ok
    ? activeTabId != null
      ? t("AgentStopDaemon")
      : t("AgentStopNeedsActiveCanvas")
    : t("AgentDaemonNotRunning");

  const pill = pillVisible ? (
    <button
      type="button"
      aria-label={t("AgentStopDaemon")}
      title={pillTitle}
      disabled={!pillStoppable || stopping}
      onClick={() => setShowStopModal(true)}
      className={`group ml-auto mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors duration-200 ${
        pillStoppable
          ? "cursor-pointer text-green-600 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 dark:text-green-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          : "cursor-default text-gray-400 dark:text-gray-500"
      }`}
    >
      <span
        className={`inline-block size-2 shrink-0 rounded-full ${
          pillStoppable
            ? "animate-pulse bg-green-500 dark:bg-green-400"
            : "bg-gray-300 dark:bg-gray-600"
        }`}
      />
      <span
        className={`max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-32 group-hover:opacity-100 group-focus-visible:max-w-32 group-focus-visible:opacity-100 ${
          pillStoppable ? "group-hover:pl-1" : ""
        }`}
      >
        {t("AgentStopDaemon")}
      </span>
    </button>
  ) : null;

  return (
    <div className="mb-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
            {t("AgentControl")}
          </h2>
          <p className="text-xs text-gray-500">{t("AgentControlDescription")}</p>
        </div>
        {pill}
      </header>

      {/* Layer 0 — master kill-switch */}
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        disabled={isLoading}
        onClick={handleMasterToggle}
        className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors duration-200 cursor-pointer disabled:opacity-50 ${
          isOn
            ? "bg-blue-50 border-blue-300 dark:bg-blue-950 dark:border-blue-700"
            : "bg-gray-50 border-gray-300 dark:bg-gray-800 dark:border-gray-700"
        }`}
      >
        {switchKnob(isOn)}
        <span className="flex flex-col text-left">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {isOn ? t("AgentControlOn") : t("AgentControlOff")}
          </span>
          <span className="text-xs text-gray-500">
            {isOn ? t("AgentControlEnabledHint") : t("AgentControlDisabledHint")}
          </span>
        </span>
      </button>

      {/* Hide-button toggle — adjustable only while the master is OFF */}
      <button
        type="button"
        role="switch"
        aria-checked={hideButton}
        disabled={isLoading || isOn}
        onClick={handleHideToggle}
        className={`flex items-center gap-3 w-full mt-2 px-4 py-3 rounded-lg border transition-colors duration-200 ${
          isOn
            ? "bg-gray-50 border-gray-200 dark:bg-gray-800/60 dark:border-gray-800 cursor-not-allowed opacity-50"
            : "bg-gray-50 border-gray-300 dark:bg-gray-800 dark:border-gray-700 cursor-pointer"
        }`}
      >
        {switchKnob(hideButton)}
        <span className="flex flex-col text-left">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {t("AgentHideButton")}
          </span>
          <span className="text-xs text-gray-500">
            {t("AgentHideButtonHint")}
          </span>
        </span>
      </button>

      {/* Confirm modal (#040): no instant stop — the user must confirm. */}
      {showStopModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowStopModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("AgentStopDaemonConfirmTitle")}
            className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">
              {t("AgentStopDaemonConfirmTitle")}
            </h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
              {t("AgentStopDaemonConfirmBody")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={stopping}
                onClick={() => setShowStopModal(false)}
                className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                disabled={stopping}
                onClick={handleStop}
                className="cursor-pointer rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {stopping ? "…" : t("AgentStopDaemon")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentControl;
