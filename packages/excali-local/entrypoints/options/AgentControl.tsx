import { useEffect, useState } from "react";
import { t } from "../lib/utils";
import {
  AGENT_BRIDGE_STORAGE_KEY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  type AgentBridgeStorage,
} from "excali-shared";

/**
 * Layer 0 — "Agent control" master switch (Options).
 *
 * Persisted via chrome.storage.local, DEFAULT OFF. OFF is a kill-switch: it hides
 * all agent UI in the popup + editor and tears down any pairing/activation (the
 * background SW reacts to the same storage change and clears its registry).
 */
const AgentControl = () => {
  const [isOn, setIsOn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    browser.storage.local
      .get(AGENT_BRIDGE_STORAGE_KEY)
      .then((result) => {
        const stored = result[AGENT_BRIDGE_STORAGE_KEY] as
          | AgentBridgeStorage
          | undefined;
        setIsOn(stored?.master ?? AGENT_BRIDGE_DEFAULT_STORAGE.master);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleToggle = () => {
    const next = !isOn;
    setIsOn(next);
    browser.storage.local.set({
      [AGENT_BRIDGE_STORAGE_KEY]: {
        master: next,
        pairing: false, // flipping master OFF (or re-enabling) resets pairing
      },
    });
  };

  return (
    <div className="mb-4">
      <header className="mb-3">
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          {t("AgentControl")}
        </h2>
        <p className="text-xs text-gray-500">{t("AgentControlDescription")}</p>
      </header>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        disabled={isLoading}
        onClick={handleToggle}
        className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors duration-200 cursor-pointer disabled:opacity-50 ${
          isOn
            ? "bg-blue-50 border-blue-300 dark:bg-blue-950 dark:border-blue-700"
            : "bg-gray-50 border-gray-300 dark:bg-gray-800 dark:border-gray-700"
        }`}
      >
        <span
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
            isOn ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
              isOn ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </span>
        <span className="flex flex-col text-left">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {isOn ? t("AgentControlOn") : t("AgentControlOff")}
          </span>
          <span className="text-xs text-gray-500">
            {isOn ? t("AgentControlEnabledHint") : t("AgentControlDisabledHint")}
          </span>
        </span>
      </button>
    </div>
  );
};

export default AgentControl;
