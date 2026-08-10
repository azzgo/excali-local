import { describe, expect, test } from "vitest";
import {
  convertToExcalidrawElements,
  getCommonBounds,
  setCustomTextMetricsProvider,
} from "@excalidraw/excalidraw";

/**
 * Goal-5 round-trip evidence (004 "partial element-template round-trip" fog):
 * the skill's element templates are PARTIAL — they omit fields real
 * Excalidraw emits (lastCommittedPoint, binders, index, updated, …). This
 * test drives the templates through the REAL patched tgz's
 * convertToExcalidrawElements — exactly what the page's elements.add
 * dispatcher calls — and asserts the CANONICAL shape a subsequent scene.get
 * returns, including the binding closures (text-in-shape, arrow bindings).
 *
 * The documented templates in skills/excali-local/references/element-templates.md
 * are the same partials exercised here; this test is their verification.
 *
 * Ground-truth findings encoded below (verified against the patched tgz):
 *   - elements.add REGENERATES ids (convertToExcalidrawElements default
 *     regenerateIds:true) — partial ids are input-hints for binding
 *     remapping, never preserved in the output. scene.update (passthrough)
 *     is the id-preserving path.
 *   - text defaults are fontSize 20 / fontFamily 5 / align left / vertical
 *     top — NOT the skill's recommended 16 / 5 / center / middle, so
 *     templates must be explicit.
 *   - roughness defaults to 1 — the skill's default (Sketch) leans into it;
 *     roughness:0 is explicit only for the Clean preset.
 *   - line width/height are NOT derived from points (defaults 100×0); arrows
 *     ARE (getSizeFromPoints).
 *   - text-in-shape binds via the container's `label` property; a bare
 *     `containerId` on a text element is ignored as input (text floats).
 *   - arrow bindings bind via `start:{id}` / `end:{id}`; startBinding/
 *     endBinding are OUTPUT fields and are ignored as input.
 *   - frames need `children: []` (undefined children crashes the transform).
 */

// happy-dom has no canvas 2d context — install a deterministic text
// measurer so text width/height are computed (as the browser would).
setCustomTextMetricsProvider({
  getLineWidth: (text: string) => Math.max(20, text.length * 8),
});

const convert = (partials: unknown[]) =>
  convertToExcalidrawElements(partials as never) as Array<Record<string, unknown>>;

const asRecord = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

