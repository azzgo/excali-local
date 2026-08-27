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
import type { CollabSessionHandle } from "./use-collab-session";

/**
 * Wire the follow-break toast into the session.
 * Call once inside RoomSession (or any component that receives the session handle).
 */
export function useFollowBreakToast(session: CollabSessionHandle): void {
  const [t] = useTranslation();
  const prevTargetRef = useRef<string | null>(null);

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
}
