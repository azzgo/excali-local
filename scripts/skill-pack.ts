/**
 * skill-pack — build the excali-local skill's release assets (build products leave git).
 *
 * ADR 0012 ("CLI distribution: one canonical binary per machine, artifacts out of
 * git"): the daemon binaries are NOT committed and are NOT written into
 * `skills/excali-local/`. This script cross-compiles the Go daemon
 * (packages/bridge) for the target matrix, runs every quality gate, and stages
 * the verified binaries + `checksums.txt` into a staging directory OUTSIDE the
 * repository:
 *
 *   - `$EXCALI_SKILL_DIST_DIR` when set, else `<os temp dir>/excali-skill-dist`
 *
 * The staged files are the GitHub release assets. The skill tarball ships docs
 * only; the skill preflight fetches the platform binary on demand to the one
 * canonical path (`~/.local/bin/excali-bridge`, `%LOCALAPPDATA%\ExcaliLocal\bin\`
 * on Windows).
 *
 * Gates (all mandatory, none skippable):
 *  1. Cross-compile per target with CGO_ENABLED=0 -trimpath -buildvcs=false
 *     -ldflags="-s -w" (pure Go, cgo disabled, symbols stripped).
 *  2. `go build` AND `go vet` must both pass for every target, else the pack
 *     FAILS (cross-platform compile health is a first-class gate — this is the
 *     tripwire for any future Unix-only syscall regression like the
 *     pidfile/client ones folded into goal-5).
 *  3. Static-verify per target (file/ldd, objdump, otool|llvm-objdump)
 *     proving the dep-free story: linux fully static; windows imports only
 *     kernel32; darwin links only Apple system libraries. FAILS otherwise.
 *  4. Only after ALL gates pass: stage the verified binaries + `checksums.txt`
 *     into the staging dir and print that dir with each binary's sha256.
 *
 * Reproducibility (-buildvcs=false): Go 1.18+ stamps binaries with the
 * surrounding git repo's vcs.revision/time/modified by default, so two builds
 * of IDENTICAL source come out byte-different across commits or dirty state.
 * We pass -buildvcs=false so the 4 binaries are byte-reproducible: re-running
 * skill-pack leaves them unchanged unless the Go source actually changes.
 * Consequence: `go version -m <bin>` shows NO vcs.* lines — that is
 * intentional, NOT a bug. Do NOT drop -buildvcs=false to "add version info";
 * it would re-introduce non-idempotent binaries that dirty every commit.
 *
 * Nothing in this script writes inside the repository: the cross-compile scratch
 * lives in the OS temp dir and is cleaned up on exit, so a gate failure never
 * leaves a partial binary behind.
 *
 * Run: pnpm skill:pack
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import os from "node:os";
import { run as runCmd, hereDir } from "./_run";

const ROOT = join(hereDir(import.meta.url), "..");
const BRIDGE_DIR = join(ROOT, "packages/bridge");

const VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;

const TARGETS = [
  { os: "darwin", arch: "arm64", exe: "" },
  { os: "darwin", arch: "amd64", exe: "" },
  { os: "linux", arch: "amd64", exe: "" },
  { os: "windows", arch: "amd64", exe: ".exe" },
] as const;

type Target = (typeof TARGETS)[number];

interface BuiltTarget {
  target: Target;
  path: string;
  sizeBytes: number;
  sha256: string;
  verify: string;
}

const MACHO_OBJDMPS = [
  "llvm-objdump",
  "llvm-objdump-20",
  "llvm-objdump-19",
  "llvm-objdump-18",
  "llvm-objdump-17",
  "llvm-objdump-16",
  "llvm-objdump-15",
  "llvm-objdump-14",
];

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[skill-pack] FAIL — ${msg}`);
};
const ok = (msg: string) => console.log(`[skill-pack] ✓ ${msg}`);

const binName = (t: Target) => `excali-bridge-${t.os}-${t.arch}${t.exe}`;

const run = (cmd: string[], cwd: string, env: Record<string, string>) =>
  runCmd(cmd, { cwd, env: { ...(process.env as Record<string, string>), ...env } });

const sha256Of = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const linkedLibs = (out: string) =>
  out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(" ")[0])
    .filter(Boolean);

const machoLibs = (path: string): { libs: string[]; tool: string } | { error: string } => {
  const otool = run(["otool", "-L", path], ROOT, {});
  if (otool.code === 0) return { libs: linkedLibs(otool.out), tool: "otool -L" };
  for (const tool of MACHO_OBJDMPS) {
    const res = run([tool, "--macho", "--dylibs-used", path], ROOT, {});
    if (res.code === 0) return { libs: linkedLibs(res.out), tool: `${tool} --macho --dylibs-used` };
  }
  return { error: `no Mach-O dylib inspector available (otool, ${MACHO_OBJDMPS.join(", ")})` };
};

const verifyLinux = (path: string): { verify: string; error?: string } => {
  const file = run(["file", path], ROOT, {});
  if (/statically linked/i.test(file.out)) return { verify: "statically linked (file)" };
  const ldd = run(["ldd", path], ROOT, {});
  if (/not a dynamic executable|statically linked/i.test(ldd.out)) {
    return { verify: "statically linked (ldd)" };
  }
  return { error: `file said "${file.out.trim()}"` };
};

const verifyWindows = (path: string): { verify: string; error?: string } => {
  const objdump = run(["objdump", "-p", path], ROOT, {});
  if (objdump.code === 0) {
    const dlls = [...objdump.out.matchAll(/DLL Name:\s*([^\s]+)/g)].map((m) => m[1].toLowerCase());
    const bad = dlls.filter((d) => !["kernel32.dll"].includes(d));
    if (bad.length) return { error: `imports non-kernel32 DLLs: ${bad.join(", ")}` };
    return { verify: `imports only: ${[...new Set(dlls)].join(", ")}` };
  }
  const strings = run(["strings", "-a", path], ROOT, {});
  if (/msvcrt|vcruntime|ucrtbase|libgcc|libwinpthread/i.test(strings.out)) {
    return { error: "MSVC/libgcc/libwinpthread runtime strings present" };
  }
  return { verify: "no MSVC/libgcc/libwinpthread (strings scan)" };
};

const verifyDarwin = (path: string): { verify: string; error?: string } => {
  const macho = machoLibs(path);
  if ("error" in macho) return { error: macho.error };
  const nonApple = macho.libs.filter((l) => !l.startsWith("/usr/lib/") && !l.startsWith("/System/"));
  if (nonApple.length) return { error: `non-Apple libraries: ${nonApple.join(", ")}` };
  return { verify: `Apple system libs only (${macho.tool}): ${macho.libs.join(", ")}` };
};

const stageReleaseAssets = (built: BuiltTarget[], distDir: string) => {
  mkdirSync(distDir, { recursive: true });
  for (const b of built) {
    const dest = join(distDir, binName(b.target));
    rmSync(dest, { force: true });
    copyFileSync(b.path, dest);
    chmodSync(dest, 0o755);
  }
  const entries = built
    .map((b) => ({ name: binName(b.target), sha256: b.sha256 }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const checksums = join(distDir, "checksums.txt");
  rmSync(checksums, { force: true });
  writeFileSync(checksums, `${entries.map((e) => `${e.sha256}  ${e.name}`).join("\n")}\n`);
  return checksums;
};

const distDir = resolve(
  process.env.EXCALI_SKILL_DIST_DIR?.trim() || join(os.tmpdir(), "excali-skill-dist"),
);
const repoRel = relative(ROOT, distDir);
if (repoRel === "" || !repoRel.startsWith("..")) {
  console.error(
    `[skill-pack] FAIL — staging dir must live outside the repository (got ${distDir}); ` +
      `ADR 0012 keeps build products out of git`,
  );
  process.exit(1);
}

const built: BuiltTarget[] = [];
const scratch = mkdtempSync(join(os.tmpdir(), "skill-pack-"));

console.log(`[skill-pack] excali-local v${VERSION} — building ${TARGETS.length} targets`);
console.log(`[skill-pack] staging dir: ${distDir}`);

let exitCode = 0;
try {
  for (const t of TARGETS) {
    const name = binName(t);
    const outPath = join(scratch, name);

    const buildEnv = { CGO_ENABLED: "0", GOOS: t.os, GOARCH: t.arch };
    const build = run(
      ["go", "build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", "-o", outPath, "."],
      BRIDGE_DIR,
      buildEnv,
    );
    if (build.code !== 0) {
      fail(`build ${t.os}/${t.arch}:\n${build.out}`);
      continue;
    }
    ok(`go build ${t.os}/${t.arch} → ${name}`);

    const vet = run(["go", "vet", "./..."], BRIDGE_DIR, buildEnv);
    if (vet.code !== 0) {
      fail(`go vet ${t.os}/${t.arch}:\n${vet.out}`);
      continue;
    }
    ok(`go vet ${t.os}/${t.arch}`);

    const verified =
      t.os === "linux" ? verifyLinux(outPath) : t.os === "windows" ? verifyWindows(outPath) : verifyDarwin(outPath);
    if (verified.error) {
      fail(`${t.os} static-verify: ${verified.error}`);
      continue;
    }
    ok(`static ${t.os}/${t.arch}: ${verified.verify}`);

    built.push({
      target: t,
      path: outPath,
      sizeBytes: statSync(outPath).size,
      sha256: sha256Of(outPath),
      verify: verified.verify,
    });
  }

  if (failures > 0) {
    console.error(`[skill-pack] FAIL — ${failures} gate(s) failed; nothing staged.`);
    exitCode = 1;
  } else {
    const checksums = stageReleaseAssets(built, distDir);

    console.log(`\n[skill-pack] release assets staged in ${distDir}`);
    for (const b of built) {
      console.log(
        `  ${binName(b.target)}  ${(b.sizeBytes / (1024 * 1024)).toFixed(2)} MiB  sha256=${b.sha256}`,
      );
    }
    console.log(`  checksums.txt  ${checksums}`);
    console.log(
      `[skill-pack] PASS — excali-local v${VERSION} binaries staged outside the repo (ADR 0012) ✔`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);
