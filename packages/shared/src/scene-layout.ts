/**
 * scene-layout — the "measure, then place" solver.
 *
 * WHY THIS EXISTS: the skill's old layout advice was "place elements on a grid
 * of your choosing (x = 100, 400, 700…), gutter >= 40, use the scale tiers
 * Primary 180x90". That advice is measurably wrong the moment a label is wider
 * than the fixed step or taller than the fixed tier:
 *
 *   - a fixed 180x90 box cannot hold "OCR 识别并结构化全部字段" — Excalidraw
 *     wraps it to 2 lines and the label no longer fits the box;
 *   - a fixed 300px grid step with a measured 304px box produces a real
 *     overlap (proved by the A/B fixture set).
 *
 * The fix is two-phase, and both phases are pure arithmetic:
 *   1. MEASURE  — get the real rendered size of every label (the page does this
 *                 with Excalidraw's own metrics; a CLI caller can pass sizes).
 *   2. PLACE    — lay out by measured size using the spacing numbers ELK's
 *                 layered algorithm is tuned with (56 node-node, 80 layer-layer).
 *
 * This is NOT a graph-drawing engine: it is a layered (Sugiyama-lite) pass —
 * topological layers, per-layer horizontal packing, centered rows. It
 * deliberately does not route edges; Excalidraw's own binding owns that.
 */

import type { AuditElement } from "./scene-audit";

/** Spacing constants, adopted from the ELK layered preset that the reference
 *  implementation tuned against complex diagrams. */
export const LAYOUT_SPACING = {
  /** Sibling gap inside a layer (ELK `elk.spacing.nodeNode` = 55). */
  node: 56,
  /** Gap between layers (ELK `nodeNodeBetweenLayers` = 80). */
  layer: 80,
  /** Canvas padding (ELK `elk.padding` = 48). */
  padding: 48,
  /** Horizontal padding added to a measured label to form its box. */
  boxPadX: 28,
  /** Vertical padding added to a measured label to form its box. */
  boxPadY: 22,
  /** Minimum box width — keeps small labels from becoming slivers. */
  minWidth: 160,
  /** Minimum box height. */
  minHeight: 64,
} as const;

export interface LayoutNode {
  id: string;
  /** The measured size of the label that will sit inside this box. */
  labelWidth: number;
  labelHeight: number;
  /** Optional explicit size override (skips the min-size clamp). */
  width?: number;
  height?: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutInput {
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
  /**
   * Optional zones. A pure chain lays out as one very tall column — 12 steps
   * become a 160x1648 strip, which is unreadable on a canvas. Zones are the
   * single-canvas answer to the multi-page one: each zone is a titled `frame`
   * holding its own layered sub-graph, and the zones are arranged in a grid.
   *
   * A node with no zone lands in an implicit default zone.
   */
  zones?: readonly LayoutZone[];
}

export interface LayoutZone {
  id: string;
  /** Frame title, rendered as the frame's `name`. */
  title: string;
  /** Node ids belonging to this zone, in reading order. */
  nodes: readonly string[];
}

export interface PlacedZone {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Node ids that landed in this zone. */
  nodes: string[];
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Which topological layer the node landed in. */
  layer: number;
}

export interface LayoutResult {
  nodes: PlacedNode[];
  /** Bounding size of the placed graph, excluding padding. */
  bounds: { width: number; height: number };
  /** Nodes that could not be layered — empty once cycles are broken. */
  cycleNodes: string[];
  /** Edges that close a cycle. They are still drawn, but routed as loop-backs
   *  around the outside rather than used for layering. */
  backEdges: Array<[string, string]>;
  /** Titled frames, present only when the input declared zones. */
  zones?: PlacedZone[];
}

export function boxForNode(node: LayoutNode): { width: number; height: number } {
  const s = LAYOUT_SPACING;
  const width = node.width ?? Math.max(s.minWidth, node.labelWidth + s.boxPadX);
  const height = node.height ?? Math.max(s.minHeight, node.labelHeight + s.boxPadY);
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Topological layering. A node's layer is 1 + the max layer of its
 * predecessors; nodes on a cycle keep layer 0 and are reported back so the
 * caller can decide (a cycle is legitimate in a flowchart — "retry" loops —
 * it just cannot be layered, so those nodes go in a trailing row).
 */
export function assignLayers(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
): { layers: string[][]; cycleNodes: string[]; backEdges: Array<[string, string]> } {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  const allEdges: Array<[string, string]> = [];
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    succs.get(e.from)!.push(e.to);
    allEdges.push([e.from, e.to]);
  }

  // A flowchart legitimately contains cycles ("retry", "reconcile again"), and
  // a plain Kahn topological sort collapses every node reachable from a cycle
  // into one trailing row — which is how a 12-node pipeline ends up as a single
  // 2782px-wide strip with no arrows. Break the cycles FIRST (depth-first: an
  // edge back to a node still on the stack is a back edge), then layer the
  // resulting DAG. The back edges are still emitted as arrows, just not used
  // for layering.
  const backEdges: Array<[string, string]> = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on stack, 2 done
  const acyclic = new Map<string, string[]>(ids.map((id) => [id, []]));

  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of succs.get(id)!) {
      const s = state.get(next) ?? 0;
      if (s === 1) {
        backEdges.push([id, next]);
        continue;
      }
      acyclic.get(id)!.push(next);
      if (s === 0) visit(next);
    }
    state.set(id, 2);
  };
  for (const id of ids) if ((state.get(id) ?? 0) === 0) visit(id);

  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [, outs] of acyclic) {
    for (const next of outs) indeg.set(next, (indeg.get(next) ?? 0) + 1);
  }

  const layerOf = new Map<string, number>();
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (const id of queue) layerOf.set(id, 0);

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const base = layerOf.get(id) ?? 0;
    for (const next of acyclic.get(id)!) {
      layerOf.set(next, Math.max(layerOf.get(next) ?? 0, base + 1));
      const remaining = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  // After breaking cycles every node should have a layer; anything left over
  // (only possible with a self-referential subgraph) goes in a trailing row.
  const orphanNodes = ids.filter((id) => !layerOf.has(id));
  const maxLayer = Math.max(0, ...[...layerOf.values()]);
  for (const id of orphanNodes) layerOf.set(id, maxLayer + 1);

  const layers: string[][] = [];
  for (const id of ids) {
    const l = layerOf.get(id)!;
    while (layers.length <= l) layers.push([]);
    layers[l].push(id);
  }
  return {
    layers: layers.filter((l) => l.length > 0),
    cycleNodes: orphanNodes,
    backEdges,
  };
}

