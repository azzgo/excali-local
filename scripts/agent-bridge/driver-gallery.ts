/**
 * AGENT BRIDGE — gallery/v1 e2e driver (Wayfinder Ticket 014, goal 3).
 *
 * Proves the full agent → daemon → (control page | active page) → gallery
 * dispatcher → daemon → agent round-trip against the REAL Go daemon:
 *
 *   agent side   — the CLI (`excali-bridge <method> '<json>'`, subcommand ==
 *                  method) drives every request
 *   daemon side  — real routing: canvas-bound (gallery.load/save) → active
 *                  slot; paired-only (list/get/rename/delete/collections.*) →
 *                  the active page when active, else a control page; identity
 *                  (per-profile uuid) tracked; bridge.status query
 *   page side    — two page-sims running the REAL gallery dispatcher
 *                  (lib/gallery-v1.ts) over an in-memory gallery store:
 *                  a CONTROL page (paired, never activated — no canvas) and
 *                  an ACTIVE page (holds the active slot, has a live scene)
 *
 * Loop exercised:
 *   - paired-only ops with NO canvas (via the control connection)
 *   - gate proof: gallery.save with no canvas → -32001 (never hangs)
 *   - load → save → rename → delete with a canvas (active page)
 *   - BLOCKING confirm path (auto-approve + auto-reject → -32005)
 *   - collections.create/list/rename/delete + member-rewrite count
 *   - metadata-only wire (no raw scene strings) + bridge.status identities
 *
 * Run:
 *   pnpm bridge:build
 *   tsx scripts/agent-bridge/driver-gallery.ts
 */

import { join } from "node:path";
import { mintBridgeToken, WS_ROLE_CONTROL_PAGE } from "excali-shared";
import { run, runAsync, hereDir } from "../_run";
import {
  AgentBridgeSession,
  type BridgeWs,
} from "../../packages/excali-page/src/features/editor/lib/agent-bridge-client";
import {
  handleGalleryV1Request,
  type GalleryV1Deps,
  type GalleryV1Request,
} from "../../packages/excali-page/src/features/editor/lib/gallery-v1";

const origin = process.env.ORIGIN ?? "chrome-extension://abcdabcdabcdabcdabcdabcdabcdabcd";
// Per-profile identity uuids (goal 3) — REQUIRED by the daemon for page roles.
const controlProfileId = "11111111-2222-4333-8444-555555555555";
const activeProfileId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const bin =
  process.env.EXCALI_BRIDGE_BIN ??
  join(hereDir(import.meta.url), "../../packages/excali-bridge/bin/excali-bridge");

