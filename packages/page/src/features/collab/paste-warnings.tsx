import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { PasteSeverity } from "./invite";

interface PasteWarningsProps {
  /** Severity classification from `pasteSeverity` (invite.ts). */
  severity: PasteSeverity;
  /** Configured relay URL — interpolated into the fp-mismatch body ("connected to {{srv}}"). */
  serverRelay?: string;
  /** fp-mismatch: amber "Continue anyway" (054 Q5 — warn-only, enabled). */
  onContinue?: () => void;
  /** unreachable: red "Retry" (054 Q9). */
  onRetry?: () => void;
  /** unreachable, server invite: red "Save anyway" (054 Q9 — admins generate invites before deploying). */
  onSaveAnyway?: () => void;
  /** no-key: ghost "Paste again". */
  onPasteAgain?: () => void;
  /** unreachable, room invite: ghost "Check server config". */
  onCheckConfig?: () => void;
}

/**
 * Paste-warning severity UI (Wayfinder 054, copy locked verbatim):
 *
 * - `no-key`      → red card, Join DISABLED (054 Q4: no continue path exists)
 * - `fp-mismatch` → amber card + "Continue anyway" enabled (054 Q5 / 048 warn-only)
 * - `unreachable` → red card + Retry, and Save-anyway for server invites
 *                   (054 Q9: "nobody answered" vs stale.admit's "server said no" —
 *                   joinSrvDown copy for rooms, srv.unreach copy for servers)
 * - `error`       → red card, no action (no invite found / malformed)
 * - `ok`          → renders nothing
 *
 * Used by the join flow (043) and any paste surface that wants the 054 severity
 * grammar. The landing screen (042) keeps its own cards and only imports the
 * parse/severity helpers.
 */
export default function PasteWarnings({
  severity,
  serverRelay,
  onContinue,
  onRetry,
  onSaveAnyway,
  onPasteAgain,
  onCheckConfig,
}: PasteWarningsProps) {
  const [t] = useTranslation();
  if (severity.kind === "ok") return null;

  switch (severity.kind) {
    case "no-key":
      return (
        <div
          data-testid="collab-paste-warning"
          className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10"
        >
          <div className="font-semibold text-red-700 dark:text-red-400">
            {t("CollabNoKeyTitle")}
          </div>
          <p className="mt-1 text-red-700/80 dark:text-red-400/80">{t("CollabNoKeyBody")}</p>
          {/* 054 Q4: no-key = red + Join disabled — no continue path exists */}
          <Button data-testid="collab-warning-join-disabled" disabled className="mt-2 w-full">
            {t("CollabJoinInvite")}
          </Button>
          {onPasteAgain && (
            <Button
              data-testid="collab-warning-paste-again"
              variant="ghost"
              className="mt-1 w-full"
              onClick={onPasteAgain}
            >
              {t("CollabPasteAgain")}
            </Button>
          )}
        </div>
      );

    case "fp-mismatch":
      return (
        <div
          data-testid="collab-paste-warning"
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <div className="font-semibold text-amber-700 dark:text-amber-400">
            {t("CollabFpTitle")}
          </div>
          <p className="mt-1 text-amber-700/80 dark:text-amber-400/80">
            {t("CollabFpBody", { srv: serverRelay ?? "" })}
          </p>
          {/* 054 Q5: fp never routes — warn-only, Continue anyway ENABLED */}
          <Button
            data-testid="collab-warning-continue"
            className="mt-2 w-full"
            onClick={onContinue}
          >
            {t("CollabFpContinue")}
          </Button>
        </div>
      );

    case "unreachable": {
      const isServer = severity.inviteKind === "server";
      return (
        <div
          data-testid="collab-paste-warning"
          className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10"
        >
          <div className="font-semibold text-red-700 dark:text-red-400">
            {t(isServer ? "CollabSrvUnreachTitle" : "CollabJoinSrvDownTitle")}
          </div>
          <p className="mt-1 text-red-700/80 dark:text-red-400/80">
            {t(isServer ? "CollabSrvUnreachBody" : "CollabJoinSrvDownBody")}
          </p>
          {/* 054 Q9: nobody answered (timeout) — retry + save-anyway escape hatch
              (admins generate invites before deploying); joinSrvDown is deliberately
              worded apart from stale.admit ("nobody answered" vs "server said no") */}
          {isServer ? (
            <div className="mt-2 flex gap-2">
              <Button
                data-testid="collab-warning-retry"
                variant="outline"
                className="flex-1"
                onClick={onRetry}
              >
                {t("CollabRetry")}
              </Button>
              <Button
                data-testid="collab-warning-save-anyway"
                className="flex-1"
                onClick={onSaveAnyway}
              >
                {t("CollabSaveAnyway")}
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button
                data-testid="collab-warning-retry"
                className="flex-1"
                onClick={onRetry}
              >
                {t("CollabRetry")}
              </Button>
              {onCheckConfig && (
                <Button
                  data-testid="collab-warning-check-config"
                  variant="ghost"
                  className="flex-1"
                  onClick={onCheckConfig}
                >
                  {t("CollabCheckServerConfig")}
                </Button>
              )}
            </div>
          )}
        </div>
      );
    }

    case "error": {
      const none = severity.reason === "none";
      return (
        <div
          data-testid="collab-paste-warning"
          className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10"
        >
          <div className="font-semibold text-red-700 dark:text-red-400">
            {t(none ? "CollabNoInviteFound" : "CollabInvalidInvite")}
          </div>
          {!none && (
            <p className="mt-1 font-mono text-red-700/80 break-all dark:text-red-400/80">
              {severity.reason}
            </p>
          )}
        </div>
      );
    }
  }
}
