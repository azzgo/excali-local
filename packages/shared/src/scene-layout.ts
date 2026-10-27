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
  /** Nodes that could not be layered (cycles) — placed in a trailing layer. */
  cycleNodes: string[];
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
): { layers: string[][]; cycleNodes: string[] } {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    succs.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
  }

  const layerOf = new Map<string, number>();
  const indeg = new Map<string, number>(ids.map((id) => [id, preds.get(id)!.length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (const id of queue) layerOf.set(id, 0);

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const base = layerOf.get(id) ?? 0;
    for (const next of succs.get(id)!) {
      layerOf.set(next, Math.max(layerOf.get(next) ?? 0, base + 1));
      const remaining = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  const cycleNodes = ids.filter((id) => !layerOf.has(id));
  const maxLayer = Math.max(0, ...[...layerOf.values()]);
  for (const id of cycleNodes) layerOf.set(id, maxLayer + 1);

  const layers: string[][] = [];
  for (const id of ids) {
    const l = layerOf.get(id)!;
    while (layers.length <= l) layers.push([]);
    layers[l].push(id);
  }
  return { layers: layers.filter((l) => l.length > 0), cycleNodes };
}

/**
 * Lay out by measured size. Layers stack top-down (the skill's default flow
 * direction), each row is centered on the widest row.
 */
export function layoutScene(input: LayoutInput): LayoutResult {
  const s = LAYOUT_SPACING;
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const { layers, cycleNodes } = assignLayers(input.nodes, input.edges);

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

  for (const e of edges) {
    const from = placedById.get(e.from);
    const to = placedById.get(e.to);
    if (!from || !to) continue;
    const ax = from.x + from.width / 2;
    const ay = from.y + from.height;
    const bx = to.x + to.width / 2;
    const by = to.y;
    partials.push({
      type: "arrow",
      x: ax,
      y: ay,
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
      points: [
        [0, 0],
        [bx - ax, by - ay],
      ],
      ...style,
      start: { id: e.from },
      end: { id: e.to },
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
