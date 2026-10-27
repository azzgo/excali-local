/**
 * scene-audit — the deterministic geometry audit for agent-drawn scenes.
 *
 * WHY THIS LIVES IN shared/: the audit is pure arithmetic over element
 * geometry. It has no dependency on Excalidraw, the DOM, or the daemon — so
 * the algorithm lives here once, and BOTH sides run it against their own
 * inputs:
 *
 *   - packages/page  — feeds it REAL elements from `convertToExcalidrawElements`
 *                      (renderer-measured text sizes, real binding closures).
 *                      That is the authoritative implementation.
 *   - packages/bridge — feeds it whatever `scene.get` returned over the wire.
 *                      Geometry-only (no fold points), but it lets the CLI
 *                      answer "is this scene sound?" without a page round-trip.
 *
 * The metric set is not invented: every field corresponds to a defect the
 * skill's methodology claims an agent should catch by hand ("pairwise AABB",
 * "gutter >= 40px", "bidirectional binding closure"). Making it executable is
 * the point — an agent doing pairwise comparison over 40 elements in its head
 * is not verification.
 *
 * Deliberate omissions, and why:
 *   - No arrow ROUTING check (where the fold points land). Excalidraw computes
 *     those in the renderer; `updateElbowArrowPoints` is not exported from the
 *     package root, so neither side can reproduce them headlessly. Checking a
 *     stale `points` array would be checking the agent's guess, not the result.
 *   - No aesthetics. Whether the picture "argues" is a human call.
 */

/** The minimal element surface the audit reads. Structurally compatible with
 *  Excalidraw's ExcalidrawElement, but declared here so shared stays
 *  dependency-free. */
export interface AuditElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Present on text elements bound to a container. */
  containerId?: string | null;
  /** Present on text elements; `\n` marks a wrapped line. */
  text?: string;
  /** Present on containers/labels — the reverse half of a binding. */
  boundElements?: ReadonlyArray<{ id: string; type: string }> | null;
  /** Present on linear elements. */
  points?: ReadonlyArray<readonly [number, number]> | null;
  /** Present on bound arrows. `fixedPoint` is a NORMALIZED ratio. */
  startBinding?: { elementId: string; mode?: string } | null;
  endBinding?: { elementId: string; mode?: string } | null;
  /** Frame membership — a child is positioned absolutely, not frame-relative. */
  frameId?: string | null;
  isDeleted?: boolean;
}

export interface AuditConfig {
  /** Minimum clear gap between two sibling elements (px). ELK's
   *  `elk.spacing.nodeNode` is 55; 40 is the skill's stated gutter. */
  gutter: number;
  /** Minimum inner padding a bound label must keep from its container edge. */
  padding: number;
  /** Tolerance for "touching counts as overlapping". */
  epsilon: number;
  /** Maximum number of lines a bound label may occupy before it counts as a
   *  readability regression. Excalidraw wraps and re-centers text, so a
   *  wrapped label is NOT a geometry defect — the box still contains it. It is
   *  a quality defect: "crammed into a fixed card" (the stress report's word). */
  maxLabelLines: number;
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  gutter: 40,
  padding: 8,
  epsilon: 1,
  maxLabelLines: 1,
};

export interface Box {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
}

export interface OverlapPair {
  a: string;
  b: string;
  /** Overlap area in px². */
  area: number;
}

export interface GutterViolation {
  a: string;
  b: string;
  /** The clear gap between the two boxes (negative when overlapping on one axis). */
  gap: number;
}

export interface TextFitViolation {
  text: string;
  container: string;
  kind: "too-wide" | "too-tall" | "container-missing";
  /** How far the label exceeds the container's inner box (px). */
  overflow: number;
}

export interface BindingViolation {
  arrow: string;
  field: "startBinding" | "endBinding";
  kind: "dangling-target" | "missing-reverse";
  /** The element id that is missing, or the target that lacks the reverse link. */
  detail: string;
}

export interface WaypointViolation {
  edge: string;
  node: string;
  point: [number, number];
}

