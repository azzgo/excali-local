/**
 * skill-pack — build the excali-local skill (source-is-the-artifact).
 *
 * `skills/excali-local/` IS the usable skill. The platform binaries are COMMITTED
 * under `skills/excali-local/bin/`; this script refreshes them in place. It writes
 * nothing to the repo outside that dir — cross-compile scratch lives in the OS
 * temp dir and is cleaned up on exit, so a gate failure never leaves a partial
 * binary (or a patched README) in the committed source.
 *
 * 1. Cross-compiles the Go daemon (packages/bridge) for the target
 *    matrix with CGO_ENABLED=0 -trimpath -buildvcs=false -ldflags="-s -w" (pure Go, cgo
 *    disabled, symbols stripped).
 * 2. Mandatory per-target gates: `go build` AND `go vet` must both pass for
 *    every target, else the pack FAILS (cross-platform compile health is a
 *    first-class gate — this is the tripwire for any future Unix-only
 *    syscall regression like the pidfile/client ones folded into goal-5).
 * 3. Mandatory static-verify per target (file/objdump/otool) proving the
 *    dep-free story: linux fully static; windows imports only kernel32;
 *    darwin links only Apple system libraries. FAILS otherwise.
 * 4. Only after ALL gates pass: copies the verified binaries into
 *    `skills/excali-local/bin/` (overwriting) and refreshes the PACK-SIZES
 *    table IN PLACE in `skills/excali-local/README.md`.
 *
 * Reproducibility (-buildvcs=false): Go 1.18+ stamps binaries with the
 * surrounding git repo's vcs.revision/time/modified by default, so two builds
 * of IDENTICAL source come out byte-different across commits or dirty state.
 * We pass -buildvcs=false so the 4 binaries are byte-reproducible: re-running
 * skill-pack leaves them unchanged unless the Go source actually changes (git
 * status stays clean). Consequence: `go version -m <bin>` shows NO vcs.* lines
 * — that is intentional, NOT a bug. Do NOT drop -buildvcs=false to "add version
 * info"; it would re-introduce non-idempotent binaries that dirty every commit.
 *
 * No release tarball is produced here — the committed skill dir IS the
 * artifact. A release archive (when one is needed) is just
 * `tar -czf excali-local-<version>.tar.gz -C skills/excali-local .`.
 *
 * Run: pnpm skill:pack
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { run as runCmd, hereDir } from "./_run";

const ROOT = join(hereDir(import.meta.url), "..");
const BRIDGE_DIR = join(ROOT, "packages/bridge");
const SKILL_DIR = join(ROOT, "skills/excali-local");
const SKILL_BIN_DIR = join(SKILL_DIR, "bin");

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

const run = (cmd: string[], cwd: string, env: Record<string, string>) =>
  runCmd(cmd, { cwd, env: { ...(process.env as Record<string, string>), ...env } });

// ---------------------------------------------------------------------------
// 1-3. build + vet + static-verify per target (scratch in the OS temp dir)
// ---------------------------------------------------------------------------
interface BuiltTarget {
  target: (typeof TARGETS)[number];
  path: string;
  sizeBytes: number;
  verify: string;
}

const built: BuiltTarget[] = [];

// Cross-compile scratch lives in the OS temp dir — a gate failure never leaves a
// partial binary (or a patched README) in the committed source. Cleaned on exit.
const scratch = mkdtempSync(join(os.tmpdir(), "skill-pack-"));
mkdirSync(SKILL_BIN_DIR, { recursive: true });

console.log(`[skill-pack] excali-local v${VERSION} — building ${TARGETS.length} targets`);
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
    console.error(`[skill-pack] FAIL — ${failures} gate(s) failed; skill bin/ NOT updated.`);
    exitCode = 1;
  } else {
    // Re-stat sizes properly (portable enough across the macOS/*BSD `stat -f %z`).
    for (const b of built) {
      b.sizeBytes = Number((runCmd(["stat", "-f", "%z", b.path], { cwd: ROOT }).stdout || "0").trim());
    }

    // ---------------------------------------------------------------------------
    // 4. copy verified binaries into the SOURCE skill + patch its README in place
    // ---------------------------------------------------------------------------
    for (const b of built) {
      const dest = join(SKILL_BIN_DIR, binName(b.target));
      writeFileSync(dest, readFileSync(b.path), { mode: 0o755 });
      ok(`installed bin/${binName(b.target)} → skills/excali-local/bin/`);
    }

    // Patch the README size table with the real measurements (in place — the
    // source README is part of the artifact).
    const readmePath = join(SKILL_DIR, "README.md");
    const readme = readFileSync(readmePath, "utf8");
    const rows = built
      .map((b) => `| \`${binName(b.target)}\` | ${(b.sizeBytes / (1024 * 1024)).toFixed(2)} MiB | ${b.verify} |`)
      .join("\n");
    const patched = readme.replace(
      /<!-- PACK-SIZES-BEGIN -->[\s\S]*?<!-- PACK-SIZES-END -->/,
      `<!-- PACK-SIZES-BEGIN -->\n${rows}\n<!-- PACK-SIZES-END -->`,
    );
    writeFileSync(readmePath, patched);
    ok("README.md PACK-SIZES table updated in place");

    console.log(`\n[skill-pack] source skill ready: ${SKILL_DIR}`);
    for (const b of built) {
      console.log(`  bin/${binName(b.target)}  ${(b.sizeBytes / (1024 * 1024)).toFixed(2)} MiB  ${b.verify}`);
    }
    console.log(`[skill-pack] PASS — excali-local v${VERSION} binaries refreshed in skills/excali-local/bin/ ✔`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);
