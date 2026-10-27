/**
 * fixtures — the shared diagram corpus for the layout A/B.
 *
 * These are ABSTRACT graphs (nodes + edges + the label text), NOT pre-drawn
 * elements. That distinction is what makes the A/B honest: both arms lay out
 * the SAME graph with the SAME labels, so the only variable is the placement
 * strategy. A fixture of finished coordinates would just be "the diagram I
 * drew last time", which cannot be reproduced.
 *
 * The labels are deliberately long. Short labels fit any strategy, which is
 * exactly why the stress report noted "simple diagrams look perfect" — the
 * defects only surface when a label exceeds the fixed grid step or the fixed
 * scale tier. These fixtures are sized to cross that line.
 */

export interface DiagramFixture {
  name: string;
  /** What the fixture is designed to expose. */
  exposes: string;
  nodes: Array<{ id: string; label: string }>;
  edges: Array<[string, string]>;
}

/** Wide fan-out: one node driving six. Exposes horizontal packing — the arm
 *  that keeps a fixed 300px step collides once labels exceed it. */
export const FANOUT: DiagramFixture = {
  name: "fanout",
  exposes: "horizontal packing under fan-out; fixed grid step collides with measured boxes",
  nodes: [
    { id: "v", label: "校验节点" },
    { id: "a", label: "邮件与附件解析" },
    { id: "b", label: "OCR 识别并结构化全部字段" },
    { id: "c", label: "合同条款抽取与关键条款比对校验" },
    { id: "d", label: "发票金额与税额逐项核对" },
    { id: "e", label: "银行流水逐笔匹配与对账" },
    { id: "f", label: "差异报告生成并归档留存" },
  ],
  edges: [
    ["v", "a"],
    ["v", "b"],
    ["v", "c"],
    ["v", "d"],
    ["v", "e"],
    ["v", "f"],
  ],
};

/** Single chain: exposes the fixed scale tier (a 180x90 box cannot hold a long
 *  label — Excalidraw wraps it and the label stops fitting the box). */
export const PIPELINE: DiagramFixture = {
  name: "pipeline",
  exposes: "fixed scale tier vs measured label height; wrapping inside a fixed box",
  nodes: [
    { id: "n1", label: "采集" },
    { id: "n2", label: "清洗、去重与字段标准化处理" },
    { id: "n3", label: "抽取" },
    { id: "n4", label: "校验" },
    { id: "n5", label: "入库" },
  ],
  edges: [
    ["n1", "n2"],
    ["n2", "n3"],
    ["n3", "n4"],
    ["n4", "n5"],
  ],
};

/** Mixed graph with a decision and a retry loop — the cycle must not break
 *  layering, and the loop-back edge must stay bound. */
export const MIXED: DiagramFixture = {
  name: "mixed",
  exposes: "decision + retry cycle; cycle nodes must still be placed and bound",
  nodes: [
    { id: "s", label: "开始" },
    { id: "d1", label: "格式正确？" },
    { id: "p", label: "解析并归一化全部字段到统一模型" },
    { id: "d2", label: "金额匹配？" },
    { id: "ok", label: "通过" },
    { id: "bad", label: "转入人工复核队列等待处理" },
  ],
  edges: [
    ["s", "d1"],
    ["d1", "p"],
    ["p", "d2"],
    ["d2", "ok"],
    ["d2", "bad"],
    ["bad", "p"],
  ],
};

export const ALL_FIXTURES: readonly DiagramFixture[] = [FANOUT, PIPELINE, MIXED];

/** Label lookup for a fixture. */
export function labelsOf(fixture: DiagramFixture): Map<string, string> {
  return new Map(fixture.nodes.map((n) => [n.id, n.label]));
}

/** Edge lookup in the solver's shape. */
export function edgesOf(fixture: DiagramFixture): Array<{ from: string; to: string }> {
  return fixture.edges.map(([from, to]) => ({ from, to }));
}

/**
 * A deterministic text measurer for headless use — mirrors the page's test
 * provider (CJK counts as one full em, latin as 0.55 em). The page's real
 * audit uses Excalidraw's own metrics; this exists so shared can compute
 * label sizes without the Excalidraw dependency.
 */
export function measureLabel(
  text: string,
  fontSize = 16,
): { width: number; height: number; lines: number } {
  const cjk = /[\u2E80-\u9FFF\uFF00-\uFFEF\u3000-\u303F\u1100-\u11FF\uAC00-\uD7AF\uF900-\uFAFF]/;
  let width = 0;
  for (const ch of text) width += cjk.test(ch) ? fontSize : fontSize * 0.55;
  return { width: Math.max(1, Math.ceil(width)), height: fontSize + 4, lines: 1 };
}