const wsFactory = (url: string): BridgeWs =>
  new WebSocket(url, { headers: { Origin: origin } }) as unknown as BridgeWs;

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[driver-gallery] FAIL — ${msg}`);
};
const ok = (msg: string) => console.log(`[driver-gallery] ✓ ${msg}`);

// --- CLI helper: subcommand == method ---------------------------------------
const cli = async (method: string, params?: unknown): Promise<{ code: number; stdout: string; stderr: string }> => {
  const args = [bin, method];
  if (params !== undefined) args.push(JSON.stringify(params));
  // async spawn: node's spawnSync would freeze the event loop and starve the
  // page-sim's WebSocket delivery (bun's spawnSync did not)
  const r = await runAsync(args, { env: process.env });
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
};

const cliResult = async (method: string, params?: unknown): Promise<unknown> => {
  const r = await cli(method, params);
  if (r.code !== 0) {
    fail(`${method} exited ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`);
    return undefined;
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    fail(`${method} stdout not JSON: ${r.stdout.slice(0, 200)}`);
    return undefined;
  }
};

const cliError = async (method: string, params?: unknown): Promise<number | null> => {
  const r = await cli(method, params);
  const m = r.stderr.match(/rpc error (-?\d+)/);
  return m ? Number(m[1]) : null;
};

// --- in-memory gallery store (stands in for IndexedDB excali v2) ------------
interface StoreDrawing {
  id: string;
  name: string;
  elements: string;
  appState: string;
  files: string;
  thumbnail: string;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}
const store = {
  drawings: new Map<string, StoreDrawing>(),
  collections: new Map<string, { id: string; name: string; createdAt: number }>(),
};

const galleryDb: GalleryV1Deps["db"] = {
  getDrawings: async (collectionId?: string) =>
    [...store.drawings.values()]
      .filter((d) => !collectionId || d.collectionIds.includes(collectionId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((d) => ({
        id: d.id,
        name: d.name,
        thumbnail: d.thumbnail,
        collectionIds: d.collectionIds,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
  getDrawingFullData: async (id: string) => {
    const d = store.drawings.get(id);
    if (!d) throw new Error("Drawing not found");
    return { id: d.id, elements: d.elements, appState: d.appState, files: d.files };
  },
  getCollections: async () =>
    [...store.collections.values()].sort((a, b) => a.createdAt - b.createdAt),
  saveDrawing: async (drawing) => {
    store.drawings.set(drawing.id, { ...drawing } as StoreDrawing);
  },
  updateDrawing: async (id, updates) => {
    const d = store.drawings.get(id);
    if (d) store.drawings.set(id, { ...d, ...updates, updatedAt: Date.now() });
  },
  deleteDrawing: async (id) => {
    store.drawings.delete(id);
  },
  createCollection: async (c) => {
    store.collections.set(c.id, c);
  },
  updateCollection: async (id, updates) => {
    const c = store.collections.get(id);
    if (c) store.collections.set(id, { ...c, ...updates });
  },
  deleteCollectionAndReport: async (id) => {
    store.collections.delete(id);
    let affected = 0;
    for (const d of [...store.drawings.values()]) {
      if (d.collectionIds.includes(id)) {
        d.collectionIds = d.collectionIds.filter((cid) => cid !== id);
        affected += 1;
      }
    }
    return affected;
  },
};

// --- live scene for the ACTIVE page-sim --------------------------------------
const liveScene = {
  elements: [] as unknown[],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {} as Record<string, unknown>,
  loadedId: null as string | null,
};

let idCounter = 0;
const sceneDeps: GalleryV1Deps["scene"] = {
  getSceneElements: () => liveScene.elements,
  getAppState: () => liveScene.appState,
  getFiles: () => liveScene.files,
  loadDrawingToScene: (elements, appState, files) => {
    liveScene.elements = elements as unknown[];
    liveScene.appState = (appState ?? {}) as Record<string, unknown>;
    liveScene.files = (files ?? {}) as Record<string, unknown>;
  },
  generateThumbnail: async () => "data:image/webp;base64,drv-thumb",
  generateId: () => `nano-${++idCounter}`,
  onLoaded: (id) => {
    liveScene.loadedId = id;
  },
};

// --- page-sims: REAL dispatcher, scriptable confirm gate ----------------------
let confirmMode: "approve" | "reject" = "approve";
let controlSession: AgentBridgeSession | null = null;
let activeSession: AgentBridgeSession | null = null;

// The handler closes over the session VARIABLE (assigned after construction) so
// responses travel back over the live connection.
const makePageHandler = (deps: GalleryV1Deps, getSession: () => AgentBridgeSession | null) =>
  (msg: Record<string, unknown>) => {
    const m = msg as { type?: string; jsonrpc?: string; method?: string };
    if (m.type === "displaced") {
      getSession()?.stop(); // displaced control/active → stop (no reconnect loop)
      return;
    }
    if (m?.jsonrpc === "2.0" && typeof m.method === "string") {
      void handleGalleryV1Request(m as GalleryV1Request, deps).then((resp) =>
        getSession()?.sendJSON(resp),
      );
    }
  };

const controlDeps: GalleryV1Deps = {
  db: galleryDb,
  // no scene — a control page is NOT a canvas (paired-only ops never need one)
  onConfirm: async () => confirmMode === "approve",
};
const activeDeps: GalleryV1Deps = {
  db: galleryDb,
  scene: sceneDeps,
  onConfirm: async () => confirmMode === "approve",
};


const waitForConnected = (s: AgentBridgeSession) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    const check = () => {
      if (s.currentStatus === "connected") {
        clearTimeout(timer);
        resolve(true);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });

// --- bootstrap ---------------------------------------------------------------
console.log(`[driver-gallery] binary: ${bin}`);
if (!run(["test", "-x", bin]).ok) {
  console.error(`[driver-gallery] bridge binary not found — run \`pnpm bridge:build\` first`);
  process.exit(1);
}
const boot = run([bin, "ping"], { env: process.env });
if (boot.code !== 0) {
  console.error(`[driver-gallery] daemon bootstrap failed:\n${boot.stdout}\n${boot.stderr}`);
  process.exit(1);
}
ok(`daemon up (${boot.stdout.trim()})`);

// --- bridge.status with nothing connected ------------------------------------
const emptyStatus = await cliResult("bridge.status") as {
  activeCanvas: { profileId: string } | null;
  controlPages: Array<{ profileId: string }>;
};
if (!emptyStatus || emptyStatus.activeCanvas !== null || emptyStatus.controlPages.length !== 0) {
  fail(`bridge.status initial = ${JSON.stringify(emptyStatus)}`);
} else {
  ok("bridge.status: no active canvas, no control pages");
}

