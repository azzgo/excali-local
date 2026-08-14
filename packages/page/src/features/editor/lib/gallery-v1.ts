/**
 * gallery/v1 — page-side JSON-RPC dispatcher (Wayfinder Ticket 014).
 *
 * PURE module: no React, no browser globals, no excalidraw imports. The
 * IndexedDB access (db) and the canvas-bound scene helpers (scene) are
 * INJECTED, so this exact code runs in the page hook (browser), in vitest,
 * and in the Bun e2e driver.
 *
 * Method inventory (EXACT names per Ticket 014):
 *   PAIRED (no canvas needed): gallery.list / gallery.get / gallery.rename /
 *          gallery.delete / gallery.collections.list / .create / .rename / .delete
 *   ACTIVATED (canvas-bound):  gallery.load / gallery.save
 *
 * Wire-payload principle: metadata + ids ONLY — never raw elements/appState/
 * files strings. load parses + pushes to the canvas internally; save captures
 * the live scene and generates the thumbnail IN-PAGE.
 *
 * Confirm tiers (013/014): gallery.delete / gallery.rename /
 * gallery.collections.delete / gallery.collections.rename / save-overwrite are
 * BLOCKING — the dispatcher awaits deps.onConfirm (a page-side UX gate) and
 * returns -32005 when rejected. The protocol layer stays non-blocking: the
 * daemon's timeout still bounds worst case, so routing can never deadlock.
 * Reads / load / save-create / collections.create auto-apply.
 */

/** Reuse canvas/v1's codes (mirror excali-shared / Go contract). */
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const JSON_RPC_ERROR_CANVAS_NOT_READY = -32001;
/** Blocking gallery op rejected by the user on the page's confirm modal. */
export const JSON_RPC_ERROR_USER_CANCELLED = -32005;
/** gallery.get / load referenced a drawing id that does not exist. */
export const JSON_RPC_ERROR_NOT_FOUND = -32006;

export interface GalleryV1Request {
  jsonrpc: "2.0";
  id: unknown;
  method: string;
  params?: unknown;
}

