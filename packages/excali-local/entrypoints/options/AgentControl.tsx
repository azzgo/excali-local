import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../lib/utils";
import {
  AB_BRIDGE_STOP_REQUEST,
  AB_STATE,
  AB_STATE_QUERY,
  AGENT_BRIDGE_MODE_WS,
  AGENT_BRIDGE_STORAGE_KEY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  isWebmcpUsable,
  type AgentBridgeMode,
  type AgentBridgeStorage,
  type AgentBridgeStatePayload,
} from "excali-shared";
import { toast } from "sonner";

import { probeDaemonHealth } from "../lib/bridge-probe";




/**
 * Layer 0 — "Enabled" master switch + hide-button toggle (Options), the
 * Active control route segmented control (Wayfinder 043/044 Variant B), and
 * the ws+daemon daemon-stop pill (Wayfinder 040/045).
 *
 * Persisted via chrome.storage.local, DEFAULT OFF. OFF is a kill-switch: it hides
 * all agent UI in the popup + editor and tears down any pairing/activation (the
 * background SW reacts to the same storage change and clears its registry).
 *
 * Layout (044 Variant B, top → bottom):
 *   header (title + mode subtitle + optional daemon pill)
 *   → "Enabled" row (kill-switch; master OFF disables everything below
 *     except the hide-button toggle)
 *   → "Hide the AI button on canvas" row (adjustable ONLY while master is OFF)
 *   → dashed divider "Active control route"
 *   → segmented control: `● Default · ws + daemon` | WebMCP (feature-gated)
 *
 * The daemon-stop pill renders only in ws+daemon mode. Master OFF hides the
 * pill (no active session) and greys the route control.
 */