/**
 * Lay out by measured size. Layers stack top-down (the skill's default flow
 * direction), each row is centered on the widest row.
 */
export function layoutScene(input: LayoutInput): LayoutResult {
  const s = LAYOUT_SPACING;
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const { layers, cycleNodes, backEdges } = assignLayers(input.nodes, input.edges);

  const rows = layers.map((ids) =>
    ids.map((id) => {
      const node = byId.get(id)!;
      const size = boxForNode(node);
      return { id, ...size };
    }),
  );

  const rowWidth = (row: { width: number }[]) =>
    row.reduce((sum, b) => sum + b.width, 0) + s.node * Math.max(0, row.length - 1);

  const widest = Math.max(0, ...rows.map(rowWidth));
  const placed: PlacedNode[] = [];
  let y = s.padding;

  rows.forEach((row, layerIndex) => {
    const total = rowWidth(row);
    let x = s.padding + (widest - total) / 2;
    let rowHeight = 0;
    for (const box of row) {
      placed.push({
        id: box.id,
        x: Math.round(x),
        y: Math.round(y),
        width: box.width,
        height: box.height,
        layer: layerIndex,
      });
      x += box.width + s.node;
      rowHeight = Math.max(rowHeight, box.height);
    }
    y += rowHeight + s.layer;
  });

  const width = widest;
  const height = placed.length > 0 ? y - s.layer - s.padding : 0;
  return {
    nodes: placed,
    bounds: { width: Math.round(width), height: Math.round(height) },
    cycleNodes,
    backEdges,
  };
}

/** Frame chrome: the title strip above the content, plus the inner padding. */
export const ZONE_CHROME = {
  titleHeight: 56,
  padding: 32,
  gap: 48,
  /** Zones per row before wrapping. Three reads well on a 16:9 canvas. */
  perRow: 3,
  /**
   * Extra width added to a zone's declared frame size. The transform adopts
   * the frame's children and then ADJUSTS the frame to fit them; declaring
   * exactly content+padding lets two adjacent frames end up touching once the
   * transform is done. The margin keeps them visibly separated.
   */
  margin: 40,
} as const;

