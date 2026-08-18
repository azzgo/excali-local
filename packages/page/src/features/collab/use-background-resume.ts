/**
 * Background/foreground resume policy for a collab session (061 §2).
 *
 * A suspended or occluded renderer can leave a WebSocket half-open: the
 * connection remains OPEN while its data plane is dead, so no close event
 * starts the client's backoff ladder. A meaningful away→present transition —
 * hidden→visible or window blur→focus — forces a fresh dial. BFCache restores
 * use the same path because the frozen page may not emit either signal.
 * Quick switches stay on the live socket, and duplicate restore signals are
 * collapsed by the away threshold and cooldown.
 */
import { useEffect, useRef } from "react";
import { collabDebugLog } from "collab-core";
import type { CollabClient } from "collab-core";

const AWAY_RESUME_MS = 5_000;
const RESUME_COOLDOWN_MS = 5_000;

type ResumableClient = Pick<CollabClient, "state" | "reconnectNow">;

/** Install and remove the page-level signals that recover stale sockets. */
export function useBackgroundResume(getClient: () => ResumableClient | null): void {
  const awayAtRef = useRef<number | null>(null);
  const lastResumeAtRef = useRef(0);
  const getClientRef = useRef(getClient);
  getClientRef.current = getClient;

  useEffect(() => {
    const markAway = () => {
      if (awayAtRef.current === null) awayAtRef.current = Date.now();
    };

    const requestResume = () => {
      const client = getClientRef.current();
      // No session (boot/leave/unmount) or a terminal state (fatal admission,
      // stale room key) — never resurrect either.
      if (client === null) {
        collabDebugLog("resume skipped: no client");
        return;
      }
      const state = client.state;
      if (state === "idle" || state === "rejected") {
        collabDebugLog("resume skipped: terminal state", { state });
        return;
      }
      const now = Date.now();
      if (now - lastResumeAtRef.current < RESUME_COOLDOWN_MS) {
        collabDebugLog("resume skipped: cooldown");
        return;
      }
      lastResumeAtRef.current = now;
      collabDebugLog("resume: forcing reconnectNow", { state });
      client.reconnectNow();
    };

    const resumeIfAway = () => {
      const awayAt = awayAtRef.current;
      awayAtRef.current = null;
      if (awayAt === null || Date.now() - awayAt < AWAY_RESUME_MS) return;
      requestResume();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markAway();
        return;
      }
      if (document.visibilityState === "visible") resumeIfAway();
    };
    const onBlur = () => markAway();
    const onFocus = () => resumeIfAway();
    const onPageShow = (event: Event) => {
      // persisted=true is a BFCache restore: the whole JS world was frozen,
      // and visibilitychange/focus may never fire. Initial pageshow events do
      // not resume.
      if ((event as PageTransitionEvent).persisted !== true) return;
      awayAtRef.current = null; // frozen time is unmeasurable — unconditional
      requestResume();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
}
