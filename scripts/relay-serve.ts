/**
 * relay-serve — self-host the collab relay on `workerd`, off Cloudflare.
 *
 * Cloudflare Workers remains the DEFAULT development and deployment path
 * (`pnpm relay:dev`). This script is the opt-in alternative for deployers who
 * want to run the relay on their own machine/box with no Cloudflare account.
 *
 * It runs the SAME `partyserver` code as a Cloudflare deploy: `wrangler dev`
 * drives the very `workerd` binary Cloudflare's edge runs (ADR 0010). Nothing
 * in `packages/collab-relay/src` changes — only how the process is launched
 * and which env it is given.
 *
 * What it does:
 *   1. Resolves config from flags/env (port, bind host, public relay URL,
 *      org label, key file) with documented defaults.
 *   2. Ensures an org identity exists: reuses `.selfhost-keys.json` when
 *      present, otherwise generates one and prints the `ORG_PUBKEYS` value
 *      the relay needs. (Use `pnpm relay:keygen` instead when you want a
 *      one-shot production keypair without persisting anything.)
 *   3. Writes `.selfhost.vars` (gitignored) that `wrangler dev` auto-loads.
 *   4. Prints the paste-ready server invite for the configured public URL.
 *   5. Runs `wrangler dev` on the configured port.
 *
 * Usage:
 *   pnpm relay:serve                       # 127.0.0.1:1999 (loopback, no TLS)
 *   pnpm relay:serve --port 8080 --url https://relay.example.com
 *   pnpm relay:serve --org acme --host 0.0.0.0 --port 8080 --url https://relay.example.com
 *
 * Flags:
 *   --port <n>     bind port                        (default 1999)
 *   --host <h>     bind host                        (default 127.0.0.1)
 *   --url <u>      PUBLIC relay URL members dial    (default http://127.0.0.1:<port>)
 *   --org <label>  org label                        (default "local")
 *   --keys <path>  key file                         (default .selfhost-keys.json)
 *
 * Env equivalents: RELAY_PORT, RELAY_HOST, RELAY_URL, RELAY_ORG, RELAY_KEYS.
 *
 * TLS. The client refuses `http://`/`ws://` for anything but loopback IP
 * literals, so a relay reachable by other machines MUST be served over TLS.
 * This script does not terminate TLS; put Caddy/nginx in front (see README →
 * "Self-host the relay on workerd"). For a local TLS-parity check use
 * `pnpm relay:dev:https` instead.
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import {
  bytesToB64url,
  deriveEd25519Pubkey,
  encodeServerInvite,
  validateRelayUrl,
} from "../packages/collab-core/src/index"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const RELAY_DIR = path.join(REPO_ROOT, "packages", "collab-relay")
const VARS_PATH = path.join(RELAY_DIR, ".selfhost.vars")

interface Config {
  port: number
  host: string
  url: string
  org: string
  keysPath: string
}

interface SelfHostKeys {
  seed: string
  org: string
  ck: string
  createdAt: string
}

function usage(): never {
  console.log(
    [
      "usage: pnpm relay:serve [--port <n>] [--host <h>] [--url <u>] [--org <label>] [--keys <path>]",
      "",
      "  --port   bind port                      (default 1999)",
      "  --host   bind host                      (default 127.0.0.1)",
      "  --url    public relay URL members dial  (default http://127.0.0.1:<port>)",
      "  --org    org label                      (default \"local\")",
      "  --keys   key file path                  (default .selfhost-keys.json)",
      "",
      "Docs: README.md → \"Self-host the relay on workerd\"",
    ].join("\n"),
  )
  process.exit(1)
}

function parseArgs(argv: readonly string[]): Config {
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined || !a.startsWith("--")) continue
    const name = a.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) usage()
    flags.set(name, value)
    i++
  }

  const rawPort = flags.get("port") ?? process.env.RELAY_PORT ?? "1999"
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`relay-serve: --port must be 1-65535, got "${rawPort}"`)
    process.exit(1)
  }

  const host = flags.get("host") ?? process.env.RELAY_HOST ?? "127.0.0.1"
  const org = flags.get("org") ?? process.env.RELAY_ORG ?? "local"
  if (!/^[A-Za-z0-9._-]+$/.test(org)) {
    console.error(`relay-serve: --org "${org}" is invalid — use only [A-Za-z0-9._-].`)
    process.exit(1)
  }

  const url = flags.get("url") ?? process.env.RELAY_URL ?? `http://127.0.0.1:${port}`
  const urlError = validateRelayUrl(url)
  if (urlError !== null) {
    console.error(`relay-serve: --url rejected: ${urlError}`)
    process.exit(1)
  }

  const keysFlag = flags.get("keys") ?? process.env.RELAY_KEYS ?? ".selfhost-keys.json"
  const keysPath = path.isAbsolute(keysFlag) ? keysFlag : path.join(REPO_ROOT, keysFlag)

  return { port, host, url, org, keysPath }
}

function warnIfUnreachable(config: Config): void {
  const parsed = new URL(config.url)
  const isLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1"
  const bindsAll = config.host === "0.0.0.0" || config.host === "::"

  if (bindsAll && isLoopback) {
    console.warn(
      `relay-serve: WARNING — binding ${config.host} (all interfaces) but the public URL is ` +
        `loopback (${config.url}). Members on other machines cannot reach it; ` +
        `pass --url https://<your-hostname> once TLS is in front.`,
    )
  }

  if (!isLoopback && !bindsAll) {
    console.warn(
      `relay-serve: NOTE — public URL is ${config.url} but this process binds ${config.host}.\n` +
        `  That is the intended setup when a Caddy/nginx TLS terminator fronts it.\n` +
        `  If nothing is proxying, remote members cannot connect.`,
    )
  }
}

async function loadOrCreateKeys(config: Config): Promise<SelfHostKeys> {
  if (existsSync(config.keysPath)) {
    const parsed = JSON.parse(readFileSync(config.keysPath, "utf8")) as Partial<SelfHostKeys>
    if (typeof parsed.seed !== "string" || typeof parsed.ck !== "string") {
      console.error(`relay-serve: ${config.keysPath} is malformed — expected { seed, ck, org }.`)
      process.exit(1)
    }
    if (parsed.org !== config.org) {
      console.warn(
        `relay-serve: key file was created for org "${String(parsed.org)}" but --org is ` +
          `"${config.org}" — reusing it under the new label. Use --keys <other path> to separate orgs.`,
      )
    }
    console.log(`relay-serve: reusing ${config.keysPath} (org identity preserved)`)
    return { seed: parsed.seed, org: config.org, ck: parsed.ck, createdAt: parsed.createdAt ?? "" }
  }

  const keys: SelfHostKeys = {
    seed: bytesToB64url(crypto.getRandomValues(new Uint8Array(32))),
    org: config.org,
    ck: bytesToB64url(crypto.getRandomValues(new Uint8Array(32))),
    createdAt: new Date().toISOString(),
  }
  writeFileSync(config.keysPath, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 })
  console.log(`relay-serve: generated ${config.keysPath} (fresh org identity, mode 0600)`)
  return keys
}

function writeVars(org: string, pubkey: string): void {
  const pubkeys = JSON.stringify([{ org, pubkeys: [pubkey] }])
  writeFileSync(VARS_PATH, `ORG_PUBKEYS=${pubkeys}\n`)
  console.log(`relay-serve: wrote ${VARS_PATH} (ORG_PUBKEYS)`)
}

function readVars(): Record<string, string | undefined> {
  const vars: Record<string, string | undefined> = {}
  for (const line of readFileSync(VARS_PATH, "utf8").split("\n")) {
    const eq = line.indexOf("=")
    if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return vars
}

function printGuide(config: Config, pubkey: string, invite: string): void {
  const lines = [
    "",
    "─".repeat(72),
    "Self-hosted relay (workerd — no Cloudflare account)",
    "─".repeat(72),
    "",
    `  Listening   : http://${config.host}:${config.port}`,
    `  Members dial: ${config.url}`,
    `  Org label   : ${config.org}`,
    "",
    "  ORG_PUBKEYS (already written to the vars file this process uses):",
    `    [{"org":"${config.org}","pubkeys":["${pubkey}"]}]`,
    "",
    "  Server invite (paste into Options → Collaboration, one per member):",
    `    ${invite}`,
    "",
  ]

  if (config.url.startsWith("http://") || config.url.startsWith("ws://")) {
    lines.push(
      "  NOTE: this is a loopback URL. Other machines cannot use it, and the",
      "  client rejects http:// for non-loopback hosts. To serve a team, put",
      "  Caddy/nginx in front for TLS and re-run with --url https://your.host",
      "",
    )
  }

  lines.push("  Docs: README.md → \"Self-host the relay on workerd\"", "─".repeat(72), "")
  console.log(lines.join("\n"))
}

function runWranglerDev(config: Config): void {
  const wranglerBin = path.join(RELAY_DIR, "node_modules", ".bin", "wrangler")
  if (!existsSync(wranglerBin)) {
    console.error(
      `relay-serve: wrangler not found at ${wranglerBin} — run \`pnpm install\` first.`,
    )
    process.exit(1)
  }

  const child = spawn(
    wranglerBin,
    [
      "dev",
      "--port",
      String(config.port),
      "--ip",
      config.host,
      "--env-file",
      VARS_PATH,
    ],
    { cwd: RELAY_DIR, stdio: "inherit", env: { ...process.env, ...readVars() } },
  )
  child.on("exit", (code, signal) => {
    if (signal) console.log(`relay-serve: wrangler dev terminated by ${signal}`)
    process.exit(code ?? 0)
  })
  child.on("error", (err) => {
    console.error(`relay-serve: failed to spawn wrangler dev: ${err.message}`)
    process.exit(1)
  })
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) usage()

  const config = parseArgs(argv)
  warnIfUnreachable(config)

  const keys = await loadOrCreateKeys(config)
  const pubkey = await deriveEd25519Pubkey(keys.seed)
  writeVars(config.org, pubkey)

  const invite = encodeServerInvite({ relay: config.url, org: config.org, sk: keys.seed, ck: keys.ck })
  printGuide(config, pubkey, invite)

  runWranglerDev(config)
}

void main()