const AgentControl = () => {
  const [isOn, setIsOn] = useState(false);
  const [hideButton, setHideButton] = useState(false);
  const [mode, setMode] = useState<AgentBridgeMode>("ws+daemon");
  const [isLoading, setIsLoading] = useState(true);
  // Honest detect: presence ≠ usability on chrome-extension:// pages before
  // Chrome 157 (the API throws SecurityError there) — probe once.
  const [webmcpOk] = useState(isWebmcpUsable);

  // --- daemon-stop pill state (040/045) ------------------------------------
  const [health, setHealth] = useState<{ ok: boolean; port: number | null }>({
    ok: false,
    port: null,
  });
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  // Stop-flow guards: while a stop is in flight no NEW probe runs (stoppingRef)
  // and any in-flight probe from before the stop is discarded (stopGenRef), so
  // a stale /health result can't flip the pill back to green after the daemon
  // is confirmed gone. The pill itself only shows while health.ok (daemon up).
  const stoppingRef = useRef(false);
  const stopGenRef = useRef(0);
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopping, setStopping] = useState(false);

  const refreshDaemon = useCallback(async () => {
    if (stoppingRef.current) return; // stop in flight — no new probes
    const gen = stopGenRef.current;
    const h = await probeDaemonHealth();
    if (gen !== stopGenRef.current) return; // stop started mid-probe — discard
    setHealth(h);
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
    // Same cadence as before — the pill must stay live while visible.
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
        setMode(current.mode ?? AGENT_BRIDGE_MODE_WS);
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

  const handleModeChange = (next: AgentBridgeMode) => {
    if (!isOn || next === mode) return; // kill-switch: master OFF → no mode switch
    if (next !== AGENT_BRIDGE_MODE_WS && !webmcpOk) return; // feature-gated
    setMode(next);
    // The storage write propagates via chrome.storage.onChanged: the SW clears
    // the ws+daemon registry / broadcasts AB_MODE_CHANGED to open editor tabs.
    writeStorage({ mode: next });
  };

  // --- daemon-stop flow (045) ----------------------------------------------
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const handleStop = useCallback(async () => {
    setStopping(true);
    stoppingRef.current = true;
    stopGenRef.current += 1;
    // The request is advisory: runtime.sendMessage fans out to the SW AND the
    // editor page (multi-responder), and Chrome keeps only the first
    // sendResponse — the {ok:true} ack can be lost even though the daemon
    // stopped cleanly (E2E finding). The source of truth is the daemon
    // itself: a reply of {ok:true} wins immediately; otherwise wait a beat
    // and probe /health — daemon gone = success, still up = real failure.
    const verdict = async (reason: string | undefined) => {
      await sleep(300);
      const h = await probeDaemonHealth();
      if (!h.ok) {
        setHealth({ ok: false, port: null });
        toast(t("AgentStopDaemonToast"), { duration: 4000 });
      } else {
        toast(t("AgentStopDaemonFailed", reason ?? "unknown"), {
          duration: 4000,
        });
      }
    };
    try {
      const reply = (await browser.runtime.sendMessage({
        type: AB_BRIDGE_STOP_REQUEST,
      })) as { ok?: boolean; reason?: string } | undefined;
      if (reply?.ok) {
        // Clean ack — the daemon replies then shuts down (flush window).
        setHealth({ ok: false, port: null });
        toast(t("AgentStopDaemonToast"), { duration: 4000 });
      } else {
        await verdict(reply?.reason);
      }
    } catch {
      await verdict("SW unreachable");
    } finally {
      setStopping(false);
      stoppingRef.current = false;
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

  // --- daemon-stop pill (ws+daemon mode only; 040 states + 045 gating) ------
  const pillVisible = mode === AGENT_BRIDGE_MODE_WS && health.ok;
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
        className={`max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ${
          pillStoppable
            ? "group-hover:max-w-32 group-hover:opacity-100 group-hover:pl-1 group-focus-visible:max-w-32 group-focus-visible:opacity-100"
            : ""
        }`}
      >
        {t("AgentStopDaemon")}
      </span>
    </button>
  ) : null;

  // --- mode segmented control (044 Variant B) -------------------------------
  const segBase =
    "inline-flex flex-1 items-center justify-center gap-1.5 border-0 px-3 py-2 text-xs font-medium transition-colors";
  const modeControl = (
    <div className="mt-2 inline-flex w-full overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
      <button
        type="button"
        role="radio"
        aria-checked={mode === "ws+daemon"}
        disabled={isLoading || !isOn}
        onClick={() => handleModeChange("ws+daemon")}
        className={`${segBase} ${
          mode === "ws+daemon"
            ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
            : "bg-transparent text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        } ${!isOn ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        <span
          title={t("AgentRouteDefault")}
          className="flex size-3.5 items-center justify-center rounded-full bg-gray-300 text-white dark:bg-gray-500"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-2"
          >
            <polyline points="3 8 7 12 13 4" />
          </svg>
        </span>
        <span className="whitespace-nowrap">
          {t("AgentRouteDefault")} · {t("AgentRouteWsDaemon")}
        </span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "webmcp"}
        disabled={isLoading || !isOn || !webmcpOk}
        onClick={() => handleModeChange("webmcp")}
        title={webmcpOk ? "" : t("AgentRouteUnsupported")}
        className={`${segBase} border-l border-gray-300 dark:border-gray-600 ${
          mode === "webmcp"
            ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
            : "bg-transparent text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        } ${!isOn || !webmcpOk ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
      >
        <span className="whitespace-nowrap">{t("AgentRouteWebmcp")}</span>
      </button>
    </div>
  );

  return (
    <div className="mb-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
            {t("AgentControl")}
          </h2>
          <p className="text-xs text-gray-500">
            {mode === "webmcp"
              ? t("AgentSubtitleWebmcp")
              : t("AgentSubtitleWsDaemon")}
          </p>
        </div>
        {pill}
      </header>

      {/* Layer 0 — Enabled master kill-switch */}
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
            {t("AgentEnabledLabel")}
          </span>
          <span className="text-xs text-gray-500">
            {isOn ? t("AgentEnabledOnHint") : t("AgentEnabledOffHint")}
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

      {/* Active control route — dashed divider + segmented control (044 B) */}
      <div className="mt-3 border-t border-dashed border-gray-300 pt-3 dark:border-gray-600">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {t("AgentRouteTitle")}
        </span>
        {modeControl}
      </div>

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
