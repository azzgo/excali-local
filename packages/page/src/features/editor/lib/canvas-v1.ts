/**
 * canvas/v1 — page-side JSON-RPC dispatcher (Wayfinder Ticket 007).
 *
 * PURE module: no React, no browser globals, no excalidraw imports. The
 * excalidraw imperative API and the module helpers (convertToExcalidrawElements,
 * getCommonBounds, exportPng, exportSvg) are INJECTED, so this exact code runs
 * in the page hook (browser), in vitest, and in the Bun e2e driver.
 *
 * Method inventory (EXACT names per Ticket 007):
 *   READ   scene.get / scene.elements / scene.state / scene.bounds /
 *          scene.exportPng / scene.exportSvg
 *   WRITE  scene.update / elements.add / elements.clear / scene.reset /
 *          files.add / tool.setActive / view.scrollTo / history.clear
 *   (META commands.list / protocol.version resolve daemon-side)
 *
 * Semantics: scene.update is a render-safe passthrough (ids/versions/bindings
 * preserved; null/missing array fields coerced to [] so a malformed re-emit
 * can't crash the renderer; default captureUpdate NEVER); elements.add = convertToExcalidrawElements
 * then concat (captureUpdate IMMEDIATELY); appState write accepts ONLY the
 * curated subset {viewBackgroundColor, gridSize, viewModeEnabled, activeTool};
 * binary (exportPng/exportSvg output, files.add input) travels as base64.
 * Destructive ops (elements.clear, scene.reset, history.clear, files.add
 * overwrite) fire deps.onDestructive → the page shows a non-blocking visible
 * indicator (003/011) — never a blocking modal.
 */

/** JSON-RPC error codes (mirror excali-shared / Go contract). */
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const JSON_RPC_ERROR_CANVAS_NOT_READY = -32001;

export const TOOL_TYPES = [
  "selection",
  "lasso",
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "eraser",
  "hand",
  "frame",
  "magicframe",
  "embeddable",
  "laser",
] as const;

/** appState write-subset (007): only these keys are accepted on write. */
const APP_STATE_WRITE_KEYS = [
  "viewBackgroundColor",
  "gridSize",
  "viewModeEnabled",
  "activeTool",
] as const;

const CAPTURE_UPDATE_VALUES = ["NEVER", "IMMEDIATELY", "EVENTUALLY"] as const;

export interface CanvasV1Request {
  jsonrpc: "2.0";
  id: unknown;
  method: string;
  params?: unknown;
}

