async () => {
  // ---- grab the real transform from the page's own module graph ----
  let X = null;
  for (const e of performance.getEntriesByType("resource")) {
    if (!/@excalidraw_excalidraw\.js/.test(e.name)) continue;
    try {
      const m = await import(e.name);
      if (typeof m.convertToExcalidrawElements === "function") { X = m; break; }
    } catch {}
  }
  if (!X) return { error: "transform module not found" };

  // ---- grab the live excalidraw API from the React fiber ----
  const root = document.querySelector(".excalidraw");
  const key = Object.keys(root).find(k => k.startsWith("__reactFiber$"));
  let api = null;
  const seen = new Set();
  (function walk(f) {
    if (!f || seen.has(f) || api) return;
    seen.add(f);
    const p = f.memoizedProps;
    if (p?.excalidrawAPI && typeof p.excalidrawAPI.updateScene === "function") api = p.excalidrawAPI;
    walk(f.child); walk(f.sibling);
  })(root[key]);
  if (!api) return { error: "no excalidrawAPI" };

  // ---- the same fixture as the shared corpus ----
  const FIX = {
    nodes: [
      { id: "v", label: "校验节点" },
      { id: "a", label: "邮件与附件解析" },
      { id: "b", label: "OCR 识别并结构化全部字段" },
      { id: "c", label: "合同条款抽取与关键条款比对校验" },
      { id: "d", label: "发票金额与税额逐项核对" },
      { id: "e", label: "银行流水逐笔匹配与对账" },
      { id: "f", label: "差异报告生成并归档留存" },
    ],
    edges: [["v","a"],["v","b"],["v","c"],["v","d"],["v","e"],["v","f"]],
  };

  // ---- STEP 1: MEASURE through the real transform ----
  const textPartials = FIX.nodes.map(n => ({
    type: "text", id: "m_" + n.id, x: 0, y: 0, text: n.label,
    fontFamily: 5, fontSize: 16, textAlign: "center", verticalAlign: "middle",
  }));
  const measuredEls = X.convertToExcalidrawElements(textPartials);
  const sizes = new Map();
  for (let i = 0; i < FIX.nodes.length; i++) {
    sizes.set(FIX.nodes[i].id, { w: measuredEls[i].width, h: measuredEls[i].height });
  }

  const PAD_X = 28, PAD_Y = 22, MIN_W = 160, MIN_H = 64;
  const SP_NODE = 56, SP_LAYER = 80, CANVAS_PAD = 48;
  const boxOf = s => ({ w: Math.max(MIN_W, Math.ceil(s.w) + PAD_X), h: Math.max(MIN_H, Math.ceil(s.h) + PAD_Y) });

  const layersOf = () => {
    const ids = FIX.nodes.map(n => n.id);
    const succ = new Map(ids.map(i => [i, []]));
    const indeg = new Map(ids.map(i => [i, 0]));
    for (const [a, b] of FIX.edges) { succ.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }
    let cur = ids.filter(i => indeg.get(i) === 0);
    const seen = new Set(cur), out = [];
    while (cur.length) {
      out.push(cur);
      const next = [];
      for (const i of cur) for (const s of succ.get(i)) if (!seen.has(s)) { seen.add(s); next.push(s); }
      cur = next;
    }
    const rest = ids.filter(i => !seen.has(i));
    if (rest.length) out.push(rest);
    return out;
  };

  const placeBaseline = () => {
    const m = new Map();
    layersOf().forEach((ids, li) => ids.forEach((id, i) => m.set(id, { x: 100 + i * 300, y: 100 + li * 200, w: 180, h: 90 })));
    return m;
  };

  const placeCandidate = () => {
    const rows = layersOf().map(ids => ids.map(id => ({ id, ...boxOf(sizes.get(id)) })));
    const rowW = r => r.reduce((s, b) => s + b.w, 0) + SP_NODE * Math.max(0, r.length - 1);
    const widest = Math.max(...rows.map(rowW));
    const m = new Map();
    let y = CANVAS_PAD;
    for (const row of rows) {
      let x = CANVAS_PAD + (widest - rowW(row)) / 2, maxH = 0;
      for (const b of row) {
        m.set(b.id, { x: Math.round(x), y: Math.round(y), w: b.w, h: b.h });
        x += b.w + SP_NODE; maxH = Math.max(maxH, b.h);
      }
      y += maxH + SP_LAYER;
    }
    return m;
  };

  const toPartials = placed => {
    const parts = [];
    for (const n of FIX.nodes) {
      const b = placed.get(n.id);
      parts.push({
        type: "rectangle", id: n.id, x: b.x, y: b.y, width: b.w, height: b.h,
        strokeColor: "#1e1e1e", backgroundColor: "#fff9db", fillStyle: "solid",
        strokeWidth: 2, roughness: 1, opacity: 100, roundness: { type: 3 },
        label: { text: n.label, fontFamily: 5, fontSize: 16, textAlign: "center", verticalAlign: "middle" },
      });
    }
    for (const [a, c] of FIX.edges) {
      const A = placed.get(a), C = placed.get(c);
      const ax = A.x + A.w / 2, ay = A.y + A.h;
      const cx = C.x + C.w / 2, cy = C.y;
      parts.push({
        type: "arrow", x: ax, y: ay, width: Math.abs(cx - ax), height: Math.abs(cy - ay),
        points: [[0, 0], [cx - ax, cy - ay]],
        strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 1, opacity: 100,
        start: { id: a }, end: { id: c },
      });
    }
    return parts;
  };

  const audit = els => {
    const live = els.filter(e => !e.isDeleted);
    const solids = live.filter(e => e.type !== "arrow" && e.type !== "text");
    const texts = live.filter(e => e.type === "text");
    const arrows = live.filter(e => e.type === "arrow");
    const box = e => {
      const x1 = Math.min(e.x, e.x + e.width), x2 = Math.max(e.x, e.x + e.width);
      const y1 = Math.min(e.y, e.y + e.height), y2 = Math.max(e.y, e.y + e.height);
      return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
    };
    let overlaps = 0, gutters = 0, overflow = 0, unbound = 0, wrapped = 0, dangling = 0;
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      const a = box(solids[i]), b = box(solids[j]);
      const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
      const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
      if (ox > 0 && oy > 0) { overlaps++; continue; }
      const gap = Math.max(Math.max(a.x1 - b.x2, b.x1 - a.x2), Math.max(a.y1 - b.y2, b.y1 - a.y2));
      if (gap < 40) gutters++;
    }
    for (const t of texts) {
      if (typeof t.text === "string" && t.text.includes("\n")) wrapped++;
      if (!t.containerId) continue;
      const c = live.find(e => e.id === t.containerId);
      if (!c) continue;
      const tb = box(t), cb = box(c);
      if (tb.h > cb.h - 16 || tb.w > cb.w - 16) overflow++;
    }
    for (const a of arrows) {
      if (!a.startBinding || !a.endBinding) unbound++;
      for (const b of [a.startBinding, a.endBinding]) {
        if (!b) continue;
        const t = live.find(e => e.id === b.elementId);
        if (!t || !(t.boundElements ?? []).some(x => x?.id === a.id)) dangling++;
      }
    }
    const bb = solids.map(box);
    const W = bb.length ? Math.max(...bb.map(b => b.x2)) - Math.min(...bb.map(b => b.x1)) : 0;
    const H = bb.length ? Math.max(...bb.map(b => b.y2)) - Math.min(...bb.map(b => b.y1)) : 0;
    return { overlaps, gutters, overflow, unbound, dangling, wrapped, w: Math.round(W), h: Math.round(H) };
  };

  const render = placed => {
    const els = X.convertToExcalidrawElements(toPartials(placed));
    api.updateScene({ elements: els, captureUpdate: "IMMEDIATELY" });
    return api.getSceneElements();
  };

  const arms = {};
  for (const [name, fn] of [["baseline", placeBaseline], ["candidate", placeCandidate]]) {
    arms[name] = audit(render(fn()));
  }

  // leave the candidate on screen, fitted for the screenshot
  render(placeCandidate());
  if (typeof api.scrollToContent === "function") {
    api.scrollToContent(api.getSceneElements(), { fitToContent: true });
  }

  return {
    measured: Object.fromEntries([...sizes].map(([k, v]) => [k, { w: Math.round(v.w), h: Math.round(v.h) }])),
    arms,
  };
}
