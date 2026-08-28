/**
 * follow-engine.ts — task 081 / Wayfinder 063.
 *
 * Framework-free follow engine. Exports:
 *   (a) applyViewport       — the ONE viewport writer (continuous follow + cursor hop).
 *   (b) classifyFollowEvent — break classifier mapping event-ish inputs to
 *                             {shouldBreak, toastKey}.
 *   (c) Guard token         — getFollowGuardToken(); consumed by
 *                              use-collab-session so follower-side
 *                              onChange echoes are never re-broadcast.
 *
 * ADR 0008 truth table:
 *   - Involuntary: local gesture onset, presenter left, own present start
 *     → shouldBreak + toast (FOLLOW_BREAK_TOAST_KEY)
 *   - Manual unfollow
 *     → shouldBreak + SILENT (toastKey = "" — prototype; no toast shown)
 *
 * Source of truth for the pure break predicate: follow-break.ts (task 080).
 * We delegate to shouldBreakFollow rather than re-implementing.
 */

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Zoom } from "@excalidraw/excalidraw/types";

import { shouldBreakFollow } from "./follow-break";

/* ------------------------------------------------------------------ */
/* Guard token (consumed by use-collab-session in task 082/083)        */
/* ------------------------------------------------------------------ */

/**
 * Opaque suppression token so the session hook can distinguish
 * remote-viewport-application echoes from genuine local gestures.
 *
 * HOW it works:
 *   Before calling applyViewport() on a received remote frame, the hook
 *   stores the token via getFollowGuardToken().
 *   When onChange fires inside Excalidraw, the hook reads the current
 *   token and skips echo-broadcast if it matches — the echo is a
 *   side-effect of our own applyViewport, not a real user gesture.
 *
 *   After applyViewport returns, the hook clears the token.
 *
 * Implementation detail (later task): the hook holds the token in a
 * module-level variable or ref; checking it is a one-liner:
 *   if (currentToken === getFollowGuardToken()) return; // suppress
 */
const _followSuppressToken = Symbol("followSuppress");

/** Returns the module's suppression identity token. */
export function getFollowGuardToken(): symbol {
  return _followSuppressToken;
}

/* ------------------------------------------------------------------ */
/* Toast key constant (083 wires i18n copy; 081 provides the key)      */
/* ------------------------------------------------------------------ */

/**
 * i18n key for the follow-break toast.
 * Task 083 will add this key to locales.ts with EN + zh-CN copy.
 * Shape: "Stopped following {name}" / "已停止跟随 {name}".
 */
export const FOLLOW_BREAK_TOAST_KEY = "CollabFollowBroke";

/* ------------------------------------------------------------------ */
/* applyViewport — the ONE viewport writer                              */
/* ------------------------------------------------------------------ */

/**
 * The single viewport application function used by:
 *   - Continuous follow (presenter viewport streams arrive continuously)
 *   - Cursor-jump hop (Ticket 063 ①: initial sync on follow activation)
 *
 * Raw pass-through: scrollX / scrollY / zoom.value go verbatim into
 * appState. Zero adaptation math — the presenter's viewport IS our
 * viewport (no offset compensation, no scale compensation in v1).
 */
export interface FollowViewport {
  scrollX: number;
  scrollY: number;
  zoom: Zoom; // zoom.value is the scalar
}

export function applyViewport(
  api: ExcalidrawImperativeAPI,
  viewport: FollowViewport,
): void {
  api.updateScene({
    appState: {
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: viewport.zoom,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Break classifier                                                     */
/* ------------------------------------------------------------------ */

/**
 * Event-ish inputs that can break the follow relationship.
 * These mirror real DOM / hook events; the session hook translates
 * native events into these types before calling classifyFollowEvent.
 */
export type FollowEvent =
  | "pointerdown" // user started dragging / pointing on canvas
  | "wheel"       // scroll / pan gesture
  | "pinch"       // pinch-to-zoom gesture
  | "presenter-left"   // followed member disappeared from roster
  | "own-present-start" // local user started presenting
  | "manual-unfollow";  // user explicitly clicked "Stop Following"

export interface FollowEventResult {
  /** True when the follow relationship must end. */
  shouldBreak: boolean;
  /**
   * i18n key for the toast to show.
   * Empty string = silent (manual-unfollow in prototype).
   * Non-empty = call toast(FOLLOW_BREAK_TOAST_KEY, { name: presenterName }).
   */
  toastKey: string;
}

/**
 * Maps a FollowEvent to a {shouldBreak, toastKey} result.
 *
 * Decision rules (ADR 0008):
 *   - manual-unfollow → always breaks silently (prototype flow).
 *   - own-present-start → always breaks with toast (local own-present
 *     overrides everything — C in shouldBreakFollow; event adds it too).
 *   - All other events (involuntary) → break when shouldBreakFollow is
 *     true, toast when breaking.
 *
 * Uses shouldBreakFollow from follow-break.ts (task 080) for the
 * predicate so the truth table stays consistent.
 */
export function classifyFollowEvent(
  event: FollowEvent,
  inputs: {
    localGesture: boolean;
    presenterLeft: boolean;
    ownPresentStarted: boolean;
  },
): FollowEventResult {
  // Manual unfollow is always intentional and always silent.
  if (event === "manual-unfollow") {
    return { shouldBreak: true, toastKey: "" };
  }

  // own-present-start is an explicit local act that breaks follow —
  // it is the C-axis in shouldBreakFollow and the event itself adds it.
  if (event === "own-present-start") {
    return { shouldBreak: true, toastKey: FOLLOW_BREAK_TOAST_KEY };
  }

  // All involuntary events (pointerdown / wheel / pinch / presenter-left).
  // Delegate to the centralized predicate from follow-break.ts.
  const break_ = shouldBreakFollow(inputs);
  return {
    shouldBreak: break_,
    toastKey: break_ ? FOLLOW_BREAK_TOAST_KEY : "",
  };
}
