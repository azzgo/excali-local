/**
 * Unit tests for applySlideOrder.
 *
 * Verifies:
 *  - Frames in frameIdList get new objects with updated customData (immutable write).
 *  - Non-frame elements pass through BY REFERENCE (original objects not mutated).
 *  - updateScene is called exactly once with captureUpdate = IMMEDIATELY.
 *  - localStorage.setItem is NOT called (no room-state leak).
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { applySlideOrder } from "@/features/collab/apply-slide-order";
import { orderAttributeLabel } from "@/features/editor/type";

// Mock @excalidraw/excalidraw so we can assert on CaptureUpdateAction values
// and spy updateScene / getSceneElements without importing the tgz bundle.
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: {
    NEVER: "NEVER",
    IMMEDIATELY: "IMMEDIATELY",
    EVENTUALLY: "EVENTUALLY",
  },
}));

// Track localStorage.setItem calls
const localStorageSetItemSpy = vi
  .spyOn(Storage.prototype, "setItem")
  .mockReturnValue(undefined);

interface FakeFrame {
  id: string;
  type: "frame";
  x: number;
  y: number;
  customData?: Record<string, unknown>;
}

interface FakeRect {
  id: string;
  type: "rectangle";
  x: number;
  y: number;
}

type FakeElement = FakeFrame | FakeRect;

describe("applySlideOrder", () => {
  beforeEach(() => {
    localStorageSetItemSpy.mockClear();
  });

  afterAll(() => {
    localStorageSetItemSpy.mockRestore();
  });

  test("sets customData order immutably on frames in frameIdList", () => {
    const frame1: FakeFrame = { id: "frame-a", type: "frame", x: 0, y: 0 };
    const frame2: FakeFrame = { id: "frame-b", type: "frame", x: 100, y: 0 };
    const rect: FakeRect = { id: "rect-1", type: "rectangle", x: 10, y: 10 };

    const sceneElements: FakeElement[] = [frame1, rect, frame2];

    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => sceneElements,
      updateScene,
    } as any;

    applySlideOrder(excalidrawAPI, ["frame-b", "frame-a"]);

    expect(updateScene).toHaveBeenCalledTimes(1);
    const { elements, captureUpdate } = updateScene.mock.calls[0][0] as {
      elements: FakeElement[];
      captureUpdate: string;
    };

    // frame-b → index 0, frame-a → index 1
    const updatedFrameB = elements.find((e) => e.id === "frame-b") as FakeFrame;
    const updatedFrameA = elements.find((e) => e.id === "frame-a") as FakeFrame;

    expect(updatedFrameB.customData?.[orderAttributeLabel]).toBe(0);
    expect(updatedFrameA.customData?.[orderAttributeLabel]).toBe(1);
    expect(captureUpdate).toBe("IMMEDIATELY");
  });

  test("non-frame elements pass through BY REFERENCE (same object identity)", () => {
    const frame: FakeFrame = { id: "frame-x", type: "frame", x: 0, y: 0 };
    const rect1: FakeRect = { id: "rect-1", type: "rectangle", x: 10, y: 10 };
    const rect2: FakeRect = { id: "rect-2", type: "rectangle", x: 20, y: 20 };

    const sceneElements: FakeElement[] = [frame, rect1, rect2];

    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => sceneElements,
      updateScene,
    } as any;

    applySlideOrder(excalidrawAPI, ["frame-x"]);

    const { elements } = updateScene.mock.calls[0][0] as { elements: FakeElement[] };

    // rect1 and rect2 should be the exact same objects (reference equality)
    expect(elements.find((e) => e.id === "rect-1")).toBe(rect1);
    expect(elements.find((e) => e.id === "rect-2")).toBe(rect2);

    // frame should be a NEW object (immutable update)
    expect(elements.find((e) => e.id === "frame-x")).not.toBe(frame);
    expect(elements.find((e) => e.id === "frame-x")).toEqual({
      ...frame,
      customData: { [orderAttributeLabel]: 0 },
    });
  });

  test("ORIGINAL frame objects are NOT mutated (immutability guarantee)", () => {
    const originalFrame: FakeFrame = {
      id: "frame-y",
      type: "frame",
      x: 0,
      y: 0,
    };

    const sceneElements: FakeElement[] = [originalFrame];

    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => sceneElements,
      updateScene,
    } as any;

    applySlideOrder(excalidrawAPI, ["frame-y"]);

    // The original frame object must NOT have been mutated
    expect(originalFrame.customData).toBeUndefined();
  });

  test("updateScene is called exactly once with captureUpdate IMMEDIATELY", () => {
    const sceneElements: FakeElement[] = [];
    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => sceneElements,
      updateScene,
    } as any;

    applySlideOrder(excalidrawAPI, []);

    expect(updateScene).toHaveBeenCalledTimes(1);
    const { captureUpdate } = updateScene.mock.calls[0][0] as { captureUpdate: string };
    expect(captureUpdate).toBe("IMMEDIATELY");
  });

  test("localStorage.setItem is NOT called (no room-state leak)", () => {
    const frame: FakeFrame = { id: "frame-z", type: "frame", x: 0, y: 0 };
    const sceneElements: FakeElement[] = [frame];

    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => sceneElements,
      updateScene,
    } as any;

    applySlideOrder(excalidrawAPI, ["frame-z"]);

    expect(localStorageSetItemSpy).not.toHaveBeenCalled();
  });

  test("frame with existing customData preserves other customData keys", () => {
    const frame: FakeFrame = {
      id: "frame-w",
      type: "frame",
      x: 0,
      y: 0,
      customData: { otherKey: "keep-me" },
    };

    const sceneElements: FakeElement[] = [frame];

    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => sceneElements,
      updateScene,
    } as any;

    applySlideOrder(excalidrawAPI, ["frame-w"]);

    const { elements } = updateScene.mock.calls[0][0] as { elements: FakeElement[] };
    const updatedFrame = elements.find((e) => e.id === "frame-w") as FakeFrame;

    expect(updatedFrame.customData).toEqual({
      otherKey: "keep-me",
      [orderAttributeLabel]: 0,
    });
  });

  test("empty frameIdList produces a scene update with unchanged elements (pass-through)", () => {
    const rect: FakeRect = { id: "rect-1", type: "rectangle", x: 0, y: 0 };
    const sceneElements: FakeElement[] = [rect];

    const updateScene = vi.fn();
    const excalidrawAPI = {
      getSceneElements: () => sceneElements,
      updateScene,
    } as any;

    applySlideOrder(excalidrawAPI, []);

    expect(updateScene).toHaveBeenCalledTimes(1);
    const { elements } = updateScene.mock.calls[0][0] as { elements: FakeElement[] };
    expect(elements).toHaveLength(1);
    expect(elements[0]).toBe(rect); // reference preserved
  });
});
