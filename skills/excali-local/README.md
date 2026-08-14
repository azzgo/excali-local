# excali-local — the Agent-agnostic drawing skill

[简体中文](./README.zh-CN.md)

A self-contained skill that teaches any coding agent to drive the **Excali
Local** editor (a local-first browser extension running Excalidraw fully
offline) through one small CLI: `excali-bridge`.

- **Read** [`SKILL.md`](SKILL.md) first — overview, consent model, routing.
- **Reference docs** live in [`references/`](references/) (command surface,
  element templates, JSON schema, color palette, style presets, shape grammar,
  workflows).
- **The daemon** is bundled pre-built for four platforms under [`bin/`](bin/).
  It is BOTH the WS server the editor page connects to (Leg B) AND the agent
  CLI you invoke (Leg A) — one binary, launched lazily on first use.

## Install

### Quick Install (Recommended)

Paste this into your AI agent (Claude, Codex, Cursor, Pi, Gemini CLI, etc.) — it will handle everything for you:

> Install the excali-local skill from azzgo/excali-local. After installing,
> use it to start the daemon by running `excali-bridge ping` from the skill's
> bin directory. I'm on macOS Apple Silicon.

That's it. The agent will install the skill, detect your platform, and start the daemon.
Once the daemon is running, open the Excali Local extension in your browser —
it will detect the daemon and offer pairing (popup: "Paired"; canvas button: ready → activate).

### Manual Install

If you prefer to install yourself, use the [`skills`](https://github.com/vercel-labs/skills) CLI
(npm package `skills`, maintained by **vercel-labs/skills**):

```bash
npx skills add azzgo/excali-local --skill excali-local -y
```

Read-only discovery (`--list`) confirms the skill exists and is named
`excali-local` before installing:

```bash
npx skills add azzgo/excali-local --list
```

Then start the daemon by telling your agent:

> **"Use the excali-local skill: run excali-bridge ping"**

Or run it yourself from the skill folder (see [Picking your binary](#picking-your-binary) below).

> **Installing is not enough — you must start the daemon.**
> The pairing condition is a **running daemon**, and the daemon only spawns
> lazily on first use. Only then does the extension detect it and offer pairing.

## Picking your binary

| Platform | Binary |
| --- | --- |
| macOS (Apple Silicon) | `bin/excali-bridge-darwin-arm64` |
| macOS (Intel) | `bin/excali-bridge-darwin-amd64` |
| Linux (x86-64) | `bin/excali-bridge-linux-amd64` |
| Windows (x86-64) | `bin/excali-bridge-windows-amd64.exe` |

Verify: `bin/excali-bridge-<your-platform> ping` → prints `"pong"`. The
human-facing way to start it is to tell your agent: **"Use the excali-local
skill: run excali-bridge ping"** — the first invocation starts the daemon
(lazy spawn) — the local bridge your canvas connects to (or run `excali-bridge serve` yourself).

## Building from source

The prebuilt binaries are committed, so you normally never need to build.
To rebuild them yourself (from the excali-local repo):

```bash
pnpm bridge:build                 # host build (dev)
pnpm skill:pack                   # cross-compile the 4 platform binaries into bin/ + static-verify
tsx scripts/agent-bridge/driver-skill.ts   # smoke-test the source skill's binary
pnpm skill:check                  # command-reference.md <-> contract drift check
```

`skill-pack` builds the binaries **in place** into `bin/` (the committed source
skill IS the artifact) and fails loudly if any target does not build, does not
pass `go vet`, or fails static verification.

## Version

This skill tracks the excali-local release version (currently `1.7.4`).