/**
 * Lay out a ZONED diagram: each zone is laid out independently, then the zones
 * are arranged in a grid and wrapped in titled frames.
 *
 * This is the single-canvas answer to the multi-page one. A 12-step pipeline
 * laid out as one graph is a 160x1648 strip — technically correct, practically
 * unreadable. Grouping the steps into three zones gives three readable columns
 * with a title each, which is what a reader needs.
 *
 * Edges that cross zones are returned in the normal `backEdges`-agnostic
 * routing pass; the caller draws them between the placed nodes as usual.
 */
export function layoutZonedScene(input: LayoutInput): LayoutResult {
  const zones = input.zones ?? [];
  if (zones.length === 0) return layoutScene(input);

  const z = ZONE_CHROME;
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const zoneOf = new Map<string, string>();
  for (const zone of zones) for (const id of zone.nodes) zoneOf.set(id, zone.id);

  const defaultZoneId = "__default__";
  const leftovers = input.nodes.filter((n) => !zoneOf.has(n.id)).map((n) => n.id);
  const allZones: LayoutZone[] = leftovers.length
    ? [...zones, { id: defaultZoneId, title: "", nodes: leftovers }]
    : [...zones];

  // Lay out each zone's sub-graph on its own.
  const inner: Array<{ zone: LayoutZone; result: LayoutResult }> = [];
  for (const zone of allZones) {
    const ids = new Set(zone.nodes);
    const subNodes = input.nodes.filter((n) => ids.has(n.id));
    const subEdges = input.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const result = layoutScene({ nodes: subNodes, edges: subEdges });
    inner.push({ zone, result });
  }

  // Row heights are driven by the tallest zone in that row, so the frames line up.
  const rowCount = Math.ceil(inner.length / z.perRow);
  const rowHeight: number[] = new Array(rowCount).fill(0);
  inner.forEach((entry, i) => {
    const r = Math.floor(i / z.perRow);
    rowHeight[r] = Math.max(rowHeight[r], entry.result.bounds.height + z.titleHeight + z.padding * 2);
  });

  const placed: PlacedNode[] = [];
  const placedZones: PlacedZone[] = [];
  const allBackEdges: Array<[string, string]> = [];
  const allCycleNodes: string[] = [];

  inner.forEach((entry, i) => {
    const r = Math.floor(i / z.perRow);
    const c = i % z.perRow;
    // x offsets: sum of the widths of the zones to the left in this row.
    let x = 0;
    for (let k = 0; k < c; k++) {
      const prev = inner[r * z.perRow + k];
      x += prev.result.bounds.width + z.padding * 2 + z.gap;
    }
    let y = 0;
    for (let k = 0; k < r; k++) y += rowHeight[k] + z.gap;

    const zoneW = entry.result.bounds.width + z.padding * 2 + z.margin;
    const zoneH = rowHeight[r];
    placedZones.push({
      id: entry.zone.id,
      title: entry.zone.title,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(zoneW),
      height: Math.round(zoneH),
      nodes: [...entry.zone.nodes],
    });

    for (const n of entry.result.nodes) {
      placed.push({
        ...n,
        x: Math.round(x + z.padding + n.x),
        y: Math.round(y + z.titleHeight + z.padding + n.y),
      });
    }
    allBackEdges.push(...entry.result.backEdges);
    allCycleNodes.push(...entry.result.cycleNodes);
  });

  const totalW = placedZones.reduce((m, p) => Math.max(m, p.x + p.width), 0);
  const totalH = placedZones.reduce((m, p) => Math.max(m, p.y + p.height), 0);

  return {
    nodes: placed,
    bounds: { width: Math.round(totalW), height: Math.round(totalH) },
    cycleNodes: allCycleNodes,
    backEdges: allBackEdges,
    zones: placedZones,
  };
}

/**
 * Turn a layout result into element partials for `elements.add`.
 *
 * Labels go through the container's `label` property (the binding-close input
 * form — a bare `containerId` on a text partial is ignored by the transform).
 * Edges become arrows bound with `start`/`end`, which resolve within the batch.
 *
 * The caller still owns styling; this only supplies geometry and wiring.
 */
export interface EdgeRoute {
  x: number;
  y: number;
  width: number;
  height: number;
  points: Array<[number, number]>;
  /** Whether the arrow got a 3-point curved path (`roundness: {type: 2}`). */
  curved: boolean;
  /** The exit ratio down the source's edge that this route used. */
  exitRatio: number;
}

/** How much of the source's edge the exits are allowed to spread over. Keeping
 *  the first and last exits away from the very corners stops the arrowhead
 *  from colliding with the box's rounded corner. */
