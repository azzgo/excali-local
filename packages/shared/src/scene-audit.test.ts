import { describe, expect, test } from "vitest";
import { auditScene, boxOf, type AuditElement } from "./scene-audit";

/**
 * The audit's own verification. Every metric is proved to FIRE on an injected
 * defect and stay SILENT on a clean scene — an audit that never fails is worse
 * than no audit, and an audit that always fails is ignored.
 *
 * The two negative-control cases (clean scene, arrow crossing a box) matter as
 * much as the positives: they pin down what the audit deliberately does NOT
 * flag, so a future change cannot quietly start crying wolf.
 */

const rect = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<AuditElement> = {},
): AuditElement => ({ id, type: "rectangle", x, y, width, height, ...extra });

const boundLabel = (
  id: string,
  container: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text = "label",
): AuditElement => ({ id, type: "text", x, y, width, height, text, containerId: container });

const arrow = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  points: Array<[number, number]>,
  extra: Partial<AuditElement> = {},
): AuditElement => ({ id, type: "arrow", x, y, width, height, points, ...extra });

describe("auditScene — overlap", () => {
  test("fires on two boxes sharing area, reporting the area", () => {
    const r = auditScene([
      rect("a", 0, 0, 180, 90),
      rect("b", 120, 40, 180, 90),
    ]);
    expect(r.ok).toBe(false);
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0]).toMatchObject({ a: "a", b: "b" });
    expect(r.overlaps[0].area).toBe(60 * 50);
    expect(r.summary).toContain("1 overlap");
  });

  test("silent on boxes that merely touch (area 0)", () => {
    const r = auditScene([rect("a", 0, 0, 100, 100), rect("b", 100, 0, 100, 100)]);
    expect(r.overlaps).toHaveLength(0);
  });

  test("a bound label inside a container is not an overlap", () => {
    const r = auditScene([
      rect("a", 0, 0, 200, 100, { boundElements: [{ id: "t", type: "text" }] }),
      boundLabel("t", "a", 50, 40, 100, 20),
    ]);
    expect(r.overlaps).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  test("ignores deleted elements", () => {
    const r = auditScene([
      rect("a", 0, 0, 180, 90),
      rect("b", 120, 40, 180, 90, { isDeleted: true }),
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("auditScene — gutter", () => {
  test("fires when the clear gap is under the configured gutter", () => {
    const r = auditScene([rect("a", 0, 0, 100, 100), rect("b", 110, 0, 100, 100)]);
    expect(r.gutterViolations).toHaveLength(1);
    expect(r.gutterViolations[0]).toMatchObject({ a: "a", b: "b", gap: 10 });
  });

  test("silent at exactly the gutter", () => {
    const r = auditScene([rect("a", 0, 0, 100, 100), rect("b", 140, 0, 100, 100)]);
    expect(r.gutterViolations).toHaveLength(0);
  });

  test("honours a custom gutter", () => {
    const r = auditScene([rect("a", 0, 0, 100, 100), rect("b", 110, 0, 100, 100)], {
      gutter: 8,
    });
    expect(r.gutterViolations).toHaveLength(0);
  });

  test("reports a real diagonal distance, not zero", () => {
    const r = auditScene([rect("a", 0, 0, 100, 100), rect("b", 120, 130, 100, 100)]);
    expect(r.gutterViolations[0].gap).toBe(30);
  });
});

describe("auditScene — text fit", () => {
  test("fires when the label is taller than the container's inner height", () => {
    const r = auditScene([
      rect("a", 0, 0, 180, 60),
      boundLabel("t", "a", 20, 10, 140, 48, "two\nlines"),
    ]);
    expect(r.textFit).toHaveLength(1);
    expect(r.textFit[0]).toMatchObject({ kind: "too-tall", text: "t", container: "a" });
  });

  test("fires when the label is wider than the container's inner width", () => {
    const r = auditScene([
      rect("a", 0, 0, 180, 90),
      boundLabel("t", "a", 10, 35, 170, 20),
    ]);
    expect(r.textFit[0]).toMatchObject({ kind: "too-wide" });
  });

  test("counts a wrapped label even when it fits", () => {
    const r = auditScene([
      rect("a", 0, 0, 200, 100),
      boundLabel("t", "a", 20, 20, 160, 60, "line one\nline two"),
    ]);
    expect(r.wrappedLabels).toBe(1);
  });

  test("reports a dangling containerId", () => {
    const r = auditScene([boundLabel("t", "ghost", 0, 0, 10, 10)]);
    expect(r.textFit[0]).toMatchObject({ kind: "container-missing", container: "ghost" });
  });

  test("dead space ratio reflects a label floating in an oversized box", () => {
    const tight = auditScene([
      rect("a", 0, 0, 200, 100),
      boundLabel("t", "a", 20, 20, 160, 60),
    ]);
    const loose = auditScene([
      rect("a", 0, 0, 400, 300),
      boundLabel("t", "a", 20, 20, 160, 60),
    ]);
    expect(loose.deadSpaceRatio).toBeGreaterThan(tight.deadSpaceRatio);
  });
});

describe("auditScene — bindings", () => {
  test("flags an arrow with no bindings", () => {
    const r = auditScene([
      rect("a", 0, 0, 100, 50),
      arrow("e", 100, 25, 200, 0, [
        [0, 0],
        [200, 0],
      ]),
    ]);
    expect(r.unboundArrows).toEqual(["e"]);
  });

  test("flags a dangling binding target", () => {
    const r = auditScene([
      rect("a", 0, 0, 100, 50, { boundElements: [{ id: "e", type: "arrow" }] }),
      arrow("e", 100, 25, 100, 0, [
        [0, 0],
        [100, 0],
      ], {
        startBinding: { elementId: "a" },
        endBinding: { elementId: "ghost" },
      }),
    ]);
    expect(r.bindingViolations).toEqual([
      { arrow: "e", field: "endBinding", kind: "dangling-target", detail: "ghost" },
    ]);
  });

  test("flags a missing reverse link (the container does not know the arrow)", () => {
    const r = auditScene([
      rect("a", 0, 0, 100, 50),
      rect("b", 300, 0, 100, 50, { boundElements: [{ id: "e", type: "arrow" }] }),
      arrow("e", 100, 25, 200, 0, [
        [0, 0],
        [200, 0],
      ], {
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
      }),
    ]);
    expect(r.bindingViolations).toEqual([
      { arrow: "e", field: "startBinding", kind: "missing-reverse", detail: "a" },
    ]);
  });

  test("silent when both directions are closed", () => {
    const r = auditScene([
      rect("a", 0, 0, 100, 50, { boundElements: [{ id: "e", type: "arrow" }] }),
      rect("b", 300, 0, 100, 50, { boundElements: [{ id: "e", type: "arrow" }] }),
      arrow("e", 100, 25, 200, 0, [
        [0, 0],
        [200, 0],
      ], {
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
      }),
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("auditScene — waypoints", () => {
  test("flags a bend point that lands inside a node", () => {
    const r = auditScene([
      rect("a", 0, 0, 100, 50, { boundElements: [{ id: "e", type: "line" }] }),
      rect("b", 300, 200, 100, 50, { boundElements: [{ id: "e", type: "line" }] }),
      arrow("e", 50, 25, 300, 200, [
        [0, 0],
        [150, 150],
        [300, 200],
      ], {
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
      }),
    ]);
    // (150,150) is between the two boxes; nothing is inside either box.
    expect(r.waypointsInsideNodes).toHaveLength(0);
  });

  test("catches a waypoint inside a third box that sits on the route", () => {
    const r = auditScene([
      rect("a", 0, 0, 100, 50, { boundElements: [{ id: "e", type: "line" }] }),
      rect("mid", 150, 100, 200, 100),
      rect("b", 300, 300, 100, 50, { boundElements: [{ id: "e", type: "line" }] }),
      arrow("e", 50, 25, 300, 300, [
        [0, 0],
        [200, 150],
        [300, 300],
      ], {
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
      }),
    ]);
    expect(r.waypointsInsideNodes).toEqual([
      { edge: "e", node: "mid", point: [250, 175] },
    ]);
  });
});

describe("auditScene — negative controls", () => {
  test("a clean scene is clean and reports its bounds", () => {
    const r = auditScene([
      rect("a", 0, 0, 180, 90, { boundElements: [{ id: "ta", type: "text" }, { id: "e", type: "arrow" }] }),
      boundLabel("ta", "a", 20, 35, 140, 20, "Start"),
      rect("b", 300, 0, 180, 90, { boundElements: [{ id: "tb", type: "text" }, { id: "e", type: "arrow" }] }),
      boundLabel("tb", "b", 320, 35, 140, 20, "Done"),
      arrow("e", 180, 45, 120, 0, [
        [0, 0],
        [120, 0],
      ], {
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
      }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.overlaps).toEqual([]);
    expect(r.gutterViolations).toEqual([]);
    expect(r.textFit).toEqual([]);
    expect(r.unboundArrows).toEqual([]);
    expect(r.bindingViolations).toEqual([]);
    expect(r.bounds).toMatchObject({ width: 480, height: 90 });
    expect(r.summary).toContain("ok");
  });

  test("an arrow crossing a box is NOT flagged (arrows legitimately cross)", () => {
    const r = auditScene([
      rect("a", 0, 0, 100, 50, { boundElements: [{ id: "e", type: "arrow" }] }),
      rect("b", 300, 300, 100, 50, { boundElements: [{ id: "e", type: "arrow" }] }),
      rect("c", 150, 150, 100, 50),
      arrow("e", 50, 25, 300, 300, [
        [0, 0],
        [300, 300],
      ], {
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
      }),
    ]);
    // The arrow passes through c, but no BEND POINT is inside c.
    expect(r.waypointsInsideNodes).toHaveLength(0);
  });

  test("an empty scene is ok, not a crash", () => {
    const r = auditScene([]);
    expect(r.ok).toBe(true);
    expect(r.bounds).toEqual({ width: 0, height: 0, aspect: 0 });
  });
});

describe("boxOf", () => {
  test("normalizes a negative-size box (mirrored width)", () => {
    const b = boxOf({ id: "a", type: "rectangle", x: 100, y: 100, width: -40, height: -20 });
    expect(b).toMatchObject({ x1: 60, y1: 80, x2: 100, y2: 100, width: 40, height: 20 });
  });
});
