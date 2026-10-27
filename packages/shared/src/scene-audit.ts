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
  /**
   * Treat a multi-point arrow as intentionally unbound. Excalidraw re-routes a
   * BOUND arrow in the renderer, discarding the points it was given — so a
   * polyline that must stay exactly where the router put it is emitted without
   * bindings. Those are not defects; a two-point arrow left unbound still is.
   */
  allowUnboundPolylines: boolean;
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
  allowUnboundPolylines: true,
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

export interface SegmentCrossing {
  edge: string;
  node: string;
  /** The segment's endpoints in scene coordinates. */
  from: [number, number];
  to: [number, number];
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
  /**
   * Places where an arrow's SEGMENT passes through a node it is not attached
   * to. Distinct from `waypointsInsideNodes`: a bend point can sit outside
   * every box while the straight run BETWEEN two bends slices through one.
   * That is the "line goes through a box" defect, and checking only the bend
   * points misses it — which is exactly what happened on the first zoned
   * render: every metric green, arrows visibly crossing boxes.
   */
  segmentCrossings: SegmentCrossing[];
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

/** Does segment (p1->p2) cross the INTERIOR of box b? Both endpoints strictly
 *  inside count as a crossing too. */
function segmentCrossesBox(
  p1: [number, number],
  p2: [number, number],
  b: Box,
  eps: number,
): boolean {
  // Either endpoint inside the interior is a crossing.
  if (pointStrictlyInside(p1[0], p1[1], b, eps) || pointStrictlyInside(p2[0], p2[1], b, eps)) {
    return true;
  }
  // Otherwise: Cohen–Sutherland style — a segment crosses the interior iff its
  // two endpoints are on strictly opposite sides of at least one box edge AND
  // the intersection point lies within the edge's span. Simplest correct form:
  // check the segment against each of the four box edges.
  const edges: Array<[[number, number], [number, number]]> = [
    [[b.x1, b.y1], [b.x2, b.y1]],
    [[b.x2, b.y1], [b.x2, b.y2]],
    [[b.x2, b.y2], [b.x1, b.y2]],
    [[b.x1, b.y2], [b.x1, b.y1]],
  ];
  return edges.some(([c, d]) => segmentsCross(p1, p2, c, d, eps));
}

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsCross(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
  eps: number,
): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // Collinear overlap counts only if it spans more than epsilon.
  return (
    Math.abs(d1) <= eps &&
    Math.abs(d2) <= eps &&
    Math.abs(d3) <= eps &&
    Math.abs(d4) <= eps &&
    (between(p1, p3, p4, eps) || between(p2, p3, p4, eps))
  );
}

function between(p: [number, number], a: [number, number], b: [number, number], eps: number): boolean {
  return (
    Math.abs(cross(a, b, p)) <= eps &&
    Math.min(a[0], b[0]) - eps <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    Math.min(a[1], b[1]) - eps <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
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
  const segmentCrossings: SegmentCrossing[] = [];
  for (const a of arrows) {
    const fields = [
      ["startBinding", a.startBinding],
      ["endBinding", a.endBinding],
    ] as const;
    const isPolyline = (a.points?.length ?? 0) > 2;
    const unbound = fields.some(([, b]) => !b);
    if (unbound && !(cfg.allowUnboundPolylines && isPolyline)) unboundArrows.push(a.id);

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
    // EVERY point is exempt from the arrow's own attached boxes — not just the
    // first and last: the transform adjusts multi-point paths on bind and can
    // pull an intermediate waypoint inside the target's edge, which is its
    // normal docking behaviour, not a defect.
    const attached = new Set(
      [a.startBinding?.elementId, a.endBinding?.elementId].filter(
        (id): id is string => typeof id === "string",
      ),
    );
    // An UNBOUND polyline has no bindings to name its endpoints, so recover
    // them geometrically: any solid that the arrow's first or last point sits
    // on/inside is an endpoint of this arrow, and its own border is not a
    // crossing. Without this every deliberately-unbound loop-back reports its
    // own target as "line through box".
    const firstPoint = a.points && a.points.length > 0
      ? ([a.x + a.points[0][0], a.y + a.points[0][1]] as [number, number])
      : null;
    const lastPoint = a.points && a.points.length > 0
      ? ([a.x + a.points[a.points.length - 1][0], a.y + a.points[a.points.length - 1][1]] as [number, number])
      : null;
    for (const s of solids) {
      const sb = boxOf(s);
      const touches = (pt: [number, number] | null) =>
        !!pt &&
        pt[0] >= sb.x1 - 2 && pt[0] <= sb.x2 + 2 && pt[1] >= sb.y1 - 2 && pt[1] <= sb.y2 + 2;
      if (touches(firstPoint) || touches(lastPoint)) attached.add(s.id);
    }
    const points = a.points ?? [];
    const absolute: Array<[number, number]> = points.map((p) => [a.x + p[0], a.y + p[1]]);
    for (let pi = 0; pi < absolute.length; pi++) {
      const [px, py] = absolute[pi];
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

    // The straight run BETWEEN waypoints can slice through a node even when
    // every waypoint sits outside one — the defect the bend-point check above
    // cannot see.
    for (let si = 0; si + 1 < absolute.length; si++) {
      const seg: [[number, number], [number, number]] = [absolute[si], absolute[si + 1]];
      for (const s of solids) {
        if (attached.has(s.id)) continue;
        const sb = boxOf(s);
        if (segmentCrossesBox(seg[0], seg[1], sb, cfg.epsilon)) {
          segmentCrossings.push({
            edge: a.id,
            node: s.id,
            from: seg[0].map(Math.round) as [number, number],
            to: seg[1].map(Math.round) as [number, number],
          });
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
    segmentCrossings.length === 0 &&
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
    segmentCrossings,
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
  if (r.segmentCrossings.length) parts.push(`${r.segmentCrossings.length} line-through-box`);
  return `FAILED — ${parts.join(", ")}`;
}