// --- paired-only ops with NO canvas (control connection) ----------------------
controlSession = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  role: WS_ROLE_CONTROL_PAGE,
  profileId: controlProfileId,
  wsFactory,
  onInbound: makePageHandler(controlDeps, () => controlSession),
});
controlSession.start();
if (!(await waitForConnected(controlSession))) {
  fail("control page-sim never connected");
  process.exit(1);
}
ok("control page-sim connected (paired, NOT activated)");

const st = await cliResult("bridge.status") as {
  activeCanvas: { profileId: string } | null;
  controlPages: Array<{ profileId: string }>;
};
if (st?.activeCanvas !== null || st?.controlPages?.[0]?.profileId !== controlProfileId) {
  fail(`bridge.status with control only = ${JSON.stringify(st)}`);
} else {
  ok("bridge.status: control identity tracked, still no active canvas");
}

const emptyList = await cliResult("gallery.list");
if (!Array.isArray(emptyList) || emptyList.length !== 0) {
  fail(`gallery.list (no canvas, empty store) = ${JSON.stringify(emptyList)}`);
} else {
  ok("gallery.list via CONTROL connection with NO canvas → [] (Gate 1 only)");
}

// --- gate proof: gallery.save is ACTIVATED — no canvas → -32001 ---------------
const saveGate = await cliError("gallery.save", { name: "Nope" });
if (saveGate !== -32001) {
  fail(`gallery.save with no canvas = ${saveGate}, want -32001 (never hangs)`);
} else {
  ok("gallery.save with no active canvas → -32001 (control pages don't satisfy ACTIVATED)");
}

// --- collections.* via control ------------------------------------------------
const coll = await cliResult("gallery.collections.create", { name: "Work" }) as {
  id: string;
  name: string;
};
if (!coll?.id || coll.name !== "Work") {
  fail(`collections.create = ${JSON.stringify(coll)}`);
} else {
  ok(`collections.create → fresh uuid ${coll.id.slice(0, 8)}… (non-idempotent)`);
}
const coll2 = await cliResult("gallery.collections.create", { name: "Work" }) as { id: string };
if (coll2?.id === coll.id) {
  fail("collections.create must mint a fresh uuid each call");
} else {
  ok("collections.create non-idempotent (two calls → two uuids)");
}
const colls = await cliResult("gallery.collections.list") as Array<{ id: string; name: string }>;
if (!Array.isArray(colls) || colls.length !== 2) {
  fail(`collections.list = ${JSON.stringify(colls)}`);
} else {
  ok("collections.list → 2 collections");
}

// --- ACTIVE page joins --------------------------------------------------------
activeSession = new AgentBridgeSession({
  origin,
  token: mintBridgeToken(),
  profileId: activeProfileId,
  wsFactory,
  onInbound: makePageHandler(activeDeps, () => activeSession),
});
activeSession.start();
if (!(await waitForConnected(activeSession))) {
  fail("active page-sim never connected");
  process.exit(1);
}
ok("active page-sim connected (holds the active slot)");

const st2 = await cliResult("bridge.status") as {
  activeCanvas: { profileId: string } | null;
  controlPages: Array<{ profileId: string }>;
};
if (st2?.activeCanvas?.profileId !== activeProfileId) {
  fail(`bridge.status activeCanvas = ${JSON.stringify(st2?.activeCanvas)}`);
} else {
  ok("bridge.status: daemon knows the active canvas's extension identity");
}

