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
 *
 * Task 082: non-self rows gain hover-revealed dual icons (cursor jump + follow
 * toggle). Jump targets the CLICKED row (ADR 0008): their live presenter
 * viewport when presenting, else their last known pointer position (055);
 * grayed/disabled when nothing is known. Enabled jump calls applyViewport
 * once (one-shot hop — pointer hops keep the current zoom). Follow icon is
 * shown only on presenting rows; clicking toggles follow (setFollowTarget).
 * The self row gains a Present toggle (startPresenting/stopPresenting).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil } from "lucide-react";
import {
  IconEye,
  IconFocusCentered,
  IconPresentation,
} from "@tabler/icons-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { MEMBER_NAME_MAX_LENGTH } from "collab-core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatLabel, useLabelMode } from "./labels";
import type { CollabSessionHandle, RosterMember } from "./use-collab-session";
import { uniqueRosterForRender } from "./roster";
import { applyViewport } from "./follow-engine";

interface PresenceFeedProps {
  session: CollabSessionHandle;
  /**
   * Excalidraw imperative API — required for applyViewport (jump hop).
   * Passed through by the parent (RoomScreen → SessionChrome → PresenceFeed).
   */
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  /** ADR 0006: open the my-name rename modal (hosted in SessionChrome). */
  onEditSelfName?: () => void;
}

/** Fade-out window for departed members (055: ~250ms both ways). */
const FEED_FADE_MS = 250;

/**
 * One-shot cursor-jump target (ADR 0008): the clicked member's OWN data
 * only — never the follow target's. Priority:
 *   1. live presenter viewport when the row is presenting (present frames)
 *   2. last known pointer position (the 055 pointer stream) otherwise
 *   3. null — nothing known → the jump button renders disabled/grayed
 *
 * `z` is present only for viewport hops (the presenter's zoom, applied
 * verbatim); pointer hops keep the jumper's current zoom.
 */
export type JumpTarget = { x: number; y: number; z?: number };

export function pickJumpTarget(row: RosterMember): JumpTarget | null {
  if (row.presenting === true && row.lastKnownViewport) {
    return {
      x: row.lastKnownViewport.x,
      y: row.lastKnownViewport.y,
      z: row.lastKnownViewport.z,
    };
  }
  if (row.lastKnownPointer) {
    return { x: row.lastKnownPointer.x, y: row.lastKnownPointer.y };
  }
  return null;
}

