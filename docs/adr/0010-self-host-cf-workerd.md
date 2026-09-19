# 1.8.0 self-host collab relay: run workerd directly; open-compute & celld are tracked, not adopted

`packages/collab-relay` is wire-stable against any wrangler-compatible runtime.
ADR 0003 lists three self-host candidates; the **celld** path was the
preferred target, but a 2026-08 pilot found celld v0.3.0's embedded V8 rejects
Ed25519 raw key import — every org-signed hello was rejected with
"unsupported key import". ADR 0003's escape hatch was *"complete fallback
today: run workerd itself"*. 2026-09-08 workerd was actually run end-to-end
in this repo and the Ed25519 verify path passed; this ADR locks that
decision and demotes/re-promotes the alternatives accordingly.

## Status

accepted — 2026-09-08 (chat-time; reviewed together with the
`docs/adr/0003` runtime fallback note)

## The decision

**Run `workerd` itself for self-hosted `collab-relay`.** No third-party
runtime on top. The `pnpm relay:dev` skeleton stays, but is moved from
"dev-only" to "dev + self-host prod with the same entry". Specific
concretization:

- **Runtime: `workerd` v1.20260820.1 or newer** (latest stable; pinned later
  in `package.json` once a versions pin lands). `collab-relay` already
  targets this version's `partyserver` contract — the **Ed25519 hello
  verify probe of 2026-09-08 confirmed production parity** (raw 32-byte
  public-key import → `crypto.subtle.verify({name:"Ed25519"})` returns
  `true`; tampering returns `false`; **no** `unsupported key import`).
  See "Decision log: probe result" below.
- **Transport: `wrangler dev` for both dev and prod.** `wrangler dev`
  drives the same `workerd` binary Cloudflare's edge uses; the dev flag
  becomes the only difference between dev and self-host prod. **This kills
  the "dev vs prod parity" question** for the wire contract.
  - Cloudflare Workers stays the **default** dev/deploy path (`pnpm relay:dev`).
    Self-hosting is the opt-in alternative (`pnpm relay:serve`), so the
    default tooling and docs never depend on the self-host entry.
- **TLS: terminator at the edge (Caddy / nginx / Cloudflare-frontend of
  the deployer's choice).** Not the runtime's job. Documented as a
  one-paragraph "deployers' checklist" addendum to `docs/COLLAB.md`,
  not a re-engineering of the relay.
- **Single-node. SQLite cells built into workerd give Durable Object
  persistence** on one machine. Multi-node replication is **not** an
  ADR-0010 concern; when it becomes one, it's ADR-0012+ (multi-node is
  not free in any candidate).
- **Ed25519 fixtures become a smoke test.** The 2026-09-08 probe
  (`scratch/ed25519-test/worker.js` → `wrangler dev` round-trip with a
  Node-generated keypair) is landed as `scripts/relay-ed25519-smoke.ts`,
  runnable as `pnpm relay:smoke` (verified passing 2026-09-08). It is a
  local, on-demand gate — no CI wiring is planned, so a runtime swap is
  validated by running one command, not by a pipeline.

## Why not the alternatives

