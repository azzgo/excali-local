/**
 * presence-pack — build the excali-presence tray binaries as release assets.
 *
 * ADR 0014 ("Presence is the face of the bridge daemon") scopes the tray build
 * matrix at launch to macOS (aarch64 + x86_64) and Linux (x86_64). Windows is a
 * placeholder — welcome-PR until a maintainer with a Windows machine picks it up.
 *
 * Like skill-pack, the tray binaries are build products that leave git
 * (ADR 0012): they are staged OUTSIDE the repository, next to the Go daemon
 * assets, and appended to the same `checksums.txt`:
 *
 *   - `$EXCALI_SKILL_DIST_DIR` when set, else `<os temp dir>/excali-skill-dist`
 *
 * Asset names: `excali-presence-<os>-<arch>` (`.exe` for the Windows placeholder
 * once it exists). Version comparison is never by filename (ADR 0012 decision 4),
 * so the name only has to be stable, not semver-stamped.
 *
 * Targets that cannot be built on the current machine (macOS cannot cross-build
 * a gtk/x11 Linux tray without a sysroot; Linux cannot cross-build a Mach-O
 * bundle at all) are SKIPPED with a WARN by default — the matrix structure is
 * the deliverable, CI builds each target on its native runner. Pass `--strict`
 * to turn a skip into a failure (used by the per-target CI matrix job).
 *
 * Run: pnpm presence:pack            (all targets, lenient)
 *      pnpm presence:pack --target x86_64-unknown-linux-gnu --strict
 * Invoked by skill-pack after the Go assets are staged.
 */

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import os from "node:os";
import { run as runCmd, hereDir } from "./_run";

const ROOT = join(hereDir(import.meta.url), "..");
const PRESENCE_DIR = join(ROOT, "packages/presence");

interface Target {
  os: "macos" | "linux";
  arch: "aarch64" | "x86_64";
  triple: string;
  exe: "";
}

// ADR 0014 build matrix. Windows is deliberately absent:
// TODO(windows): add `{ os: "windows", arch: "x86_64", triple: "x86_64-pc-windows-msvc", exe: ".exe" }`
// — welcome PR (no maintainer Windows machine).
const TARGETS: Target[] = [
  { os: "macos", arch: "aarch64", triple: "aarch64-apple-darwin", exe: "" },
  { os: "macos", arch: "x86_64", triple: "x86_64-apple-darwin", exe: "" },
  { os: "linux", arch: "x86_64", triple: "x86_64-unknown-linux-gnu", exe: "" },
];

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const only = (() => {
  const i = args.indexOf("--target");
  return i >= 0 ? args[i + 1] : undefined;
})();

const selected = only ? TARGETS.filter((t) => t.triple === only) : TARGETS;
if (only && selected.length === 0) {
  console.error(`[presence-pack] FAIL — unknown target ${only} (known: ${TARGETS.map((t) => t.triple).join(", ")})`);
  process.exit(1);
}

const binName = (t: Target) => `excali-presence-${t.os}-${t.arch}${t.exe}`;
const sha256Of = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const run = (cmd: string[], cwd: string, env: Record<string, string> = {}) =>
  runCmd(cmd, { cwd, env: { ...(process.env as Record<string, string>), ...env } });

const ok = (msg: string) => console.log(`[presence-pack] ✓ ${msg}`);
const warn = (msg: string) => console.warn(`[presence-pack] WARN — ${msg}`);
const fail = (msg: string) => console.error(`[presence-pack] FAIL — ${msg}`);

const expectedFile = (t: Target): RegExp =>
  t.os === "macos"
    ? new RegExp(`Mach-O 64-bit executable ${t.arch === "aarch64" ? "arm64" : "x86_64"}`)
    : /ELF 64-bit LSB.*x86-64/;

const verifyBinary = (t: Target, path: string): string | undefined => {
  const file = run(["file", path], ROOT);
  if (file.code !== 0) return `file(1) unavailable: ${file.out.trim()}`;
  if (!expectedFile(t).test(file.out)) return `unexpected binary type: ${file.out.trim()}`;
  return undefined;
};

