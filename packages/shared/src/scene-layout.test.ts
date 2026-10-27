import { describe, expect, test } from "vitest";
import { auditScene, type AuditReport } from "./scene-audit";
import {
  assignLayers,
  boxForNode,
  layoutBaseline,
  layoutMeasuredOnFixedGrid,
  layoutScene,
  layoutToAuditElements,
  toElementPartials,
  type LayoutInput,
  type LayoutResult,
} from "./scene-layout";
import {
  ALL_FIXTURES,
  edgesOf,
  labelsOf,
  measureLabel,
  type DiagramFixture,
} from "./diagram-fixtures";

/**
 * THE A/B — this file is the proof that the layout change is an improvement,
 * not a preference.
 *
 * Three arms over the same abstract graph and the same labels:
 *
 *   baseline   — the OLD skill advice: fixed scale tier (180x90) + fixed grid
 *                step (300x200), no measurement.
 *   measured   — the agent DOES size boxes from the label, but keeps the fixed
 *                grid step. This is the arm that reproduces the reported
 *                "elements cover each other".
 *   candidate  — measure-then-place: pack each layer by measured width using
 *                ELK's tuned spacing.
 *
 * The assertions are RELATIVE (candidate vs baseline), never absolute
 * thresholds — so this file reads as red before the change and green after,
 * and stays a regression net afterwards.
 */

function layoutInput(fixture: DiagramFixture): LayoutInput {
  return {
    nodes: fixture.nodes.map((n) => {
      const m = measureLabel(n.label);
      return { id: n.id, labelWidth: m.width, labelHeight: m.height };
    }),
    edges: edgesOf(fixture),
  };
}

function auditOf(fixture: DiagramFixture, layout: LayoutResult): AuditReport {
  const elements = layoutToAuditElements(layout, labelsOf(fixture), edgesOf(fixture));
  return auditScene(elements);
}

interface ArmResult {
  name: string;
  layout: LayoutResult;
  audit: AuditReport;
}

function runArms(fixture: DiagramFixture): Record<string, ArmResult> {
  const input = layoutInput(fixture);
  const arms: Record<string, LayoutResult> = {
    baseline: layoutBaseline(input),
    measured: layoutMeasuredOnFixedGrid(input),
    candidate: layoutScene(input),
  };
  const out: Record<string, ArmResult> = {};
  for (const [name, layout] of Object.entries(arms)) {
    out[name] = { name, layout, audit: auditOf(fixture, layout) };
  }
  return out;
}

describe("A/B — the candidate strictly improves on the documented baseline", () => {
  for (const fixture of ALL_FIXTURES) {
    describe(fixture.name, () => {
      test("candidate has zero geometric defects", () => {
        const { candidate } = runArms(fixture);
        expect(candidate.audit.overlaps).toEqual([]);
        expect(candidate.audit.gutterViolations).toEqual([]);
        expect(candidate.audit.textFit).toEqual([]);
        expect(candidate.audit.unboundArrows).toEqual([]);
        expect(candidate.audit.bindingViolations).toEqual([]);
        expect(candidate.audit.waypointsInsideNodes).toEqual([]);
        expect(candidate.audit.ok).toBe(true);
      });

      test("candidate eliminates the wrapped labels the baseline forces", () => {
        const { baseline, candidate } = runArms(fixture);
        // Excalidraw CONTAINS a wrapped label (it re-centers it), so wrapping
        // is a readability defect, not a geometry one — proved on the page
        // side against the real transform. The baseline's fixed tier forces
        // the wrap; the candidate measures first and avoids it entirely.
        expect(baseline.audit.wrappedLabels).toBeGreaterThan(0);
        expect(baseline.audit.readabilityOk).toBe(false);
        expect(candidate.audit.wrappedLabels).toBe(0);
        expect(candidate.audit.readabilityOk).toBe(true);
      });

      test("candidate does not buy tidiness with wasted space", () => {
        const { baseline, candidate } = runArms(fixture);
        expect(candidate.audit.deadSpaceRatio).toBeLessThanOrEqual(
          baseline.audit.deadSpaceRatio + 0.1,
        );
      });

      test("candidate is not larger than the baseline", () => {
        const { baseline, candidate } = runArms(fixture);
        const baselineArea = baseline.audit.bounds.width * baseline.audit.bounds.height;
        const candidateArea = candidate.audit.bounds.width * candidate.audit.bounds.height;
        expect(candidateArea).toBeLessThanOrEqual(baselineArea);
      });
    });
  }

  test("the 'measured on a fixed grid' arm reproduces the reported overlap", () => {
    // This is the causal link the user reported: measuring without changing
    // the packing strategy produces collisions.
    const { measured } = runArms(ALL_FIXTURES[0]);
    const defects =
      measured.audit.overlaps.length + measured.audit.gutterViolations.length;
    expect(defects).toBeGreaterThan(0);
  });
});

describe("layout — layering", () => {
  test("a chain becomes one node per layer", () => {
    const input = layoutInput(ALL_FIXTURES[1]);
    const { layers, cycleNodes } = assignLayers(input.nodes, input.edges);
    expect(cycleNodes).toEqual([]);
    expect(layers).toHaveLength(5);
    expect(layers.every((l) => l.length === 1)).toBe(true);
  });

  test("a fan-out puts the leaves in one shared layer", () => {
    const input = layoutInput(ALL_FIXTURES[0]);
    const { layers } = assignLayers(input.nodes, input.edges);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual(["v"]);
    expect(layers[1]).toHaveLength(6);
  });

  test("a cycle is reported, not silently dropped", () => {
    const input = layoutInput(ALL_FIXTURES[2]);
    const { layers, cycleNodes } = assignLayers(input.nodes, input.edges);
    expect(cycleNodes.length).toBeGreaterThan(0);
    // Every node still appears exactly once across the layers.
    const seen = layers.flat();
    expect(new Set(seen).size).toBe(input.nodes.length);
  });

  test("unknown edge endpoints are ignored, not crashed on", () => {
    const { layers } = assignLayers(
      [{ id: "a", labelWidth: 10, labelHeight: 10 }],
      [{ from: "a", to: "ghost" }],
    );
    expect(layers.flat()).toEqual(["a"]);
  });
});

