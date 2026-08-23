/**
 * relay-keygen — production org keypair + server invite generator.
 *
 * The production counterpart of relay-dev's seed+invite step: derives a fresh
 * org Ed25519 keypair and an org content key (`ck`), prints (a) the
 * `ORG_PUBKEYS` env entry the deployed relay must be configured with, and
 * (b) a paste-ready server invite for your org label + relay URL.
 *
 * Usage:
 *   pnpm relay:keygen --org acme --relay https://relay.example.com
 *
 * Output material is printed once and NOT persisted — pipe to a file
 * yourself and store it in your secret manager (sk/ck are client-config-only
 * and must never reach the relay).
 */
import { bytesToB64url, deriveEd25519Pubkey, encodeServerInvite, validateRelayUrl } from "../packages/collab-core/src/index"

interface Args {
  org: string | null
  relay: string | null
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { org: null, relay: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org" && argv[i + 1] !== undefined) {
      args.org = argv[++i]
    } else if (argv[i] === "--relay" && argv[i + 1] !== undefined) {
      args.relay = argv[++i]
    }
  }
  return args
}

function usage(): never {
  console.error("usage: pnpm relay:keygen --org <org label> --relay <https://relay.example.com>")
  process.exit(1)
}

async function main(): Promise<void> {
  const { org, relay } = parseArgs(process.argv.slice(2))
  if (org === null || org === "" || relay === null || relay === "") usage()
  if (!/^[A-Za-z0-9._-]+$/.test(org)) {
    console.error(`relay-keygen: org label "${org}" is invalid — use only [A-Za-z0-9._-].`)
    process.exit(1)
  }
  const relayError = validateRelayUrl(relay)
  if (relayError !== null) {
    console.error(`relay-keygen: invalid relay URL: ${relayError}`)
    process.exit(1)
  }

  const seed = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
  const ck = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
  const pk = await deriveEd25519Pubkey(seed)

  console.log(`relay-keygen: org "${org}" — keep sk/ck secret (they ride server invites only).`)
  console.log("")
  console.log(`ORG_PUBKEYS entry (set on the deployed relay, e.g. wrangler secret put ORG_PUBKEYS '…'):`)
  console.log(`  [{"org":"${org}","pubkeys":["${pk}"]}]`)
  console.log("")
  console.log("Server invite (paste into Options → Collaboration for each member):")
  console.log(`  ${encodeServerInvite({ relay, org, sk: seed, ck })}`)
  console.log("")
  console.log("Note: everyone holding this invite is a member of the org (it carries sk + ck).")
  console.log("Leak → rotate both keys and re-issue invites (see docs/COLLAB.md → Key rotation).")
}

main().catch((err) => {
  console.error(`relay-keygen: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})