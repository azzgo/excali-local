/**
 * SessionChrome — the exclusive one-row session bar above the canvas
 * (Wayfinder 053 sessionLive — decided: OWN row, not excalidraw's internal
 * slot; one row, no wrap; 055 roster = color dots only, hover pops
 * name·short id, self outlined, join/leave ~250ms fade; 061 conn dot).
 *
 * Layout (left → right):
 *   room label + privacy badge · conn dot (+word when degraded) · roster
 *   dots · spacer · copy invite · save to gallery · leave
 *
 * No autosave indicator (053 round 3 — removed as redundant; the explicit
 * save button + leave modal carry the message).
 *
 * Seams:
 * - `session.conn` / `session.reconnect` / `session.lastError` feed the
 *   conn dot. Task 046 owns the full health vocabulary (banner strip under
 *   the bar, tooltip detail lines, degraded copy) — this task renders the
 *   simple 4-state dot (live green steady · connecting blue pulse ·
 *   reconnecting amber pulse · rejected red steady + word) and leaves the
 *   state data on the handle for 046 to refine.
 * - `session.resets` is NOT rendered here — 047 renders the amber reset
 *   notice.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, DoorOpen, Pencil, Save, Users } from "lucide-react";
import { ROOM_NAME_MAX_LENGTH } from "collab-core";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyInvite } from "./invite";
import { formatLabel, useLabelMode } from "./labels";
import { PresenceFeed } from "./presence";
import { ROUTES } from "./routes";
import type { CollabRoomMeta, CollabSessionHandle, RosterMember } from "./use-collab-session";
import { uniqueRosterForRender } from "./roster";

interface SessionChromeProps {
  room: CollabRoomMeta;
  session: CollabSessionHandle;
}

/** Fade-out window for departed roster dots (055: ~250ms both ways). */
const ROSTER_FADE_MS = 250;

