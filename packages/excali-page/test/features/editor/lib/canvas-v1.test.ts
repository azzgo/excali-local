import { describe, expect, test, vi } from "vitest";
import {
  blobToDataURL,
  bytesToBase64,
  handleCanvasV1Request,
  pickAppStateWriteSubset,
  type CanvasV1Api,
  type CanvasV1Helpers,
} from "@/features/editor/lib/canvas-v1";

// ---------------------------------------------------------------------------
// Fake excalidraw API + helpers (the dispatcher is pure; everything injected).
// ---------------------------------------------------------------------------

function makeApi(overrides: Partial<CanvasV1Api> = {}): CanvasV1Api {
  return {
    getSceneElements: () => [],
    getAppState: () => ({}),
    getFiles: () => ({}),
    updateScene: vi.fn(),
    addFiles: vi.fn(),
    setActiveTool: vi.fn(),
    scrollToContent: vi.fn(),
    resetScene: vi.fn(),
    history: { clear: vi.fn() },
    ...overrides,
  };
}

function makeHelpers(overrides: Partial<CanvasV1Helpers> = {}): CanvasV1Helpers {
  return {
    convertToExcalidrawElements: vi.fn((data) => data as unknown[]),
    getCommonBounds: vi.fn(() => [0, 0, 100, 50] as [number, number, number, number]),
    exportPng: vi.fn(async () => ({
      dataURL: "data:image/png;base64,AAAA",
      width: 100,
      height: 50,
    })),
    exportSvg: vi.fn(async () => "<svg/>"),
    ...overrides,
  };
}

async function call(method: string, params: unknown, deps: { api?: CanvasV1Api; helpers?: CanvasV1Helpers; onDestructive?: (m: string) => void } = {}) {
  const api = deps.api ?? makeApi();
  const helpers = deps.helpers ?? makeHelpers();
  const onDestructive = deps.onDestructive ?? vi.fn();
  return {
    api,
    helpers,
    onDestructive,
    resp: await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 1, method, params },
      { api, helpers, onDestructive },
    ),
  };
}

describe("canvas/v1 dispatcher — READ", () => {
  test("scene.get returns {elements, appState, files} from the live API", async () => {
    const elements = [{ id: "a", type: "rectangle" }];
    const appState = { viewBackgroundColor: "#fff" };
    const files = { f1: { mimeType: "image/png" } };
    const { resp } = await call("scene.get", null, {
      api: makeApi({
        getSceneElements: () => elements,
        getAppState: () => appState,
        getFiles: () => files,
      }),
    });
    expect(resp.result).toEqual({ elements, appState, files });
  });

  test("scene.elements returns the raw element array", async () => {
    const elements = [{ id: "a" }];
    const { resp } = await call("scene.elements", null, {
      api: makeApi({ getSceneElements: () => elements }),
    });
    expect(resp.result).toBe(elements);
  });

  test("scene.state returns the curated read subset", async () => {
    const { resp } = await call("scene.state", null, {
      api: makeApi({
        getAppState: () => ({
          viewBackgroundColor: "#fff",
          gridSize: 20,
          zoom: { value: 1 },
          scrollX: 10,
          scrollY: 20,
          viewModeEnabled: false,
          activeTool: { type: "selection" },
          collaborators: [{ id: "x" }], // must NOT leak
        }),
      }),
    });
    expect(resp.result).toEqual({
      viewBackgroundColor: "#fff",
      gridSize: 20,
      zoom: { value: 1 },
      scrollX: 10,
      scrollY: 20,
      viewModeEnabled: false,
      activeTool: { type: "selection" },
    });
  });

  test("scene.bounds maps getCommonBounds to {x,y,width,height}", async () => {
    const elements = [{ id: "a" }];
    const { helpers, resp } = await call("scene.bounds", { elements }, {
      api: makeApi({ getSceneElements: () => elements }),
      helpers: makeHelpers({ getCommonBounds: vi.fn(() => [10, 20, 110, 60] as [number, number, number, number]) }),
    });
    expect(helpers.getCommonBounds).toHaveBeenCalledWith(elements);
    expect(resp.result).toEqual({ x: 10, y: 20, width: 100, height: 40 });
  });

  test("scene.bounds defaults to live elements and rejects non-arrays", async () => {
    const elements = [{ id: "a" }];
    const { resp } = await call("scene.bounds", null, {
      api: makeApi({ getSceneElements: () => elements }),
    });
    expect(resp.result).toEqual({ x: 0, y: 0, width: 100, height: 50 });

    const bad = await call("scene.bounds", { elements: "nope" });
    expect(bad.resp.error?.code).toBe(-32602);
  });

  test("scene.exportPng calls the exportPng helper with mimeType/scale and returns {dataURL,width,height}", async () => {
    const elements = [{ id: "a" }];
    const files = {};
    const exportPng = vi.fn(async () => ({
      dataURL: "data:image/png;base64,QUJD",
      width: 200,
      height: 100,
    }));
    const { helpers, resp } = await call("scene.exportPng", { elements, mimeType: "image/png", scale: 2 }, {
      api: makeApi({ getSceneElements: () => elements, getFiles: () => files }),
      helpers: makeHelpers({ exportPng }),
    });
    expect(exportPng).toHaveBeenCalledWith(
      expect.objectContaining({ elements, mimeType: "image/png", scale: 2 }),
    );
    expect(resp.result).toEqual({ dataURL: "data:image/png;base64,QUJD", width: 200, height: 100 });
  });

  test("scene.exportSvg returns {svg}", async () => {
    const { resp } = await call("scene.exportSvg", null);
    expect(resp.result).toEqual({ svg: "<svg/>" });
  });
});

