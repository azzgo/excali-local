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
 *
 * 047 — re-entry card (061 Q4): dialing with no welcome for 10s → red card
 * with the 054 "nobody answered" copy family (NEVER the rejected family)
 * + Retry / Open last synced copy / Leave. Degraded hint (061 Q5): ≥3
 * reconnects within 5 min → ONE amber hint per session, while live only.
 * Fatal banner (061 Q7 + 054): lastError.fatal → red banner with the 054
 * stale.admit / stale.gcm copy word-identical + Save to gallery / Leave.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { CollabClientState, CollabError } from "collab-core";
import { DIAL_TIMEOUT_MS } from "collab-core";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ROUTES } from "./routes";
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
/* re-entry card (061 Q4)                                               */
/* ------------------------------------------------------------------ */

/** 061 Q4/Q6: the client's dial timeout (10s) is the card's "nothing
 * answered" threshold — after it, the card tells the truth: nobody
 * answered (054 join.srvdown family, NEVER the rejected family). */
const REENTRY_TIMEOUT_MS = DIAL_TIMEOUT_MS;

/** 061 Q5: ≥3 reconnects within 5 minutes earn one amber hint per session. */
const DEGRADED_THRESHOLD = 3;
const DEGRADED_WINDOW_MS = 5 * 60 * 1000;

/**
 * Re-entry card state (061 Q4): while the session is dialing/retrying
 * BEFORE the first welcome (snapshotAvailable === null) and no answer has
 * come after 10s → show the card once per dialing phase. `Retry` re-dials
 * and re-arms a fresh 10s window; `Open last synced copy` dismisses the
 * card for the rest of the session (the cached scene was already painted
 * at boot by the hook — local-first, 061 §3 — and the client keeps
 * retrying in the background: retrying never stops, Q6); a welcome (or
 * leave) clears the phase. Leave mirrors the 053 leave modal: close +
 * back to My Rooms.
 */

/**
 * Debounce the offline banner so a fast self-healing reconnect (e.g. the
 * ghost-connection recovery — `reconnecting` for only tens of ms) doesn't
 * flash a large DOM block in and out, shifting layout twice. Entry debounce
 * `enterMs`: the banner shows only once offline has persisted that long.
 * Minimum residency `holdMs`: once shown it holds before collapsing, so a
 * quick recovery doesn't blink out. Returns the debounced boolean.
 */
function useOfflineBanner(offline: boolean, enterMs = 1500, holdMs = 1000): boolean {
  const [show, setShow] = useState(false);
  const enteredAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!offline) {
      // Back live: hold for holdMs before collapsing so we don't shift layout
      // twice in quick succession.
      if (show) {
        const timer = window.setTimeout(() => setShow(false), holdMs);
        return () => window.clearTimeout(timer);
      }
      enteredAtRef.current = null;
      return;
    }
    // Offline (or still offline): start/keep the entry clock once.
    if (enteredAtRef.current === null) enteredAtRef.current = Date.now();
    if (show) return; // already showing — hold it
    const elapsed = Date.now() - enteredAtRef.current;
    if (elapsed >= enterMs) {
      setShow(true);
    } else {
      const timer = window.setTimeout(() => setShow(true), enterMs - elapsed);
      return () => window.clearTimeout(timer);
    }
  }, [offline, show, enterMs, holdMs]);

  return show;
}