describe("element-template round-trip through the real patched tgz", () => {
  test("text: partial {type,text,x,y} normalizes with EXPLICIT style + survives JSON round-trip", () => {
    const [el] = convert([
      { type: "text", text: "Hello", x: 0, y: 0, fontFamily: 3, fontSize: 16, textAlign: "center", verticalAlign: "middle" },
    ]);
    expect(el.id).toBeTruthy();
    expect(el.type).toBe("text");
    expect(el.text).toBe("Hello");
    expect(el.fontFamily).toBe(3);
    expect(el.fontSize).toBe(16);
    expect(el.textAlign).toBe("center");
    expect(el.verticalAlign).toBe("middle");
    expect(el.originalText).toBe("Hello");
    expect(el.containerId).toBeNull();
    expect(el.seed).toBeTypeOf("number");
    expect(el.version).toBeTypeOf("number");
    expect(el.isDeleted).toBe(false);
    expect(el.index).toBeTruthy(); // fractional index assigned on normalize
    expect(el.boundElements).toBeNull();
    expect(el.groupIds).toEqual([]);
    expect(el.frameId).toBeNull();
    expect(el.width).toBeGreaterThan(0);
    expect(el.height).toBeGreaterThan(0);

    // JSON round-trip: serializing (as scene.get would) and re-normalizing
    // REGENERATES ids (convertToExcalidrawElements is id-regenerating by
    // design) — style + geometry are what survive, not ids.
    const serialized = JSON.parse(JSON.stringify(el)) as Record<string, unknown>;
    const [el2] = convert([serialized]);
    expect(el2.text).toBe("Hello");
    expect(el2.fontFamily).toBe(3);
    expect(el2.width).toBe(el.width);
    expect(el2.height).toBe(el.height);
  });

  test("line: width/height MUST be explicit (not derived from points)", () => {
    const [noWH] = convert([{ type: "line", x: 10, y: 20, points: [[0, 0], [50, 0], [50, 40]] }]);
    // Defaults are 100×0 — a partial line WITHOUT width/height is broken.
    expect(noWH.width).toBe(100);
    expect(noWH.height).toBe(0);

    const [el] = convert([
      { type: "line", x: 10, y: 20, width: 50, height: 40, points: [[0, 0], [50, 0], [50, 40]], strokeWidth: 2, roughness: 0 },
    ]);
    expect(el.type).toBe("line");
    expect(el.points).toEqual([[0, 0], [50, 0], [50, 40]]);
    expect(el.width).toBe(50);
    expect(el.height).toBe(40);
    expect(el.polygon).toBe(false);
    expect(el.startBinding).toBeNull();
    expect(el.endBinding).toBeNull();
    expect(el.roughness).toBe(0);
  });

  test("dot (small ellipse): defaults applied; roughness:0 explicit", () => {
    const [el] = convert([
      { type: "ellipse", x: 0, y: 0, width: 8, height: 8, strokeColor: "#020817", backgroundColor: "#020817", roughness: 0 },
    ]);
    expect(el.type).toBe("ellipse");
    expect(el.width).toBe(8);
    expect(el.height).toBe(8);
    expect(el.fillStyle).toBe("solid");
    expect(el.strokeWidth).toBe(2);
    expect(el.roughness).toBe(0);
    expect(el.opacity).toBe(100);
    expect(el.roundness).toBeNull();
  });

  test("rectangle: partial geometry normalizes; roughness defaults to 1 unless explicit", () => {
    const [implicit] = convert([{ type: "rectangle", x: 100, y: 100, width: 180, height: 90 }]);
    expect(implicit.roughness).toBe(1); // the REAL default — Sketch leans into it (0 only for Clean)

    const [el] = convert([
      { type: "rectangle", x: 100, y: 100, width: 180, height: 90, strokeColor: "#020817", backgroundColor: "#f1f5f9", strokeWidth: 2, roughness: 0, opacity: 100 },
    ]);
    expect(el.type).toBe("rectangle");
    expect(el.x).toBe(100);
    expect(el.y).toBe(100);
    expect(el.width).toBe(180);
    expect(el.height).toBe(90);
    expect(el.strokeColor).toBe("#020817");
    expect(el.backgroundColor).toBe("#f1f5f9");
    expect(el.fillStyle).toBe("solid");
    expect(el.strokeWidth).toBe(2);
    expect(el.roughness).toBe(0);
    expect(el.opacity).toBe(100);
    expect(el.roundness).toBeNull();
    expect(el.boundElements).toBeNull();
    expect(el.angle).toBe(0);
  });

  test("text-in-shape: binds via the container's `label` (containerId alone is ignored)", () => {
    // containerId-only: the text floats, no binding is created.
    const [rectA, textA] = convert([
      { type: "rectangle", id: "container-a", x: 0, y: 0, width: 200, height: 100 },
      { type: "text", containerId: "container-a", text: "Title", x: 0, y: 0, width: 200, height: 100 },
    ]);
    expect(rectA.boundElements).toBeNull();
    expect(textA.containerId).toBe("container-a"); // echoed but NOT bound

    // label form: the container gets a boundElements text entry, the text is
    // created, auto-positioned, and containerId is closed on the text.
    const [rect, text] = convert([
      {
        type: "rectangle", id: "c1", x: 0, y: 0, width: 200, height: 100,
        strokeColor: "#020817", backgroundColor: "#e8c468", roughness: 0, strokeWidth: 2, opacity: 100,
        label: { text: "Title", fontFamily: 3, fontSize: 16, textAlign: "center", verticalAlign: "middle" },
      },
    ]);

    const bound = (rect.boundElements ?? []) as Array<{ id: string; type: string }>;
    expect(bound.some((b) => b.id === text.id && b.type === "text")).toBe(true);
    expect(text.containerId).toBe(rect.id);
    expect(text.text).toBe("Title");
    expect(text.fontFamily).toBe(3);
    expect(text.fontSize).toBe(16);
    expect(text.textAlign).toBe("center");
    expect(text.verticalAlign).toBe("middle");
    expect(text.x).toBeGreaterThan(0); // auto-centered inside the container
    expect(text.y).toBeGreaterThan(0);

    // Round-trip caveat (documented in the skill): on re-add via elements.add,
    // the container id regenerates but the text's containerId is ECHOED, not
    // remapped — the binding breaks. The id/binding-preserving path for
    // re-emitting serialized scene content is scene.update (passthrough), not
    // elements.add. (Label-form input is the only binding-close on add.)
    const [rect2, text2] = convert([JSON.parse(JSON.stringify(rect)), JSON.parse(JSON.stringify(text))]);
    expect(text2.containerId).toBe(rect.id); // echoed old id, NOT remapped
    expect(text2.id).not.toBe(rect2.id);
    expect(text2.text).toBe("Title");
  });

  test("arrow with bindings: input `start`/`end` closes startBinding/endBinding + boundElements", () => {
    // startBinding/endBinding as input are IGNORED (output-only fields).
    const [, , arrowOut] = convert([
      { type: "rectangle", id: "from", x: 0, y: 0, width: 100, height: 50 },
      { type: "rectangle", id: "to", x: 300, y: 0, width: 100, height: 50 },
      {
        type: "arrow", x: 100, y: 25, width: 200, height: 0, points: [[0, 0], [200, 0]],
        startBinding: { elementId: "from", focus: 1, gap: 2 },
        endBinding: { elementId: "to", focus: 0, gap: 2 },
      },
    ]);
    expect(arrowOut.startBinding).toBeNull();
    expect(arrowOut.endBinding).toBeNull();

    // The working form: start:{id} / end:{id}.
    const [from, to, arrow] = convert([
      { type: "rectangle", id: "from", x: 0, y: 0, width: 100, height: 50, strokeColor: "#020817", backgroundColor: "#f1f5f9", roughness: 0, strokeWidth: 2 },
      { type: "rectangle", id: "to", x: 300, y: 0, width: 100, height: 50, strokeColor: "#020817", backgroundColor: "#f1f5f9", roughness: 0, strokeWidth: 2 },
      { type: "arrow", x: 100, y: 25, width: 200, height: 0, points: [[0, 0], [200, 0]], strokeColor: "#020817", strokeWidth: 2, roughness: 0, start: { id: "from" }, end: { id: "to" } },
    ]);

    expect(arrow.type).toBe("arrow");
    expect(asRecord(arrow.startBinding).elementId).toBe(from.id);
    expect(asRecord(arrow.endBinding).elementId).toBe(to.id);
    expect(arrow.endArrowhead).toBe("arrow"); // default arrowhead filled
    expect(arrow.startArrowhead).toBeNull();
    expect(arrow.elbowed).toBe(false);

    // Both containers' boundElements reference the arrow (binding closed).
    expect((from.boundElements as Array<{ id: string; type: string }>).some((b) => b.id === arrow.id && b.type === "arrow")).toBe(true);
    expect((to.boundElements as Array<{ id: string; type: string }>).some((b) => b.id === arrow.id && b.type === "arrow")).toBe(true);

    // Round-trip caveat (documented in the skill): startBinding/endBinding are
    // OUTPUT fields — re-adding the serialized output through elements.add
    // DROPS them (the input contract is start/end). The id/version/binding-
    // preserving path is scene.update (passthrough), not elements.add.
    const [, , arrow2] = convert([JSON.parse(JSON.stringify(from)), JSON.parse(JSON.stringify(to)), JSON.parse(JSON.stringify(arrow))]);
    expect(arrow2.startBinding).toBeNull();
    expect(arrow2.endBinding).toBeNull();
  });

  test("frame: children must be an array (undefined crashes); frameId assigned to children", () => {
    const out = convert([
      { type: "rectangle", id: "in-frame", x: 20, y: 20, width: 100, height: 50, roughness: 0 },
      { type: "frame", id: "f1", children: ["in-frame"] },
    ]);
    const frame = out.find((e) => e.type === "frame"); // frames sort AFTER children
    const child = out.find((e) => e.type === "rectangle");
    expect(frame).toBeDefined();
    expect(frame!.type).toBe("frame");
    expect(child!.frameId).toBe(frame!.id); // transform assigns frameId from children
    expect(frame!.name).toBeNull();
  });

  test("scene.bounds works over the normalized template set (getCommonBounds)", () => {
    const els = convert([
      { type: "rectangle", x: 100, y: 100, width: 180, height: 90, roughness: 0 },
      { type: "ellipse", x: 0, y: 0, width: 8, height: 8, roughness: 0 },
    ]);
    const [x1, y1, x2, y2] = getCommonBounds(els as never);
    expect([x1, y1, x2, y2]).toEqual([0, 0, 280, 190]);
  });
});

