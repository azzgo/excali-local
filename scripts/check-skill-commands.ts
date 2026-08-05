/**
 * check-skill-commands — assert ZERO DRIFT between the command surface
 * documented in skills/excali-draw/references/command-reference.md and the
 * wire contract in packages/excali-shared/src/agent-bridge.ts.
 *
 * The CLI is the stable contract of the excali-draw skill; the reference doc
 * is its teaching surface. If the daemon/contract gains or loses a method
 * and this file is not updated, the skill would teach a wrong surface.
 *
 * Checks:
 *   1. Every method token in command-reference.md exists in the contract.
 *   2. Every contract method is documented (no silent omissions).
 *   3. Every method is documented under exactly one gate group
 *      (daemon-local / activated / paired) and that gate matches the
 *      contract's routing classes.
 *
 * Run: pnpm skill:check
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hereDir } from "./_run";
import {
  CANVAS_BOUND_METHODS,
  CANVAS_V1_METHODS,
  DAEMON_LOCAL_METHODS,
  FONTS_PAGE_METHODS,
  FONTS_V1_METHODS,
  GALLERY_V1_METHODS,
  PAIRED_ONLY_METHODS,
} from "excali-shared";

const DOC = join(hereDir(import.meta.url), "../skills/excali-draw/references/command-reference.md");

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`[check-skill-commands] FAIL — ${msg}`);
};
const ok = (msg: string) => console.log(`[check-skill-commands] ✓ ${msg}`);

// ---- contract side ---------------------------------------------------------
// The full callable set (mirrors Go contract.AllMethods(), deduped).
const contractSet = new Set<string>(
  [...CANVAS_V1_METHODS, ...GALLERY_V1_METHODS, ...FONTS_V1_METHODS, ...DAEMON_LOCAL_METHODS].sort(),
);

// Routing classes as the contract defines them.
const activatedSet = new Set<string>(CANVAS_BOUND_METHODS);
const pairedSet = new Set<string>([...PAIRED_ONLY_METHODS, ...FONTS_PAGE_METHODS]);
const daemonLocalSet = new Set<string>([...DAEMON_LOCAL_METHODS, "fonts.system.list"]); // Go resolves fonts.system.list daemon-local

// ---- doc side --------------------------------------------------------------
const doc = readFileSync(DOC, "utf8");

// Method tokens: inline-code spans shaped like a dotted method name
// (`scene.get`, `tool.setActive`, `fonts.system.list`) plus the single-word
// `ping`. Version strings ("canvas/v1"), quoted values (`"elements"`), and
// bare English words don't match.
const METHOD_TOKEN = /`((?:ping)|[a-z]+\.[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)`/g;
const documented = new Set<string>();
for (const m of doc.matchAll(METHOD_TOKEN)) documented.add(m[1]);

// Gate-group sections: split on "## " headings; the body of each of the
// three gate sections is the list of methods documented under that gate.
const sectionBodies = new Map<string, Set<string>>();
let currentHeader = "";
for (const line of doc.split("\n")) {
  const h = line.match(/^## (.+)$/);
  if (h) {
    currentHeader = h[1].trim();
    sectionBodies.set(currentHeader, new Set());
    continue;
  }
  const body = sectionBodies.get(currentHeader);
  if (body) {
    for (const m of line.matchAll(METHOD_TOKEN)) body.add(m[1]);
  }
}

// ---- assertions ------------------------------------------------------------
// 1 + 2: bidirectional zero drift.
const phantom = [...documented].filter((m) => !contractSet.has(m));
if (phantom.length) {
  fail(`documented methods NOT in the contract: ${phantom.join(", ")}`);
} else {
  ok(`all ${documented.size} documented methods exist in the contract`);
}
const missing = [...contractSet].filter((m) => !documented.has(m));
if (missing.length) {
  fail(`contract methods NOT documented in command-reference.md: ${missing.join(", ")}`);
} else {
  ok(`all ${contractSet.size} contract methods are documented`);
}

// 3: gate grouping.
const gateSections = ["daemon-local", "activated (canvas-bound)", "paired"];
const gateOf = (m: string): string | null => {
  for (const g of gateSections) {
    if (sectionBodies.get(g)?.has(m)) return g;
  }
  return null;
};

let gateMismatches = 0;
const expectedGate = (m: string): string => {
  if (daemonLocalSet.has(m)) return "daemon-local";
  if (activatedSet.has(m)) return "activated (canvas-bound)";
  if (pairedSet.has(m)) return "paired";
  return "unknown";
};
for (const m of [...contractSet].sort()) {
  const docGate = gateOf(m);
  const expGate = expectedGate(m);
  if (docGate !== expGate) {
    gateMismatches += 1;
    fail(`method "${m}" documented under gate "${docGate ?? "none"}" but the contract routes it as ${expGate}`);
  }
}
if (gateMismatches === 0) {
  ok("every method is documented under exactly the gate the contract routes it to");
}

const total = failures === 0 ? documented.size : 0;
console.log(
  failures === 0
    ? `[check-skill-commands] PASS — ${total} methods, zero drift ✔`
    : `[check-skill-commands] FAIL — ${failures} check(s)`,
);
process.exit(failures > 0 ? 1 : 0);
