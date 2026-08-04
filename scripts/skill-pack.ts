#!/usr/bin/env bun
/**
 * skill-pack — build the distributable excali-draw skill folder.
 *
 * 1. Cross-compiles the Go daemon (packages/excali-bridge) for the target
 *    matrix with CGO_ENABLED=0 -trimpath -ldflags="-s -w" (pure Go, cgo
 *    disabled, symbols stripped).
 * 2. Mandatory per-target gates: `go build` AND `go vet` must both pass for
 *    every target, else the pack FAILS (cross-platform compile health is a
 *    first-class gate — this is the tripwire for any future Unix-only
 *    syscall regression like the pidfile/client ones folded into goal-5).
 * 3. Mandatory static-verify per target (file/objdump/otool) proving the
 *    dep-free story: linux fully static; windows imports only kernel32;
 *    darwin links only Apple system libraries. FAILS otherwise.
 * 4. Assembles .skill-dist/excali-draw/ (SKILL.md + README.md + references/
 *    + bin/excali-bridge-<os>-<arch>[.exe]) and records the actual
 *    per-binary + archive sizes in the skill README.
 * 5. Produces a versioned archive: .skill-dist/excali-draw-<version>.tar.gz.
 *
 * Run: bun scripts/skill-pack.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BRIDGE_DIR = join(ROOT, "packages/excali-bridge");
const SKILL_DIR = join(ROOT, "skills/excali-draw");
const DIST = join(ROOT, ".skill-dist");
const SKILL_NAME = "excali-draw";

const VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;

const TARGETS = [
  { os: "darwin", arch: "arm64", exe: "" },
  { os: "darwin", arch: "amd64", exe: "" },
  { os: "linux", arch: "amd64", exe: "" },
  { os: "windows", arch: "amd64", exe: ".exe" },
] as const;

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[skill-pack] FAIL — ${msg}`);
};
const ok = (msg: string) => console.log(`[skill-pack] ✓ ${msg}`);

const binName = (t: (typeof TARGETS)[number]) =>
  `excali-bridge-${t.os}-${t.arch}${t.exe}`;

const run = (cmd: string[], cwd: string, env: Record<string, string>): { code: number; out: string } => {
  const res = Bun.spawnSync(cmd, { cwd, env: { ...process.env as Record<string, string>, ...env } });
  return { code: res.exitCode ?? -1, out: `${res.stdout?.toString() ?? ""}${res.stderr?.toString() ?? ""}` };
};

// ---------------------------------------------------------------------------
// 1-3. build + vet + static-verify per target
// ---------------------------------------------------------------------------
interface BuiltTarget {
  target: (typeof TARGETS)[number];
  path: string;
  sizeBytes: number;
  verify: string;
}

const built: BuiltTarget[] = [];

// Scratch area for the built binaries lives under .skill-dist/bin during the
// build phase and is renamed into the assembled folder afterwards.
rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, "bin"), { recursive: true });

console.log(`[skill-pack] excali-draw v${VERSION} — building ${TARGETS.length} targets`);
for (const t of TARGETS) {
  const name = binName(t);
  const outPath = join(DIST, "bin", name);

  const buildEnv = { CGO_ENABLED: "0", GOOS: t.os, GOARCH: t.arch };
  const build = run(
    ["go", "build", "-trimpath", "-ldflags=-s -w", "-o", outPath, "."],
    BRIDGE_DIR,
    buildEnv,
  );
  if (build.code !== 0) {
    fail(`build ${t.os}/${t.arch}:\n${build.out}`);
    continue;
  }
  ok(`go build ${t.os}/${t.arch} → bin/${name}`);

  const vet = run(["go", "vet", "./..."], BRIDGE_DIR, buildEnv);
  if (vet.code !== 0) {
    fail(`go vet ${t.os}/${t.arch}:\n${vet.out}`);
    continue;
  }
  ok(`go vet ${t.os}/${t.arch}`);

  // ---- static-verify ------------------------------------------------------
  let verify = "";
  if (t.os === "linux") {
    const file = run(["file", outPath], ROOT, {});
    if (!/statically linked/i.test(file.out)) {
      // fallback: ldd (not present on macOS hosts) must say "not a dynamic executable"
      const ldd = run(["ldd", outPath], ROOT, {});
      if (!/not a dynamic executable|statically linked/i.test(ldd.out)) {
        fail(`linux static-verify: file said "${file.out.trim()}"`);
        continue;
      }
    }
    verify = "statically linked (file)";
    ok(`static ${t.os}/${t.arch}: statically linked`);
  } else if (t.os === "windows") {
    const objdump = run(["objdump", "-p", outPath], ROOT, {});
    if (objdump.code === 0) {
      const dlls = [...objdump.out.matchAll(/DLL Name:\s*([^\s]+)/g)].map((m) => m[1].toLowerCase());
      const bad = dlls.filter((d) => !["kernel32.dll"].includes(d));
      if (bad.length) {
        fail(`windows static-verify: imports non-kernel32 DLLs: ${bad.join(", ")}`);
        continue;
      }
      verify = `imports only: ${[...new Set(dlls)].join(", ")}`;
    } else {
      // objdump unavailable — string-scan for forbidden runtime DLLs.
      const strings = run(["strings", "-a", outPath], ROOT, {});
      const forbidden = /msvcrt|vcruntime|ucrtbase|libgcc|libwinpthread/i.test(strings.out);
      if (forbidden) {
        fail("windows static-verify: MSVC/libgcc/libwinpthread runtime strings present");
        continue;
      }
      verify = "no MSVC/libgcc/libwinpthread (strings scan)";
    }
    ok(`static ${t.os}/${t.arch}: ${verify}`);
  } else {
    // darwin — must link ONLY Apple system libraries.
    const otool = run(["otool", "-L", outPath], ROOT, {});
    if (otool.code !== 0) {
      fail(`darwin static-verify: otool failed:\n${otool.out}`);
      continue;
    }
    const libs = otool.out
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(" ")[0])
      .filter(Boolean);
    const nonApple = libs.filter((l) => !l.startsWith("/usr/lib/") && !l.startsWith("/System/"));
    if (nonApple.length) {
      fail(`darwin static-verify: non-Apple libraries: ${nonApple.join(", ")}`);
      continue;
    }
    verify = `Apple system libs only: ${libs.join(", ")}`;
    ok(`static ${t.os}/${t.arch}: ${verify}`);
  }

  built.push({
    target: t,
    path: outPath,
    sizeBytes: 0, // re-stat'ed after the loop
    verify,
  });
}

if (failures > 0) {
  console.error(`[skill-pack] FAIL — ${failures} gate(s) failed; no distributable assembled.`);
  process.exit(1);
}

// Re-stat sizes properly (the stat above is clunky but portable enough).
for (const b of built) {
  b.sizeBytes = Number((Bun.spawnSync(["stat", "-f", "%z", b.path], { cwd: ROOT }).stdout?.toString() ?? "0").trim());
}

// ---------------------------------------------------------------------------
// 4. assemble .skill-dist/excali-draw/
// ---------------------------------------------------------------------------
const DIST_SKILL = join(DIST, SKILL_NAME);
mkdirSync(join(DIST_SKILL, "bin"), { recursive: true });
mkdirSync(join(DIST_SKILL, "references/workflows"), { recursive: true });

for (const f of ["SKILL.md", "README.md"]) {
  writeFileSync(join(DIST_SKILL, f), readFileSync(join(SKILL_DIR, f)));
}
for (const f of ["command-reference.md", "element-templates.md", "json-schema.md", "color-palette.md"]) {
  writeFileSync(join(DIST_SKILL, "references", f), readFileSync(join(SKILL_DIR, "references", f)));
}
for (const f of ["draw-a-diagram.md", "save-to-gallery.md", "install-and-use-a-font.md"]) {
  writeFileSync(join(DIST_SKILL, "references/workflows", f), readFileSync(join(SKILL_DIR, "references/workflows", f)));
}
for (const b of built) {
  // Move the scratch-built binary into the assembled folder (keeps modes).
  const dest = join(DIST_SKILL, "bin", binName(b.target));
  writeFileSync(dest, readFileSync(b.path), { mode: 0o755 });
}
rmSync(join(DIST, "bin"), { recursive: true, force: true }); // scratch area no longer needed

// Patch the README size table with the real measurements.
const readme = readFileSync(join(DIST_SKILL, "README.md"), "utf8");
const rows = built
  .map((b) => `| \`${binName(b.target)}\` | ${(b.sizeBytes / (1024 * 1024)).toFixed(2)} MiB | ${b.verify} |`)
  .join("\n");
const patched = readme.replace(
  /<!-- PACK-SIZES-BEGIN -->[\s\S]*?<!-- PACK-SIZES-END -->/,
  `<!-- PACK-SIZES-BEGIN -->\n${rows}\n<!-- PACK-SIZES-END -->`,
);
writeFileSync(join(DIST_SKILL, "README.md"), patched);

// ---------------------------------------------------------------------------
// 5. versioned archive + report
// ---------------------------------------------------------------------------
const archive = join(DIST, `${SKILL_NAME}-${VERSION}.tar.gz`);
const tar = run(["tar", "-czf", archive, "-C", DIST, SKILL_NAME], ROOT, {});
if (tar.code !== 0) {
  fail(`archive:\n${tar.out}`);
  process.exit(1);
}
const archiveBytes = Number((Bun.spawnSync(["stat", "-f", "%z", archive], { cwd: ROOT }).stdout?.toString() ?? "0").trim());

console.log(`\n[skill-pack] assembled ${DIST_SKILL}`);
for (const b of built) {
  console.log(`  bin/${binName(b.target)}  ${(b.sizeBytes / (1024 * 1024)).toFixed(2)} MiB  ${b.verify}`);
}
console.log(`  archive ${archive}  ${(archiveBytes / (1024 * 1024)).toFixed(2)} MiB (${archiveBytes} bytes)`);
console.log(`[skill-pack] PASS — excali-draw v${VERSION} distributable ready ✔`);
