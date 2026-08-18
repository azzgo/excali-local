/**
 * SessionChrome — the exclusive one-row session bar above the canvas
 * (Wayfinder 053 sessionLive — decided: OWN row, not excalidraw's internal
 * slot; one row, no wrap; 061 conn dot).
 *
 * Layout (left → right):
 *   room label + privacy badge · conn dot (+word when degraded) · spacer ·
 *   copy invite · save to gallery · leave
 *
 * No autosave indicator (053 round 3 — removed as redundant; the explicit
 * save button + leave modal carry the message).
 *
 * Presence: the roster dots are REMOVED (merged into Excalidraw's UserList
 * in the top-right). The PresenceFeed dropdown (behind the Users button)
 * provides the detailed list + label-mode setting + self-name edit.
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
import { MEMBER_NAME_MAX_LENGTH, ROOM_NAME_MAX_LENGTH } from "collab-core";
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
import { copyInvite } from "./invite";
import { useLabelMode } from "./labels";
import { PresenceFeed } from "./presence";
import { ROUTES } from "./routes";
import type { CollabRoomMeta, CollabSessionHandle } from "./use-collab-session";

interface SessionChromeProps {
  room: CollabRoomMeta;
  session: CollabSessionHandle;
}



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
  // ADR 0006: my-name rename modal state — the self roster entry's name.
  const [selfNameOpen, setSelfNameOpen] = useState(false);
  const [selfNameValue, setSelfNameValue] = useState("");
  const [selfNameError, setSelfNameError] = useState(false);
  // Dropdown control — close it when opening the self-name modal
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // Ref for the self-name input — manual focus for portaled modals
  const selfNameInputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the modal opens (autoFocus doesn't work in portals)
  useEffect(() => {
    if (selfNameOpen) {
      // Small delay to ensure the modal is fully rendered
      setTimeout(() => selfNameInputRef.current?.focus(), 50);
    }
  }, [selfNameOpen]);

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

  /** ADR 0006: open the my-name rename modal seeded with the CURRENT
   *  per-room name (the self roster entry — NEVER the identity default). */
  const openSelfNameRename = () => {
    setSelfNameValue(session.selfName ?? "");
    setSelfNameError(false);
    setSelfNameOpen(true);
    // Close the dropdown when opening the modal
    setDropdownOpen(false);
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

      <span className="flex-1" />

      {/* presence feed — the fuller collaborators list (055); the label-mode
          setting lives inside it; the roster dots stay the compact form */}
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
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
          <PresenceFeed session={session} onEditSelfName={openSelfNameRename} />
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

      {/* ADR 0006: my-name rename modal — prefilled with the CURRENT
          per-room name (the self roster entry, never the identity default) */}
      <Modal
        open={selfNameOpen}
        title={t("CollabSelfNameRename")}
        onDismiss={() => setSelfNameOpen(false)}
      >
        <div data-testid="collab-selfname-modal" className="space-y-3">
          <label htmlFor="collab-selfname-input" className="text-xs font-semibold">
            {t("CollabSelfNameLabel")}
          </label>
          <Input
            ref={selfNameInputRef}
            id="collab-selfname-input"
            data-testid="collab-selfname-input"
            value={selfNameValue}
            maxLength={MEMBER_NAME_MAX_LENGTH}
            onChange={(e) => {
              setSelfNameValue(e.target.value);
              setSelfNameError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSelfNameRename();
            }}
          />
          {selfNameError && (
            <p data-testid="collab-selfname-error" className="text-xs text-red-500">
              {t("CollabSelfNameInvalid")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              data-testid="collab-selfname-save"
              className="w-full"
              onClick={submitSelfNameRename}
            >
              {t("CollabRenameSave")}
            </Button>
            <Button
              data-testid="collab-selfname-cancel"
              variant="ghost"
              className="w-full"
              onClick={() => setSelfNameOpen(false)}
            >
              {t("CollabCancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

