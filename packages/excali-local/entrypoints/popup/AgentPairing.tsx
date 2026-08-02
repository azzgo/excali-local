import { useEffect, useState } from "react";
import { t } from "../lib/utils";
import {
  AGENT_BRIDGE_STORAGE_KEY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  type AgentBridgeStorage,
} from "excali-shared";
import { IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";

/**
 * Gate 1 — "Pair with agent" control (popup).
 *
 * Shown only when the Layer 0 master switch is ON (kill-switch semantics).
 * Opening it enables agent control at the connection level by persisting
 * `pairing` in chrome.storage.local. The background SW tears down all
 * activations when pairing goes OFF.
 */
const AgentPairing = () => {
  const [storage, setStorage] = useState<AgentBridgeStorage>(
    AGENT_BRIDGE_DEFAULT_STORAGE,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    browser.storage.local
      .get(AGENT_BRIDGE_STORAGE_KEY)
      .then((result) => {
        const stored = result[AGENT_BRIDGE_STORAGE_KEY] as
          | AgentBridgeStorage
          | undefined;
        setStorage(stored ?? AGENT_BRIDGE_DEFAULT_STORAGE);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Live-update if the master switch changes while the popup is open
  useEffect(() => {
    const onChange = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => {
      if (area === "local" && changes[AGENT_BRIDGE_STORAGE_KEY]) {
        setStorage(
          (changes[AGENT_BRIDGE_STORAGE_KEY].newValue as AgentBridgeStorage) ??
            AGENT_BRIDGE_DEFAULT_STORAGE,
        );
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  if (isLoading) return null;
  if (!storage.master) return null; // Layer 0 OFF = kill-switch: hide pairing UI

  const isPaired = storage.pairing;
  const handleToggle = () => {
    const next = !isPaired;
    setStorage((prev) => ({ ...prev, pairing: next }));
    browser.storage.local.set({
      [AGENT_BRIDGE_STORAGE_KEY]: { ...storage, pairing: next },
    });
  };

  return (
    <div className="mb-2">
      <div className="flex flex-row items-center justify-between border-t border-b border-gray-300 dark:border-gray-800 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {t("AgentPairing")}
          </span>
          <span className="text-xs text-gray-500">
            {isPaired ? t("AgentPairingPaired") : t("AgentPairingUnpaired")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPaired}
          onClick={handleToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            isPaired
              ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          {isPaired ? (
            <>
              <IconPlugConnected className="size-4" />
              {t("UnpairAgent")}
            </>
          ) : (
            <>
              <IconPlugConnectedX className="size-4" />
              {t("PairAgent")}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default AgentPairing;
