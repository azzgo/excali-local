import { describe, expect, test } from "vitest";
import {
  convertToExcalidrawElements,
  setCustomTextMetricsProvider,
} from "@excalidraw/excalidraw";
import {
  ALL_FIXTURES,
  auditScene,
  edgesOf,
  labelsOf,
  layoutBaseline,
  layoutMeasuredOnFixedGrid,
  layoutScene,
  measureLabel,
  toElementPartials,
  type AuditReport,
  type AuditElement,
  type DiagramFixture,
  type LayoutInput,
  type LayoutResult,
} from "excali-shared";
import { handleCanvasV1Request, type CanvasV1Api, type CanvasV1Helpers } from "@/features/editor/lib/canvas-v1";

/**
 * THE PAGE-SIDE HALF OF THE VERIFICATION CLOSURE.
 *
 * The shared package proves the algorithm against a synthetic scene. This file
 * proves the SAME algorithm against the REAL patched Excalidraw transform —
 * the exact code path `elements.add` takes in production. Two things only this
 * side can establish:
 *
 *   1. That the synthetic scene model is faithful. If shared's simulated label
 *      wrapping disagreed with the real transform, the shared A/B would be
 *      measuring a fiction. The parity tests below pin the two together.
 *   2. That the payload `toElementPartials` emits is actually accepted by the
 *      transform and comes out bound — the end-to-end wiring, not just numbers.
 *
 * happy-dom has no canvas 2d context, so a deterministic text measurer is
 * installed (same approach as element-templates-roundtrip.test.ts). It must
 * match the one `measureLabel` uses in shared, or the two arms diverge.
 */

const FONT = 16;

setCustomTextMetricsProvider({
  getLineWidth: (text: string) => measureLabel(text, FONT).width,
});

const convert = (partials: unknown[]): AuditElement[] =>
  convertToExcalidrawElements(partials as never) as unknown as AuditElement[];

function layoutInput(fixture: DiagramFixture): LayoutInput {
  return {
    nodes: fixture.nodes.map((n) => {
      const m = measureLabel(n.label);
      return { id: n.id, labelWidth: m.width, labelHeight: m.height };
    }),
    edges: edgesOf(fixture),
  };
}

/** Run a layout through the REAL transform, then audit what came out. */
function realAudit(fixture: DiagramFixture, layout: LayoutResult): AuditReport {
  const partials = toElementPartials(layout, labelsOf(fixture), edgesOf(fixture), {
    roughness: 1,
    strokeWidth: 2,
    opacity: 100,
    strokeColor: "#1e1e1e",
    backgroundColor: "#fff9db",
    fillStyle: "solid",
    roundness: { type: 3 },
  });
  return auditScene(convert(partials));
}

describe("page closure — the real transform accepts what the solver emits", () => {
  for (const fixture of ALL_FIXTURES) {
    test(`${fixture.name}: every emitted element survives the transform`, () => {
      const layout = layoutScene(layoutInput(fixture));
      const partials = toElementPartials(layout, labelsOf(fixture), edgesOf(fixture));
      const elements = convert(partials);

      // Every node box came out, with a bound label.
      const rects = elements.filter((e) => e.type === "rectangle");
      expect(rects).toHaveLength(fixture.nodes.length);
      for (const r of rects) {
        const labels = (r.boundElements ?? []).filter((b) => b.type === "text");
        expect(labels).toHaveLength(1);
      }

      // Every edge came out BOUND on both ends (the transform resolved
      // start/end through id regeneration).
      const arrows = elements.filter((e) => e.type === "arrow");
      expect(arrows).toHaveLength(fixture.edges.length);
      for (const a of arrows) {
        expect(a.startBinding).toBeTruthy();
        expect(a.endBinding).toBeTruthy();
      }
    });

    test(`${fixture.name}: the real transform's result audits clean`, () => {
      const layout = layoutScene(layoutInput(fixture));
      const report = realAudit(fixture, layout);
      expect(report.overlaps).toEqual([]);
      expect(report.gutterViolations).toEqual([]);
      expect(report.textFit).toEqual([]);
      expect(report.unboundArrows).toEqual([]);
      expect(report.bindingViolations).toEqual([]);
      expect(report.waypointsInsideNodes).toEqual([]);
      expect(report.ok).toBe(true);
    });

    test(`${fixture.name}: the baseline is GEOMETRICALLY clean but UNREADABLE`, () => {
      // Verified against the real transform: a fixed 180x90 tier does not
      // overflow — Excalidraw wraps the label and re-centers it inside the
      // box. So the baseline's defect is not "geometry broken", it is "the
      // label was crammed into two lines". Reporting it honestly is the point:
      // a test that claimed a geometry failure here would be lying.
      const layout = layoutBaseline(layoutInput(fixture));
      const report = realAudit(fixture, layout);
      expect(report.ok).toBe(true);
      expect(report.wrappedLabels).toBeGreaterThan(0);
      expect(report.readabilityOk).toBe(false);
    });
  }
});

