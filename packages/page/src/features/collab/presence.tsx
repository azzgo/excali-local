/**
 * PresenceFeed — the collaborators feed (Wayfinder 055; task 045).
 *
 * A fuller list surface than the chrome's roster dots: every present
 * collaborator as a row (avatar dot in the 055 native deriveColor hue, name +
 * short id), self outlined, join/leave = ~250ms fade (no toasts, no collision
 * badges — 055 resolution #4). Hosted in the session chrome behind a people
 * trigger (DropdownMenu), so the one-row chrome stays unwrapped.
 *
 * The feed also carries the 055 label-mode setting: 最全 (default — full
 * `名·短id` labels) vs 安静 (quiet — username omitted, identity via the dots
 * and short ids only). Purely local, persisted via useLabelMode (labels.ts);
 * the same mode drives the canvas chips (the session hook omits `username`
 * from the collaborators map in quiet mode).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatLabel, useLabelMode } from "./labels";
import type { CollabSessionHandle, RosterMember } from "./use-collab-session";

interface PresenceFeedProps {
  session: CollabSessionHandle;
}

/** Fade-out window for departed members (055: ~250ms both ways). */
const FEED_FADE_MS = 250;

export function PresenceFeed({ session }: PresenceFeedProps) {
  const [t] = useTranslation();
  const { mode, setMode } = useLabelMode();

  // --- roster fade (055): departed rows linger ~250ms at opacity 0 ---------
  const prevPeersRef = useRef<RosterMember[]>([]);
  const [departed, setDeparted] = useState<RosterMember[]>([]);
  useEffect(() => {
    const prev = prevPeersRef.current;
    prevPeersRef.current = session.peers;
    const curIds = new Set(session.peers.map((p) => p.profileId));
    const gone = prev.filter((m) => !curIds.has(m.profileId));
    if (gone.length === 0) return;
    const timer = setTimeout(() => {
      setDeparted((cur) =>
        cur.filter((m) => !gone.some((g) => g.profileId === m.profileId)),
      );
    }, FEED_FADE_MS);
    // Drop re-joined ids immediately (they render from `session.peers` now).
    setDeparted((cur) => [
      ...cur.filter((m) => !curIds.has(m.profileId)),
      ...gone,
    ]);
    return () => clearTimeout(timer);
  }, [session.peers]);
  // Render-time dedupe: live members win over departing entries (same key).
  const rendered: Array<{ m: RosterMember; leaving: boolean }> = [];
  const seen = new Set<string>();
  for (const m of session.peers) {
    seen.add(m.profileId);
    rendered.push({ m, leaving: false });
  }
  for (const m of departed) {
    if (!seen.has(m.profileId)) rendered.push({ m, leaving: true });
  }

  return (
    <div data-testid="collab-presence-feed" className="w-64 space-y-2">
      {/* header: title + the 055 label-mode toggle */}
      <div className="flex items-center justify-between gap-2">
        <span data-testid="collab-feed-title" className="text-xs font-semibold">
          {t("CollabPresenceTitle")} ({session.peers.length})
        </span>
        <span
          data-testid="collab-label-mode"
          role="group"
          aria-label={t("CollabLabelModeTitle")}
          title={t("CollabLabelModeHint")}
          className="flex items-center gap-0.5 rounded-full border bg-muted p-0.5"
        >
          <button
            data-testid="collab-label-mode-full"
            data-active={mode === "full" ? "true" : undefined}
            onClick={() => setMode("full")}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              mode === "full"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("CollabLabelModeFull")}
          </button>
          <button
            data-testid="collab-label-mode-quiet"
            data-active={mode === "quiet" ? "true" : undefined}
            onClick={() => setMode("quiet")}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              mode === "quiet"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("CollabLabelModeQuiet")}
          </button>
        </span>
      </div>

      {/* the list — avatar dot (055 native hue), name · short id, self outlined */}
      {rendered.length === 0 ? (
        <p data-testid="collab-feed-empty" className="px-1 py-2 text-xs text-muted-foreground">
          {t("CollabPresenceEmpty")}
        </p>
      ) : (
        <div data-testid="collab-feed-list" className="space-y-1">
          {rendered.map(({ m, leaving }) => (
            <div
              key={m.profileId}
              data-testid={`collab-feed-row-${m.profileId}`}
              data-self={m.self ? "true" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-1 py-1",
                leaving
                  ? "opacity-0 transition-opacity duration-250"
                  : "animate-in fade-in duration-250",
              )}
            >
              <span
                data-testid={`collab-feed-dot-${m.profileId}`}
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  // 055: self dot gets an outline ring
                  m.self && "ring-2 ring-foreground ring-offset-1",
                )}
                style={{ background: m.color }}
              />
              <span data-testid={`collab-feed-label-${m.profileId}`} className="truncate text-xs">
                {m.self ? t("CollabYou") : formatLabel(m.name, m.profileId, mode)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