const EXIT_SPREAD_MIN = 0.2;
const EXIT_SPREAD_MAX = 0.8;
/** How far the arrow travels straight out of the source before turning. */
const LEAD_OUT = 28;

/**
 * Route every edge with a DISTINCT exit point and a gentle curve.
 *
 * Why this is not a cosmetic detail — verified on the real canvas:
 *
 *   - Every arrow leaving a node defaults to the same point (the middle of the
 *     nearest edge). Five outgoing arrows therefore converge on one spot and
 *     fan out as a star, which reads as "spaghetti", not as structure.
 *   - `roundness: {type: 2}` on a TWO-point arrow does NOTHING: there is no
 *     corner to round. A curve requires at least three points.
 *
 * So a fan-out needs both: exits spread along the source edge, and a waypoint
 * that makes the path bendable. The exit point is controlled by where the
 * arrow's first point sits (Excalidraw derives `fixedPoint` from it), which is
 * why this computes geometry rather than passing `fixedPoint` explicitly.
 */
export function routeEdges(
  layout: LayoutResult,
  edges: readonly LayoutEdge[],
): Array<EdgeRoute | null> {
  const placedById = new Map(layout.nodes.map((n) => [n.id, n]));
  const backEdgeKeys = new Set((layout.backEdges ?? []).map(([a, b]) => `${a}->${b}`));
  const zoneOfNode = new Map<string, string>();
  for (const zone of layout.zones ?? []) for (const id of zone.nodes) zoneOfNode.set(id, zone.id);
  const sameZone = (a: string, b: string) =>
    (!zoneOfNode.has(a) && !zoneOfNode.has(b)) || zoneOfNode.get(a) === zoneOfNode.get(b);
  // Rightmost extent of the whole graph — loop-backs route outside it.
  const graphRight = layout.nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);

  // Group edges by source so siblings can share the edge without colliding.
  const bySource = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const list = bySource.get(e.from) ?? [];
    list.push(i);
    bySource.set(e.from, list);
  });

  const routes: Array<EdgeRoute | null> = new Array(edges.length).fill(null);

  for (const [, indices] of bySource) {
    // Order the siblings by their target's horizontal position so the arrows
    // do not cross each other on the way out.
    const ordered = [...indices].sort((a, b) => {
      const ta = placedById.get(edges[a].to);
      const tb = placedById.get(edges[b].to);
      return (ta?.x ?? 0) - (tb?.x ?? 0);
    });

    ordered.forEach((edgeIndex, slot) => {
      const e = edges[edgeIndex];
      const from = placedById.get(e.from);
      const to = placedById.get(e.to);
      if (!from || !to) return;

      const n = ordered.length;
      // A single edge leaves from the centre; several spread across the edge.
      const ratio =
        n === 1
          ? 0.5
          : EXIT_SPREAD_MIN + ((EXIT_SPREAD_MAX - EXIT_SPREAD_MIN) * slot) / (n - 1);

      // A loop-back (a back edge) must travel AROUND the diagram, not through
      // it: it leaves the source's right side, goes out past the widest node,
      // drops down, and comes back into the target from the right.
      if (backEdgeKeys.has(`${e.from}->${e.to}`)) {
        const sx = from.x + from.width;
        const sy = from.y + from.height / 2;
        const tx = to.x + to.width;
        const ty = to.y + to.height / 2;
        const laneX = graphRight + LAYOUT_SPACING.padding + slot * 24;
        const pts: Array<[number, number]> = [
          [0, 0],
          [laneX - sx, 0],
          [laneX - sx, ty - sy],
          [tx - sx, ty - sy],
        ];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        routes[edgeIndex] = {
          x: sx + minX,
          y: sy + minY,
          width: Math.max(...xs) - minX,
          height: Math.max(...ys) - minY,
          points: pts.map(([px, py]) => [px - minX, py - minY] as [number, number]),
          curved: true,
          exitRatio: 0.5,
        };
        return;
      }

      const sourceRight = from.x + from.width;
      const sourceBottom = from.y + from.height;
      const targetLeft = to.x;
      const targetMidY = to.y + to.height / 2;
      // A cross-zone arrow must clear both frames, not just the node: leave
      // with a longer lead-out so the curve starts outside the frame border.
      const crossesZone = !sameZone(from.id, to.id);

      // Leave through the right edge when the target is to the right;
      // otherwise leave through the bottom (the default top-down flow).
      const horizontal = targetLeft >= sourceRight;
      const sx = horizontal ? sourceRight : from.x + from.width * ratio;
      const sy = horizontal ? from.y + from.height * ratio : sourceBottom;

      const tx = horizontal ? targetLeft : to.x + to.width / 2;
      const ty = horizontal ? targetMidY : to.y;

      // Straight run out of the box, then a single bend into the target. A
      // cross-zone arrow leads out further so the bend happens OUTSIDE the
      // frame border, and its waypoint matches the target's y before turning —
      // that is what keeps the line from slicing across the next frame.
      const lead = crossesZone ? LEAD_OUT * 2.5 : LEAD_OUT;
      const leadX = horizontal ? sx + lead : sx;
      const leadY = horizontal ? sy : sy + lead;

      let points: Array<[number, number]>;
      if (horizontal && crossesZone && Math.abs(ty - sy) > 8) {
        // out — across — turn at the target's lane — in
        points = [
          [0, 0],
          [leadX - sx, leadY - sy],
          [tx - sx - LEAD_OUT, leadY - sy],
          [tx - sx, ty - sy],
        ];
      } else {
        points = [
          [0, 0],
          [leadX - sx, leadY - sy],
          [tx - sx, ty - sy],
        ];
      }
      const curved = true;

      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const shifted = points.map(([px, py]) => [px - minX, py - minY] as [number, number]);

      routes[edgeIndex] = {
        x: sx + minX,
        y: sy + minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
        points: shifted,
        curved,
        exitRatio: ratio,
      };
    });
  }

  return routes;
}

