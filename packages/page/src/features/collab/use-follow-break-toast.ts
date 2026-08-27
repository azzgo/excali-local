/**
 * use-follow-break-toast.ts — task 083.
 *
 * Wires the follow-break toast into the session lifecycle.
 *
 * Fires a sonner toast when an INVOLUNTARY follow break occurs:
 *   (a) own-present-start  — local user starts presenting while following someone
 *   (b) presenter-left     — the followed presenter stops presenting or leaves
 *
 * SILENT (no toast):
 *   (c) manual-unfollow — user clicks the active follow icon → followTargetId → null
 *
 * Key insight: session.startPresenting() clears followTargetId SYNCHRONOUSLY
 * (before React batches state), so own-present-start: prevTarget non-null,
 * curTarget null, presentingSelf true.
 *
 * We capture the peer's name when followTargetId first becomes non-null
 * (user starts following). This name is used in the toast even if the peer
 * is later removed from the roster.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { classifyFollowEvent } from "./follow-engine";
import type { CollabSessionHandle } from "./use-collab-session";

/**
 * Wire the follow-break toast into the session.
 * Call once inside RoomSession (or any component that receives the session handle).
 *
 * `canvasRef` (optional): the canvas-area DOM node. While following, capture-phase
 * listeners on it break follow at the ONSET of every local pan/zoom gesture
 * (pointerdown-drag / wheel / pinch) with a toast — Ticket 063 ③, ADR 0008.
 * Without it, only the state-transition breaks (presenter-left, own-present-start)
 * fire.
 */
export function useFollowBreakToast(
  session: CollabSessionHandle,
  canvasRef?: React.RefObject<HTMLElement | null>,
): void {
  const [t] = useTranslation();
  const prevTargetRef = useRef<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  /** Captured name of the followed peer's roster entry. Captured when
   *  followTargetId first becomes non-null (user starts following). Used in
   *  the toast even if the peer is later removed from the roster. */
  const followedPeerName = useRef<string | null>(null);

  useEffect(() => {
    const prevTarget = prevTargetRef.current;
    const curTarget = session.followTargetId;

    // Capture peer's name when followTargetId first becomes non-null.
    // This runs once when the user starts following (or on mount with existing target).
    if (prevTarget === null && curTarget !== null) {
      const peer = session.peers.find((p) => p.profileId === curTarget);
      followedPeerName.current = peer?.name ?? null;
    }

    // Update prevTargetRef AFTER reading
    prevTargetRef.current = curTarget;

    // (a) own-present-start: startPresenting() clears followTargetId synchronously
    //     (before React batches state). By the time the effect runs:
    //     followTargetId is null AND presentingSelf is true simultaneously.
    if (prevTarget !== null && curTarget === null && session.presentingSelf) {
      const name = followedPeerName.current ?? `user:${prevTarget}`;
      toast(t("CollabFollowBroke", { name }));
      return;
    }

    // (b) presenter-left vs manual unfollow: followTargetId non-null → null,
    //     presentingSelf is false.
    if (prevTarget !== null && curTarget === null && !session.presentingSelf) {
      const followedPeer = session.peers.find((p) => p.profileId === prevTarget);
      if (followedPeer?.presenting !== true) {
        // Presenter-left (peer stopped or left) → toast.
        const name = followedPeerName.current ?? `user:${prevTarget}`;
        toast(t("CollabFollowBroke", { name }));
      }
      // Manual unfollow (peer still presenting=true) → silent.
      return;
    }
  }, [session.followTargetId, session.presentingSelf, session.peers, t]);

  // --- Gesture-onset breaks (ADR 0008 / Ticket 063 ③) ---
  // Capture-phase listeners on the canvas area: they fire BEFORE Excalidraw's
  // own handlers, so the follow relationship dies at gesture onset and the
  // user's first pan/zoom pixel is free. Every involuntary break toasts; the
  // manual-unfollow path (follow icon click) is outside the canvas area and
  // stays silent (effect branch b above).
  useEffect(() => {
    if (session.followTargetId === null) return;
    const el = canvasRef?.current ?? null;
    if (el === null) return;
    const breakWithToast = (event: "pointerdown" | "wheel" | "pinch") => {
      const result = classifyFollowEvent(event, {
        localGesture: true,
        presenterLeft: false,
        ownPresentStarted: false,
      });
      if (!result.shouldBreak) return;
      const target = sessionRef.current.followTargetId;
      if (target === null) return;
      sessionRef.current.setFollowTarget(null); // break
      const name = followedPeerName.current ?? `user:${target}`;
      toast(t("CollabFollowBroke", { name }));
    };
    const onPointerDown = () => breakWithToast("pointerdown");
    const onWheel = () => breakWithToast("wheel");
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) breakWithToast("pinch");
    };
    el.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
    };
  }, [session.followTargetId, canvasRef, t]);
}
