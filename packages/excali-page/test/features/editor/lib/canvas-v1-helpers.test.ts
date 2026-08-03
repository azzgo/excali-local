import { describe, expect, test } from "vitest";
import { buildCanvasV1Helpers } from "@/features/editor/lib/canvas-v1-helpers";

/**
 * Real-helpers coverage: buildCanvasV1Helpers imports the patched tgz. The
 * pure parts (convertToExcalidrawElements / getCommonBounds) run under
 * happy-dom without a canvas; the canvas-bound exportPng/exportSvg need a real
 * browser canvas and are covered structurally by the dispatcher unit tests.
 */
describe("canvas/v1 real helpers (patched tgz)", () => {
  const helpers = buildCanvasV1Helpers();

  test("convertToExcalidrawElements normalizes partials (fills id + defaults)", () => {
    const els = helpers.convertToExcalidrawElements([
      { type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    ]);
    expect(els.length).toBe(1);
    const el = els[0] as { id?: string; type?: string; width?: number; height?: number; strokeColor?: string };
    expect(typeof el.id).toBe("string");
    expect(el.id!.length).toBeGreaterThan(0);
    expect(el.type).toBe("rectangle");
    expect(el.width).toBe(100);
    expect(el.height).toBe(50);
    expect(typeof el.strokeColor).toBe("string"); // default filled
  });

  test("getCommonBounds computes the scene bounding box", () => {
    const els = helpers.convertToExcalidrawElements([
      { type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
      { type: "ellipse", x: 200, y: 0, width: 10, height: 10 },
    ]);
    const [x1, y1, x2, y2] = helpers.getCommonBounds(els as never);
    expect([x1, y1, x2, y2]).toEqual([10, 0, 210, 70]);
  });

  test("exportPng is available (canvas-bound; not exercised without a DOM canvas)", () => {
    expect(typeof helpers.exportPng).toBe("function");
    expect(typeof helpers.exportSvg).toBe("function");
  });
});