const writeChecksums = (distDir: string, entries: { name: string; sha256: string }[]) => {
  const path = join(distDir, "checksums.txt");
  const merged = new Map<string, string>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (m) merged.set(m[2], m[1]);
    }
  }
  for (const e of entries) merged.set(e.name, e.sha256);
  const lines = [...merged.entries()]
    .map(([name, sha256]) => ({ name, sha256 }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.name}`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
};

const distDir = resolve(
  process.env.EXCALI_SKILL_DIST_DIR?.trim() || join(os.tmpdir(), "excali-skill-dist"),
);
const repoRel = relative(ROOT, distDir);
if (repoRel === "" || !repoRel.startsWith("..")) {
  console.error(
    `[presence-pack] FAIL — staging dir must live outside the repository (got ${distDir}); ` +
      `ADR 0012 keeps build products out of git`,
  );
  process.exit(1);
}

const cargo = run(["cargo", "--version"], ROOT);
if (cargo.code !== 0) {
  warn(`cargo not available — skipping ${selected.length} presence target(s): ${cargo.out.trim()}`);
  process.exit(strict ? 1 : 0);
}

const scratch = mkdtempSync(join(os.tmpdir(), "presence-pack-"));
const built: { target: Target; path: string; sizeBytes: number; sha256: string }[] = [];
const skipped: { target: Target; reason: string }[] = [];

console.log(`[presence-pack] building ${selected.length} target(s) — staging dir: ${distDir}`);

try {
  for (const t of selected) {
    const name = binName(t);
    const targetDir = join(scratch, t.triple);

    const build = run(
      ["cargo", "build", "--release", "--target", t.triple],
      PRESENCE_DIR,
      { CARGO_TARGET_DIR: targetDir },
    );
    if (build.code !== 0) {
      const reason = `cargo build ${t.triple} failed`;
      if (strict) {
        fail(`${reason}:\n${build.out}`);
      } else {
        warn(`${reason} — skipping this target (build it on its native runner / CI):\n${build.out.trim().split("\n").slice(-5).join("\n")}`);
      }
      skipped.push({ target: t, reason });
      continue;
    }
    ok(`cargo build ${t.triple} → ${name}`);

    const outPath = join(targetDir, t.triple, "release", `excali-presence${t.exe}`);
    if (!existsSync(outPath)) {
      const reason = `cargo reported success but ${outPath} is missing`;
      if (strict) fail(reason);
      else warn(`${reason} — skipping ${t.triple}`);
      skipped.push({ target: t, reason });
      continue;
    }

    const bad = verifyBinary(t, outPath);
    if (bad) {
      const reason = `static-verify ${t.triple}: ${bad}`;
      if (strict) fail(reason);
      else warn(`${reason} — skipping ${t.triple}`);
      skipped.push({ target: t, reason });
      continue;
    }
    ok(`static ${t.triple}: ${t.os} ${t.arch}`);

    built.push({ target: t, path: outPath, sizeBytes: statSync(outPath).size, sha256: sha256Of(outPath) });
  }

  if (built.length > 0) {
    mkdirSync(distDir, { recursive: true });
    for (const b of built) {
      const dest = join(distDir, binName(b.target));
      rmSync(dest, { force: true });
      copyFileSync(b.path, dest);
      chmodSync(dest, 0o755);
    }
    const checksums = writeChecksums(
      distDir,
      built.map((b) => ({ name: binName(b.target), sha256: b.sha256 })),
    );

    console.log(`\n[presence-pack] release assets staged in ${distDir}`);
    for (const b of built) {
      console.log(
        `  ${binName(b.target)}  ${(b.sizeBytes / (1024 * 1024)).toFixed(2)} MiB  sha256=${b.sha256}`,
      );
    }
    console.log(`  checksums.txt  ${checksums}`);
  }

  if (skipped.length > 0) {
    console.log(
      `[presence-pack] skipped ${skipped.length} target(s): ${skipped.map((s) => s.target.triple).join(", ")}`,
    );
  }

  const allSkipped = built.length === 0 && skipped.length > 0;
  if (allSkipped || (strict && skipped.length > 0)) {
    console.error(`[presence-pack] FAIL — no usable presence assets were produced.`);
    process.exit(1);
  }
  console.log(`[presence-pack] PASS — ${built.length} presence asset(s) staged outside the repo (ADR 0014) ✔`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
