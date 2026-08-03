import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  handleGalleryV1Request,
  type GalleryV1Deps,
  type GalleryV1Request,
} from "@/features/editor/lib/gallery-v1";

// ---------------------------------------------------------------------------
// Fakes: a metadata store + scene doubles, so every method → the right db/scene
// call + payload mapping + confirm tier is observable.
// ---------------------------------------------------------------------------

interface FakeDrawing {
  id: string;
  name: string;
  thumbnail: string;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
  elements?: string;
  appState?: string;
  files?: string;
}

function makeDeps(overrides: Partial<GalleryV1Deps> = {}): {
  deps: GalleryV1Deps;
  db: Record<string, ReturnType<typeof vi.fn>>;
  scene: Record<string, ReturnType<typeof vi.fn>>;
  store: FakeDrawing[];
} {
  const store: FakeDrawing[] = [];
  const dbFns = {
    getDrawings: vi.fn(async (collectionId?: string) =>
      store
        .filter((d) => !collectionId || d.collectionIds?.includes(collectionId))
        .map((d) => ({
          id: d.id,
          name: d.name,
          thumbnail: d.thumbnail,
          collectionIds: d.collectionIds,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        }))
        // Real indexdb getDrawings() sorts updatedAt desc (014).
        .sort((a, b) => b.updatedAt - a.updatedAt),
    ),
    getDrawingFullData: vi.fn(async (id: string) => {
      const d = store.find((x) => x.id === id);
      if (!d) throw new Error("Drawing not found");
      return { id: d.id, elements: d.elements!, appState: d.appState!, files: d.files! };
    }),
    getCollections: vi.fn(async () => []),
    saveDrawing: vi.fn(async () => {}),
    updateDrawing: vi.fn(async () => {}),
    deleteDrawing: vi.fn(async () => {}),
    createCollection: vi.fn(async () => {}),
    updateCollection: vi.fn(async () => {}),
    deleteCollectionAndReport: vi.fn(async () => 0),
  };
  const sceneFns = {
    getSceneElements: vi.fn(() => [{ id: "live-1", type: "rectangle" }]),
    getAppState: vi.fn(() => ({ viewBackgroundColor: "#fff" })),
    getFiles: vi.fn(() => ({ file1: { mimeType: "image/png" } })),
    loadDrawingToScene: vi.fn(),
    generateThumbnail: vi.fn(async () => "data:image/webp;base64,thumb"),
    generateId: vi.fn(() => "nano-new-id"),
    onLoaded: vi.fn(),
  };
  const deps: GalleryV1Deps = {
    db: dbFns,
    scene: sceneFns,
    onConfirm: vi.fn(async () => true),
    ...overrides,
  };
  return { deps, db: dbFns, scene: sceneFns, store };
}

const addDrawing = (
  store: FakeDrawing[],
  d: Partial<FakeDrawing> & { id: string },
) => {
  store.push({
    name: "Test Drawing",
    thumbnail: "data:image/webp;base64,old",
    collectionIds: [],
    createdAt: 1000,
    updatedAt: 2000,
    elements: "[{\"id\":\"el-1\"}]",
    appState: "{\"viewBackgroundColor\":\"#000\"}",
    files: "{\"f1\":{}}",
    ...d,
  });
};

const call = (deps: GalleryV1Deps, method: string, params?: unknown, id = 1) =>
  handleGalleryV1Request({ jsonrpc: "2.0", id, method, params } as GalleryV1Request, deps);

const okResult = async (resp: Awaited<ReturnType<typeof handleGalleryV1Request>>) => {
  expect(resp.error).toBeUndefined();
  return resp.result;
};