describe("canvas/v1 dispatcher — WRITE", () => {
  test("scene.update: passthrough elements, default captureUpdate NEVER, appState write-subset only", async () => {
    const elements = [{ id: "a", version: 7 }];
    const api = makeApi();
    const { resp } = await call("scene.update", { elements, appState: { viewBackgroundColor: "#000", collaborators: ["leak"], gridSize: 10 } }, { api });
    expect(api.updateScene).toHaveBeenCalledWith({
      elements,
      captureUpdate: "NEVER",
      appState: { viewBackgroundColor: "#000", gridSize: 10 }, // subset picked, collaborators dropped
    });
    expect(resp.result).toBeNull();
  });

  test("scene.update: explicit captureUpdate honored; unknown captureUpdate rejected", async () => {
    const api = makeApi();
    await call("scene.update", { elements: [], captureUpdate: "IMMEDIATELY" }, { api });
    expect(api.updateScene).toHaveBeenCalledWith({ elements: [], captureUpdate: "IMMEDIATELY" });

    const bad = await call("scene.update", { elements: [], captureUpdate: "SOMETIME" });
    expect(bad.resp.error?.code).toBe(-32602);
  });

  test("scene.update: empty patch rejected", async () => {
    const { resp } = await call("scene.update", {});
    expect(resp.error?.code).toBe(-32602);
  });

  test("elements.add: converts partials then concats with captureUpdate IMMEDIATELY", async () => {
    const existing = [{ id: "existing" }];
    const partial = { type: "rectangle", x: 0, y: 0, width: 10, height: 10 };
    const normalized = [{ id: "gen-1", ...partial }];
    const api = makeApi({ getSceneElements: () => existing });
    const helpers = makeHelpers({ convertToExcalidrawElements: vi.fn(() => normalized) });
    const { resp } = await call("elements.add", { elements: [partial] }, { api, helpers });
    expect(helpers.convertToExcalidrawElements).toHaveBeenCalledWith([partial]);
    expect(api.updateScene).toHaveBeenCalledWith({
      elements: [...existing, { id: "gen-1", groupIds: [], ...partial }], // render-safety normalize (freedraw crash fix)
      captureUpdate: "IMMEDIATELY",
    });
    expect(resp.result).toBeNull();
  });

  test("elements.add: normalizes groupIds-undefined output before updateScene (freedraw crash fix)", async () => {
    const api = makeApi();
    const raw = { type: "freedraw", id: "fd1", points: [[0, 0], [1, 1]] };
    const helpers = makeHelpers({
      convertToExcalidrawElements: vi.fn(() => [raw] as unknown[]),
    });
    const { resp } = await call("elements.add", { elements: [raw] }, { api, helpers });
    expect(resp.result).toBeNull();
    const pushed = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls[0][0].elements;
    expect(pushed).toHaveLength(1);
    expect(pushed[0].groupIds).toEqual([]);
    expect(pushed[0].pressures).toEqual([0.5, 0.5]);
    expect(pushed[0].simulatePressure).toBe(true);
  });

  test("elements.clear: wipes scene + fires onDestructive (non-blocking)", async () => {
    const api = makeApi();
    const onDestructive = vi.fn();
    const { resp } = await call("elements.clear", null, { api, onDestructive });
    expect(api.updateScene).toHaveBeenCalledWith({ elements: [], captureUpdate: "IMMEDIATELY" });
    expect(onDestructive).toHaveBeenCalledWith("elements.clear");
    expect(resp.error).toBeUndefined();
  });

  test("scene.reset: calls resetScene + fires onDestructive", async () => {
    const api = makeApi();
    const onDestructive = vi.fn();
    await call("scene.reset", null, { api, onDestructive });
    expect(api.resetScene).toHaveBeenCalled();
    expect(onDestructive).toHaveBeenCalledWith("scene.reset");
  });

  test("files.add: maps BinaryFileData; overwrite fires onDestructive", async () => {
    const api = makeApi({ getFiles: () => ({ img1: {} }) });
    const onDestructive = vi.fn();
    const files = [
      { id: "img1", mimeType: "image/png", dataURL: "data:image/png;base64,AA", created: 123 }, // overwrite
      { id: "img2", mimeType: "image/jpeg", dataURL: "data:image/jpeg;base64,BB" },
    ];
    await call("files.add", { files }, { api, onDestructive });
    expect(api.addFiles).toHaveBeenCalledWith(files);
    expect(onDestructive).toHaveBeenCalledWith("files.add");
  });

  test("files.add: new ids are NOT destructive", async () => {
    const api = makeApi({ getFiles: () => ({ other: {} }) });
    const onDestructive = vi.fn();
    await call("files.add", { files: [{ id: "new1", dataURL: "data:image/png;base64,AA" }] }, { api, onDestructive });
    expect(onDestructive).not.toHaveBeenCalled();
  });

  test("files.add: invalid file rejected", async () => {
    const { resp } = await call("files.add", { files: [{ id: "x" }] }); // no dataURL
    expect(resp.error?.code).toBe(-32602);
  });

  test("tool.setActive: passes {type, locked}; invalid type rejected", async () => {
    const api = makeApi();
    await call("tool.setActive", { type: "rectangle", locked: true }, { api });
    expect(api.setActiveTool).toHaveBeenCalledWith({ type: "rectangle", locked: true });

    const bad = await call("tool.setActive", { type: "nope" });
    expect(bad.resp.error?.code).toBe(-32602);
    expect(bad.api.setActiveTool).not.toHaveBeenCalled();
  });

  test("view.scrollTo: scrolls to given elements with fitToContent; defaults to live elements", async () => {
    const elements = [{ id: "a" }];
    const api = makeApi({ getSceneElements: () => elements });
    await call("view.scrollTo", { elements: [{ id: "b" }], fitToContent: true }, { api });
    expect(api.scrollToContent).toHaveBeenCalledWith([{ id: "b" }], { fitToContent: true });

    await call("view.scrollTo", null, { api });
    expect(api.scrollToContent).toHaveBeenCalledWith(elements, { fitToContent: false });
  });

  test("history.clear: clears undo stack + fires onDestructive", async () => {
    const api = makeApi();
    const onDestructive = vi.fn();
    await call("history.clear", null, { api, onDestructive });
    expect(api.history.clear).toHaveBeenCalled();
    expect(onDestructive).toHaveBeenCalledWith("history.clear");
  });
});

