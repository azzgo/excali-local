import { useEffect, useState } from "react";
import { getBrowser } from "@/lib/utils";
import {
  COLLAB_SERVER_CONFIG,
  parseStoredConfig,
  type ServerConfig,
} from "../storage";

/**
 * Read + live-watch the server admission config (056 Q2 storage propagation:
 * Options write → chrome.storage.onChanged → open editor pages update live).
 * Same storage pattern as use-agent-bridge.ts: chrome.storage.local in the
 * extension, localStorage fallback when getBrowser() is null (webapp form).
 *
 * READ-ONLY — writes belong to the Options section / the webapp mirror (049).
 * `loaded` flips true after the first read so screens can avoid flashing a
 * "not configured" state before storage answers.
 */
export function useServerConfig(): {
  config: ServerConfig | null;
  loaded: boolean;
} {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const browser = getBrowser();
    let cancelled = false;
    if (browser?.storage?.local) {
      browser.storage.local
        .get(COLLAB_SERVER_CONFIG)
        .then((result: Record<string, unknown>) => {
          if (cancelled) return;
          setConfig(parseStoredConfig(result[COLLAB_SERVER_CONFIG]));
          setLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setLoaded(true);
        });
      const onChange = (
        changes: Record<string, { newValue?: unknown }>,
        area: string,
      ) => {
        if (area === "local" && changes[COLLAB_SERVER_CONFIG]) {
          setConfig(parseStoredConfig(changes[COLLAB_SERVER_CONFIG].newValue));
        }
      };
      browser.storage.onChanged.addListener(onChange);
      return () => {
        cancelled = true;
        browser.storage.onChanged.removeListener(onChange);
      };
    }
    // Webapp fallback (getBrowser() null — also the test path).
    setConfig(parseStoredConfig(localStorage.getItem(COLLAB_SERVER_CONFIG)));
    setLoaded(true);
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, loaded };
}
