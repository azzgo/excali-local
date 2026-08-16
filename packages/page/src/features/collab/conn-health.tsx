/**
 * Connection-health UI — Wayfinder 061 (task 046): the conn dot (4 states),
 * the offline banners and the amber reset notice.
 *
 * 061 §1 — conn-dot vocabulary:
 *   live (green steady, dot only) · connecting (blue pulse, first connect) ·
 *   reconnecting (amber pulse, lost + retrying) · rejected (red steady, fatal
 *   only). Degraded states add a word next to the dot; the tooltip is the
 *   state word + one detail line (attempt n · every {interval} while
 *   retrying; last-synced while live). Recovery returns silently to green
 *   (Q1a — the 2s synced flash is dropped).
 *
 * 061 §2 — offline banners: mid-session server death keeps editing free;
 *   the banner promises "edits are kept" + the frozen-roster count (Q3 — a
 *   frozen roster must never read as "everyone left") + the one-line conflict
 *   pre-warning (same element edited on both sides → online wins on
 *   reconnect).
 *
 * 061 §3 — reset notice: ONLY real conflicts (resets.length > 0 from the
 *   three-way merge at re-activation) get the amber notice ("{n} local
 *   edit(s) conflicted with the server — the online version was kept");
 *   "Show me" briefly outlines the reset elements (transient appState
 *   selection highlight, auto-clear, never touches undo); "Got it" dismisses;
 *   per-recovery state, never modal. Clean resyncs stay silent.
 *
 * 047 seam: the re-entry card, the degraded hint and the fatal banner fill
 * the same banner slot — `ConnHealthBanners` is the composition point
 * (`BannerSlotProps` is the state slice they consume).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { CollabClientState } from "collab-core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type {
  CollabResetNotice,
  CollabSessionHandle,
  RosterMember,
} from "./use-collab-session";

/**
 * 061 §1: the state the UI should read. The client re-enters "connecting" on
 * EVERY dial attempt, retries included — inside a retry cycle (a reconnect is
 * scheduled) a blue "connecting" pulse would break the blue-vs-amber
 * first-connect/reconnect distinction, so it reads as "reconnecting".
 */
export function connDisplayState(
  conn: CollabClientState,
  reconnect: { attempt: number; delayMs: number } | null,
): CollabClientState {
  return conn === "connecting" && reconnect !== null ? "reconnecting" : conn;
}

/* ------------------------------------------------------------------ */
/* conn dot (061 §1)                                                    */
/* ------------------------------------------------------------------ */

export interface ConnDotProps {
  /** raw client state (CollabClientState from the session hook) */
  conn: CollabClientState;
  /** last scheduled reconnect — non-null while a retry cycle is in flight */
  reconnect: { attempt: number; delayMs: number } | null;
  /** last full-scene sync timestamp — the live tooltip detail (061 §1) */
  lastSyncedAt?: number | null;
}

/** 061 §1 colors: green steady · blue pulse · amber pulse · red steady. */
const DOT_CLASS: Record<CollabClientState, string> = {
  idle: "bg-muted-foreground/40",
  connected: "bg-emerald-500",
  connecting: "bg-sky-500 animate-pulse",
  reconnecting: "bg-amber-500 animate-pulse",
  rejected: "bg-red-500",
};

/** Word color while degraded: amber for retrying, red for fatal (prototype). */
const WORD_CLASS: Record<CollabClientState, string> = {
  idle: "text-muted-foreground",
  connected: "text-muted-foreground",
  connecting: "text-muted-foreground",
  reconnecting: "text-amber-600 dark:text-amber-400",
  rejected: "text-red-600 dark:text-red-400",
};

/** 061 §1: degraded states carry a word next to the dot; live is dot-only. */
const DEGRADED: ReadonlySet<CollabClientState> = new Set([
  "connecting",
  "reconnecting",
  "rejected",
]);

export function ConnDot({ conn, reconnect, lastSyncedAt = null }: ConnDotProps) {
  const [t, i18n] = useTranslation();
  const state = connDisplayState(conn, reconnect);
  const lang = i18n?.resolvedLanguage ?? "en";

  // Tooltip = state word + one detail line (061 §1 / Q1c).
  let title: string;
  if (state === "connected") {
    title = t("CollabConnLive");
    if (lastSyncedAt !== null) {
      title += ` · ${t("CollabConnLiveSynced", {
        time: formatClock(lastSyncedAt, lang),
      })}`;
    }
  } else if (state === "connecting") {
    title = t("CollabConnConnecting");
  } else if (state === "reconnecting") {
    const n = (reconnect?.attempt ?? 0) + 1;
    const seconds = Math.round((reconnect?.delayMs ?? 0) / 1000);
    const interval = lang.startsWith("zh") ? `${seconds} 秒` : `${seconds}s`;
    title = `${t("CollabConnReconnecting")} · ${t("CollabConnReconnectDetail", {
      n,
      interval,
    })}`;
  } else if (state === "rejected") {
    title = t("CollabConnRejected");
  } else {
    title = t("CollabConnIdle");
  }

  const word =
    state === "connecting"
      ? t("CollabConnConnecting")
      : state === "reconnecting"
        ? t("CollabConnReconnecting")
        : state === "rejected"
          ? t("CollabConnRejected")
          : "";

  return (
    <span
      data-testid="collab-conn-dot"
      data-state={conn}
      title={title}
      className="flex shrink-0 items-center gap-1.5"
    >
      <span className={cn("size-2.5 rounded-full", DOT_CLASS[state])} />
      {DEGRADED.has(state) && (
        <span
          data-testid="collab-conn-word"
          className={cn("text-xs", WORD_CLASS[state])}
        >
          {word}
        </span>
      )}
    </span>
  );
}