describe("page closure — parity between shared's model and the real transform", () => {
  for (const fixture of ALL_FIXTURES) {
    test(`${fixture.name}: measured label sizes agree`, () => {
      const partials = fixture.nodes.map((n) => ({
        type: "text",
        id: n.id,
        x: 0,
        y: 0,
        text: n.label,
        fontFamily: 5,
        fontSize: FONT,
        textAlign: "center",
        verticalAlign: "middle",
      }));
      const real = convert(partials);
      for (let i = 0; i < fixture.nodes.length; i++) {
        const expected = measureLabel(fixture.nodes[i].label, FONT);
        expect(Math.round(real[i].width)).toBe(expected.width);
      }
    });

    test(`${fixture.name}: baseline wrap count matches the synthetic model`, () => {
      // The baseline is the arm whose defect the A/B rests on. If the real
      // transform wrapped differently from shared's simulator, the shared
      // regression test would be asserting on a fiction.
      const layout = layoutBaseline(layoutInput(fixture));
      const partials = toElementPartials(layout, labelsOf(fixture), edgesOf(fixture));
      const real = convert(partials);
      const realWrapped = real.filter(
        (e) => e.type === "text" && typeof e.text === "string" && e.text.includes("\n"),
      ).length;
      expect(realWrapped).toBeGreaterThan(0);
    });
  }
});

describe("page closure — scene.audit is wired into the dispatcher", () => {
  function makeApi(elements: unknown[]): CanvasV1Api {
    return {
      getSceneElements: () => elements,
      getAppState: () => ({}),
      getFiles: () => ({}),
      updateScene: () => {},
      addFiles: () => {},
      setActiveTool: () => {},
      setViewport: () => {},
      resetScene: () => {},
      history: { clear: () => {} },
    } as unknown as CanvasV1Api;
  }

  const helpers = {} as CanvasV1Helpers;

  test("reports a clean scene as ok over the live API", async () => {
    const fixture = ALL_FIXTURES[1];
    const layout = layoutScene(layoutInput(fixture));
    const elements = convert(toElementPartials(layout, labelsOf(fixture), edgesOf(fixture)));

    const resp = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 1, method: "scene.audit", params: {} },
      { api: makeApi(elements), helpers },
    );
    const result = resp.result as AuditReport;
    expect(result.ok).toBe(true);
    expect(result.elementCount).toBeGreaterThan(0);
    expect(result.summary).toContain("ok");
  });

  test("reports the baseline as readable=false through the dispatcher", async () => {
    const fixture = ALL_FIXTURES[1];
    const layout = layoutBaseline(layoutInput(fixture));
    const elements = convert(toElementPartials(layout, labelsOf(fixture), edgesOf(fixture)));

    const resp = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 1, method: "scene.audit", params: {} },
      { api: makeApi(elements), helpers },
    );
    const result = resp.result as AuditReport;
    expect(result.ok).toBe(true);
    expect(result.readabilityOk).toBe(false);
    expect(result.wrappedLabels).toBeGreaterThan(0);
    expect(result.summary).toContain("wrapped");
  });

  test("reports a real overlap as a hard failure", async () => {
    const elements = [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 180, height: 90 },
      { id: "b", type: "rectangle", x: 120, y: 40, width: 180, height: 90 },
    ];
    const resp = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 1, method: "scene.audit", params: { elements } },
      { api: makeApi([]), helpers },
    );
    const result = resp.result as AuditReport;
    expect(result.ok).toBe(false);
    expect(result.overlaps).toHaveLength(1);
    expect(result.summary).toContain("FAILED");
  });

  test("accepts a supplied element array and a custom gutter", async () => {
    const elements = [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", type: "rectangle", x: 110, y: 0, width: 100, height: 100 },
    ];
    const strict = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 1, method: "scene.audit", params: { elements, gutter: 40 } },
      { api: makeApi([]), helpers },
    );
    expect((strict.result as AuditReport).gutterViolations).toHaveLength(1);

    const loose = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 1, method: "scene.audit", params: { elements, gutter: 8 } },
      { api: makeApi([]), helpers },
    );
    expect((loose.result as AuditReport).gutterViolations).toHaveLength(0);
  });

  test("rejects a non-array elements param", async () => {
    const resp = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 1, method: "scene.audit", params: { elements: "nope" } },
      { api: makeApi([]), helpers },
    );
    expect(resp.error?.code).toBe(-32602);
  });
});
