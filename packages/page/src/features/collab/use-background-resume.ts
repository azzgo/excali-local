/**
 * Probe-driven background/foreground resume policy for a collab session.
 *
 * On any resume trigger (visibility → visible, window focus, BFCache restore,
 * or user-activity events), the hook probes the current WebSocket with a
 * lightweight ping/pong. Only if the probe fails (timeout) does it force a
 * reconnect. This replaces the previous away-marking heuristic, which
 * missed macOS gestures where neither visibilitychange nor blur fires
 * (show-desktop swipe, Mission Control, Launchpad, native dialogs).
 *
 * A cooldown prevents signal bursts (e.g. rapid pointerdown events while
 * drawing) from spamming probes. Quick tab switches that keep the socket
 * alive are handled cheaply — one ping round-trip, no roster churn.
 */
import { useEffect, useRef } from "react";
import { collabDebugLog, PROBE_TIMEOUT_MS } from "collab-core";
import type { CollabClient } from "collab-core";

const RESUME_COOLDOWN_MS = 5_000;

type ResumableClient = Pick<CollabClient, "state" | "reconnectNow" | "probe">;

/**
 * Install and remove the page-level signals that recover stale sockets.
 * Resume triggers funnel into a single probe-driven decision: redial only
 * when the socket is absent/dead.
 */
export function useBackgroundResume(getClient: () => ResumableClient | null): void {
  const lastResumeAtRef = useRef(0);
  const getClientRef = useRef(getClient);
  getClientRef.current = getClient;

  useEffect(() => {
    const considerResume = () => {
      const client = getClientRef.current();
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

      if (state !== "connected") {
        // No live socket (connecting/reconnecting) — redial immediately
        // to supersede any pending backoff timer.
        collabDebugLog("resume: not connected, forcing redial", { state });
        client.reconnectNow();
        return;
      }

      // Connected: probe liveness before deciding to reconnect.
      collabDebugLog("resume: probing liveness");
      const captured = client;
      void client.probe(PROBE_TIMEOUT_MS).then((alive) => {
        if (getClientRef.current() !== captured) return; // session swapped
        if (alive) {
          collabDebugLog("resume: probe OK — socket alive");
          return;
        }
        collabDebugLog("resume: probe FAILED — forcing redial");
        captured.reconnectNow();
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") considerResume();
    };
    const onFocus = () => considerResume();
    const onPageShow = (event: Event) => {
      // persisted=true is a BFCache restore: the whole JS world was frozen,
      // and visibilitychange/focus may never fire.
      if ((event as PageTransitionEvent).persisted !== true) return;
      considerResume();
    };
    // User-activity events: catch cases where no visibility/focus signal
    // fires (macOS show-desktop swipe, Mission Control, etc.). Throttled
    // by RESUME_COOLDOWN_MS to avoid spam during drawing.
    const onActivity = () => considerResume();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);
}