export function PresenceFeed({ session, excalidrawAPI, onEditSelfName }: PresenceFeedProps) {
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

  // --- jump: one-shot hop to the clicked member's target ---------------------
  const handleJump = (row: RosterMember) => {
    if (!excalidrawAPI) return;
    const target = pickJumpTarget(row);
    if (!target) return;
    // Pointer hops carry no zoom — keep the jumper's current zoom; viewport
    // hops apply the presenter's zoom verbatim (ADR 0008, zero adaptation).
    const zoom =
      target.z !== undefined
        ? ({ value: target.z } as import("@excalidraw/excalidraw/types").Zoom)
        : (excalidrawAPI.getAppState().zoom ?? { value: 1 });
    applyViewport(excalidrawAPI, { scrollX: target.x, scrollY: target.y, zoom });
  };

  // --- follow toggle ----------------------------------------------------------
  const handleFollowToggle = (profileId: string) => {
    const next = session.followTargetId === profileId ? null : profileId;
    session.setFollowTarget(next);
  };

  return (
    <>
      <div data-testid="collab-presence-feed" className="w-64 space-y-2">
        {/* header: title + the 075 "show user list" checkbox */}
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
              <Row
                key={m.profileId}
                m={m}
                leaving={leaving}
                session={session}
                onEditSelfName={onEditSelfName}
                excalidrawAPI={excalidrawAPI}
                onJump={handleJump}
                onFollowToggle={handleFollowToggle}
              />
            ))}
          </div>
        )}
      </div>

      {/* ADR 0006: self-name rename modal */}
      <Modal
        open={selfNameOpen}
        onDismiss={() => setSelfNameOpen(false)}
        title={t("CollabSelfNameRename")}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("CollabSelfNameLabel")}</span>
            <Input
              value={selfNameValue}
              onChange={(e) => setSelfNameValue(e.target.value)}
              className="mt-1"
              autoFocus
            />
          </label>
          {selfNameError && (
            <p className="text-xs text-destructive">{t("CollabSelfNameInvalid")}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelfNameOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button size="sm" onClick={submitSelfNameRename}>
              {t("CollabRenameSave")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Row sub-component (co-located for readability)                       */
/* ------------------------------------------------------------------ */

interface RowProps {
  m: RosterMember;
  leaving: boolean;
  session: CollabSessionHandle;
  onEditSelfName?: () => void;
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  onJump: (row: RosterMember) => void;
  onFollowToggle: (profileId: string) => void;
}

function Row({ m, leaving, session, onEditSelfName, excalidrawAPI, onJump, onFollowToggle }: RowProps) {
  const [t] = useTranslation();
  const [hovered, setHovered] = useState(false);

  const isSelf = m.self;
  // 082 (ADR 0008): jump target = the CLICKED row's own data only — live
  // presenter viewport when presenting, else last known pointer. Grayed
  // (disabled) when nothing is known about this row.
  const jumpTarget = isSelf ? null : pickJumpTarget(m);
  const jumpDisabled = jumpTarget === null;
  const isFollowing = session.followTargetId === m.profileId;
  const showFollow = !isSelf && m.presenting === true;

  const handleJumpClick = () => {
    if (jumpDisabled) return;
    onJump(m);
  };

  const handleFollowClick = () => {
    onFollowToggle(m.profileId);
  };

  return (
    <div
      data-testid={`collab-feed-row-${m.profileId}`}
      data-self={isSelf ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-1 py-1",
        leaving
          ? "opacity-0 transition-opacity duration-250"
          : "animate-in fade-in duration-250",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* avatar dot */}
      <span
        data-testid={`collab-feed-dot-${m.profileId}`}
        className={cn(
          "size-3 shrink-0 rounded-full",
          isSelf && "ring-2 ring-foreground ring-offset-1",
        )}
        style={{ background: m.color }}
      />

      {/* name label */}
      <span data-testid={`collab-feed-label-${m.profileId}`} className="truncate text-xs">
        {isSelf ? `${m.name}${t("CollabSelfMarker")}` : formatLabel(m.name, m.profileId)}
      </span>

      {/* --- self row actions (ADR 0006 edit + 082 Present toggle) --- */}
      {isSelf && (
        <>
          {/* ADR 0006: my-name edit */}
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
          {/* 082: Present toggle */}
          <button
            data-testid="collab-self-present-btn"
            type="button"
            title={
              session.presentingSelf
                ? t("CollabStopPresenting")
                : t("CollabStartPresenting")
            }
            aria-label={
              session.presentingSelf
                ? t("CollabStopPresenting")
                : t("CollabStartPresenting")
            }
            data-presenting={session.presentingSelf ? "true" : undefined}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() =>
              session.presentingSelf ? session.stopPresenting() : session.startPresenting()
            }
          >
            <IconPresentation className="size-3" />
          </button>
        </>
      )}

      {/* --- non-self row hover actions (082: jump + follow) --- */}
      {!isSelf && hovered && (
        <>
          {/* Jump: cursor-jump to peer's viewport */}
          <button
            data-testid={`collab-row-jump-${m.profileId}`}
            type="button"
            title={t("CollabJumpToViewport")}
            aria-label={t("CollabJumpToViewport")}
            aria-disabled={jumpDisabled}
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors",
              jumpDisabled
                ? "cursor-not-allowed text-muted-foreground/40"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={handleJumpClick}
          >
            <IconFocusCentered className="size-3" />
          </button>

          {/* Follow: only on presenting rows */}
          {showFollow && (
            <button
              data-testid={`collab-row-follow-${m.profileId}`}
              type="button"
              title={t("CollabFollowToggle")}
              aria-label={t("CollabFollowToggle")}
              data-follow-active={isFollowing ? "true" : undefined}
              className={cn(
                "shrink-0 rounded p-0.5 transition-colors",
                isFollowing
                  ? "text-foreground hover:bg-muted"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={handleFollowClick}
            >
              <IconEye className={cn("size-3", isFollowing && "fill-current")} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
