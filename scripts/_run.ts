/**
 * _run — Bun-runtime compatibility shim for the pnpm+tsx migration.
 * Replaces `import.meta.dir`, `Bun.spawnSync` (+ `.exitCode`/`.success`),
 * and the `$` shell tag used across scripts/.
 *
 * NOTE on sync vs async: node's `spawnSync` FREEZES the event loop, so any
 * WS-message delivery in the same process (the driver page-sims) stalls while
 * a sync CLI call is in flight. Bun's spawnSync did not. Use `runAsync` for
 * CLI calls that must interleave with an active WebSocket session.
 */
import { spawn, spawnSync, type SpawnOptions, type SpawnSyncOptions } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RunResult {
  code: number;       // <- node's `status` (NOT bun's `exitCode`)
  ok: boolean;        // <- replaces bun's `.success`
  stdout: string;     // string (encoding:"utf8"), never null
  stderr: string;
  out: string;        // stdout + stderr
}

export function run(cmd: string[], opts: SpawnSyncOptions = {}): RunResult {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, // go build/vet output can exceed node's 1MB default
    ...opts,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { code: r.status ?? -1, ok: r.status === 0, stdout, stderr, out: `${stdout}${stderr}` };
}

/** Async variant of `run` — keeps the event loop free so same-process
 * WebSocket callbacks (the driver page-sims) keep firing mid-command. */
export function runAsync(cmd: string[], opts: SpawnOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { ...opts });
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => (stdout += String(d)));
    p.stderr?.on("data", (d) => (stderr += String(d)));
    p.on("close", (code) =>
      resolve({ code: code ?? -1, ok: code === 0, stdout, stderr, out: `${stdout}${stderr}` }),
    );
  });
}

/** Replaces bun's `import.meta.dir`. Use: `hereDir(import.meta.url)` */
export function hereDir(metaUrl: string): string {
  return dirname(fileURLToPath(metaUrl));
}
