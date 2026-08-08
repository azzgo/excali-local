import { describe, expect, test } from "vitest";
import {
  convertToExcalidrawElements,
  setCustomTextMetricsProvider,
} from "@excalidraw/excalidraw";
import { ensureRenderSafeDefaults } from "@/features/editor/lib/canvas-v1";

/**
 * Regression test for the freedraw `groupIds` render crash.
 *
 * The patched tgz's convertToExcalidrawElements fills `groupIds: []` on
 * text/rectangle/arrow but NOT on freedraw. Excalidraw's render loop reads
 * `e.groupIds.length` on every visible element without a null check, so a
 * freedraw added via `elements.add` crashed the page (the scene-restore path
 * fills these, which is why a reloaded scene rendered fine). The fix:
 * `ensureRenderSafeDefaults` in canvas-v1.ts normalizes after the transform.
 */
setCustomTextMetricsProvider({
  getLineWidth: (text: string) => Math.max(20, text.length * 8),
});

const convert = (partials: unknown[]) =>
  convertToExcalidrawElements(partials as never) as Array<Record<string, unknown>>;

describe("add-path render safety (freedraw groupIds crash)", () => {
  test("real transform emits freedraw WITHOUT groupIds (the bug precondition)", () => {
    const [fd] = convert([
      { type: "freedraw", x: 0, y: 0, width: 20, height: 10, points: [[0, 0], [10, 5], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 1, opacity: 100 },
    ]);
    expect(fd.type).toBe("freedraw");
    expect(fd.groupIds).toBeUndefined();
  });

  test("ensureRenderSafeDefaults fills groupIds on every element + freedraw pressures", () => {
    const out = convert([
      { type: "freedraw", x: 0, y: 0, width: 20, height: 10, points: [[0, 0], [10, 5], [20, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 1, opacity: 100 },
      { type: "text", x: 0, y: 0, text: "hi", fontFamily: 1, fontSize: 16, strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 1, opacity: 100 },
    ]);
    ensureRenderSafeDefaults(out);
    for (const el of out) {
      expect(el.groupIds, `groupIds on ${el.type}`).toEqual(expect.any(Array));
    }
    const fd = out.find((e) => e.type === "freedraw")!;
    expect(fd.pressures).toEqual([0.5, 0.5, 0.5]);
    expect(fd.simulatePressure).toBe(true);
  });

  test("ensureRenderSafeDefaults leaves existing values alone and skips nulls", () => {
    const el = { type: "freedraw", groupIds: ["g1"], pressures: [1, 0], simulatePressure: false, points: [[0, 0]] } as Record<string, unknown>;
    ensureRenderSafeDefaults([el, null, undefined]);
    expect(el.groupIds).toEqual(["g1"]);
    expect(el.pressures).toEqual([1, 0]);
    expect(el.simulatePressure).toBe(false);
  });
});