export interface AuditReport {
  /** Hard geometry defects only (overlap, gutter, text overflow, binding,
   *  waypoint). Readability is reported separately — see `readabilityOk`. */
  ok: boolean;
  /** No label exceeded `maxLabelLines`. A wrapped label is not a geometry
   *  error (Excalidraw contains it), but it is the "crammed" look the layout
   *  change exists to remove. */
  readabilityOk: boolean;
  /** Element count that participated in the audit. */
  elementCount: number;
  overlaps: OverlapPair[];
  gutterViolations: GutterViolation[];
  textFit: TextFitViolation[];
  unboundArrows: string[];
  bindingViolations: BindingViolation[];
  waypointsInsideNodes: WaypointViolation[];
  /** A label that had to wrap — the "crammed into a fixed card" defect. */
  wrappedLabels: number;
  /** Container area not covered by its label, as a ratio of total box area. */
  deadSpaceRatio: number;
  /** Bounding box of all non-arrow, non-text solids. */
  bounds: { width: number; height: number; aspect: number };
  /** One-line human summary, for a CLI's stdout. */
  summary: string;
}

const isArrow = (e: AuditElement) => e.type === "arrow";
const isText = (e: AuditElement) => e.type === "text";
const isLive = (e: AuditElement) => e.isDeleted !== true;