export interface CanvasV1Response {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface CanvasV1ExportPngOptions {
  elements: readonly unknown[];
  appState: unknown;
  files: unknown;
  mimeType?: string;
  scale?: number;
}

export interface CanvasV1ExportSvgOptions {
  elements: readonly unknown[];
  appState: unknown;
  files: unknown;
}

/** Injected module helpers (in-repo patched-tgz exports in the browser). */
export interface CanvasV1Helpers {
  convertToExcalidrawElements(data: readonly unknown[]): readonly unknown[];
  getCommonBounds(elements: readonly unknown[]): [number, number, number, number];
  exportPng(opts: CanvasV1ExportPngOptions): Promise<{
    dataURL: string;
    width: number;
    height: number;
  }>;
  exportSvg(opts: CanvasV1ExportSvgOptions): Promise<string>;
}

/** Minimal structural view of the excalidraw imperative API we use. */
export interface CanvasV1Api {
  getSceneElements(): readonly unknown[];
  getAppState(): Record<string, unknown>;
  getFiles(): Record<string, unknown> | null | undefined;
  updateScene(patch: {
    elements?: readonly unknown[];
    appState?: Record<string, unknown>;
    captureUpdate?: string;
  }): void;
  addFiles(files: readonly { id: string; mimeType?: string; dataURL?: string; created?: number }[]): void;
  setActiveTool(tool: { type: string; locked?: boolean }): void;
  setViewport(opts: { target?: unknown; fit?: "scale-down" | "contain" | "none" }): void;
  resetScene(): void;
  history: { clear(): void };
}

export interface CanvasV1Deps {
  api: CanvasV1Api;
  helpers: CanvasV1Helpers;
  /** Fired for the destructive subset (003/011 non-blocking op; the page surfaces a toast). */
  onDestructive?: (method: string) => void;
}

class CanvasV1Error extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

const invalidParams = (message: string): never => {
  throw new CanvasV1Error(JSON_RPC_INVALID_PARAMS, message);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Render-safety normalization for element arrays, applied to BOTH
 * `elements.add` (post-transform) and `scene.update` (pre-passthrough).
 *
 * Why scene.update needs it too: scene.update is a passthrough into
 * `updateScene`, but Excalidraw's RENDERER (React render cycle, which runs
 * AFTER updateScene returns and is NOT covered by the dispatcher's try/catch)
 * reads `e.groupIds.length`, iterates `e.boundElements`, and reads
 * `e.pressures.length` on freedraw — all WITHOUT null-checks. An element
 * re-emitted from `scene.get`/`scene.elements` with a `null`/missing array
 * field (a common LLM-constructed-payload failure) therefore throws an
 * uncaught TypeError, killing the page and dropping the WS connection
 * (surfaces as rpc -32003). Coercing non-arrays to `[]` here makes every
 * element render-safe while preserving ids/versions/bindings exactly.
 *
 * Deliberately minimal: it only guarantees the renderer won't crash on
 * array-typed fields. It does NOT validate binding shapes (an arrow's
 * startBinding/endBinding consistency with endpoint boundElements is the
 * caller's responsibility — documented in the skill).
 */
export function ensureRenderSafeDefaults(elements: readonly unknown[]): void {
  for (const el of elements) {
    if (typeof el !== "object" || el === null) continue;
    const e = el as Record<string, unknown>;
    // groupIds: renderer reads .length on every visible element.
    if (!Array.isArray(e.groupIds)) {
      e.groupIds = [];
    } else {
      e.groupIds = (e.groupIds as unknown[]).filter((g) => typeof g === "string");
    }
    // boundElements: renderer iterates and reads .type/.id per entry; a null
    // entry or non-array crashes it. Coerce to [] and keep only records.
    if (!Array.isArray(e.boundElements)) {
      e.boundElements = [];
    } else {
      e.boundElements = (e.boundElements as unknown[]).filter(
        (b) => typeof b === "object" && b !== null,
      );
    }
    if (e.type === "freedraw") {
      if (e.simulatePressure === undefined) e.simulatePressure = true;
      if (!Array.isArray(e.pressures) && Array.isArray(e.points)) {
        e.pressures = (e.points as unknown[]).map(() => 0.5);
      } else if (!Array.isArray(e.pressures)) {
        e.pressures = [];
      }
    }
  }
}

/** Dispatch one canvas/v1 request; never throws (errors → error response). */
export async function handleCanvasV1Request(
  req: CanvasV1Request,
  deps: CanvasV1Deps,
): Promise<CanvasV1Response> {
  if (req.jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: req.id, error: { code: JSON_RPC_INVALID_REQUEST, message: "invalid request" } };
  }
  try {
    const result = await dispatch(req.method, req.params, deps);
    return { jsonrpc: "2.0", id: req.id, result };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: typeof err.code === "number" ? err.code : JSON_RPC_INTERNAL_ERROR,
        message: err.message ?? "internal error",
      },
    };
  }
}

