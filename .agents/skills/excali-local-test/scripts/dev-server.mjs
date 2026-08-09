#!/usr/bin/env node
/**
 * excali-local-test — dev-server supervisor (start | status | stop)
 *
 * Owns the wxt dev server as a supervised background job. The supervisor
 * process holds wxt's stdin pipe open — wxt exits when its stdin closes, so
 * the supervisor is also the lifecycle guard: if the supervisor dies, wxt
 * dies too (no orphans), and `stop` = SIGTERM the supervisor.
 *
 * Only the wxt dev server is owned here. The excali-bridge daemon (machine
 * wide, ~/.excali-local/bridge.pid) and the chrome-devtools MCP browser are
 * intentionally left alone.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  openSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUNTIME = path.join(SKILL_ROOT, ".excali-test");
const SUPERVISOR_PID = path.join(RUNTIME, "supervisor.pid");
const WXT_PID = path.join(RUNTIME, "wxt.pid");
const WXT_LOG = path.join(RUNTIME, "wxt.log");
const SUP_LOG = path.join(RUNTIME, "supervisor.log");
const CONFIG_PATH = path.join(RUNTIME, "wxt.test.config.ts");
const EXT_ID_FILE = path.join(RUNTIME, "extension-id.txt");
const TEMPLATE = path.join(SKILL_ROOT, "templates", "wxt.test.config.ts.tpl");
const DEV_PORT = 3000;
const READY_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------- utilities

const log = (...a) => {
  console.log(`[excali-test] ${a.join(" ")}`);
};
const die = (code, ...a) => {
  log(...a);
  process.exit(code);
};

const isAlive = (pid) => {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const readPid = (file) => {
  try { return parseInt(readFileSync(file, "utf8").trim(), 10); } catch { return 0; }
};

const removePids = () => {
  for (const f of [SUPERVISOR_PID, WXT_PID]) { try { rmSync(f); } catch {} }
};

const tryConnect = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port }, () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
// vite binds localhost on ::1 (IPv6 loopback); 127.0.0.1 alone misses it.
// Try IPv4 first, then IPv6 — sequential, no race.
const portOpen = async (port) => (await tryConnect("127.0.0.1", port)) || (await tryConnect("::1", port));


const newestMtime = (dir, best = 0) => {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return best; }
  for (const e of entries) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (e.isDirectory()) best = newestMtime(p, Math.max(best, st.mtimeMs));
    else best = Math.max(best, st.mtimeMs);
  }
  return best;
};

// -------------------------------------------------------------- repo root

function resolveRepoRoot() {
  const flagIdx = process.argv.indexOf("--root");
  const root = flagIdx >= 0 ? process.argv[flagIdx + 1] : process.env.EXCALI_REPO_ROOT ?? process.cwd();
  const abs = path.resolve(root);
  let pkg;
  try { pkg = JSON.parse(readFileSync(path.join(abs, "package.json"), "utf8")); } catch { pkg = null; }
  const valid = pkg?.name === "excali" && existsSync(path.join(abs, "packages/excali-local/wxt.config.ts"));
  return valid ? abs : null;
}

// ---------------------------------------------------------------- spawning

let wxtChild = null;

function killWxt(graceMs = 3000) {
  const pid = wxtChild?.pid ?? readPid(WXT_PID);
  if (!isAlive(pid)) return;
  log(`stopping wxt (pid ${pid})`);
  try { process.kill(pid, "SIGTERM"); } catch {}
  const deadline = Date.now() + graceMs;
  const t = setInterval(() => {
    if (!isAlive(pid) || Date.now() > deadline) {
      clearInterval(t);
      if (isAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} log("wxt force-killed"); }
      else log("wxt stopped");
      removePids();
    }
  }, 200);
}

async function materializeConfig(repoRoot) {
  const tpl = readFileSync(TEMPLATE, "utf8");
  const config = tpl.replaceAll("__REPO_ROOT__", repoRoot.replace(/\/+$/, ""));
  writeFileSync(CONFIG_PATH, config);
  return CONFIG_PATH;
}

// ------------------------------------------------------------------ start

async function cmdStart() {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) die(1, `not an excali-local repo root (cwd=${process.cwd()}, use --root <path> or EXCALI_REPO_ROOT)`);
  log(`repo root: ${repoRoot}`);

  // Already running? (idempotent)
  const supPid = readPid(SUPERVISOR_PID);
  if (isAlive(supPid) && isAlive(readPid(WXT_PID))) {
    log(`already running (supervisor pid ${supPid}) — reuse it, or run "stop" first`);
    return;
  }
  // Stale state → clean
  if (supPid || readPid(WXT_PID)) {
    log("stale supervisor state detected, cleaning");
    const oldWxt = readPid(WXT_PID);
    if (isAlive(oldWxt)) { try { process.kill(oldWxt, "SIGKILL"); } catch {} }
    removePids();
  }
  mkdirSync(RUNTIME, { recursive: true });

  // Port 3000 must be free (wxt dev uses strictPort; page:dev also wants it)
  if (await portOpen(DEV_PORT)) {
    die(1, `port ${DEV_PORT} is already in use — stop "pnpm page:dev" or another "pnpm local:dev" first`);
  }

  const pkgDir = path.join(repoRoot, "packages/excali-local");
  // node_modules present?
  if (!existsSync(path.join(repoRoot, "node_modules")) && !existsSync(path.join(pkgDir, "node_modules"))) {
    log("node_modules missing — running `pnpm install` (first run only)");
    await new Promise((res) => {
      const p = spawn("pnpm", ["install"], { cwd: repoRoot, stdio: "inherit" });
      p.on("exit", (c) => { if (c !== 0) die(1, "pnpm install failed"); res(); });
    });
  }

  // Editor artifact (public/editor) — rebuild when the page source is newer
  const editorHtml = path.join(pkgDir, "public/editor/index.html");
  const pageSrc = path.join(repoRoot, "packages/excali-page/src");
  if (!existsSync(editorHtml) || newestMtime(pageSrc) > statSync(editorHtml).mtimeMs) {
    log("running `pnpm page:build` (editor artifact)");
    await new Promise((res) => {
      const p = spawn("pnpm", ["page:build"], { cwd: repoRoot, stdio: "inherit" });
      p.on("exit", (c) => { if (c !== 0) die(1, "pnpm page:build failed"); res(); });
    });
  } else {
    log("editor artifact fresh — skipping page:build");
  }

  // Materialize the dev-only wxt config (absolute imports, browser disabled)
  const configFile = await materializeConfig(repoRoot);

  // Spawn wxt. CRITICAL: stdio[0] must stay an open pipe — wxt exits when
  // stdin closes (readline on process.stdin). The supervisor holds it.
  const wxtCli = path.join(pkgDir, "node_modules/wxt/dist/cli/index.mjs");
  if (!existsSync(wxtCli)) die(1, `wxt CLI not found at ${wxtCli} — run pnpm install`);
  const outFd = openSync(WXT_LOG, "a");
  writeFileSync(WXT_LOG, `\n=== wxt started ${new Date().toISOString()} ===\n`, { flag: "a" });
  wxtChild = spawn(process.execPath, [wxtCli, "-c", configFile], {
    cwd: pkgDir,
    stdio: ["pipe", outFd, outFd],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  writeFileSync(SUPERVISOR_PID, String(process.pid));
  writeFileSync(WXT_PID, String(wxtChild.pid));
  log(`wxt dev starting (pid ${wxtChild.pid}) — log: ${WXT_LOG}`);

  // Signal wiring: stop = terminate the supervisor
  process.on("SIGTERM", () => { log("received SIGTERM — stopping wxt"); killWxt(); setTimeout(() => process.exit(0), 3500); });
  process.on("SIGINT", () => { log("received SIGINT — stopping wxt"); killWxt(); setTimeout(() => process.exit(0), 3500); });
  wxtChild.on("exit", (code) => {
    log(`wxt exited (code ${code})`);
    removePids();
    process.exit(0);
  });
  wxtChild.on("error", (err) => { log(`failed to spawn wxt: ${err.message}`); removePids(); process.exit(1); });

  // Readiness: poll the dev server until it answers, then check the build
  const outdir = path.join(pkgDir, ".output/chrome-mv3-dev/manifest.json");
  const startTs = Date.now();
  for (;;) {
    if (wxtChild.exitCode !== null) die(1, "wxt exited before becoming ready — see " + WXT_LOG);
    if (await portOpen(DEV_PORT)) {
      if (existsSync(outdir) && statSync(outdir).mtimeMs >= startTs - 5_000) break;
      // build may still be writing the manifest; give it a moment
      await new Promise((r) => setTimeout(r, 1500));
      if (existsSync(outdir) && statSync(outdir).mtimeMs >= startTs - 5_000) break;
    }
    if (Date.now() - startTs > READY_TIMEOUT_MS) die(1, `timed out waiting for dev server on :${DEV_PORT} — see ${WXT_LOG}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  log("ready");
  log(`dev-server: http://127.0.0.1:${DEV_PORT}`);
  log(`extension-outdir: ${path.dirname(outdir)}`);
  log("next: CDP-install that outdir via chrome-devtools MCP install_extension, record the id, open the editor page, activate the canvas — see references/");
  // stay alive as supervisor
}

// ----------------------------------------------------------------- status

async function cmdStatus() {
  const supPid = readPid(SUPERVISOR_PID);
  const wxtPid = readPid(WXT_PID);
  const repoRoot = resolveRepoRoot();
  console.log(`supervisor.pid: ${supPid} (${isAlive(supPid) ? "alive" : "dead"})`);
  console.log(`wxt.pid: ${wxtPid} (${isAlive(wxtPid) ? "alive" : "dead"})`);
  console.log(`port ${DEV_PORT}: ${(await portOpen(DEV_PORT)) ? "open" : "closed"}`);
  if (repoRoot) {
    const outdir = path.join(repoRoot, "packages/excali-local/.output/chrome-mv3-dev/manifest.json");
    if (existsSync(outdir)) {
      const fresh = Date.now() - statSync(outdir).mtimeMs < 10 * 60_000;
      console.log(`dev-build: ${new Date(statSync(outdir).mtime).toISOString()} (${fresh ? "fresh" : "STALE"})`);
    } else console.log("dev-build: missing");
    console.log(`editor-artifact: ${existsSync(path.join(repoRoot, "packages/excali-local/public/editor/index.html")) ? "present" : "MISSING"}`);
  } else {
    console.log("repo root: not resolvable from cwd (use --root)");
  }
  console.log(`extension-id: ${existsSync(EXT_ID_FILE) ? readFileSync(EXT_ID_FILE, "utf8").trim() : "(not recorded)"}`);
  console.log(`wxt log: ${WXT_LOG}`);
}

// ------------------------------------------------------------------- stop

async function cmdStop() {
  const supPid = readPid(SUPERVISOR_PID);
  const wxtPid = readPid(WXT_PID);
  if (isAlive(supPid)) {
    console.log(`[excali-test] stopping supervisor (pid ${supPid})`);
    try { process.kill(supPid, "SIGTERM"); } catch {}
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && isAlive(supPid)) await new Promise((r) => setTimeout(r, 200));
  }
  if (isAlive(wxtPid)) {
    console.log(`[excali-test] stopping wxt directly (pid ${wxtPid})`);
    try { process.kill(wxtPid, "SIGTERM"); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    if (isAlive(wxtPid)) { try { process.kill(wxtPid, "SIGKILL"); } catch {} }
  }
  removePids();
  console.log("[excali-test] stopped — wxt dev server terminated (bridge daemon & MCP browser left running)");
}

// ------------------------------------------------------------------- main

const cmd = process.argv[2] ?? "status";
if (cmd === "start") cmdStart();
else if (cmd === "status") cmdStatus();
else if (cmd === "stop") cmdStop();
else {
  console.log("usage: node dev-server.mjs start|status|stop [--root <repo>]");
  process.exit(1);
}
