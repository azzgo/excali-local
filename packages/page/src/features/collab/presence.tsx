/**
 * PresenceFeed — the collaborators feed (Wayfinder 055; task 045).
 *
 * A fuller list surface than the chrome's roster dots: every present
 * collaborator as a row (avatar dot in the 055 native deriveColor hue, name +
 * short id), self outlined, join/leave = ~250ms fade (no toasts, no collision
 * badges — 055 resolution #4). Hosted in the session chrome behind a people
 * trigger (DropdownMenu), so the one-row chrome stays unwrapped.
 *
 * The feed carries the 055 user-list control, now a single checkbox (075):
 * checked = show the Excalidraw right-side UserList (default), unchecked =
 * quiet — the collaborators map omits `username` so Excalidraw's UserList
 * filter drops every member. Purely local, persisted via useLabelMode
 * (labels.ts); the same mode drives the collaborators map (the session hook
 * omits `username` from the collaborators map in quiet mode). The self row
 * shows the real per-room name with a "（自己）"/"(you)" marker (075).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil } from "lucide-react";
import { MEMBER_NAME_MAX_LENGTH } from "collab-core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatLabel, useLabelMode } from "./labels";
import type { CollabSessionHandle, RosterMember } from "./use-collab-session";
import { uniqueRosterForRender } from "./roster";

interface PresenceFeedProps {
  session: CollabSessionHandle;
  /** ADR 0006: open the my-name rename modal (hosted in SessionChrome). */
  onEditSelfName?: () => void;
}

/** Fade-out window for departed members (055: ~250ms both ways). */
const FEED_FADE_MS = 250;

export function PresenceFeed({ session, onEditSelfName }: PresenceFeedProps) {
  const [t] = useTranslation();
  const { mode, setMode } = useLabelMode();
  // ADR 0006: my-name rename modal state — the self roster entry's name.
  const [selfNameOpen, setSelfNameOpen] = useState(false);
  const [selfNameValue, setSelfNameValue] = useState("");
  const [selfNameError, setSelfNameError] = useState(false);

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
  const rendered = uniqueRosterForRender(session.peers, departed);

  /** ADR 0006: open the my-name rename modal seeded with the CURRENT
   *  per-room name (the self roster entry — NEVER the identity default). */
  const openSelfNameRename = () => {
    setSelfNameValue(session.selfName ?? "");
    setSelfNameError(false);
    setSelfNameOpen(true);
  };

  const submitSelfNameRename = () => {
    const trimmed = selfNameValue.trim();
    if (trimmed === "" || trimmed.length > MEMBER_NAME_MAX_LENGTH) {
      setSelfNameError(true);
      return;
    }
    if (session.renameSelf(trimmed)) setSelfNameOpen(false);
    // The self roster dot/chip is the feedback — no toast for your own rename.
  };

  return (
    <>
    <div data-testid="collab-presence-feed" className="w-64 space-y-2">
      {/* header: title + the 075 "show user list" checkbox (replaces the
          full/quiet segmented control — quiet's only effect is hiding the
          Excalidraw right-side UserList) */}
      <div className="flex items-center justify-between gap-2">
        <span data-testid="collab-feed-title" className="text-xs font-semibold">
          {t("CollabPresenceTitle")} ({session.peers.length})
        </span>
        <label
          data-testid="collab-show-userlist"
          title={t("CollabShowUserListHint")}
          className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={mode === "full"}
            data-testid="collab-show-userlist-checkbox"
            data-checked={mode === "full" ? "true" : undefined}
            aria-label={t("CollabShowUserList")}
            onClick={() => setMode(mode === "full" ? "quiet" : "full")}
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
              mode === "full"
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground/40 bg-muted text-muted-foreground",
            )}
          >
            {mode === "full" && <Check className="size-2.5" strokeWidth={3} />}
          </button>
          {t("CollabShowUserList")}
        </label>
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
                {/* 075: the self row shows the real per-room name with the
                    "（自己）"/"(you)" marker in parens — never the bare alias,
                    and WITHOUT the · short-id tail (075 follow-up). */}
                {m.self ? `${m.name}${t("CollabSelfMarker")}` : formatLabel(m.name, m.profileId)}
              </span>
              {/* ADR 0006: self row carries an edit affordance that opens the
                  my-name rename modal (prefilled with the current per-room name). */}
              {m.self && (
                <button
                  data-testid="collab-selfname-edit"
                  type="button"
                  title={t("CollabSelfNameEdit")}
                  aria-label={t("CollabSelfNameEdit")}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={onEditSelfName}
                >
                  <Pencil className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}