describe("liveliness toolbox templates (verified live on the canvas)", () => {
  test("freedraw: points preserved; groupIds/pressures OMITTED by the transform (page normalizes)", () => {
    const [fd] = convert([
      { type: "freedraw", x: 60, y: 78, width: 270, height: 8, points: [[0, 4], [30, 0], [60, 7]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 1, opacity: 100 },
    ]);
    expect(fd.type).toBe("freedraw");
    expect(fd.points).toEqual([[0, 4], [30, 0], [60, 7]]);
    expect(fd.roughness).toBe(1);
    // Patched-tgz quirk (44bbf16): convertToExcalidrawElements omits groupIds
    // and pressures on freedraw; the page's ensureRenderSafeDefaults fills
    // them or the render loop crashes on e.groupIds.length. Pinning the
    // omission here so a tgz upgrade that changes it forces a re-check of
    // that normalize + the skill docs.
    expect(fd.groupIds).toBeUndefined();
    expect(fd.pressures).toBeUndefined();
    expect(fd.simulatePressure).toBeUndefined();
  });

  test("curved arrow: roundness {type:2} survives; same-batch start/end still bind", () => {
    const [from, to, arrow] = convert([
      { type: "rectangle", id: "from", x: 0, y: 0, width: 100, height: 50, roughness: 0 },
      { type: "rectangle", id: "to", x: 300, y: 0, width: 100, height: 50, roughness: 0 },
      { type: "arrow", x: 100, y: 25, width: 200, height: 40, points: [[0, 0], [100, 40], [200, 0]], roughness: 0, roundness: { type: 2 }, start: { id: "from" }, end: { id: "to" } },
    ]);
    expect(arrow.roundness).toEqual({ type: 2 }); // curved rendering preserved
    expect(asRecord(arrow.startBinding).elementId).toBe(from.id);
    expect(asRecord(arrow.endBinding).elementId).toBe(to.id);
    expect(arrow.endArrowhead).toBe("arrow");
  });

  test("liveliness strokes + arrowheads survive: strokeStyle/startArrowhead/endArrowhead", () => {
    const [, , arrow] = convert([
      { type: "rectangle", id: "from", x: 0, y: 0, width: 100, height: 50, roughness: 0 },
      { type: "rectangle", id: "to", x: 300, y: 0, width: 100, height: 50, roughness: 0 },
      { type: "arrow", x: 100, y: 25, width: 200, height: 0, points: [[0, 0], [200, 0]], roughness: 0, strokeStyle: "dashed", startArrowhead: "dot", endArrowhead: "triangle", start: { id: "from" }, end: { id: "to" } },
    ]);
    expect(arrow.strokeStyle).toBe("dashed");
    expect(arrow.startArrowhead).toBe("dot");
    expect(arrow.endArrowhead).toBe("triangle");
  });
});