async function dispatch(method: string, params: unknown, deps: CanvasV1Deps): Promise<unknown> {
  const { api, helpers, onDestructive } = deps;
  switch (method) {
    // ---------------- READ ----------------
    case "scene.get":
      return {
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles() ?? {},
      };
    case "scene.elements":
      return api.getSceneElements();
    case "scene.state": {
      const s = api.getAppState();
      return {
        viewBackgroundColor: s.viewBackgroundColor,
        gridSize: s.gridSize,
        zoom: s.zoom,
        scrollX: s.scrollX,
        scrollY: s.scrollY,
        viewModeEnabled: s.viewModeEnabled,
        activeTool: s.activeTool,
      };
    }
    case "scene.bounds": {
      const p = asRecord(params);
      const elements = p.elements ?? api.getSceneElements();
      if (!Array.isArray(elements)) invalidParams("scene.bounds: elements must be an array");
      const [x1, y1, x2, y2] = helpers.getCommonBounds(elements as readonly unknown[]);
      return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
    case "scene.exportPng": {
      const p = asRecord(params);
      const elements = p.elements ?? api.getSceneElements();
      if (!Array.isArray(elements)) invalidParams("scene.exportPng: elements must be an array");
      const mimeType = typeof p.mimeType === "string" ? p.mimeType : "image/png";
      const scale = typeof p.scale === "number" ? p.scale : undefined;
      if (p.scale != null && (scale === undefined || scale <= 0)) {
        invalidParams("scene.exportPng: scale must be a positive number");
      }
      return await helpers.exportPng({
        elements: elements as readonly unknown[],
        appState: api.getAppState(),
        files: api.getFiles() ?? {},
        mimeType,
        scale,
      });
    }
    case "scene.exportSvg": {
      const p = asRecord(params);
      const elements = p.elements ?? api.getSceneElements();
      if (!Array.isArray(elements)) invalidParams("scene.exportSvg: elements must be an array");
      const svg = await helpers.exportSvg({
        elements: elements as readonly unknown[],
        appState: api.getAppState(),
        files: api.getFiles() ?? {},
      });
      return { svg };
    }

    // ---------------- WRITE ----------------
    case "scene.update": {
      const p = asRecord(params);
      const patch: { elements?: readonly unknown[]; appState?: Record<string, unknown>; captureUpdate?: string } = {};
      if (p.elements !== undefined) {
        if (!Array.isArray(p.elements)) invalidParams("scene.update: elements must be an array");
        // Render-safety (see ensureRenderSafeDefaults): the renderer reads
        // array-typed fields without null-checks, so a null groupIds/
        // boundElements on a re-emitted element kills the page (→ WS drop →
        // -32003). Coerce before the passthrough so a malformed re-emit can
        // never crash the page; ids/versions/bindings stay untouched.
        ensureRenderSafeDefaults(p.elements as readonly unknown[]);
        patch.elements = p.elements as readonly unknown[];
      }
      if (p.appState !== undefined) {
        const appState = p.appState;
        if (!isRecord(appState)) invalidParams("scene.update: appState must be an object");
        patch.appState = pickAppStateWriteSubset(appState as Record<string, unknown>);
      }
      if (p.captureUpdate !== undefined) {
        if (!CAPTURE_UPDATE_VALUES.includes(p.captureUpdate as never)) {
          invalidParams(`scene.update: captureUpdate must be one of ${CAPTURE_UPDATE_VALUES.join("|")}`);
        }
        patch.captureUpdate = p.captureUpdate as string;
      }
      if (patch.elements === undefined && patch.appState === undefined) {
        invalidParams("scene.update: at least one of elements/appState required");
      }
      api.updateScene({ ...patch, captureUpdate: patch.captureUpdate ?? "NEVER" });
      return null;
    }
    case "elements.add": {
      const p = asRecord(params);
      if (!Array.isArray(p.elements)) invalidParams("elements.add: elements must be an array");
      const normalized = helpers.convertToExcalidrawElements(p.elements as readonly unknown[]);
      ensureRenderSafeDefaults(normalized);
      const existing = api.getSceneElements();
      api.updateScene({
        elements: [...existing, ...normalized],
        captureUpdate: "IMMEDIATELY",
      });
      return null;
    }
    case "elements.clear":
      api.updateScene({ elements: [], captureUpdate: "IMMEDIATELY" });
      onDestructive?.("elements.clear");
      return null;
    case "scene.reset":
      api.resetScene();
      onDestructive?.("scene.reset");
      return null;
    case "files.add": {
      const p = asRecord(params);
      if (!Array.isArray(p.files)) invalidParams("files.add: files must be an array");
      const files = (p.files as readonly unknown[]).map((fileCandidate) => {
        if (
          !isRecord(fileCandidate) ||
          typeof fileCandidate.id !== "string" ||
          typeof fileCandidate.dataURL !== "string"
        ) {
          invalidParams("files.add: each file needs {id, dataURL}");
        }
        const file = fileCandidate as Record<string, unknown>;
        return {
          id: file.id as string,
          mimeType: typeof file.mimeType === "string" ? file.mimeType : undefined,
          dataURL: file.dataURL as string,
          created: typeof file.created === "number" ? file.created : undefined,
        };
      });
      const existing = new Set(Object.keys(api.getFiles() ?? {}));
      if (files.some((f) => existing.has(f.id))) {
        onDestructive?.("files.add"); // overwrite → destructive
      }
      api.addFiles(files);
      return null;
    }
    case "tool.setActive": {
      const p = asRecord(params);
      if (typeof p.type !== "string" || !(TOOL_TYPES as readonly string[]).includes(p.type)) {
        invalidParams(`tool.setActive: type must be one of ${TOOL_TYPES.join("|")}`);
      }
      api.setActiveTool({ type: p.type as string, locked: typeof p.locked === "boolean" ? (p.locked as boolean) : undefined });
      return null;
    }
    case "view.scrollTo": {
      const p = asRecord(params);
      const elements = p.elements ?? api.getSceneElements();
      if (!Array.isArray(elements)) invalidParams("view.scrollTo: elements must be an array");
      api.setViewport({
        target: elements,
        fit: p.fitToContent === true ? "contain" : "none",
      });
      return null;
    }
    case "history.clear":
      api.history.clear();
      onDestructive?.("history.clear");
      return null;

    default:
      throw new CanvasV1Error(JSON_RPC_METHOD_NOT_FOUND, "method not found");
  }
}

function asRecord(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (isRecord(params)) return params;
  invalidParams("params must be an object");
  throw new Error("unreachable");
}

/** Pick ONLY the curated appState write-subset (007). */
export function pickAppStateWriteSubset(appState: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of APP_STATE_WRITE_KEYS) {
    if (appState[key] !== undefined) out[key] = appState[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// base64 helpers (pure — unit-testable without a browser canvas)
// ---------------------------------------------------------------------------

/** Encode bytes as base64 (chunked — no call-stack overflow on large exports). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Blob → base64 dataURL (works in browser + Bun + Node ≥16). */
export async function blobToDataURL(blob: Blob, mimeType?: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = mimeType ?? blob.type ?? "application/octet-stream";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
