/**
 * follow-engine.test.ts — task 081.
 *
 * Red-first TDD:
 *   1. Full break-predicate truth table for every FollowEvent × every
 *      {localGesture, presenterLeft, ownPresentStarted} combination.
 *   2. applyViewport passthrough — stub api must receive exactly the
 *      viewport values we passed in.
 *   3. Guard-token shape — opaque symbol returned by getFollowGuardToken().
 */
import { describe, expect, test, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Zoom } from "@excalidraw/excalidraw/types";
import {
  classifyFollowEvent,
  applyViewport,
  getFollowGuardToken,
  FOLLOW_BREAK_TOAST_KEY,
} from "@/features/collab/follow-engine";

/* ------------------------------------------------------------------ */
/* Stub API                                                             */
/* ------------------------------------------------------------------ */

function makeStubApi() {
  return {
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
    isDestroyed: false,
  } as unknown as ExcalidrawImperativeAPI;
}

/* ------------------------------------------------------------------ */
/* applyViewport passthrough                                            */
/* ------------------------------------------------------------------ */

describe("applyViewport", () => {
  test("writes scrollX, scrollY, zoom.value verbatim to updateScene", () => {
    const api = makeStubApi();
    const viewport = { scrollX: 150, scrollY: 200, zoom: { value: 1.5 } as Zoom };
    applyViewport(api, viewport);
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: { scrollX: 150, scrollY: 200, zoom: { value: 1.5 } },
    });
  });

  test("zero values are written (no coercion)", () => {
    const api = makeStubApi();
    const viewport = { scrollX: 0, scrollY: 0, zoom: { value: 0 } as Zoom };
    applyViewport(api, viewport);
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: { scrollX: 0, scrollY: 0, zoom: { value: 0 } },
    });
  });

  test("negative values are written (e.g. overscroll)", () => {
    const api = makeStubApi();
    const viewport = { scrollX: -50, scrollY: -30, zoom: { value: 0.5 } as Zoom };
    applyViewport(api, viewport);
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: { scrollX: -50, scrollY: -30, zoom: { value: 0.5 } },
    });
  });
});

/* ------------------------------------------------------------------ */
/* Guard token                                                          */
/* ------------------------------------------------------------------ */

describe("getFollowGuardToken", () => {
  test("returns a non-null value", () => {
    expect(getFollowGuardToken()).not.toBeNull();
  });

  test("returns the same token on every call (pure identity)", () => {
    const a = getFollowGuardToken();
    const b = getFollowGuardToken();
    expect(a).toBe(b);
  });
});

/* ------------------------------------------------------------------ */
/* FOLLOW_BREAK_TOAST_KEY constant                                      */
/* ------------------------------------------------------------------ */

describe("FOLLOW_BREAK_TOAST_KEY", () => {
  test("is a non-empty string", () => {
    expect(typeof FOLLOW_BREAK_TOAST_KEY).toBe("string");
    expect(FOLLOW_BREAK_TOAST_KEY.length).toBeGreaterThan(0);
  });

  test("is used as the toastKey for involuntary breaks", () => {
    // Any involuntary event that SHOULD break must carry this key.
    const result = classifyFollowEvent("pointerdown", {
      localGesture: true,
      presenterLeft: false,
      ownPresentStarted: false,
    });
    expect(result.shouldBreak).toBe(true);
    expect(result.toastKey).toBe(FOLLOW_BREAK_TOAST_KEY);
  });
});

/* ------------------------------------------------------------------ */
/* Break-predicate truth table                                          */
/*                                                                   */
/*  Event → classifier → { shouldBreak, toastKey }
 *  Rows are grouped by input truth-table dimension:
 *    A = localGesture, B = presenterLeft, C = ownPresentStarted
 *                                                                   */
/*  Break-when: A || B || C (per shouldBreakFollow from follow-break.ts)
 *  Toast: involuntary events → FOLLOW_BREAK_TOAST_KEY
 *         manual-unfollow      → "" (silent prototype)
 *                                                                   */
/* ------------------------------------------------------------------ */

type BreakInputs = {
  localGesture: boolean;
  presenterLeft: boolean;
  ownPresentStarted: boolean;
};

/** All 8 combinations of the three boolean inputs. */
const INPUT_COMBOS: BreakInputs[] = [
  { localGesture: false, presenterLeft: false, ownPresentStarted: false },
  { localGesture: false, presenterLeft: false, ownPresentStarted: true  },
  { localGesture: false, presenterLeft: true,  ownPresentStarted: false },
  { localGesture: false, presenterLeft: true,  ownPresentStarted: true  },
  { localGesture: true,  presenterLeft: false, ownPresentStarted: false },
  { localGesture: true,  presenterLeft: false, ownPresentStarted: true  },
  { localGesture: true,  presenterLeft: true,  ownPresentStarted: false },
  { localGesture: true,  presenterLeft: true,  ownPresentStarted: true  },
];

/** Involuntary events — must break + toast for EVERY combination. */
const INVOLUNTARY_EVENTS = [
  "pointerdown",
  "wheel",
  "pinch",
  "presenter-left",
] as const;

/** Own-present-start — should break + toast (not a localGesture). */
const OWN_PRESENT_EVENTS = ["own-present-start"] as const;

