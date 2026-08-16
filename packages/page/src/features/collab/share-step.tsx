import { useTranslation } from "react-i18next";
import type { RoomInvite } from "collab-core";
import { Button } from "@/components/ui/button";
import {
  copyInvite,
  copyInviteCode,
  inviteCode,
  inviteSentence,
} from "./invite";

interface ShareStepProps {
  /** Room label — shown in the card and interpolated into the clipboard sentence. */
  name: string;
  /** Room invite payload (shareId/tier/roomSecret/fp) — the copyable code derives from it. */
  invite: RoomInvite;
  /** Ghost "Skip — enter room" (053: transient share step right after create). */
  onSkip?: () => void;
  /** Called after a successful clipboard write (full or code-only). */
  onCopied?: () => void;
}

/**
 * Post-create share step (Wayfinder 053 intermediate step / 054 prototype
 * "shareStep" screen). Shows the generated room invite as **sentence + code**
 * (054 Q1): primary "Copy invite", secondary "Copy code only", ghost
 * "Skip — enter room", one amber caution line (member invite). Per 054 there is
 * NO toast after copy — the clipboard preview box above the buttons IS the
 * confirmation, so no transient state is kept here.
 *
 * Used by the create flow (043) and re-copy surfaces; the code is derived from
 * the payload via collab-core so re-copy always yields the identical code
 * (054 Q2: tier is immutable at create — changing tier = new room).
 */
export default function ShareStep({ name, invite, onSkip, onCopied }: ShareStepProps) {
  const [t] = useTranslation();
  const code = inviteCode("room", invite);
  const sentence = inviteSentence(t, "room", invite, { name });
  const fullText = `${sentence}\n${code}`;

  const handleCopy = async () => {
    if (await copyInvite(t, "room", invite, { name })) onCopied?.();
  };

  const handleCopyCode = async () => {
    if (await copyInviteCode("room", invite)) onCopied?.();
  };

  return (
    <div data-testid="collab-share-step" className="space-y-3">
      <h1 className="text-lg font-semibold tracking-tight">{t("CollabShareTitle")}</h1>

      {/* room card — 054 prototype: name + tier badge + "anyone with the invite can edit" */}
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm shadow-xs dark:border-emerald-500/40 dark:bg-emerald-500/10">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{name}</span>
          <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {t(invite.tier === "private" ? "CollabTierBadgePrivate" : "CollabTierBadgeTeam")}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("CollabShareAnyoneEdits")}</p>
      </div>

      {/* clipboard preview — the box IS the confirmation (054: no toast) */}
      <div
        data-testid="collab-share-preview"
        className="rounded-lg border border-dashed bg-muted/50 p-3 font-mono text-xs break-all"
      >
        {sentence}
        <br />
        {code}
      </div>

      <Button data-testid="collab-share-copy" className="w-full" onClick={handleCopy}>
        {t("CollabShareCopy")}
      </Button>
      <div className="flex gap-2">
        <Button
          data-testid="collab-share-copy-code"
          variant="secondary"
          className="flex-1"
          onClick={handleCopyCode}
        >
          {t("CollabShareCopyCode")}
        </Button>
        <Button
          data-testid="collab-share-skip"
          variant="ghost"
          className="flex-1"
          onClick={onSkip}
        >
          {t("CollabShareSkip")}
        </Button>
      </div>

      {/* 054: one amber caution line (member invite) */}
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
        {t("CollabShareCaution")}
      </p>
    </div>
  );
}