describe("layout — geometry invariants", () => {
  for (const fixture of ALL_FIXTURES) {
    test(`${fixture.name}: every node is placed exactly once, non-negative`, () => {
      const layout = layoutScene(layoutInput(fixture));
      expect(layout.nodes).toHaveLength(fixture.nodes.length);
      expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(fixture.nodes.length);
      for (const n of layout.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.width).toBeGreaterThan(0);
        expect(n.height).toBeGreaterThan(0);
      }
    });

    test(`${fixture.name}: rows never overlap vertically`, () => {
      const layout = layoutScene(layoutInput(fixture));
      const byLayer = new Map<number, typeof layout.nodes>();
      for (const n of layout.nodes) {
        const row = byLayer.get(n.layer) ?? [];
        row.push(n);
        byLayer.set(n.layer, row);
      }
      const rows = [...byLayer.entries()].sort((a, b) => a[0] - b[0]);
      for (let i = 0; i + 1 < rows.length; i++) {
        const bottom = Math.max(...rows[i][1].map((n) => n.y + n.height));
        const top = Math.min(...rows[i + 1][1].map((n) => n.y));
        expect(top).toBeGreaterThan(bottom);
      }
    });
  }

  test("a wider label produces a wider box (measurement actually drives geometry)", () => {
    const narrow = boxForNode({ id: "a", labelWidth: 40, labelHeight: 20 });
    const wide = boxForNode({ id: "b", labelWidth: 400, labelHeight: 20 });
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  test("min size clamps a tiny label", () => {
    const box = boxForNode({ id: "a", labelWidth: 4, labelHeight: 4 });
    expect(box.width).toBeGreaterThanOrEqual(160);
    expect(box.height).toBeGreaterThanOrEqual(64);
  });

  test("an explicit size override is honoured", () => {
    const box = boxForNode({ id: "a", labelWidth: 400, labelHeight: 400, width: 10, height: 10 });
    expect(box).toEqual({ width: 10, height: 10 });
  });
});

describe("toElementPartials — the payload contract", () => {
  test("labels ride the container's `label` property, not a separate text element", () => {
    const fixture = ALL_FIXTURES[1];
    const layout = layoutScene(layoutInput(fixture));
    const partials = toElementPartials(layout, labelsOf(fixture), edgesOf(fixture));
    const rects = partials.filter((p) => p.type === "rectangle");
    expect(rects).toHaveLength(fixture.nodes.length);
    for (const r of rects) {
      expect(r.label).toBeDefined();
      expect((r.label as { text: string }).text.length).toBeGreaterThan(0);
    }
    expect(partials.some((p) => p.type === "text")).toBe(false);
  });

  test("arrows bind with start/end (the input form), one per edge", () => {
    const fixture = ALL_FIXTURES[1];
    const layout = layoutScene(layoutInput(fixture));
    const partials = toElementPartials(layout, labelsOf(fixture), edgesOf(fixture));
    const arrows = partials.filter((p) => p.type === "arrow");
    expect(arrows).toHaveLength(fixture.edges.length);
    for (const a of arrows) {
      expect(a.start).toBeDefined();
      expect(a.end).toBeDefined();
      expect(a.startBinding).toBeUndefined();
      expect(a.endBinding).toBeUndefined();
    }
  });

  test("style is applied to every element", () => {
    const fixture = ALL_FIXTURES[1];
    const layout = layoutScene(layoutInput(fixture));
    const partials = toElementPartials(layout, labelsOf(fixture), edgesOf(fixture), {
      roughness: 1,
      strokeWidth: 2,
    });
    for (const p of partials) {
      expect(p.roughness).toBe(1);
      expect(p.strokeWidth).toBe(2);
    }
  });

  test("an edge to an unknown node is skipped, not emitted dangling", () => {
    const layout = layoutScene({
      nodes: [{ id: "a", labelWidth: 100, labelHeight: 20 }],
      edges: [],
    });
    const partials = toElementPartials(layout, new Map([["a", "A"]]), [
      { from: "a", to: "ghost" },
    ]);
    expect(partials.filter((p) => p.type === "arrow")).toHaveLength(0);
  });
});

describe("fixtures — the corpus stays honest", () => {
  test("every fixture declares what it exposes", () => {
    for (const f of ALL_FIXTURES) {
      expect(f.exposes.length).toBeGreaterThan(10);
      expect(f.nodes.length).toBeGreaterThan(1);
    }
  });

  test("every fixture has labels long enough to stress a fixed grid step", () => {
    for (const f of ALL_FIXTURES) {
      const widths = f.nodes.map((n) => measureLabel(n.label).width);
      expect(Math.max(...widths)).toBeGreaterThan(200);
    }
  });

  test("every edge endpoint exists as a node", () => {
    for (const f of ALL_FIXTURES) {
      const ids = new Set(f.nodes.map((n) => n.id));
      for (const [from, to] of f.edges) {
        expect(ids.has(from)).toBe(true);
        expect(ids.has(to)).toBe(true);
      }
    }
  });
});