/** Manual unfollow — should break + SILENT (toastKey = ""). */
const MANUAL_UNFOLLOW_EVENTS = ["manual-unfollow"] as const;

describe("classifyFollowEvent — truth table", () => {
  /**
   * Involuntary events (pointerdown / wheel / pinch / presenter-left):
   *   shouldBreak = A || B || C   (per shouldBreakFollow)
   *   toastKey    = shouldBreak ? FOLLOW_BREAK_TOAST_KEY : ""
   */
  describe.each(INVOLUNTARY_EVENTS)("involuntary event: %s", (event) => {
    test.each(INPUT_COMBOS)(
      "A=$localGesture B=$presenterLeft C=$ownPresentStarted → shouldBreak=$localGesture||$presenterLeft||$ownPresentStarted",
      ({ localGesture, presenterLeft, ownPresentStarted }) => {
        const result = classifyFollowEvent(event, {
          localGesture,
          presenterLeft,
          ownPresentStarted,
        });
        const expectedBreak = localGesture || presenterLeft || ownPresentStarted;
        expect(result.shouldBreak).toBe(expectedBreak);
        expect(result.toastKey).toBe(
          expectedBreak ? FOLLOW_BREAK_TOAST_KEY : "",
        );
      },
    );
  });

  /**
   * own-present-start:
   *   Should break + toast regardless of localGesture (own-present-start is
   *   the third break axis — C).
   */
  describe.each(OWN_PRESENT_EVENTS)("own-present-start event: %s", (event) => {
    test.each(INPUT_COMBOS)(
      "A=$localGesture B=$presenterLeft C=$ownPresentStarted → shouldBreak=true (own-present-start always breaks), toastKey=FOLLOW_BREAK_TOAST_KEY",
      ({ localGesture, presenterLeft, ownPresentStarted }) => {
        const result = classifyFollowEvent(event, {
          localGesture,
          presenterLeft,
          ownPresentStarted,
        });
        // own-present-start ALWAYS breaks (C=true case + the event itself breaks).
        // In our model: shouldBreak = true always, toastKey = FOLLOW_BREAK_TOAST_KEY.
        expect(result.shouldBreak).toBe(true);
        expect(result.toastKey).toBe(FOLLOW_BREAK_TOAST_KEY);
      },
    );
  });

  /**
   * manual-unfollow:
   *   shouldBreak = true (intentional) — but SILENT (toastKey = "").
   *   localGesture/presenterLeft/ownPresentStarted are IGNORED because the
   *   manual act of unfollowing is always the final word in the prototype.
   */
  describe.each(MANUAL_UNFOLLOW_EVENTS)("manual-unfollow event: %s", (event) => {
    test.each(INPUT_COMBOS)(
      "A=$localGesture B=$presenterLeft C=$ownPresentStarted → shouldBreak=true, toastKey='' (silent)",
      ({ localGesture, presenterLeft, ownPresentStarted }) => {
        const result = classifyFollowEvent(event, {
          localGesture,
          presenterLeft,
          ownPresentStarted,
        });
        expect(result.shouldBreak).toBe(true);
        expect(result.toastKey).toBe(""); // silent prototype
      },
    );
  });
});

/* ------------------------------------------------------------------ */
/* Semantic edge cases                                                  */
/* ------------------------------------------------------------------ */

describe("classifyFollowEvent — semantic edge cases", () => {
  test("pointerdown with no break inputs → shouldBreak=false, toastKey=''", () => {
    const r = classifyFollowEvent("pointerdown", {
      localGesture: false,
      presenterLeft: false,
      ownPresentStarted: false,
    });
    expect(r.shouldBreak).toBe(false);
    expect(r.toastKey).toBe("");
  });

  test("pointerdown with localGesture=true → shouldBreak=true, toast", () => {
    const r = classifyFollowEvent("pointerdown", {
      localGesture: true,
      presenterLeft: false,
      ownPresentStarted: false,
    });
    expect(r.shouldBreak).toBe(true);
    expect(r.toastKey).toBe(FOLLOW_BREAK_TOAST_KEY);
  });

  test("presenter-left alone breaks and toasts", () => {
    const r = classifyFollowEvent("presenter-left", {
      localGesture: false,
      presenterLeft: true,
      ownPresentStarted: false,
    });
    expect(r.shouldBreak).toBe(true);
    expect(r.toastKey).toBe(FOLLOW_BREAK_TOAST_KEY);
  });

  test("own-present-start alone breaks and toasts", () => {
    const r = classifyFollowEvent("own-present-start", {
      localGesture: false,
      presenterLeft: false,
      ownPresentStarted: false,
    });
    expect(r.shouldBreak).toBe(true);
    expect(r.toastKey).toBe(FOLLOW_BREAK_TOAST_KEY);
  });

  test("manual-unfollow is always silent regardless of inputs", () => {
    const r = classifyFollowEvent("manual-unfollow", {
      localGesture: true,
      presenterLeft: true,
      ownPresentStarted: true,
    });
    expect(r.shouldBreak).toBe(true);
    expect(r.toastKey).toBe(""); // manual-unfollow overrides all — silent
  });
});
