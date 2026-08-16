/**
 * relay-dev — one-command collab-relay dev loop (Wayfinder 060 §2).
 *
 *   1. Idempotent Ed25519 seed: `.dev-keys.json` at the repo root is reused
 *      when present (re-seeding must NOT rotate keys — a dev's invite keeps
 *      working across days, 060 §2); otherwise a fresh 32-byte seed + 32-byte
 *      org content key (`ck`, 057 §1) are generated and written.
 *   2. `.env` (gitignored) for `partykit dev`: `ORG_PUBKEYS` (v2, 059 §2) with
 *      the Ed25519 public key derived from the seed, plus the legacy
 *      `ORG_SECRETS` object (052 §2) for compatibility. PartyKit's
 *      findUpSync dotenv auto-loads it; the vars are also passed into the
 *      spawned process explicitly.
 *   3. Prints a paste-ready server invite for `http://127.0.0.1:1999`
 *      (loopback carve-out, 060 §1) via collab-core `encodeServerInvite`.
 *   4. Runs `partykit dev` (cwd = packages/collab-relay). If the relay
 *      package is not wired yet (no party.config.ts / partykit.json — task
 *      041 owns it), prints a hint and exits cleanly: keys + invite are the
 *      script's core value and are still produced.
 *   5. `--https` (optional TLS-parity mode, 060 §1): mkcert certs
 *      `.dev-cert.pem` / `.dev-key.pem` (local CA) and passes partykit's
 *      native `--https --https-key-path --https-cert-path` flags (verified
 *      in partykit 0.0.115 bin).
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
  encodeServerInvite,
  seedToPkcs8,
} from "../packages/collab-core/src/index"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const RELAY_DIR = path.join(REPO_ROOT, "packages", "collab-relay")
const KEYS_PATH = path.join(REPO_ROOT, ".dev-keys.json")
const ENV_PATH = path.join(REPO_ROOT, ".env")
const DEV_CERT_PATH = path.join(REPO_ROOT, ".dev-cert.pem")
const DEV_KEY_PATH = path.join(REPO_ROOT, ".dev-key.pem")

/** Dev org label + relay URL (060 §1/§2: standardized on 127.0.0.1, not localhost). */
const ORG = "local"
const RELAY_URL = "http://127.0.0.1:1999"

/** Config files that mean the relay is wired (041 plans party.config.ts; partykit 0.0.115 reads partykit.json*). */
const CONFIG_FILES = [
  "party.config.ts",
  "party.config.js",
  "party.config.mjs",
  "partykit.json",
  "partykit.json5",
  "partykit.jsonc",
]

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

/**
 * Derive the 32-byte Ed25519 public key from the seed (057 §1): PKCS#8 wrap
 * via collab-core `seedToPkcs8`, WebCrypto import, JWK export, take the raw
 * public key from the RFC 8037 OKP `x` field. (Node's WebCrypto rejects
 * `exportKey("spki")` on a private key — spki is public-key-only per spec —
 * so the raw pk rides the JWK `x` field instead.) The import is extractable
 * here (keygen-only; the client runtime uses `extractable:false`, 057 §1).
 */
async function derivePubkey(seedB64url: string): Promise<string> {
  const pkcs8 = seedToPkcs8(b64urlToBytes(seedB64url))
  const privKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"])
  const jwk = (await crypto.subtle.exportKey("jwk", privKey)) as { x: string; d: string }
  const rawPk = b64urlToBytes(jwk.x)
  if (rawPk.length !== 32) {
    throw new Error(`relay-dev: unexpected raw pk length ${rawPk.length} (expected 32)`)
  }
  const pk = bytesToB64url(rawPk)

  // Self-check the derived pk (057 §1 format): sign with the seed, verify with the raw pk.
  const pubKey = await crypto.subtle.importKey("raw", rawPk, { name: "Ed25519" }, false, ["verify"])
  const msg = new TextEncoder().encode("excali-local relay-dev pk self-check")
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", privKey, msg))
  if (!(await crypto.subtle.verify("Ed25519", pubKey, sig, msg))) {
    throw new Error("relay-dev: derived pk failed sign/verify self-check")
  }
  return pk
}

/** Write `.env` (gitignored): ORG_PUBKEYS (059 §2 v2) + legacy ORG_SECRETS (052 §2 object shape). */
function writeEnv(pk: string, seedB64url: string): void {
  const pubkeys = JSON.stringify([{ org: ORG, pubkeys: [pk] }])
  const secrets = JSON.stringify({ [ORG]: seedB64url })
  writeFileSync(ENV_PATH, `ORG_PUBKEYS=${pubkeys}\nORG_SECRETS=${secrets}\n`)
  console.log(`relay-dev: wrote ${ENV_PATH} (ORG_PUBKEYS + legacy ORG_SECRETS)`)
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
  const res = spawnSync(
    "mkcert",
    ["-cert-file", DEV_CERT_PATH, "-key-file", DEV_KEY_PATH, "localhost", "127.0.0.1"],
    { stdio: "inherit" },
  )
  if (res.error) {
    console.error(`relay-dev: mkcert failed to start (${res.error.message}) — is mkcert installed? (brew install mkcert)`)
    process.exit(1)
  }
  if (res.status !== 0) {
    console.error(`relay-dev: mkcert exited with status ${res.status}`)
    process.exit(1)
  }
}

/** Parse the `.env` we just wrote (trivial key=value, no quotes) for explicit env passing. */
function readEnvVars(): Record<string, string | undefined> {
  const vars: Record<string, string | undefined> = {}
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const eq = line.indexOf("=")
    if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return vars
}

function runPartykitDev(https: boolean): void {
  const args = ["--filter", "./packages/collab-relay", "exec", "partykit", "dev"]
  if (https) {
    args.push("--https", "--https-key-path", DEV_KEY_PATH, "--https-cert-path", DEV_CERT_PATH)
  }
  const child = spawn("pnpm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...readEnvVars() },
  })
  child.on("exit", (code, signal) => {
    if (signal) console.log(`relay-dev: partykit dev terminated by ${signal}`)
    process.exit(code ?? 0)
  })
  child.on("error", (err) => {
    console.error(`relay-dev: failed to spawn partykit dev: ${err.message}`)
    process.exit(1)
  })
}

async function main(): Promise<void> {
  const https = process.argv.includes("--https")

  const keys = loadOrCreateKeys()
  const pk = await derivePubkey(keys.seed)
  writeEnv(pk, keys.seed)
  printInvite(keys)

  if (!relayIsWired()) {
    console.log(
      "relay-dev: packages/collab-relay is not wired yet — no party.config.ts / partykit.json",
    )
    console.log("relay-dev: (that file lands with task 041). Keys + invite are ready;")
    console.log("relay-dev: run `pnpm relay:dev` again once the relay is wired.")
    return
  }

  if (https) ensureHttpsCerts()
  console.log(https ? "relay-dev: starting `partykit dev --https` …" : "relay-dev: starting `partykit dev` …")
  runPartykitDev(https)
}

main().catch((err) => {
  console.error(`relay-dev: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