// --- gallery.save (create) on the ACTIVE page ----------------------------------
liveScene.elements = [{ id: "el-1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }];
const saved = await cliResult("gallery.save", { name: "Scene A" }) as { id: string; isNew: boolean };
if (!saved?.id || saved.isNew !== true) {
  fail(`gallery.save create = ${JSON.stringify(saved)}`);
} else {
  ok(`gallery.save (create) → {id: ${saved.id.slice(0, 8)}…, isNew: true} — non-blocking`);
}

// --- gallery.list now prefers the ACTIVE page; metadata only -------------------
const list1 = await cliResult("gallery.list") as Array<Record<string, unknown>>;
if (!Array.isArray(list1) || list1.length !== 1 || list1[0].id !== saved.id) {
  fail(`gallery.list after save = ${JSON.stringify(list1)}`);
} else {
  const wire = JSON.stringify(list1);
  if (wire.includes("el-1") || wire.includes("rectangle")) {
    fail("gallery.list leaked raw scene data on the wire");
  } else {
    ok("gallery.list → 1 drawing, metadata+ids only (no scene strings)");
  }
}

// --- gallery.load → scene replace ----------------------------------------------
const loaded = await cliResult("gallery.load", { id: saved.id }) as { id: string; name: string };
if (loaded?.id !== saved.id || loaded.name !== "Scene A") {
  fail(`gallery.load = ${JSON.stringify(loaded)}`);
} else {
  if (liveScene.loadedId !== saved.id) {
    fail(`onLoaded not fired for ${saved.id}`);
  } else {
    ok("gallery.load → getDrawingFullData→parse→loadDrawingToScene→onLoaded (in-page)");
  }
}

// --- gallery.save (overwrite existing) → BLOCKING confirm path -----------------
liveScene.elements = [
  { id: "el-1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
  { id: "el-2", type: "ellipse", x: 5, y: 5, width: 3, height: 3 },
];
const overwritten = await cliResult("gallery.save", { id: saved.id }) as { id: string; isNew: boolean };
if (overwritten?.id !== saved.id || overwritten.isNew !== false) {
  fail(`gallery.save overwrite = ${JSON.stringify(overwritten)}`);
} else {
  ok("gallery.save (overwrite existing) → {id, isNew:false} — BLOCKING confirm auto-approved");
}

// --- gallery.rename (BLOCKING) -------------------------------------------------
const renamed = await cliResult("gallery.rename", { id: saved.id, name: "Scene B" }) as {
  id: string;
  name: string;
};
if (renamed?.name !== "Scene B") {
  fail(`gallery.rename = ${JSON.stringify(renamed)}`);
} else {
  ok("gallery.rename → {id, name} — BLOCKING confirm auto-approved");
}

// --- collections.delete rewrites member drawings --------------------------------
const inColl = await cliResult("gallery.save", {
  id: saved.id,
  name: "Scene B",
  collectionIds: [coll.id],
}) as { id: string };
if (!inColl?.id) fail(`attach collection failed: ${JSON.stringify(inColl)}`);
const collDel = await cliResult("gallery.collections.delete", { id: coll.id }) as {
  id: string;
  affectedDrawings: number;
};
if (collDel?.affectedDrawings !== 1) {
  fail(`collections.delete affectedDrawings = ${JSON.stringify(collDel)}`);
} else {
  ok("collections.delete → member drawing rewritten (affectedDrawings: 1)");
}
const collsAfter = await cliResult("gallery.collections.list") as Array<{ id: string }>;
if (!Array.isArray(collsAfter) || collsAfter.length !== 1) {
  fail(`collections.list after delete = ${JSON.stringify(collsAfter)}`);
} else {
  ok("collections.list after delete → 1 remaining");
}

// --- gallery.delete (BLOCKING) + cancel path ------------------------------------
confirmMode = "reject";
const cancelled = await cli("gallery.delete", { id: saved.id });
if (cancelled.code === 0 || !cancelled.stderr.includes("-32005")) {
  fail(`gallery.delete with user reject = code=${cancelled.code} ${cancelled.stderr.trim()}`);
} else {
  ok("gallery.delete rejected on the confirm modal → -32005 'cancelled by user'");
}
const stillThere = await cliResult("gallery.get", { id: saved.id }) as { id: string };
if (stillThere?.id !== saved.id) {
  fail(`drawing should survive a cancelled delete: ${JSON.stringify(stillThere)}`);
} else {
  ok("cancelled delete did not touch the drawing");
}

confirmMode = "approve";
const deleted = await cliResult("gallery.delete", { id: saved.id }) as { id: string; deleted: boolean };
if (deleted?.deleted !== true) {
  fail(`gallery.delete = ${JSON.stringify(deleted)}`);
} else {
  ok("gallery.delete → {id, deleted:true} — BLOCKING confirm auto-approved");
}
const afterDelete = await cliResult("gallery.list");
if (!Array.isArray(afterDelete) || afterDelete.length !== 0) {
  fail(`gallery.list after delete = ${JSON.stringify(afterDelete)}`);
} else {
  ok("gallery.list after delete → []");
}

// --- teardown + summary --------------------------------------------------------
activeSession.stop();
controlSession.stop();
await new Promise((r) => setTimeout(r, 300));
const stFinal = await cliResult("bridge.status") as {
  activeCanvas: { profileId: string } | null;
  controlPages: Array<{ profileId: string }>;
};
if (stFinal?.activeCanvas !== null || stFinal?.controlPages?.length !== 0) {
  fail(`bridge.status after teardown = ${JSON.stringify(stFinal)}`);
} else {
  ok("bridge.status after teardown → empty");
}

console.log(
  failures === 0
    ? "[driver-gallery] PASS — gallery/v1 round-trip ✔"
    : `[driver-gallery] FAIL — ${failures} assertion(s)`,
);
process.exit(failures > 0 ? 1 : 0);
