/**
 * follow-break.ts — the ONE follow-break predicate (task 080 / 081).
 *
 * A follow relationship is broken when ANY of these holds:
 *   1. `localGesture` — the local user is interacting (scroll/pan/zoom/pointer).
 *   2. `presenterLeft` — the followed member is no longer in the roster.
 *   3. `ownPresentStarted` — the local user started presenting.
 *
 * Exported as a pure function so task 081 can build its frame-application
 * truth table without importing React or the hook.
 */
export interface FollowBreakInputs {
  localGesture: boolean;
  presenterLeft: boolean;
  ownPresentStarted: boolean;
}

/**
 * Returns true when the follow relationship must be broken.
 * All three inputs are required so every caller is explicit.
 */
export function shouldBreakFollow({
  localGesture,
  presenterLeft,
  ownPresentStarted,
}: FollowBreakInputs): boolean {
  return localGesture || presenterLeft || ownPresentStarted;
}