/** HH:MM clock for the live tooltip detail ("synced 10:31", 061 copy table). */
function formatClock(ts: number, lang: string): string {
  return new Date(ts).toLocaleTimeString(lang, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* ------------------------------------------------------------------ */
/* offline banner (061 §2 + Q3)                                          */
/* ------------------------------------------------------------------ */

export interface OfflineBannerProps {
  /** the roster while offline is frozen (061 Q3) — includes self */
  peers: readonly RosterMember[];
}

export function OfflineBanner({ peers }: OfflineBannerProps) {
  const [t] = useTranslation();
  // Q3: "N collaborators were in the room when it dropped" — self excluded.
  const collaborators = Math.max(0, peers.length - 1);
  return (
    <div
      data-testid="collab-offline-banner"
      className="mx-3 mt-1.5 flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <span className="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      <div className="min-w-0 grow">
        <div
          data-testid="collab-offline-title"
          className="font-semibold text-amber-700 dark:text-amber-400"
        >
          {t("CollabConnDropTitle")}
        </div>
        <div
          data-testid="collab-offline-body"
          className="mt-0.5 text-amber-700/80 dark:text-amber-400/80"
        >
          {t("CollabConnDropBody", { n: collaborators })}
        </div>
        <div className="mt-1 text-amber-700/80 dark:text-amber-400/80">
          <span aria-hidden="true" className="mr-1">
            ⚠
          </span>
          <span data-testid="collab-offline-warn">
            {t("CollabConnConflictWarn")}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* reset notice (061 §3)                                                */
/* ------------------------------------------------------------------ */

/**
 * 061 §3 "Show me": briefly outline the reset elements via a transient
 * appState selection highlight (this tgz has no per-element highlight prop),
 * then restore the pre-highlight selection. CaptureUpdateAction.NEVER keeps
 * it off the undo stack; auto-clears after a few seconds.
 */
export function highlightResetElements(
  api: ExcalidrawImperativeAPI | null | undefined,
  ids: string[],
  durationMs = 3000,
): void {
  if (api === null || api === undefined || ids.length === 0) return;
  const before = api.getAppState().selectedElementIds ?? {};
  const selectedElementIds: { [id: string]: true } = {};
  for (const id of ids) selectedElementIds[id] = true;
  api.updateScene({
    appState: { selectedElementIds },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  window.setTimeout(() => {
    if (api.isDestroyed) return;
    const current = api.getAppState().selectedElementIds ?? {};
    const restore: { [id: string]: true } = { ...current };
    for (const id of ids) delete restore[id];
    Object.assign(restore, before);
    api.updateScene({
      appState: { selectedElementIds: restore },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, durationMs);
}

export interface ResetNoticeProps {
  notice: CollabResetNotice;
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
}

/** 061 §3: the amber reset notice — per-recovery (keyed on `notice.at`),
 * dismissible via "Got it", never modal. Shows ONLY for real conflicts. */
export function ResetNotice({ notice, excalidrawAPI }: ResetNoticeProps) {
  const [t] = useTranslation();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  if (dismissedAt === notice.at) return null;
  return (
    <div
      data-testid="collab-reset-notice"
      className="mx-3 mt-1.5 flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <span className="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      <div className="min-w-0 grow">
        <div
          data-testid="collab-reset-title"
          className="font-semibold text-amber-700 dark:text-amber-400"
        >
          {t("CollabConnResetTitle", { n: notice.count })}
        </div>
        <div className="mt-0.5 text-amber-700/80 dark:text-amber-400/80">
          {t("CollabConnResetBody", { editN: notice.editN, delN: notice.delN })}
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          data-testid="collab-reset-show"
          variant="ghost"
          size="sm"
          className="px-2 text-xs"
          onClick={() => highlightResetElements(excalidrawAPI, notice.ids)}
        >
          {t("CollabConnResetShow")}
        </Button>
        <Button
          data-testid="collab-reset-ok"
          variant="secondary"
          size="sm"
          className="px-2 text-xs"
          onClick={() => setDismissedAt(notice.at)}
        >
          {t("CollabConnResetOk")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* banner slot (061 §8)                                                 */
/* ------------------------------------------------------------------ */

/** 061 §8: the banner strip under the chrome bar — the composition point for
 * the offline banner + reset notice. 047 plugs the re-entry card, the
 * degraded hint and the fatal banner into this same slot. */
export interface BannerSlotProps {
  session: Pick<CollabSessionHandle, "conn" | "reconnect" | "peers" | "resets">;
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
}

export function ConnHealthBanners({ session, excalidrawAPI }: BannerSlotProps) {
  const offline =
    connDisplayState(session.conn, session.reconnect) === "reconnecting";
  return (
    <>
      {offline && <OfflineBanner peers={session.peers} />}
      {session.resets !== null && (
        <ResetNotice notice={session.resets} excalidrawAPI={excalidrawAPI} />
      )}
    </>
  );
}