export function toElementPartials(
  layout: LayoutResult,
  labels: ReadonlyMap<string, string>,
  edges: readonly LayoutEdge[],
  style: Record<string, unknown> = {},
): Array<Record<string, unknown>> {
  const placedById = new Map(layout.nodes.map((n) => [n.id, n]));
  const partials: Array<Record<string, unknown>> = [];

  // Zones become titled frames. Frames must be emitted FIRST so the transform
  // can adopt the listed children (a frame whose children are not in the same
  // batch has nothing to claim).
  for (const zone of layout.zones ?? []) {
    partials.push({
      type: "frame",
      id: zone.id,
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
      name: zone.title,
      children: zone.nodes,
    });
  }

  for (const n of layout.nodes) {
    partials.push({
      type: "rectangle",
      id: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      ...style,
      label: {
        text: labels.get(n.id) ?? n.id,
        fontFamily: 5,
        fontSize: 16,
        textAlign: "center",
        verticalAlign: "middle",
      },
    });
  }

  const routes = routeEdges(layout, edges);
  for (let i = 0; i < edges.length; i++) {
    const r = routes[i];
    if (!r) continue;
    partials.push({
      type: "arrow",
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      points: r.points,
      ...(r.curved ? { roundness: { type: 2 } } : {}),
      ...style,
      start: { id: edges[i].from },
      end: { id: edges[i].to },
    });
  }

  return partials;
}

/**
 * The "documented baseline" arm, kept in code so the A/B is reproducible.
 *
 * This is a faithful implementation of the OLD skill advice: fixed scale tier
 * (Primary 180x90), fixed grid step (300 x 200), no measurement. It exists to
 * be beaten — a regression test asserts the candidate strictly improves on it.
 */
export function layoutBaseline(input: LayoutInput): LayoutResult {
  const COL = 300;
  const ROW = 200;
  const W = 180;
  const H = 90;
  const { layers } = assignLayers(input.nodes, input.edges);
  const placed: PlacedNode[] = [];
  layers.forEach((ids, li) => {
    ids.forEach((id, i) => {
      placed.push({ id, x: 100 + i * COL, y: 100 + li * ROW, width: W, height: H, layer: li });
    });
  });
  const xs = placed.map((n) => n.x + n.width);
  const ys = placed.map((n) => n.y + n.height);
  return {
    nodes: placed,
    bounds: {
      width: Math.round(Math.max(0, ...xs) - 100),
      height: Math.round(Math.max(0, ...ys) - 100),
    },
    cycleNodes: [],
    backEdges: [],
  };
}

/**
 * The arm that reproduces the user-reported "elements cover each other":
 * the agent DOES size boxes from the label, but keeps the old fixed grid step.
 * A label wider than the step therefore collides with its neighbour.
 */
