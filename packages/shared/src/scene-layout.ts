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
  /**
   * Maximum layers per COLUMN before the layout wraps into a new column, the
   * way text wraps. A pure 12-step chain laid out as one column is a
   * 160x1648 strip — technically correct, practically a scroll test. Wrapping
   * every 6 layers keeps a pipeline within roughly a screen's height, and the
   * flow continues at the top of the next column (read down, then next
   * column — newspaper order).
   */
  maxLayersPerColumn: 6,
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

  // Wrap long chains: after `maxLayersPerColumn` rows, continue at the top of
  // the next column. Column width is driven by the widest row in it.
  const columns: Array<typeof rows> = [];
  for (let i = 0; i < rows.length; i += s.maxLayersPerColumn) {
    columns.push(rows.slice(i, i + s.maxLayersPerColumn));
  }

  const placed: PlacedNode[] = [];
  let columnX = s.padding;
  let maxColumnWidth = 0;

  columns.forEach((columnRows) => {
    const columnWidest = Math.max(0, ...columnRows.map(rowWidth));
    let y = s.padding;
    columnRows.forEach((row) => {
      const total = rowWidth(row);
      let x = columnX + (columnWidest - total) / 2;
      let rowHeight = 0;
      for (const box of row) {
        placed.push({
          id: box.id,
          x: Math.round(x),
          y: Math.round(y),
          width: box.width,
          height: box.height,
          layer: 0,
        });
        x += box.width + s.node;
        rowHeight = Math.max(rowHeight, box.height);
      }
      y += rowHeight + s.layer;
    });
    maxColumnWidth = Math.max(maxColumnWidth, columnWidest);
    columnX += columnWidest + LAYOUT_SPACING.layer * 2;
  });

  const width = maxColumnWidth + (columns.length - 1) * (maxColumnWidth + LAYOUT_SPACING.layer * 2);
  const heights = columns.map(
    (columnRows) =>
      columnRows.reduce(
        (sum, row) => sum + Math.max(...row.map((b) => b.height)) + s.layer,
        0,
      ) - s.layer,
  );
  const height = Math.max(0, ...heights);
  return {
    nodes: placed,
    bounds: { width: Math.round(width), height: Math.round(height) },
    cycleNodes,
    backEdges,
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
  /** Always false since the switch to orthogonal polylines; kept so the
   *  route shape stays serialisable if curves return. */
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
/** Does the segment p1->p2 pass through the interior of the box? Tolerant at
 *  the edges by `eps`, so an arrow landing ON a border is not a hit. */
export function segmentHitsBox(
  p1: [number, number],
  p2: [number, number],
  b: { x1: number; y1: number; x2: number; y2: number },
  eps: number,
): boolean {
  const inside = (px: number, py: number) =>
    px > b.x1 + eps && px < b.x2 - eps && py > b.y1 + eps && py < b.y2 - eps;
  if (inside(p1[0], p1[1]) || inside(p2[0], p2[1])) return true;
  const { x1, y1, x2, y2 } = b;
  return (
    segmentsProperCross(p1, p2, [x1, y1], [x2, y1]) ||
    segmentsProperCross(p1, p2, [x2, y1], [x2, y2]) ||
    segmentsProperCross(p1, p2, [x2, y2], [x1, y2]) ||
    segmentsProperCross(p1, p2, [x1, y2], [x1, y1])
  );
}

function segmentsProperCross(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): boolean {
  const d = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function routeEdges(
  layout: LayoutResult,
  edges: readonly LayoutEdge[],
): Array<EdgeRoute | null> {
  const placedById = new Map(layout.nodes.map((n) => [n.id, n]));
  const backEdgeKeys = new Set((layout.backEdges ?? []).map(([a, b]) => `${a}->${b}`));
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

  // CORRIDOR LANES: the midpoints of the empty vertical bands between node
  // columns (plus the outer margins). A lane placed at "box edge + 60" tends
  // to land on or just beside the next column's border, so the run reads as
  // scraping the boxes; a corridor midpoint sits in visibly empty space.
  const bands = layout.nodes
    .map((n) => [n.x, n.x + n.width] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band[0] <= last[1] + 1) last[1] = Math.max(last[1], band[1]);
    else merged.push([...band]);
  }
  const corridorLanes: number[] = [];
  for (let i = 0; i + 1 < merged.length; i++) {
    const gapStart = merged[i][1];
    const gapEnd = merged[i + 1][0];
    if (gapEnd - gapStart >= 24) corridorLanes.push(Math.round((gapStart + gapEnd) / 2));
  }
  // Outer margins, so a loop-back can always find a lane.
  corridorLanes.push(merged.length ? merged[0][0] - LAYOUT_SPACING.padding : 0);
  corridorLanes.push(
    (merged.length ? merged[merged.length - 1][1] : 0) + LAYOUT_SPACING.padding,
  );

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
        // Enter the target from the side facing the lane, or the return run
        // crosses the whole graph horizontally — straight through whatever
        // sits between (verified: bad->p returned via the target's right edge
        // and sliced through the node directly below the lane's descent).
        const fromLeft = to.x < from.x;
        const tx = fromLeft ? to.x : to.x + to.width;
        const ty = to.y + to.height / 2;
        // Lane candidates, NEAREST first: the gaps beside the source and
        // target are usually clear, and a loop-back that swings out past the
        // graph edge reads as a detour even when it is collision-free. The
        // far-outside lane is the last resort, not the default.
        // Nearest corridor to the right of the source first (a loop-back reads
        // best when it turns in the first empty band it meets), then the rest.
        const laneCandidates = [
          ...corridorLanes
            .filter((x) => x > from.x + from.width)
            .sort((a, b) => a - b),
          ...corridorLanes
            .filter((x) => x <= from.x + from.width)
            .sort((a, b) => b - a),
        ];
        const clearBack = (poly: Array<[number, number]>) => {
          const abs: Array<[number, number]> = poly.map(([px, py]) => [sx + px, sy + py]);
          for (let si = 0; si + 1 < abs.length; si++) {
            for (const other of layout.nodes) {
              if (other.id === from.id || other.id === to.id) continue;
              if (
                segmentHitsBox(abs[si], abs[si + 1], {
                  x1: other.x, y1: other.y, x2: other.x + other.width, y2: other.y + other.height,
                }, 4)
              ) {
                return false;
              }
            }
          }
          return true;
        };
        let pts: Array<[number, number]> | null = null;
        for (const laneX of laneCandidates) {
          const candidate: Array<[number, number]> = [
            [0, 0],
            [laneX - sx, 0],
            [laneX - sx, ty - sy],
            [tx - sx, ty - sy],
          ];
          if (clearBack(candidate)) {
            pts = candidate;
            break;
          }
          // The return run at the target's mid-y is the usual blocker; retry
          // this lane with the return shifted between rows.
          for (const dy of [-80, 80, -160, 160]) {
            const midY = ty - sy + dy;
            const retry: Array<[number, number]> = [
              [0, 0],
              [laneX - sx, 0],
              [laneX - sx, midY],
              [tx - sx, midY],
              [tx - sx, ty - sy],
            ];
            if (clearBack(retry)) {
              pts = retry;
              break;
            }
          }
          if (pts) break;
        }
        if (!pts) {
          const laneX = laneCandidates[laneCandidates.length - 1] - sx;
          pts = [
            [0, 0],
            [laneX, 0],
            [laneX, ty - sy],
            [tx - sx, ty - sy],
          ];
        }
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
          curved: false,
          exitRatio: 0.5,
        };
        return;
      }

      const sourceRight = from.x + from.width;
      const sourceBottom = from.y + from.height;
      const targetLeft = to.x;
      const targetMidY = to.y + to.height / 2;

      // Leave through the right edge when the target is to the right;
      // otherwise leave through the bottom (the default top-down flow).
      const horizontal = targetLeft >= sourceRight;
      const sx = horizontal ? sourceRight : from.x + from.width * ratio;
      const sy = horizontal ? from.y + from.height * ratio : sourceBottom;

      const tx = horizontal ? targetLeft : to.x + to.width / 2;
      const ty = horizontal ? targetMidY : to.y;

      // ORTHOGONAL POLYLINES ONLY. Every bend is a point we placed, on a lane
      // we chose — and the verify-and-shift loop below can then guarantee the
      // segments avoid the boxes. Curves were tried first and abandoned with
      // evidence: Excalidraw re-computes a bound curve's path in the renderer
      // (`updateElbowArrowPoints` is not exported), so the rounded shape is
      // not reproducible headlessly and its docked waypoints can land inside
      // a box. A polyline's geometry is ours end to end.
      //
      // Exit control stays first: the arrow leaves at this edge's slot ratio
      // (so a fan does not converge on one point), runs straight out, then
      // turns on orthogonal segments — descending in a LANE between columns,
      // never diagonally across the canvas.
      const lead = LEAD_OUT;
      const verticalDrop = Math.abs(ty - sy);
      const laneDrop = verticalDrop > 64;
      let points: Array<[number, number]>;
      if (horizontal) {
        const midX = laneDrop ? tx - sx - LEAD_OUT : (tx - sx) / 2;
        points = [
          [0, 0],
          [lead, 0],
          [midX, 0],
          [midX, ty - sy],
          [tx - sx, ty - sy],
        ];
      } else {
        // Vertical flow, orthogonal: out the bottom at this slot's x, across in
        // the gap between the rows, then down into the target.
        const drop = Math.max(LEAD_OUT, (ty - sy) * 0.4);
        points = [
          [0, 0],
          [0, drop],
          [tx - sx, drop],
          [tx - sx, ty - sy],
        ];
      }

      // VERIFY-AND-SHIFT: the shapes above are heuristics. Test the actual
      // polyline against every solid it is not attached to; if any segment
      // slices through one, push the whole route out past the graph edge and
      // re-test. Heuristics alone shipped two crossings on the 12-node
      // invoice pipeline; this loop is what removes them.
      const clear = (pts: Array<[number, number]>) => {
        const abs: Array<[number, number]> = pts.map(([px, py]) => [sx + px, sy + py]);
        for (let si = 0; si + 1 < abs.length; si++) {
          for (const other of layout.nodes) {
            if (other.id === from.id || other.id === to.id) continue;
            if (
              segmentHitsBox(abs[si], abs[si + 1], {
                x1: other.x, y1: other.y, x2: other.x + other.width, y2: other.y + other.height,
              }, 4)
            ) {
              return false;
            }
          }
        }
        return true;
      };

      if (!clear(points)) {
        // Candidate lanes, NEAREST first. Pushing straight past the graph edge
        // was the old behaviour and it produced absurd detours: a single
        // cross-column edge swung out hundreds of pixels right and came back
        // (the "big hook"). The gaps between nearby nodes are usually clear —
        // try lanes just right of the source, then progressively wider, and
        // only then the far outside.
        const laneCandidates: number[] = [
          ...corridorLanes
            .filter((x) => x > from.x + from.width)
            .sort((a, b) => a - b),
          ...corridorLanes.slice().sort((a, b) => b - a),
        ];
        for (const laneX of laneCandidates) {
          const retry: Array<[number, number]> =
            horizontal
              ? [
                  [0, 0],
                  [lead, 0],
                  [laneX, 0],
                  [laneX, ty - sy],
                  [tx - sx, ty - sy],
                ]
              : [
                  [0, 0],
                  [0, lead],
                  [laneX, lead],
                  [laneX, ty - sy],
                  [tx - sx, ty - sy],
                ];
          if (clear(retry)) {
            points = retry;
            break;
          }
        }
      }

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
        curved: false,
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
      ...style,
      // BIND ONLY STRAIGHT ARROWS.
      //
      // Verified on the canvas: once an arrow carries start/end bindings,
      // Excalidraw recomputes its entire path in the renderer — our `points`
      // are discarded and replaced with the renderer's own routing, which is
      // why a verified-orthogonal polyline came out as a big smooth curve that
      // crossed boxes. A two-point arrow is unaffected (the renderer keeps a
      // straight line between the same endpoints), so those stay bound and get
      // the "follows the box" behaviour for free.
      //
      // A multi-point polyline is emitted UNBOUND: its geometry is ours end to
      // end, which is exactly what makes the audit's guarantee real. The
      // endpoints still sit on the box borders, so it reads as attached.
      ...(r.points.length === 2
        ? { start: { id: edges[i].from }, end: { id: edges[i].to } }
        : {}),
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
  // Route with the SAME router the real payload uses — auditing a simplified
  // straight-line geometry would be checking a fiction.
  const routes = routeEdges(layout, edges);
  for (let i = 0; i < edges.length; i++) {
    const from = placedById.get(edges[i].from);
    const to = placedById.get(edges[i].to);
    const route = routes[i];
    if (!from || !to || !route) continue;
    const arrowId = `arrow_${i}`;
    elements.push({
      id: arrowId,
      type: "arrow",
      x: route.x,
      y: route.y,
      width: route.width,
      height: route.height,
      points: route.points,
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
