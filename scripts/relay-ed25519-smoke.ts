/**
 * relay-ed25519-smoke — runtime gate that pins workerd's WebCrypto
 * Ed25519 raw-import capability (ADR 0010).
 *
 * Background. ADR 0010 promoted "self-host collab-relay on stock workerd"
 * over the previously preferred celld (denoland). The rejection of celld
 * was empirical: celld v0.3's embedded V8 rejects raw Ed25519 key import,
 * so org-signed hello admission rejects every connection. ADR 0003 left
 * that gate un-pinned at the unit-test level, so a runtime regression in
 * either direction (celld's polyfill landing and breaking our tests, or a
 * new workerd release losing some crypto matrix) could re-open the gate
 * silently. This script makes the gate a one-command local check.
 *
 * Scope. This is an ON-DEMAND developer/deployer tool, NOT a CI job.
 * Self-hosting off Cloudflare is an opt-in path, so its verification must
 * not be coupled to the release pipeline. Run it when you change the
 * runtime, the workerd/wrangler version, or the admission crypto.
 *
 * What it does.
 *   1. Spins up a fresh wrangler dev process against a bundled 30-line
 *      worker that mirrors collab-relay/src/server.ts:205-208 (the
 *      importKey(\"raw\", pub, {name:\"Ed25519\"}, false, [\"verify\"]) call
 *      and the verify({name:\"Ed25519\"}, ...) call).
 *   2. Generates a Node-side Ed25519 keypair, exports the raw 32-byte
 *      public key, signs a fixed message.
 *   3. POSTs happy + tampered inputs to /verify.
 *   4. Asserts happy returns importedOk:true AND verifyOk:true, tampered
 *      returns verifyOk:false. Either side failing fails the script with
 *      exit code 1.
 *
 * Configurable via env:
 *   SMOKE_PORT — port to bind (default 19998; pick another when 19998
 *                is already taken by your long-running relay:dev).
 *   SMOKE_WRANGLER — path to wrangler binary (default:
 *                    packages/collab-relay/node_modules/.bin/wrangler
 *                    via relative path).
 *
 * Run locally with: `pnpm relay:smoke` (or `tsx scripts/relay-ed25519-smoke.ts`).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"

const PORT = Number(process.env.SMOKE_PORT ?? 19998)
const WRANGLER =
  process.env.SMOKE_WRANGLER ??
  join(
    process.cwd(),
    "packages/collab-relay/node_modules/.bin/wrangler",
  )

// Mirrors collab-relay/src/server.ts verifyHelloSig's Ed25519 round-trip.
const WORKER_SRC = `
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/verify") return new Response("nope", { status: 404 });
    const body = await request.json();
    const pub = b64u2b(body.pubRaw);
    const m = new TextEncoder().encode(body.msg);
    const sig = b64u2b(body.sig);
    let importedOk = false, verifyOk = false, err = null;
    try {
      const k = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
      importedOk = true;
      verifyOk = await crypto.subtle.verify({ name: "Ed25519" }, k, sig, m);
    } catch (e) { err = e?.message ?? String(e); }
    return new Response(JSON.stringify({ importedOk, verifyOk, err }), {
      headers: { "content-type": "application/json" },
    });
  },
};
function b64u2b(s) {
  s = s.replaceAll("-", "+").replaceAll("_", "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
`

function b64url(u8: Uint8Array): string {
  return Buffer.from(u8)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

async function waitForReady(
  child: ChildProcessWithoutNullStreams,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const onChunk = (buf: Buffer) => {
      const s = buf.toString()
      process.stdout.write(`[${label}] ${s}`)
      if (s.includes("Ready on")) resolve()
      if (s.toLowerCase().includes("error") || s.includes("EADDRINUSE")) {
        reject(new Error(`wrangler dev reported error: ${s}`))
      }
    }
    child.stdout.on("data", onChunk)
    child.stderr.on("data", onChunk)
    const timer = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`wrangler dev did not become ready in ${timeoutMs}ms`))
      }
    }, 500)
    const finish = () => {
      clearInterval(timer)
    }
    child.on("exit", () => reject(new Error("wrangler dev exited prematurely")))
    // resolve/reject will be called by onChunk; finish cleanup is best-effort
    void finish
  })
}

async function kill(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return
  child.kill("SIGTERM")
  await new Promise<void>((r) => {
    const t = setTimeout(() => child.kill("SIGKILL"), 2000)
    child.on("exit", () => {
      clearTimeout(t)
      r()
    })
  })
}

async function main(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "relay-ed25519-smoke-"))
  writeFileSync(join(dir, "worker.js"), WORKER_SRC)
  writeFileSync(
    join(dir, "wrangler.jsonc"),
    JSON.stringify(
      {
        $schema: "../../../packages/collab-relay/node_modules/wrangler/config-schema.json",
        name: "ed25519-smoke",
        main: "worker.js",
        compatibility_date: "2026-08-01",
        workers_dev: false,
      },
      null,
      2,
    ),
  )

  const child = spawn(WRANGLER, ["dev", "--port", String(PORT)], {
    cwd: dir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams

  let exitCode = 1
  try {
    await waitForReady(child, "wrangler", 30_000)

    // Generate fresh keypair, sign a fixed message.
    const kp = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"],
    )
    const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))
    const msg = "relay-ed25519-smoke hello"
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(msg)),
    )

    const post = async (m: string) => {
      const r = await fetch(`http://127.0.0.1:${PORT}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubRaw: b64url(rawPub), msg: m, sig: b64url(sig) }),
      })
      return r.json() as Promise<{ importedOk: boolean; verifyOk: boolean; err: string | null }>
    }

    const happy = await post(msg)
    const tampered = await post("tampered:" + msg)

    console.log("happy  :", happy)
    console.log("tamper :", tampered)
    console.log("durability assertion: pubRaw.length =", rawPub.length, "bytes (must be 32)")

    const fail =
      rawPub.length !== 32 ||
      !happy.importedOk || happy.verifyOk !== true ||
      !tampered.importedOk || tampered.verifyOk !== false
    if (fail) {
      console.error("Ed25519 smoke FAILED")
      exitCode = 1
    } else {
      console.log("Ed25519 smoke PASSED (workerd hello-verify contract honored)")
      exitCode = 0
    }
  } catch (e) {
    console.error("Ed25519 smoke threw:", (e as Error).message)
    exitCode = 1
  } finally {
    await kill(child)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort tmp cleanup
    }
    process.exit(exitCode)
  }
}

void main()