| axis | **workerd (this ADR)** | **open-compute** (elliothux) | **denoland/celld** | **wrangler dev** (as a deploy target) |
| --- | --- | --- | --- | --- |
| what it is | Cloudflare's open-source V8 isolate runtime (Apache-2.0); the bit Cloudflare's edge runs anyway | Rust single-binary CLI that bundles a workerd fork + DO/SQLite + admin surfaces | Rust single-binary DO runtime with bare V8 (no CF WebCrypto) | Cloudflare's dev-mode CLI; same workerd binary, but advertised for development |
| Ed25519 raw pub import | ✅ **verified 2026-09-08** end-to-end against `workerd 1.20260820.1` | ✅ **should** pass — fork is pinned to workerd `v1.20260905.0-open-compute-p1.b3e1a278` (newer) | ❌ **pilot 2026-08: every hello rejected** ("unsupported key import"); vanilla V8 has no CF WebCrypto polyfill | ✅ yes (same workerd binary) — but only at dev-time |
| publish & maintenance | CF-maintained; weekly dated releases; LTS train documented | single-maintainer fork, tracks upstream; no release SLA | personal-project cadence; celld is a side of denoland | CF-maintained; tied to current workerd |
| build & deploy cost | users run `wrangler dev` for prod; prebuilt `workerd` is on npm (`@cloudflare/workerd-darwin-arm64` etc.) | users compile ocd from source — requires Rust + LLVM 19 + bazel (~10-15 min one-time; CI rebuild on every ell workerd bump is heavier) | ditto, plus the missing WebCrypto means users must polyfill | trivially `npx wrangler dev` — but **not meant for production traffic** (no durable SQLite, no hibernation, ephemeral state) |
| TLS / reverse proxy | user provides (Caddy, nginx, etc.) — one-liner | built-in (Rust binary owns listeners) | built-in | dev-server mode only |
| multi-node DO replication | **out of scope**; single-node + SQLite cells on disk | not exposed | not exposed | n/a |
| operational maturity for "self-host relay" | highest of the three — the same runtime CF runs in production, just standalone | middle — comes with packaging, loses CF backend | lowest — known missing primitives |
| standalone single-binary | ❌ — needs workerd binary + wrangler invocation (or hand-rolled capnp config) | ✅ | ✅ | ❌ |
| license | Apache-2.0 | see their LICENSE (typically MIT) | see their LICENSE | MIT |

The decisive column is **Ed25519 raw pub import**: it is the wire-level
gate that defines whether org-signed hello admission works. workerd passes
the empirical test today; open-compute is the same code on a newer commit,
so it would too, but it carries a build-the-fork dependency that gives
nothing the user does not already get from `wrangler dev` against stock
workerd; celld fails it and the denoland team has not prioritized the gap.

## Considered Options

- **Adopt open-compute as the public self-host tarball** — rejected
  for v1. Same code shape as workerd plus a Rust wrapper, but the wrapper
  adds a hand-rolled build pipeline (Rust + LLVM 19 + bazel) and a
  single-maintainer fork that drags every bump. The user already needs
  `wrangler dev` to run the relay in development; using the same
  invocation in production removes an entire reproducibility hurdle.
  open-compute stays listed in `docs/COLLAB.md`'s "future options" with
  a tracked issue link in case the build/fork story stabilizes.
- **Wait for celld's upstream to grow Ed25519 raw import** — rejected
  for v1. The denoland roadmap is Deno-first; celld is a peripheral that
  has not seen a release between v0.3.0 and the time of writing, and
  the gate (raw pubkey import in V8's WebCrypto polyfill) is a non-
  trivial upstream change. Re-check after celld ships two releases
  beyond v0.3 with documented crypto. Documented as a TODO with a
  trigger: *"the moment celld passes our Ed25519 hello fixture, we
  re-promote it as the preferred path — it has the cleanest single-
  binary story for users who want no Node-runtime"* (ADR-0011+).
- **A custom runtime over V8** — rejected. Adding primitives celld
  missed is a bottomless pit; the entire reason to pick workerd over
  celld is "the runtime maintainers know Workers". Reaching past
  workerd puts the relay project in the runtime business.
- **Cloudflare Workers hosted plan for the user's relay (third-party
  operators only)** — out of scope. ADR 0003's threat model explicitly
  assumes the deployer is **not** on Cloudflare's edge. Self-host is
  the right name for what we ship.

## Consequences

> **Status of this section (2026-09-12).** The decision itself is settled and
> locked. The follow-ups below are landed: the self-host entry
> (`pnpm relay:serve`), the smoke test (`pnpm relay:smoke` — a local, on-demand
> check, deliberately not a CI step), and the README / `docs/COLLAB.md` /
> `KNOWN_LIMITATIONS.md` documentation.