export function SessionChrome({ room, session }: SessionChromeProps) {
  const [t] = useTranslation();
  const { mode: labelMode } = useLabelMode();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // ADR 0004: rename modal state — anyone may rename, LWW.
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState(false);
  // --- roster fade (055): departed dots linger ~250ms at opacity 0 ---------
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
    }, ROSTER_FADE_MS);
    // Drop re-joined ids immediately (they render from `session.peers` now).
    setDeparted((cur) => [
      ...cur.filter((m) => !curIds.has(m.profileId)),
      ...gone,
    ]);
    return () => clearTimeout(timer);
  }, [session.peers]);
  const renderedRoster = uniqueRosterForRender(session.peers, departed);

  // --- conn dot (061 §1 vocabulary — 046 refines copy/tooltip) ------------
  const conn = session.conn;
  const degraded = conn === "connecting" || conn === "reconnecting" || conn === "rejected";
  const connDotClass =
    conn === "connected"
      ? "bg-emerald-500"
      : conn === "connecting"
        ? "bg-sky-500 animate-pulse"
        : conn === "reconnecting"
          ? "bg-amber-500 animate-pulse"
          : conn === "rejected"
            ? "bg-red-500"
            : "bg-muted-foreground/40";
  const connLabel =
    conn === "connected"
      ? t("CollabConnLive")
      : conn === "connecting"
        ? t("CollabConnConnecting")
        : conn === "reconnecting"
          ? t("CollabConnReconnecting")
          : conn === "rejected"
            ? t("CollabConnRejected")
            : t("CollabConnIdle");
  const connDetail =
    session.reconnect !== null
      ? ` · ${t("CollabConnReconnectDetail", {
          n: session.reconnect.attempt + 1,
          s: Math.round(session.reconnect.delayMs / 1000),
        })}`
      : "";

  // --- actions ------------------------------------------------------------
  const handleCopy = async () => {
    if (await copyInvite(t, "room", room.invite, { name: room.label })) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (await session.saveToGallery()) {
        toast.success(t("CollabSavedToGallery"));
      } else {
        toast.error(t("CollabSaveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  /** 053 leave modal — Save & leave / Leave without saving / Stay. */
  const handleSaveAndLeave = async () => {
    setLeaveOpen(false);
    const ok = await session.saveToGallery();
    if (!ok) {
      // The cache is the only local copy — never destroy it on a failed save.
      toast.error(t("CollabSaveFailed"));
      return;
    }
    session.leave();
    window.location.hash = ROUTES.rooms;
  };

  const handleLeaveWithoutSaving = () => {
    setLeaveOpen(false);
    session.leave();
    window.location.hash = ROUTES.rooms;
  };

  /** ADR 0004: open the rename modal seeded with the current name. */
  const openRename = () => {
    setRenameValue(session.roomName ?? room.label);
    setRenameError(false);
    setRenameOpen(true);
  };

  const submitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed === "" || trimmed.length > ROOM_NAME_MAX_LENGTH) {
      setRenameError(true);
      return;
    }
    if (session.rename(trimmed)) setRenameOpen(false);
    // The chrome label is the feedback — no toast for your own rename.
  };

  /** ADR 0004: the shared room name wins once the relay states one; the boot
   *  label (and its short-id fallback) only show before/without a name. */
  const displayName = session.roomName ?? room.label;

  return (
    <div
      data-testid="collab-session-chrome"
      className="flex items-center gap-2 whitespace-nowrap border-b bg-background px-3 py-1.5 text-xs"
    >
      {/* room label + rename (ADR 0004 — anyone may rename) + privacy badge */}
      <span
        data-testid="collab-room-label"
        className="min-w-0 max-w-56 truncate font-semibold text-foreground"
        title={displayName}
      >
        {displayName}
      </span>
      <button
        data-testid="collab-rename-room"
        type="button"
        title={t("CollabRenameRoom")}
        aria-label={t("CollabRenameRoom")}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={openRename}
      >
        <Pencil className="size-3" />
      </button>
      <span
        data-testid="collab-room-tier"
        className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
      >
        {t(room.tier === "private" ? "CollabTierBadgePrivate" : "CollabTierBadgeTeam")}
      </span>


      {/* conn dot — 046 owns the full health copy; dot-only when live (061 §1) */}
      <span
        data-testid="collab-conn-dot"
        data-state={conn}
        title={`${connLabel}${connDetail}`}
        className="flex shrink-0 items-center gap-1.5"
      >
        <span className={cn("size-2.5 rounded-full", connDotClass)} />
        {degraded && (
          <span data-testid="collab-conn-word" className="text-muted-foreground">
            {connLabel}
          </span>
        )}
      </span>

      {/* roster — color dots only; hover pops name·short id (055) */}
      <span
        data-testid="collab-roster"
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto"
      >
        {renderedRoster.map(({ m, leaving }) => (
          <Tooltip key={m.profileId}>
            <TooltipTrigger asChild>
              <span
                data-testid={`collab-roster-dot-${m.profileId}`}
                data-self={m.self ? "true" : undefined}
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  // 055: self dot gets an outline ring; join/leave = ~250ms fade
                  m.self && "ring-2 ring-foreground ring-offset-1",
                  leaving
                    ? "opacity-0 transition-opacity duration-250"
                    : "animate-in fade-in duration-250",
                )}
                style={{ background: m.color }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {m.self ? t("CollabYou") : formatLabel(m.name, m.profileId, labelMode)}
            </TooltipContent>
          </Tooltip>
        ))}
      </span>

      <span className="flex-1" />

      {/* presence feed — the fuller collaborators list (055); the label-mode
          setting lives inside it; the roster dots stay the compact form */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-testid="collab-feed-trigger"
            variant="ghost"
            size="sm"
            className="shrink-0 px-2 text-xs"
          >
            <Users className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="p-2">
          <PresenceFeed session={session} />
        </DropdownMenuContent>
      </DropdownMenu>
      {/* copy invite (054: the invite IS the room — always re-copyable) */}
      <Button
        data-testid="collab-copy-invite"
        variant="ghost"
        size="sm"
        className="shrink-0 px-2 text-xs"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        {copied ? t("CollabCopied") : t("CollabCopyInvite")}
      </Button>

      {/* explicit save to my gallery — no autosave indicator (053/061) */}
      <Button
        data-testid="collab-save-to-gallery"
        variant="outline"
        size="sm"
        className="shrink-0 px-2 text-xs"
        disabled={saving}
        onClick={handleSave}
      >
        <Save className="size-3.5" />
        {t("CollabSaveToGallery")}
      </Button>

      <Button
        data-testid="collab-leave"
        variant="ghost"
        size="sm"
        className="shrink-0 px-2 text-xs text-muted-foreground"
        onClick={() => setLeaveOpen(true)}
      >
        <DoorOpen className="size-3.5" />
        {t("CollabLeave")}
      </Button>

      {/* leave modal — 3 actions (053 round 1: modal, not dismissible banner) */}
      <Modal
        open={leaveOpen}
        title={t("CollabLeaveTitle")}
        onDismiss={() => setLeaveOpen(false)}
      >
        <div data-testid="collab-leave-modal" className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("CollabLeaveBody")}</p>
          <div className="flex flex-col gap-2">
            <Button
              data-testid="collab-leave-save"
              className="w-full"
              onClick={() => void handleSaveAndLeave()}
            >
              {t("CollabLeaveSaveAndLeave")}
            </Button>
            <Button
              data-testid="collab-leave-discard"
              variant="secondary"
              className="w-full"
              onClick={handleLeaveWithoutSaving}
            >
              {t("CollabLeaveWithoutSaving")}
            </Button>
            <Button
              data-testid="collab-leave-stay"
              variant="ghost"
              className="w-full"
              onClick={() => setLeaveOpen(false)}
            >
              {t("CollabStay")}
            </Button>
          </div>
        </div>
      </Modal>


      {/* ADR 0004: rename modal — any member may rename, LWW (no owner) */}
      <Modal
        open={renameOpen}
        title={t("CollabRenameRoom")}
        onDismiss={() => setRenameOpen(false)}
      >
        <div data-testid="collab-rename-modal" className="space-y-3">
          <label htmlFor="collab-rename-input" className="text-xs font-semibold">
            {t("CollabRenameLabel")}
          </label>
          <Input
            id="collab-rename-input"
            data-testid="collab-rename-input"
            value={renameValue}
            maxLength={ROOM_NAME_MAX_LENGTH}
            autoFocus
            onChange={(e) => {
              setRenameValue(e.target.value);
              setRenameError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
          />
          {renameError && (
            <p data-testid="collab-rename-error" className="text-xs text-red-500">
              {t("CollabRenameInvalid")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              data-testid="collab-rename-save"
              className="w-full"
              onClick={submitRename}
            >
              {t("CollabRenameSave")}
            </Button>
            <Button
              data-testid="collab-rename-cancel"
              variant="ghost"
              className="w-full"
              onClick={() => setRenameOpen(false)}
            >
              {t("CollabCancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
