import { useCallback, useEffect, useState } from "react";
import { t } from "../lib/utils";
import {
  AGENT_BRIDGE_STORAGE_KEY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  type AgentBridgeStorage,
} from "excali-shared";

/**
 * Layer 0 — "Agent control" master switch + hide-button toggle (Options).
 *
 * Persisted via chrome.storage.local, DEFAULT OFF. OFF is a kill-switch: it hides
 * all agent UI in the popup + editor and tears down any pairing/activation (the
 * background SW reacts to the same storage change and clears its registry).
 *
 * "Hide the AI button on canvas" (Wayfinder 034 locked invariant) is adjustable
 * ONLY while the master is OFF: an active canvas must always have a visible stop
 * control, so turning master ON forces the canvas button visible.
 */
const AgentControl = () => {
  const [isOn, setIsOn] = useState(false);
  const [hideButton, setHideButton] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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

  return (
    <div className="mb-4">
      <header className="mb-3">
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t("AgentControl")}
        </h2>
        <p className="text-xs text-gray-500">{t("AgentControlDescription")}</p>
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
    </div>
  );
};

export default AgentControl;