describe("canvas/v1 dispatcher — errors + meta", () => {
  test("unknown method → -32601 with the request id echoed", async () => {
    const resp = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: "abc", method: "canvas.read", params: {} },
      { api: makeApi(), helpers: makeHelpers() },
    );
    expect(resp.error?.code).toBe(-32601);
    expect(resp.id).toBe("abc");
  });

  test("non-2.0 jsonrpc → -32600", async () => {
    const resp = await handleCanvasV1Request(
      { jsonrpc: "1.0", id: 1, method: "scene.get", params: {} } as unknown as Parameters<
        typeof handleCanvasV1Request
      >[0],
      { api: makeApi(), helpers: makeHelpers() },
    );
    expect(resp.error?.code).toBe(-32600);
  });

  test("dispatcher never throws: a failing api surfaces an internal-error response", async () => {
    const resp = await handleCanvasV1Request(
      { jsonrpc: "2.0", id: 9, method: "scene.get", params: {} },
      { api: makeApi({ getSceneElements: () => { throw new Error("boom"); } }), helpers: makeHelpers() },
    );
    expect(resp.id).toBe(9);
    expect(resp.error?.code).toBe(-32603);
  });
});

describe("appState write-subset + base64 helpers", () => {
  test("pickAppStateWriteSubset keeps only the curated keys", () => {
    expect(
      pickAppStateWriteSubset({
        viewBackgroundColor: "#fff",
        gridSize: 20,
        viewModeEnabled: true,
        activeTool: { type: "arrow" },
        collaborators: ["x"],
        zoom: { value: 2 },
        unknownKey: 1,
      }),
    ).toEqual({
      viewBackgroundColor: "#fff",
      gridSize: 20,
      viewModeEnabled: true,
      activeTool: { type: "arrow" },
    });
  });

  test("bytesToBase64 encodes known bytes", () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3, 4]))).toBe("AQIDBA==");
  });

  test("blobToDataURL produces a data URL with the mime type", async () => {
    const url = await blobToDataURL(new Blob([new Uint8Array([1, 2, 3])]), "image/png");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(url).toBe("data:image/png;base64,AQID");
  });
});