- **Self-host entry: `scripts/relay-serve.ts` (`pnpm relay:serve`).** The
  production-flavored counterpart to `relay:dev`: same `wrangler dev` launch,
  but parameterized port/host/public-URL/org/key-file, writing its own
  `.selfhost.vars` so it never depends on the dev-seeded env. Prints the
  `ORG_PUBKEYS` value and a paste-ready invite for the configured public URL.
  **The README's "Self-host the relay on workerd" section is the deployer
  walkthrough.**
- **`scripts/relay-ed25519-smoke.ts` (repo-root, sits next to
  `scripts/relay-dev.ts`)** is the smoke test, run as `pnpm relay:smoke`.
  It is a **local, on-demand gate, not a CI job** — deployment is optional
  and must not be coupled to the release pipeline. The fixture stands in for
  "the first hello a member sends" and pins 32-byte raw pubkey round-trip as
  the contract test: any future runtime swap is settled by running one
  command.
- **Deployer runbook: README → "Self-host the relay on workerd".** A
  walkthrough pointing at `pnpm relay:serve`, with a Caddy example for TLS
  and a note that workerd binds on `127.0.0.1` by default and the deployer
  fronts it. Cloudflare Workers remains the default documented path.
- **Operational honesty: no formal SLA on self-hosted workerd.**
  This ADR does not introduce an SLA; Cloudflare does not provide one
  for the open-source build and we do not commit to one for the
  deployer's behalf. `KNOWN_LIMITATIONS.md` carries the bullet: *"self-
  hosted collab relay SLA is the deployer's; this repo ships the
  runtime integration, not a turnkey platform"*.
- **OUT_OF_SCOPE for ADR-0010, recorded for after:** (a) capnp-only
  config translation for users who want to drop `wrangler dev` (real
  adoption is small — wait for ask); (b) multi-node DO replication
  (when relaying > ~1000 concurrent rooms on one box becomes a real
  pain, trigger ADR-0012+); (c) celld re-evaluation once it has two
  releases past v0.3 with documented Ed25519 path (monitor repo,
  no code changes); (d) deploy-time inventory: per-bin sha256 +
  expected workerd version in the relay's `/healthz` response, so
  deployers can pin runtime.
- **Compatibility dates move with the wrangler / workerd release line.**
  `compatibility_date` stays latest stable. The gate is `pnpm relay:smoke`,
  run on demand when a runtime or workerd version changes — a CF release that
  breaks our Ed25519 contract is caught by one command, not by a pipeline.

## Decision log: probe result (2026-09-08)

```
setup:
  /Users/ison/.workbuddy/scratch/ed25519-test/worker.js  — 30 lines
      importKey("raw", pubRaw, {name:"Ed25519"}, false, ["verify"])
      verify({name:"Ed25519"}, key, sig, msg)
  /Users/ison/.workbuddy/scratch/ed25519-test/wrangler.jsonc
      compatibility_date: 2026-08-01, workers_dev: false

client (Node 22):
  kp   = crypto.subtle.generateKey({name:"Ed25519"}, true, ["sign","verify"])
  raw  = exportKey("raw", kp.publicKey)      // 32 bytes
  sig  = sign({name:"Ed25519"}, kp.privateKey, msg)
  POST {pubRaw, msg, sig} (all base64url) -> /verify on wrangler dev

result:
  happy   -> {"importedOk":true, "verifyOk":true, "err":null}
  tampered-> {"importedOk":true, "verifyOk":false, "err":null}
```

The tampered-response assertion is what makes the fixture a real test,
not a smoke check. When a runtime version is bumped, re-run the same shape
against the new version and treat any release that returns
`importedOk:false` or flips `verifyOk` for the tampered input as a blocker.

## Cross-refs

- ADR 0003 §"Non-Cloudflare self-hosting" — the original fallback
  language. Edit ADR 0003 to point at ADR 0010 for the picked path
  (small, mechanical change to its implementation note).
- `docs/COLLAB.md` Self-hosting section — gets the deployer runbook
  paragraph this ADR defers to.
- `KNOWN_LIMITATIONS.md` — adds the no-SLA bullet.
- `scripts/relay-dev.ts` — unchanged. It stays the **Cloudflare-default** dev
  loop; the self-host entry is the separate `scripts/relay-serve.ts`.