function useReentryCard(
  conn: CollabClientState,
  reconnect: { attempt: number; delayMs: number } | null,
  snapshotAvailable: boolean | null,
  connect: () => void,
  leave: () => void,
) {
  const [show, setShow] = useState(false);
  const [armKey, setArmKey] = useState(0);
  const dismissedRef = useRef(false);
  const dialingSinceRef = useRef<number | null>(null);

  // "Dialing" = the first welcome has not arrived yet and a dial is in
  // flight (connecting) or a retry is scheduled (reconnecting). The client
  // flips between those two forever while the server never answers — both
  // count, so the 10s clock must NOT re-arm on every flip.
  const display = connDisplayState(conn, reconnect);
  const dialing =
    snapshotAvailable === null &&
    (display === "connecting" || display === "reconnecting");

  useEffect(() => {
    if (!dialing) {
      dialingSinceRef.current = null;
      setShow(false);
      return;
    }
    if (dialingSinceRef.current === null) dialingSinceRef.current = Date.now();
  }, [dialing]);

  // One 10s shot per dialing phase; Retry re-arms via armKey.
  useEffect(() => {
    if (!dialing) return;
    const started = dialingSinceRef.current;
    const timer = window.setTimeout(() => {
      if (dialingSinceRef.current === started && !dismissedRef.current) {
        setShow(true);
      }
    }, REENTRY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [dialing, armKey]);

  const retry = useCallback(() => {
    // Re-dial. Inside the client's own retry loop connect() is a no-op
    // (collab-core: never dials twice) — the loop never gives up (Q6) and
    // the fresh 10s window is what Retry really re-arms here.
    connect();
    setShow(false);
    setArmKey((k) => k + 1);
  }, [connect]);

  const openCache = useCallback(() => {
    dismissedRef.current = true;
    setShow(false);
  }, []);

  const leaveSession = useCallback(() => {
    leave();
    window.location.hash = ROUTES.rooms;
  }, [leave]);

  return { show, retry, openCache, leave: leaveSession };
}

/** 061 Q4: relay URL → bare host for the body's {relay} slot (prototype:
 * "Sprint planning · relay.acme-design.com · nothing answered for 10s"). */
function relayHost(relay: string | undefined): string {
  if (!relay) return "";
  try {
    return new URL(relay).host;
  } catch {
    return relay;
  }
}

export interface ReentryCardProps {
  /** room label (053 chrome) — the body's {room} slot */
  roomLabel?: string;
  /** relay URL — the body's {relay} slot (rendered as the bare host) */
  relay?: string;
  /** session cache updatedAt — the "Last synced {time}" footer (061 copy
   * table). Hidden when nothing is cached. */
  lastSyncedAt?: number | null;
  /** seconds the server stayed silent (default 10 = DIAL_TIMEOUT_MS) */
  timeoutS?: number;
  onRetry: () => void;
  onOpenCache: () => void;
  onLeave: () => void;
}

/** 061 Q4: the 10s-timeout red card — 054 "nobody answered" copy family
 * (join.srvdown), never the rejected family. Retry / Open last synced
 * copy / Leave. */
export function ReentryCard({
  roomLabel,
  relay,
  lastSyncedAt = null,
  timeoutS = 10,
  onRetry,
  onOpenCache,
  onLeave,
}: ReentryCardProps) {
  const [t, i18n] = useTranslation();
  const lang = i18n?.resolvedLanguage ?? "en";
  return (
    <div
      data-testid="collab-reentry-card"
      className="mx-3 mt-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs dark:border-red-500/40 dark:bg-red-500/10"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-red-500" />
        <div className="min-w-0 grow">
          <div
            data-testid="collab-reentry-title"
            className="font-semibold text-red-700 dark:text-red-400"
          >
            {t("CollabReentryDownTitle")}
          </div>
          <div
            data-testid="collab-reentry-body"
            className="mt-0.5 text-red-700/80 dark:text-red-400/80"
          >
            {t("CollabReentryDownBody", {
              room: roomLabel ?? "—",
              relay: relayHost(relay),
              timeout: timeoutS,
            })}
          </div>
          {lastSyncedAt !== null && (
            <div
              data-testid="collab-reentry-last-synced"
              className="mt-1 text-red-700/60 dark:text-red-400/60"
            >
              {t("CollabReentryLastSynced", {
                time: formatClock(lastSyncedAt, lang),
              })}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          data-testid="collab-reentry-retry"
          size="sm"
          className="px-2 text-xs"
          onClick={onRetry}
        >
          {t("CollabRetry")}
        </Button>
        <Button
          data-testid="collab-reentry-open-cache"
          variant="outline"
          size="sm"
          className="px-2 text-xs"
          onClick={onOpenCache}
        >
          {t("CollabReentryOpenCache")}
        </Button>
        <Button
          data-testid="collab-reentry-leave"
          variant="ghost"
          size="sm"
          className="px-2 text-xs"
          onClick={onLeave}
        >
          {t("CollabLeave")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* degraded hint (061 Q5)                                               */
/* ------------------------------------------------------------------ */

/**
 * 061 Q5: silence by default — ≥3 reconnects within 5 minutes earn ONE
 * amber hint per session, then the tracker goes quiet forever. Events
 * before the first welcome (the re-entry card owns that story) do not
 * count: `armed` (snapshotAvailable !== null) gates the counter while the
 * attempt ladder is still tracked, so a stale attempt value is never
 * double-counted at arm time.
 */
function useDegradedHint(
  reconnect: { attempt: number; delayMs: number } | null,
  armed: boolean,
): boolean {
  const [show, setShow] = useState(false);
  const shownRef = useRef(false);
  const timesRef = useRef<number[]>([]);
  const lastAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    if (shownRef.current || reconnect === null) return;
    if (
      lastAttemptRef.current !== null &&
      reconnect.attempt === lastAttemptRef.current
    ) {
      return;
    }
    lastAttemptRef.current = reconnect.attempt;
    if (!armed) return; // pre-welcome retries don't count (061 Q4 owns them)
    const now = Date.now();
    const recent = [
      ...timesRef.current.filter((t) => now - t <= DEGRADED_WINDOW_MS),
      now,
    ];
    timesRef.current = recent;
    if (recent.length >= DEGRADED_THRESHOLD) {
      shownRef.current = true;
      setShow(true);
    }
  }, [armed, reconnect]);

  return show;
}

/** 061 Q5: the one-shot amber hint — shown once per session, while live. */
export function DegradedHint() {
  const [t] = useTranslation();
  return (
    <div
      data-testid="collab-degraded-hint"
      className="mx-3 mt-1.5 flex items-start gap-2.5 rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <span className="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      <div className="min-w-0 grow">
        <div
          data-testid="collab-degraded-title"
          className="font-semibold text-amber-700 dark:text-amber-400"
        >
          {t("CollabConnUnstableTitle")}
        </div>
        <div
          data-testid="collab-degraded-body"
          className="mt-0.5 text-amber-700/80 dark:text-amber-400/80"
        >
          {t("CollabConnUnstableBody")}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* fatal banner (061 Q7 + 054)                                          */
/* ------------------------------------------------------------------ */

export interface FatalBannerProps {
  /** the fatal CollabError (lastError.fatal === true) */
  error: CollabError;
  onSave: () => void;
  onLeave: () => void;
  /** in-flight save → the button is disabled (Save to gallery is async) */
  saving?: boolean;
}

/**
 * 061 Q7: the only red banner — fatal lastError. Copy is 054 VERBATIM:
 * stale.admit (keys rotated → "The server rejected this member key") for
 * the wire fatals, stale.gcm (room recreated → "This room's key doesn't
 * match") for E2E_AUTH_FAILED — the definitive GCM stale-key signal (058
 * §5). Retrying has stopped (the client went "rejected"); editing still
 * works locally — the actions are Save to gallery / Leave.
 */
export function FatalBanner({
  error,
  onSave,
  onLeave,
  saving = false,
}: FatalBannerProps) {
  const [t] = useTranslation();
  const gcm = error.code === "E2E_AUTH_FAILED";
  return (
    <div
      data-testid="collab-fatal-banner"
      className="mx-3 mt-1.5 flex items-start gap-2.5 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs dark:border-red-500/40 dark:bg-red-500/10"
    >
      <span className="mt-1 size-2 shrink-0 rounded-full bg-red-500" />
      <div className="min-w-0 grow">
        <div
          data-testid="collab-fatal-title"
          className="font-semibold text-red-700 dark:text-red-400"
        >
          {gcm ? t("CollabConnFatalGcmTitle") : t("CollabConnFatalTitle")}
        </div>
        <div
          data-testid="collab-fatal-body"
          className="mt-0.5 text-red-700/80 dark:text-red-400/80"
        >
          {gcm ? t("CollabConnFatalGcmBody") : t("CollabConnFatalBody")}
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          data-testid="collab-fatal-save"
          variant="secondary"
          size="sm"
          className="px-2 text-xs"
          disabled={saving}
          onClick={onSave}
        >
          {t("CollabSaveToGallery")}
        </Button>
        <Button
          data-testid="collab-fatal-leave"
          variant="ghost"
          size="sm"
          className="px-2 text-xs"
          onClick={onLeave}
        >
          {t("CollabLeave")}
        </Button>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* banner slot (061 §8)                                                 */
/* ------------------------------------------------------------------ */

/** 061 §8: the banner strip under the chrome bar — the composition point.
 * 047 composition rules (never stack wrongly):
 *   fatal banner        — lastError.fatal (red = fatal only, 061 Q6)
 *   re-entry card       — pre-welcome dialing past 10s (061 Q4); while it
 *                         shows, the offline banner is suppressed
 *   offline banner      — mid-session reconnecting (existing 046)
 *   degraded hint       — one-shot, only while live (never stacked on the
 *                         offline banner / card / fatal)
 *   reset notice        — per-recovery, independent (existing 046)
 */
export interface BannerSlotProps {
  session: Pick<
    CollabSessionHandle,
    | "conn"
    | "reconnect"
    | "peers"
    | "resets"
    | "lastError"
    | "lastSyncedAt"
    | "snapshotAvailable"
    | "connect"
    | "leave"
    | "saveToGallery"
  >;
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  /** 061 Q4: room label for the re-entry card body ({room} · {relay} …) */
  roomLabel?: string;
  /** 061 Q4: relay URL for the re-entry card body (bare host rendered) */
  relay?: string;
}

export function ConnHealthBanners({
  session,
  excalidrawAPI,
  roomLabel,
  relay,
}: BannerSlotProps) {
  const [t] = useTranslation();
  const [saving, setSaving] = useState(false);
  const offline =
    connDisplayState(session.conn, session.reconnect) === "reconnecting";
  // Debounced: a fast self-healing reconnect (ghost recovery) must not flash
  // the large offline banner in/out — see useOfflineBanner.
  const showOffline = useOfflineBanner(offline);
  const live =
    connDisplayState(session.conn, session.reconnect) === "connected";
  const reentry = useReentryCard(
    session.conn,
    session.reconnect,
    session.snapshotAvailable,
    session.connect,
    session.leave,
  );
  // Count reconnects only after the first welcome (the re-entry card owns
  // the pre-welcome story); the hint itself renders only while live.
  const hint = useDegradedHint(
    session.reconnect,
    session.snapshotAvailable !== null,
  );
  const fatal = session.lastError !== null && session.lastError.fatal === true;

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    const ok = await session.saveToGallery();
    setSaving(false);
    if (!ok) toast.error(t("CollabSaveFailed"));
  }, [saving, session, t]);

  return (
    <>
      {fatal && session.lastError !== null && (
        <FatalBanner
          error={session.lastError}
          onSave={handleSave}
          onLeave={reentry.leave}
          saving={saving}
        />
      )}
      {!fatal && reentry.show && (
        <ReentryCard
          roomLabel={roomLabel}
          relay={relay}
          lastSyncedAt={session.lastSyncedAt}
          onRetry={reentry.retry}
          onOpenCache={reentry.openCache}
          onLeave={reentry.leave}
        />
      )}
      {!fatal && !reentry.show && showOffline && (
        <OfflineBanner peers={session.peers} />
      )}
      {!fatal && live && hint && <DegradedHint />}
      {session.resets !== null && (
        <ResetNotice notice={session.resets} excalidrawAPI={excalidrawAPI} />
      )}
    </>
  );
}