export function boxOf(e: AuditElement): Box {
  const x1 = Math.min(e.x, e.x + e.width);
  const x2 = Math.max(e.x, e.x + e.width);
  const y1 = Math.min(e.y, e.y + e.height);
  const y2 = Math.max(e.y, e.y + e.height);
  return { id: e.id, x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

/** Clear gap between two boxes. Positive = separated, 0 = touching,
 *  negative = overlapping on that axis. The pair's gap is the larger of the
 *  two axis gaps (so diagonally-separated boxes report a real distance). */
function gapBetween(a: Box, b: Box): number {
  return Math.max(a.x1 - b.x2, b.x1 - a.x2, a.y1 - b.y2, b.y1 - a.y2);
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

function pointStrictlyInside(px: number, py: number, b: Box, eps: number): boolean {
  return px > b.x1 + eps && px < b.x2 - eps && py > b.y1 + eps && py < b.y2 - eps;
}

/** Elements that occupy space for overlap purposes: shapes and containers.
 *  Arrows legitimately cross everything; bound labels live inside a container
 *  (the container is the thing that must not collide). */
function solidElements(elements: readonly AuditElement[]): AuditElement[] {
  // Frames are excluded: a frame is a REGION that contains its children by
  // definition, so it necessarily "overlaps" them. Counting it as a solid
  // would flag every zoned diagram as broken. Zone membership is the frame's
  // contract, not a collision.
  return elements.filter((e) => isLive(e) && !isArrow(e) && !isText(e) && e.type !== "frame");
}

export function auditScene(
  elements: readonly AuditElement[],
  config: Partial<AuditConfig> = {},
): AuditReport {
  const cfg: AuditConfig = { ...DEFAULT_AUDIT_CONFIG, ...config };
  const live = elements.filter(isLive);
  const byId = new Map(live.map((e) => [e.id, e]));
  const solids = solidElements(live);
  const texts = live.filter(isText);
  const arrows = live.filter(isArrow);

  const overlaps: OverlapPair[] = [];
  const gutterViolations: GutterViolation[] = [];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = boxOf(solids[i]);
      const b = boxOf(solids[j]);
      const area = overlapArea(a, b);
      if (area > 0) {
        overlaps.push({ a: a.id, b: b.id, area: Math.round(area) });
        continue;
      }
      const gap = gapBetween(a, b);
      if (gap < cfg.gutter) {
        gutterViolations.push({ a: a.id, b: b.id, gap: Math.round(gap) });
      }
    }
  }

  const textFit: TextFitViolation[] = [];
  let wrappedLabels = 0;
  let deadSpace = 0;
  let boxArea = 0;
  for (const t of texts) {
    if (!t.containerId) continue;
    if (typeof t.text === "string" && t.text.includes("\n")) wrappedLabels++;
    const c = byId.get(t.containerId);
    if (!c) {
      textFit.push({ text: t.id, container: t.containerId, kind: "container-missing", overflow: 0 });
      continue;
    }
    const tb = boxOf(t);
    const cb = boxOf(c);
    const innerW = cb.width - cfg.padding * 2;
    const innerH = cb.height - cfg.padding * 2;
    const overflowW = tb.width - innerW;
    const overflowH = tb.height - innerH;
    if (overflowW > cfg.epsilon) {
      textFit.push({ text: t.id, container: c.id, kind: "too-wide", overflow: Math.round(overflowW) });
    }
    if (overflowH > cfg.epsilon) {
      textFit.push({ text: t.id, container: c.id, kind: "too-tall", overflow: Math.round(overflowH) });
    }
    deadSpace += Math.max(0, cb.width * cb.height - tb.width * tb.height);
    boxArea += cb.width * cb.height;
  }

  const unboundArrows: string[] = [];
  const bindingViolations: BindingViolation[] = [];
  const waypointsInsideNodes: WaypointViolation[] = [];
  for (const a of arrows) {
    const fields = [
      ["startBinding", a.startBinding],
      ["endBinding", a.endBinding],
    ] as const;
    const unbound = fields.some(([, b]) => !b);
    if (unbound) unboundArrows.push(a.id);

    for (const [field, binding] of fields) {
      if (!binding) continue;
      const target = byId.get(binding.elementId);
      if (!target) {
        bindingViolations.push({
          arrow: a.id,
          field,
          kind: "dangling-target",
          detail: binding.elementId,
        });
        continue;
      }
      const hasReverse = (target.boundElements ?? []).some((be) => be?.id === a.id);
      if (!hasReverse) {
        bindingViolations.push({ arrow: a.id, field, kind: "missing-reverse", detail: target.id });
      }
    }

    // Bend points must not land inside a node the arrow is not attached to.
    // The arrow's own bound endpoints are excluded by construction: its first
    // and last point sit ON (or inside) those boxes by definition, so flagging
    // them would fire on every correctly-bound arrow.
    const attached = new Set(
      [a.startBinding?.elementId, a.endBinding?.elementId].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    const points = a.points ?? [];
    for (let pi = 0; pi < points.length; pi++) {
      const p = points[pi];
      const px = a.x + p[0];
      const py = a.y + p[1];
      for (const s of solids) {
        if (attached.has(s.id)) continue;
        const sb = boxOf(s);
        if (pointStrictlyInside(px, py, sb, cfg.epsilon)) {
          waypointsInsideNodes.push({
            edge: a.id,
            node: s.id,
            point: [Math.round(px), Math.round(py)],
          });
          break;
        }
      }
    }
  }

  const boxes = solids.map(boxOf);
  let width = 0;
  let height = 0;
  if (boxes.length > 0) {
    const x1 = Math.min(...boxes.map((b) => b.x1));
    const x2 = Math.max(...boxes.map((b) => b.x2));
    const y1 = Math.min(...boxes.map((b) => b.y1));
    const y2 = Math.max(...boxes.map((b) => b.y2));
    width = x2 - x1;
    height = y2 - y1;
  }

  const readabilityOk = wrappedLabels === 0;
  const ok =
    overlaps.length === 0 &&
    gutterViolations.length === 0 &&
    textFit.length === 0 &&
    unboundArrows.length === 0 &&
    bindingViolations.length === 0 &&
    waypointsInsideNodes.length === 0;

  const report: AuditReport = {
    ok,
    readabilityOk,
    elementCount: live.length,
    overlaps,
    gutterViolations,
    textFit,
    unboundArrows,
    bindingViolations,
    waypointsInsideNodes,
    wrappedLabels,
    deadSpaceRatio: boxArea > 0 ? Math.round((deadSpace / boxArea) * 100) / 100 : 0,
    bounds: {
      width: Math.round(width),
      height: Math.round(height),
      aspect: height > 0 ? Math.round((width / height) * 100) / 100 : 0,
    },
    summary: "",
  };
  report.summary = summarize(report);
  return report;
}

function summarize(r: AuditReport): string {
  if (r.ok) {
    const quality = r.readabilityOk ? "readable" : `${r.wrappedLabels} wrapped label(s)`;
    return `ok — ${r.elementCount} elements, ${quality}, dead space ${r.deadSpaceRatio}, ${r.bounds.width}x${r.bounds.height}`;
  }
  const parts: string[] = [];
  if (r.overlaps.length) parts.push(`${r.overlaps.length} overlap`);
  if (r.gutterViolations.length) parts.push(`${r.gutterViolations.length} gutter`);
  if (r.textFit.length) parts.push(`${r.textFit.length} text-fit`);
  if (r.unboundArrows.length) parts.push(`${r.unboundArrows.length} unbound arrow`);
  if (r.bindingViolations.length) parts.push(`${r.bindingViolations.length} binding`);
  if (r.waypointsInsideNodes.length) parts.push(`${r.waypointsInsideNodes.length} waypoint-in-node`);
  return `FAILED — ${parts.join(", ")}`;
}