describe("gallery/v1 dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("gallery.list", () => {
    test("returns metadata updatedAt desc; no scene strings on the wire", async () => {
      const { deps, store } = makeDeps();
      addDrawing(store, { id: "a", name: "Older", updatedAt: 100, thumbnail: "thumb-a" });
      addDrawing(store, { id: "b", name: "Newer", updatedAt: 900, thumbnail: "thumb-b" });

      const result = await okResult(await call(deps, "gallery.list", {}));
      const list = result as Array<{ id: string; name: string }>;
      expect(list.map((d) => d.id)).toEqual(["b", "a"]); // db sorts; dispatcher preserves
      expect(list[0]).toMatchObject({ id: "b", name: "Newer" });
      // includeThumbnail=false default → thumbnail stripped (small payload)
      expect((list[0] as { thumbnail: string }).thumbnail).toBe("");
      // NEVER raw scene strings
      expect(JSON.stringify(result)).not.toContain("el-1");
    });

    test("includeThumbnail=true keeps thumbnails", async () => {
      const { deps, store } = makeDeps();
      addDrawing(store, { id: "a", thumbnail: "thumb-a" });
      const result = await okResult(await call(deps, "gallery.list", { includeThumbnail: true }));
      expect((result as Array<{ thumbnail: string }>)[0].thumbnail).toBe("thumb-a");
    });

    test("collectionId + nameContains filters", async () => {
      const { deps, db, store } = makeDeps();
      addDrawing(store, { id: "a", name: "Work Diagram", collectionIds: ["c1"] });
      addDrawing(store, { id: "b", name: "Personal Sketch", collectionIds: ["c2"] });

      const byCollection = await okResult(await call(deps, "gallery.list", { collectionId: "c2" }));
      expect((byCollection as Array<{ id: string }>).map((d) => d.id)).toEqual(["b"]);
      expect(db.getDrawings).toHaveBeenCalledWith("c2");

      const byName = await okResult(await call(deps, "gallery.list", { nameContains: "work" }));
      expect((byName as Array<{ id: string }>).map((d) => d.id)).toEqual(["a"]);
    });

    test("confirm tier: non-blocking (no onConfirm call)", async () => {
      const { deps, store } = makeDeps();
      addDrawing(store, { id: "a" });
      await call(deps, "gallery.list", {});
      expect(deps.onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("gallery.get", () => {
    test("returns one DrawingMetadata (with thumbnail)", async () => {
      const { deps, store } = makeDeps();
      addDrawing(store, { id: "a", name: "Found", thumbnail: "thumb-a" });
      const result = await okResult(await call(deps, "gallery.get", { id: "a" }));
      expect(result).toMatchObject({ id: "a", name: "Found", thumbnail: "thumb-a" });
    });

    test("missing id → -32006 not found", async () => {
      const { deps } = makeDeps();
      const resp = await call(deps, "gallery.get", { id: "nope" });
      expect(resp.error?.code).toBe(-32006);
    });

    test("missing params id → -32602", async () => {
      const { deps } = makeDeps();
      const resp = await call(deps, "gallery.get", {});
      expect(resp.error?.code).toBe(-32602);
    });
  });

  describe("gallery.load (ACTIVATED)", () => {
    test("getDrawingFullData → parse → loadDrawingToScene → onLoaded; returns {id,name}", async () => {
      const { deps, db, scene, store } = makeDeps();
      addDrawing(store, { id: "a", name: "Stored", updatedAt: 3000 });

      const result = await okResult(await call(deps, "gallery.load", { id: "a" }));
      expect(db.getDrawingFullData).toHaveBeenCalledWith("a");
      expect(scene.loadDrawingToScene).toHaveBeenCalledWith(
        [{ id: "el-1" }],
        { viewBackgroundColor: "#000" },
        { f1: {} },
      );
      expect(scene.onLoaded).toHaveBeenCalledWith("a");
      expect(result).toEqual({ id: "a", name: "Stored" });
      // Non-blocking: no confirm gate.
      expect(deps.onConfirm).not.toHaveBeenCalled();
    });

    test("missing drawing → -32006", async () => {
      const { deps } = makeDeps();
      const resp = await call(deps, "gallery.load", { id: "nope" });
      expect(resp.error?.code).toBe(-32006);
    });

    test("no scene (not activated) → -32001 canvas not ready", async () => {
      const { deps, store } = makeDeps({ scene: undefined });
      addDrawing(store, { id: "a" });
      const resp = await call(deps, "gallery.load", { id: "a" });
      expect(resp.error?.code).toBe(-32001);
    });
  });

  describe("gallery.save (ACTIVATED, upsert by id)", () => {
    test("create-new (id absent) → nanoid, non-blocking, thumbnail in-page", async () => {
      const { deps, db, scene, store } = makeDeps();
      const result = await okResult(await call(deps, "gallery.save", { name: "New" }));
      expect(scene.getSceneElements).toHaveBeenCalled();
      expect(scene.generateThumbnail).toHaveBeenCalled();
      expect(db.saveDrawing).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "nano-new-id",
          name: "New",
          thumbnail: "data:image/webp;base64,thumb",
          elements: JSON.stringify([{ id: "live-1", type: "rectangle" }]),
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      );
      expect(result).toEqual({ id: "nano-new-id", isNew: true });
      expect(deps.onConfirm).not.toHaveBeenCalled();
      // Wire response carries ids/metadata only — never raw scene strings.
      expect(JSON.stringify(result)).not.toContain("live-1");
    });

    test("create-new with an id that does NOT exist → upsert with that id (deterministic)", async () => {
      const { deps, db } = makeDeps();
      const result = await okResult(await call(deps, "gallery.save", { id: "provided-id", name: "N" }));
      expect(db.saveDrawing).toHaveBeenCalledWith(expect.objectContaining({ id: "provided-id" }));
      expect(result).toEqual({ id: "provided-id", isNew: true });
    });

    test("overwrite-existing → BLOCKING confirm, then updateDrawing, isNew=false", async () => {
      const { deps, db, store } = makeDeps();
      addDrawing(store, { id: "a", name: "Stored" });
      const onConfirm = deps.onConfirm as ReturnType<typeof vi.fn>;

      const result = await okResult(await call(deps, "gallery.save", { id: "a" }));
      expect(onConfirm).toHaveBeenCalledWith({
        method: "gallery.save",
        params: { id: "a" },
      });
      expect(db.updateDrawing).toHaveBeenCalledWith(
        "a",
        expect.objectContaining({ name: "Stored", thumbnail: "data:image/webp;base64,thumb" }),
      );
      expect(result).toEqual({ id: "a", isNew: false });
    });

    test("overwrite rejected by the user → -32005 cancelled", async () => {
      const { deps, db, store } = makeDeps({ onConfirm: vi.fn(async () => false) });
      addDrawing(store, { id: "a" });
      const resp = await call(deps, "gallery.save", { id: "a" });
      expect(resp.error?.code).toBe(-32005);
      expect(db.updateDrawing).not.toHaveBeenCalled();
    });

    test("no scene → -32001", async () => {
      const { deps } = makeDeps({ scene: undefined });
      const resp = await call(deps, "gallery.save", {});
      expect(resp.error?.code).toBe(-32001);
    });
  });

  describe("gallery.rename (PAIRED, BLOCKING)", () => {
    test("confirm gate → updateDrawing → {id,name}", async () => {
      const { deps, db, store } = makeDeps();
      addDrawing(store, { id: "a" });
      const result = await okResult(await call(deps, "gallery.rename", { id: "a", name: "Renamed" }));
      expect(deps.onConfirm).toHaveBeenCalledWith({ method: "gallery.rename", params: { id: "a", name: "Renamed" } });
      expect(db.updateDrawing).toHaveBeenCalledWith("a", { name: "Renamed" });
      expect(result).toEqual({ id: "a", name: "Renamed" });
    });

    test("rejected → -32005", async () => {
      const { deps, store } = makeDeps({ onConfirm: vi.fn(async () => false) });
      addDrawing(store, { id: "a" });
      const resp = await call(deps, "gallery.rename", { id: "a", name: "X" });
      expect(resp.error?.code).toBe(-32005);
    });

    test("missing drawing → -32006", async () => {
      const { deps } = makeDeps();
      const resp = await call(deps, "gallery.rename", { id: "nope", name: "X" });
      expect(resp.error?.code).toBe(-32006);
    });
  });

  describe("gallery.delete (PAIRED, BLOCKING)", () => {
    test("confirm gate → deleteDrawing → {id, deleted:true}", async () => {
      const { deps, db } = makeDeps();
      const result = await okResult(await call(deps, "gallery.delete", { id: "a" }));
      expect(deps.onConfirm).toHaveBeenCalledWith({ method: "gallery.delete", params: { id: "a" } });
      expect(db.deleteDrawing).toHaveBeenCalledWith("a");
      expect(result).toEqual({ id: "a", deleted: true });
    });

    test("no onConfirm gate → auto-reject -32005 (never hangs)", async () => {
      const { deps, db } = makeDeps({ onConfirm: undefined });
      const resp = await call(deps, "gallery.delete", { id: "a" });
      expect(resp.error?.code).toBe(-32005);
      expect(db.deleteDrawing).not.toHaveBeenCalled();
    });
  });

  describe("gallery.collections.*", () => {
    test("list → getCollections (non-blocking)", async () => {
      const { deps, db } = makeDeps();
      const result = await okResult(await call(deps, "gallery.collections.list", {}));
      expect(db.getCollections).toHaveBeenCalled();
      expect(deps.onConfirm).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    test("create → fresh uuid each call (non-idempotent), non-blocking", async () => {
      const { deps, db } = makeDeps();
      const result = await okResult(await call(deps, "gallery.collections.create", { name: "Work" }));
      expect(db.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Work", id: expect.any(String), createdAt: expect.any(Number) }),
      );
      expect(result).toMatchObject({ name: "Work" });
      expect(deps.onConfirm).not.toHaveBeenCalled();
      // two calls produce different ids (documented non-idempotency, 014)
      const second = await okResult(await call(deps, "gallery.collections.create", { name: "Work" }, 2));
      expect((result as { id: string }).id).not.toBe((second as { id: string }).id);
    });

    test("rename → BLOCKING confirm → updateCollection → Collection", async () => {
      const { deps, db } = makeDeps();
      db.getCollections.mockResolvedValueOnce([{ id: "c1", name: "Old", createdAt: 5 }]);
      const result = await okResult(await call(deps, "gallery.collections.rename", { id: "c1", name: "New" }));
      expect(deps.onConfirm).toHaveBeenCalledWith({
        method: "gallery.collections.rename",
        params: { id: "c1", name: "New" },
      });
      expect(db.updateCollection).toHaveBeenCalledWith("c1", { name: "New" });
      expect(result).toEqual({ id: "c1", name: "New", createdAt: 5 });
    });

    test("rename missing collection → -32006", async () => {
      const { deps } = makeDeps();
      const resp = await call(deps, "gallery.collections.rename", { id: "nope", name: "X" });
      expect(resp.error?.code).toBe(-32006);
    });

    test("delete → BLOCKING confirm → member rewrite → affectedDrawings", async () => {
      const { deps, db } = makeDeps();
      db.deleteCollectionAndReport.mockResolvedValueOnce(3);
      const result = await okResult(await call(deps, "gallery.collections.delete", { id: "c1" }));
      expect(deps.onConfirm).toHaveBeenCalledWith({
        method: "gallery.collections.delete",
        params: { id: "c1" },
      });
      expect(db.deleteCollectionAndReport).toHaveBeenCalledWith("c1");
      expect(result).toEqual({ id: "c1", affectedDrawings: 3 });
    });
  });

  describe("error mapping", () => {
    test("non-2.0 jsonrpc → -32600", async () => {
      const { deps } = makeDeps();
      const resp = await handleGalleryV1Request(
        { jsonrpc: "1.0", id: 1, method: "gallery.list" } as GalleryV1Request,
        deps,
      );
      expect(resp.error?.code).toBe(-32600);
    });

    test("unknown method → -32601", async () => {
      const { deps } = makeDeps();
      const resp = await call(deps, "gallery.bogus", {});
      expect(resp.error?.code).toBe(-32601);
    });

    test("invalid params shape → -32602", async () => {
      const { deps } = makeDeps();
      const resp = await call(deps, "gallery.list", "not-an-object");
      expect(resp.error?.code).toBe(-32602);
    });
  });
});
