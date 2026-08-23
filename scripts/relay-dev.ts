/**
 * relay-dev — one-command collab-relay dev loop (Wayfinder 060 §2).
 *
 *   1. Idempotent Ed25519 seed: `.dev-keys.json` at the repo root is reused
 *      when present (re-seeding must NOT rotate keys — a dev's invite keeps
 *      working across days, 060 §2); otherwise a fresh 32-byte seed + 32-byte
 *      org content key (`ck`, 057 §1) are generated and written.
 *   2. `.dev.vars` (gitignored, packages/collab-relay/) for `wrangler dev`:
 *      `ORG_PUBKEYS` (v2, 059 §2) with the Ed25519 public key derived from
 *      the seed, plus the legacy `ORG_SECRETS` object (052 §2) for
 *      compatibility. Wrangler auto-loads `.dev.vars` from the project dir;
 *      the vars are also passed into the spawned process explicitly.
 *   3. Prints a paste-ready server invite for `http://127.0.0.1:1999`
 *      (loopback carve-out, 060 §1) via collab-core `encodeServerInvite`.
 *   4. Runs `wrangler dev` (cwd = packages/collab-relay). If the relay is
 *      not wired yet (no wrangler.jsonc), prints a hint and exits cleanly:
 *      keys + invite are the script's core value and are still produced.
 *   5. `--https` (optional TLS-parity mode, 060 §1): mkcert certs
 *      `.dev-cert.pem` / `.dev-key.pem` (local CA) and passes wrangler's
 *      `--local-protocol https --https-key-path --https-cert-path` flags.
 *
 * Run: `pnpm relay:dev` / `pnpm relay:dev:https` (tsx).
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  b64urlToBytes,
  bytesToB64url,
  deriveEd25519Pubkey,
  encodeServerInvite,
} from "../packages/collab-core/src/index"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const RELAY_DIR = path.join(REPO_ROOT, "packages", "collab-relay")
const KEYS_PATH = path.join(REPO_ROOT, ".dev-keys.json")
const DEV_VARS_PATH = path.join(RELAY_DIR, ".dev.vars")
const DEV_CERT_PATH = path.join(REPO_ROOT, ".dev-cert.pem")
const DEV_KEY_PATH = path.join(REPO_ROOT, ".dev-key.pem")

/** Dev org label + relay URL (060 §1/§2: standardized on 127.0.0.1, not localhost). */
const ORG = "local"
const RELAY_URL = "http://127.0.0.1:1999"

/** Config files that mean the relay is wired (wrangler config for partyserver). */
const CONFIG_FILES = ["wrangler.jsonc", "wrangler.toml"]

interface DevKeys {
  /** 43-char b64url Ed25519 seed (32 bytes) — the idempotency anchor (060 §2). */
  seed: string
  /** org label, "local" for dev. */
  org: string
  /** 43-char b64url org content key (32 bytes, 057 §1) — required by the server invite. */
  ck: string
  createdAt: string
}

function isB64urlOfLength(s: unknown, n: number): s is string {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s)) return false
  try {
    return b64urlToBytes(s).length === n
  } catch {
    return false
  }
}

/** Load `.dev-keys.json` or generate it. Idempotent: an existing file is never rewritten. */
function loadOrCreateKeys(): DevKeys {
  if (existsSync(KEYS_PATH)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(KEYS_PATH, "utf8"))
    } catch (e) {
      console.error(`relay-dev: ${KEYS_PATH} is not valid JSON (${e instanceof Error ? e.message : String(e)})`)
      console.error("relay-dev: refusing to rotate keys silently — delete the file to start over.")
      process.exit(1)
    }
    const rec = parsed as Partial<DevKeys>
    if (!isB64urlOfLength(rec.seed, 32)) {
      console.error(`relay-dev: ${KEYS_PATH} is malformed (seed must be a 43-char base64url 32-byte key).`)
      console.error("relay-dev: refusing to rotate keys silently — delete the file to start over.")
      process.exit(1)
    }
    if (!isB64urlOfLength(rec.ck, 32) || typeof rec.org !== "string") {
      console.error(`relay-dev: ${KEYS_PATH} is malformed (ck must be a 43-char base64url 32-byte key, org a string).`)
      console.error("relay-dev: refusing to rotate keys silently — delete the file to start over.")
      process.exit(1)
    }
    console.log(`relay-dev: reused ${KEYS_PATH} (idempotent — seed kept, no rotation)`)
    return { seed: rec.seed, org: rec.org, ck: rec.ck, createdAt: rec.createdAt ?? "unknown" }
  }

  const seed = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
  const ck = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
  const keys: DevKeys = { seed, org: ORG, ck, createdAt: new Date().toISOString() }
  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2) + "\n")
  console.log(`relay-dev: generated ${KEYS_PATH} (fresh dev identity)`)
  return keys
}

