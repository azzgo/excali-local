/**
 * Config-change propagation banner (Wayfinder 056 Q6).
 *
 * Options / the webapp mirror write COLLAB_SERVER_CONFIG; open editor pages
 * pick the change up via chrome.storage.onChanged (the use-server-config live
 * pattern). Under a LIVE room session that must NOT mean auto-reconnect — the
 * session's admission belonged to the old config, so silently re-dialing the
 * new org is worse than asking (056 Q6):
 *
 *   - live session  → this amber banner + a manual Reload button; the session
 *     keeps running on its snapshot (the admission freeze in
 *     use-collab-session) — reloading reconnects with the new config.
 *   - no live session → nothing to banner; the config updates in place via
 *     use-server-config's onChanged listener.
 *
 * Extension form only (getBrowser() non-null): localStorage has no onChanged
 * signal, and the webapp mirror is the only writer in webapp mode — same-tab
 * reads are fresh anyway, so the banner would be dead code there.
 *
 * `useConfigPropagation(live)` is exported separately so tests / other
 * surfaces can drive the banner from their own session state.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { getBrowser } from "@/lib/utils";
import { COLLAB_SERVER_CONFIG } from "./storage";

/**
 * Watch chrome.storage.onChanged for COLLAB_SERVER_CONFIG. Fires `changed`
 * only while a session is live (`live` is read through a ref so the listener
 * stays stable). Never reconnects anything — the banner is informational;
 * the Reload button is the only path to the new config (056 Q6).
 */
export function useConfigPropagation(live: boolean): { changed: boolean } {
  const [changed, setChanged] = useState(false);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    const browser = getBrowser();
    if (!browser?.storage?.onChanged) return;
    const onChange = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => {
      if (area !== "local" || changes[COLLAB_SERVER_CONFIG] === undefined) return;
      if (liveRef.current) setChanged(true);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  return { changed };
}

interface ConfigPropagationBannerProps {
  /** true while a room session is connected (use-collab-session `live`). */
  live: boolean;
}

/** Amber banner: server config changed under a live session (056 Q6). */
export function ConfigPropagationBanner({ live }: ConfigPropagationBannerProps) {
  const [t] = useTranslation();
  const { changed } = useConfigPropagation(live);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when the underlying config-change signal goes away and
  // comes back (so a later change under a live session is still surfaced).
  useEffect(() => {
    if (changed) setDismissed(false);
  }, [changed]);

  if (!changed || dismissed) return null;
  return (
    <div
      data-testid="collab-config-propagation"
      className="relative flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 pr-6 text-xs shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <button
        type="button"
        aria-label={t("AgentDismiss")}
        className="absolute right-1 top-1 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        onClick={() => setDismissed(true)}
      >
        <X className="size-3" />
      </button>
      <span className="mt-1 shrink-0 text-amber-600 dark:text-amber-400">⚠</span>
      <div className="min-w-0 grow">
        <div className="font-semibold text-amber-800 dark:text-amber-300">
          {t("CollabConfigChangeTitle")}
        </div>
        <p className="mt-0.5 text-amber-700/80 dark:text-amber-400/80">
          {t("CollabConfigChangeBody")}
        </p>
      </div>
      <Button
        data-testid="collab-config-propagation-reload"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => window.location.reload()}
      >
        {t("CollabConfigReload")}
      </Button>
    </div>
  );
}