export function layoutMeasuredOnFixedGrid(input: LayoutInput): LayoutResult {
  const COL = 300;
  const ROW = 200;
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const { layers } = assignLayers(input.nodes, input.edges);
  const placed: PlacedNode[] = [];
  layers.forEach((ids, li) => {
    ids.forEach((id, i) => {
      const size = boxForNode(byId.get(id)!);
      placed.push({ id, x: 100 + i * COL, y: 100 + li * ROW, ...size, layer: li });
    });
  });
  const xs = placed.map((n) => n.x + n.width);
  const ys = placed.map((n) => n.y + n.height);
  return {
    nodes: placed,
    bounds: {
      width: Math.round(Math.max(0, ...xs) - 100),
      height: Math.round(Math.max(0, ...ys) - 100),
    },
    cycleNodes: [],
    backEdges: [],
  };
}

/** Wrap a label the way Excalidraw's container transform does: greedily break
 *  on the container's inner width, one line per row. This matters because the
 *  documented defect is not "text spills outside the box" — Excalidraw
 *  re-centers it — it is "the label was forced to wrap, and the resulting
 *  multi-line block no longer fits the box's height". */
function wrapLabel(text: string, maxWidth: number, fontSize = 16): string[] {
  const cjk = /[\u2E80-\u9FFF\uFF00-\uFFEF\u3000-\u303F\u1100-\u11FF\uAC00-\uD7AF\uF900-\uFAFF]/;
  const charWidth = (ch: string) => (cjk.test(ch) ? fontSize : fontSize * 0.55);
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  let current = "";
  let width = 0;
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(current);
      current = "";
      width = 0;
      continue;
    }
    const w = charWidth(ch);
    if (width + w > maxWidth && current !== "") {
      lines.push(current);
      current = ch;
      width = w;
    } else {
      current += ch;
      width += w;
    }
  }
  lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function lineWidth(line: string, fontSize = 16): number {
  const cjk = /[\u2E80-\u9FFF\uFF00-\uFFEF\u3000-\u303F\u1100-\u11FF\uAC00-\uD7AF\uF900-\uFAFF]/;
  let w = 0;
  for (const ch of line) w += cjk.test(ch) ? fontSize : fontSize * 0.55;
  return w;
}

/**
 * Convenience: build a synthetic scene from a layout, for audits that run
 * without a real Excalidraw transform.
 *
 * The label geometry mimics the transform: the text is wrapped to the
 * container's inner width, and the resulting block's height grows with the
 * line count. That is what makes the "fixed tier forces a wrap" defect
 * visible to the audit instead of silently passing.
 */
export function layoutToAuditElements(
  layout: LayoutResult,
  labels: ReadonlyMap<string, string>,
  edges: readonly LayoutEdge[],
): AuditElement[] {
  const placedById = new Map(layout.nodes.map((n) => [n.id, n]));
  const elements: AuditElement[] = [];
  for (const n of layout.nodes) {
    const label = labels.get(n.id) ?? n.id;
    elements.push({
      id: n.id,
      type: "rectangle",
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      boundElements: [],
    });
    const innerWidth = n.width - 28;
    const lines = wrapLabel(label, innerWidth);
    const textWidth = Math.min(innerWidth, Math.max(1, Math.ceil(Math.max(...lines.map((l) => lineWidth(l))))));
    const textHeight = lines.length * 20;
    elements.push({
      id: `${n.id}__label`,
      type: "text",
      x: n.x + 14,
      y: n.y + n.height / 2 - textHeight / 2,
      width: textWidth,
      height: textHeight,
      text: lines.join("\n"),
      containerId: n.id,
    });
  }
  for (let i = 0; i < edges.length; i++) {
    const from = placedById.get(edges[i].from);
    const to = placedById.get(edges[i].to);
    if (!from || !to) continue;
    const ax = from.x + from.width / 2;
    const ay = from.y + from.height;
    const bx = to.x + to.width / 2;
    const by = to.y;
    const arrowId = `arrow_${i}`;
    elements.push({
      id: arrowId,
      type: "arrow",
      x: ax,
      y: ay,
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
      points: [
        [0, 0],
        [bx - ax, by - ay],
      ],
      startBinding: { elementId: from.id, mode: "orbit" },
      endBinding: { elementId: to.id, mode: "orbit" },
    });
    for (const end of [from, to]) {
      const container = elements.find((e) => e.id === end.id);
      if (container) {
        container.boundElements = [
          ...(container.boundElements ?? []),
          { id: arrowId, type: "arrow" },
        ];
      }
    }
  }
  return elements;
}