/** Write `.dev.vars` (gitignored) for wrangler dev: ORG_PUBKEYS (059 §2 v2) + legacy ORG_SECRETS (052 §2). */
function writeDevVars(pk: string, seedB64url: string): void {
  const pubkeys = JSON.stringify([{ org: ORG, pubkeys: [pk] }])
  const secrets = JSON.stringify({ [ORG]: seedB64url })
  writeFileSync(DEV_VARS_PATH, `ORG_PUBKEYS=${pubkeys}\nORG_SECRETS=${secrets}\n`)
  console.log(`relay-dev: wrote ${DEV_VARS_PATH} (ORG_PUBKEYS + legacy ORG_SECRETS)`)
}

/** Print the paste-ready server invite (049 §4 / 057 §2 encoding, 060 §1 loopback rule). */
function printInvite(keys: DevKeys): void {
  const invite = encodeServerInvite({ relay: RELAY_URL, org: ORG, sk: keys.seed, ck: keys.ck })
  console.log("")
  console.log("Server invite (paste into Options → Collaboration):")
  console.log("")
  console.log(`  ${invite}`)
  console.log("")
}

function relayIsWired(): boolean {
  return CONFIG_FILES.some((f) => existsSync(path.join(RELAY_DIR, f)))
}

/** mkcert (local CA) certs for --https TLS-parity mode (060 §1). Idempotent. */
function ensureHttpsCerts(): void {
  if (existsSync(DEV_CERT_PATH) && existsSync(DEV_KEY_PATH)) {
    console.log("relay-dev: https certs already present (reused)")
    return
  }
  console.log("relay-dev: generating mkcert certs for localhost + 127.0.0.1 …")
  const res = spawnSync("mkcert", ["-cert-file", DEV_CERT_PATH, "-key-file", DEV_KEY_PATH, "localhost", "127.0.0.1"], {
    stdio: "inherit",
  })
  if (res.error) {
    console.error(`relay-dev: mkcert failed to start (${res.error.message}) — is mkcert installed? (brew install mkcert)`)
    process.exit(1)
  }
  if (res.status !== 0) {
    console.error(`relay-dev: mkcert exited with status ${res.status}`)
    process.exit(1)
  }
}

/** Parse the `.dev.vars` we just wrote (trivial key=value, no quotes) for explicit env passing. */
function readDevVars(): Record<string, string | undefined> {
  const vars: Record<string, string | undefined> = {}
  for (const line of readFileSync(DEV_VARS_PATH, "utf8").split("\n")) {
    const eq = line.indexOf("=")
    if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return vars
}

function runWranglerDev(https: boolean): void {
  const args = ["--filter", "./packages/collab-relay", "exec", "wrangler", "dev", "--port", "1999"]
  if (https) {
    args.push("--local-protocol", "https", "--https-key-path", DEV_KEY_PATH, "--https-cert-path", DEV_CERT_PATH)
  }
  const child = spawn("pnpm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...readDevVars() },
  })
  child.on("exit", (code, signal) => {
    if (signal) console.log(`relay-dev: wrangler dev terminated by ${signal}`)
    process.exit(code ?? 0)
  })
  child.on("error", (err) => {
    console.error(`relay-dev: failed to spawn wrangler dev: ${err.message}`)
    process.exit(1)
  })
}

async function main(): Promise<void> {
  const https = process.argv.includes("--https")

  const keys = loadOrCreateKeys()
  const pk = await deriveEd25519Pubkey(keys.seed)
  writeDevVars(pk, keys.seed)
  printInvite(keys)

  if (!relayIsWired()) {
    console.log("relay-dev: packages/collab-relay is not wired yet — no wrangler.jsonc")
    console.log("relay-dev: keys + invite are ready; run `pnpm relay:dev` again once the relay is wired.")
    return
  }

  if (https) ensureHttpsCerts()
  console.log(https ? "relay-dev: starting `wrangler dev --https` …" : "relay-dev: starting `wrangler dev` …")
  runWranglerDev(https)
}

main().catch((err) => {
  console.error(`relay-dev: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})