export interface GalleryV1Response {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** DrawingMetadata — the list-card view. NO heavy scene fields on the wire. */
export interface GalleryDrawingMetadata {
  id: string;
  name: string;
  thumbnail: string;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GalleryCollection {
  id: string;
  name: string;
  createdAt: number;
}

/**
 * Injected IndexedDB access — 1:1 with `features/editor/utils/indexdb.ts` so
 * the hook can wire the real module functions directly.
 */
export interface GalleryV1Db {
  /** Metadata sorted updatedAt desc; collectionId filters via the index. */
  getDrawings(collectionId?: string): Promise<GalleryDrawingMetadata[]>;
  getDrawingFullData(
    id: string,
  ): Promise<{ id: string; elements: string; appState: string; files: string }>;
  getCollections(): Promise<GalleryCollection[]>;
  saveDrawing(drawing: {
    id: string;
    name: string;
    elements: string;
    appState: string;
    files: string;
    thumbnail: string;
    collectionIds: string[];
    createdAt: number;
    updatedAt: number;
  }): Promise<void>;
  updateDrawing(
    id: string,
    updates: {
      name?: string;
      elements?: string;
      appState?: string;
      files?: string;
      thumbnail?: string;
      collectionIds?: string[];
    },
  ): Promise<void>;
  deleteDrawing(id: string): Promise<void>;
  createCollection(collection: GalleryCollection): Promise<void>;
  updateCollection(id: string, updates: { name?: string }): Promise<void>;
  /**
   * Delete a collection AND rewrite every member drawing to strip the id
   * (reuses the useDrawingCrud.deleteCollection loop). Returns the number of
   * member drawings rewritten.
   */
  deleteCollectionAndReport(id: string): Promise<number>;
}

/** Canvas-bound scene access — only needed by load/save (ACTIVATED). */
export interface GalleryV1Scene {
  getSceneElements(): readonly unknown[];
  getAppState(): Record<string, unknown>;
  getFiles(): Record<string, unknown> | null | undefined;
  /** updateScene + addFiles (excalidraw-api.helper.loadDrawingToScene). */
  loadDrawingToScene(
    elements: readonly unknown[],
    appState: unknown,
    files: unknown,
  ): void;
  /** In-page thumbnail generation — the agent never sends one (014). */
  generateThumbnail(
    elements: readonly unknown[],
    files: Record<string, unknown>,
  ): Promise<string>;
  /** nanoid — fresh id for save-create (id absent). */
  generateId(): string;
  /** Fired after load so the UI's currentLoadedDrawingId tracks the scene. */
  onLoaded?(id: string): void;
}

export interface GalleryV1Deps {
  db: GalleryV1Db;
  /** Required only for gallery.load/save (ACTIVATED). */
  scene?: GalleryV1Scene;
  /**
   * Page-side UX gate for BLOCKING ops (delete/rename/collections.delete/
   * collections.rename/save-overwrite). Resolve true = proceed; false =
   * respond -32005 "cancelled by user". Absent gate = auto-reject (safe).
   */
  onConfirm?: (info: { method: string; params: Record<string, unknown> }) => Promise<boolean>;
  /**
   * Fired once after EVERY successful gallery write (save-create, save-overwrite,
   * rename, delete, collections.create/rename/delete) so the UI can refresh live.
   * NEVER called on reads (list/get/load/collections.list) and never on a
   * cancelled blocking confirm (-32005) — those throw before any write. Best-effort:
   * a throwing callback must not fail the RPC.
   */
  onGalleryMutated?: () => void;
}

class GalleryV1Error extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

const invalidParams = (message: string): never => {
  throw new GalleryV1Error(JSON_RPC_INVALID_PARAMS, message);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function asRecord(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (isRecord(params)) return params;
  invalidParams("params must be an object");
  throw new Error("unreachable");
}

async function requireScene(deps: GalleryV1Deps): Promise<GalleryV1Scene> {
  if (!deps.scene) {
    throw new GalleryV1Error(
      JSON_RPC_ERROR_CANVAS_NOT_READY,
      "canvas not ready (load/save need the active canvas)",
    );
  }
  return deps.scene;
}

async function confirmGate(
  deps: GalleryV1Deps,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (!deps.onConfirm) {
    throw new GalleryV1Error(JSON_RPC_ERROR_USER_CANCELLED, "cancelled by user (no confirm gate)");
  }
  const ok = await deps.onConfirm({ method, params });
  if (!ok) throw new GalleryV1Error(JSON_RPC_ERROR_USER_CANCELLED, "cancelled by user");
}

/** Best-effort write signal — a throwing callback must never fail the RPC. */
function notifyMutated(deps: GalleryV1Deps): void {
  try {
    deps.onGalleryMutated?.();
  } catch {
    // ignore — the write already succeeded; the UI refresh is best-effort.
  }
}

/** Dispatch one gallery/v1 request; never throws (errors → error response). */
export async function handleGalleryV1Request(
  req: GalleryV1Request,
  deps: GalleryV1Deps,
): Promise<GalleryV1Response> {
  if (req.jsonrpc !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: JSON_RPC_INVALID_REQUEST, message: "invalid request" },
    };
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

async function dispatch(
  method: string,
  params: unknown,
  deps: GalleryV1Deps,
): Promise<unknown> {
  switch (method) {
    // ---------------- PAIRED reads ----------------
    case "gallery.list": {
      const p = asRecord(params);
      const collectionId =
        typeof p.collectionId === "string" && p.collectionId !== ""
          ? p.collectionId
          : undefined;
      let drawings = await deps.db.getDrawings(collectionId);
      if (typeof p.nameContains === "string" && p.nameContains !== "") {
        const needle = p.nameContains.toLowerCase();
        drawings = drawings.filter((d) => d.name.toLowerCase().includes(needle));
      }
      const includeThumbnail = p.includeThumbnail === true;
      // Metadata-only wire: strip the (potentially large) thumbnail by default.
      return includeThumbnail
        ? drawings
        : drawings.map((d) => ({ ...d, thumbnail: "" }));
    }

    case "gallery.get": {
      const p = asRecord(params);
      if (typeof p.id !== "string" || !p.id) invalidParams("gallery.get: id is required");
      const drawings = await deps.db.getDrawings();
      const found = drawings.find((d) => d.id === p.id);
      if (!found) throw new GalleryV1Error(JSON_RPC_ERROR_NOT_FOUND, "drawing not found");
      return found;
    }

    case "gallery.collections.list":
      return deps.db.getCollections();

    // ---------------- PAIRED writes (BLOCKING confirm, 013/014) ----------------
    case "gallery.rename": {
      const p = asRecord(params);
      if (typeof p.id !== "string" || !p.id) invalidParams("gallery.rename: id is required");
      const id = p.id as string;
      if (typeof p.name !== "string" || !p.name) invalidParams("gallery.rename: name is required");
      const name = p.name as string;
      await confirmGate(deps, method, p);
      const drawings = await deps.db.getDrawings();
      if (!drawings.some((d) => d.id === id)) {
        throw new GalleryV1Error(JSON_RPC_ERROR_NOT_FOUND, "drawing not found");
      }
      await deps.db.updateDrawing(id, { name });
      notifyMutated(deps);
      return { id, name };
    }

    case "gallery.delete": {
      const p = asRecord(params);
      if (typeof p.id !== "string" || !p.id) invalidParams("gallery.delete: id is required");
      const id = p.id as string;
      await confirmGate(deps, method, p);
      await deps.db.deleteDrawing(id);
      notifyMutated(deps);
      return { id, deleted: true };
    }

    case "gallery.collections.create": {
      const p = asRecord(params);
      if (typeof p.name !== "string" || !p.name) {
        invalidParams("gallery.collections.create: name is required");
      }
      const name = p.name as string;
      // Fresh uuid each call — NON-idempotent by design (014; follow-up: key).
      const collection: GalleryCollection = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
      };
      await deps.db.createCollection(collection);
      notifyMutated(deps);
      return collection;
    }

    case "gallery.collections.rename": {
      const p = asRecord(params);
      if (typeof p.id !== "string" || !p.id) {
        invalidParams("gallery.collections.rename: id is required");
      }
      const id = p.id as string;
      if (typeof p.name !== "string" || !p.name) {
        invalidParams("gallery.collections.rename: name is required");
      }
      const name = p.name as string;
      await confirmGate(deps, method, p);
      const collections = await deps.db.getCollections();
      const found = collections.find((c) => c.id === id);
      if (!found) throw new GalleryV1Error(JSON_RPC_ERROR_NOT_FOUND, "collection not found");
      await deps.db.updateCollection(id, { name });
      notifyMutated(deps);
      return { id: found.id, name, createdAt: found.createdAt };
    }

    case "gallery.collections.delete": {
      const p = asRecord(params);
      if (typeof p.id !== "string" || !p.id) {
        invalidParams("gallery.collections.delete: id is required");
      }
      const id = p.id as string;
      await confirmGate(deps, method, p);
      // Rewrites every member drawing to strip the id; reports the count.
      const affectedDrawings = await deps.db.deleteCollectionAndReport(id);
      notifyMutated(deps);
      return { id, affectedDrawings };
    }

    // ---------------- ACTIVATED (canvas-bound, Ticket 014 gates) ----------------
    case "gallery.load": {
      const p = asRecord(params);
      if (typeof p.id !== "string" || !p.id) invalidParams("gallery.load: id is required");
      const id = p.id as string;
      const scene = await requireScene(deps);
      const drawings = await deps.db.getDrawings();
      const found = drawings.find((d) => d.id === id);
      if (!found) throw new GalleryV1Error(JSON_RPC_ERROR_NOT_FOUND, "drawing not found");
      const full = await deps.db.getDrawingFullData(id);
      const elements = JSON.parse(full.elements);
      const appState = JSON.parse(full.appState);
      const files = JSON.parse(full.files);
      scene.loadDrawingToScene(elements, appState, files);
      scene.onLoaded?.(id);
      return { id: found.id, name: found.name };
    }

    case "gallery.save": {
      const p = asRecord(params);
      const scene = await requireScene(deps);
      const elements = scene.getSceneElements();
      const files = scene.getFiles() ?? {};
      const appState = scene.getAppState();
      const thumbnail = await scene.generateThumbnail(elements, files);
      const now = Date.now();

      const paramId = typeof p.id === "string" && p.id !== "" ? p.id : undefined;
      if (paramId) {
        const drawings = await deps.db.getDrawings();
        const existing = drawings.find((d) => d.id === paramId);
        if (existing) {
          // Overwrite-existing → BLOCKING (destroys the stored version, 014).
          await confirmGate(deps, method, p);
          const collectionIds = Array.isArray(p.collectionIds)
            ? (p.collectionIds as unknown[]).filter((c): c is string => typeof c === "string")
            : existing.collectionIds;
          await deps.db.updateDrawing(paramId, {
            name: typeof p.name === "string" && p.name !== "" ? p.name : existing.name,
            elements: JSON.stringify(elements),
            appState: JSON.stringify(appState),
            files: JSON.stringify(files),
            thumbnail,
            collectionIds,
          });
          notifyMutated(deps);
          return { id: paramId, isNew: false };
        }
      }

      // Create-new (non-blocking, additive). id present but missing → upsert
      // with that id (deterministic); id absent → nanoid create.
      const id = paramId ?? scene.generateId();
      const name =
        typeof p.name === "string" && p.name !== ""
          ? p.name
          : `Drawing ${new Date(now).toLocaleString()}`;
      const collectionIds = Array.isArray(p.collectionIds)
        ? (p.collectionIds as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      await deps.db.saveDrawing({
        id,
        name,
        elements: JSON.stringify(elements),
        appState: JSON.stringify(appState),
        files: JSON.stringify(files),
        thumbnail,
        collectionIds,
        createdAt: now,
        updatedAt: now,
      });
      notifyMutated(deps);
      return { id, isNew: true };
    }

    default:
      throw new GalleryV1Error(JSON_RPC_METHOD_NOT_FOUND, "method not found");
  }
}
