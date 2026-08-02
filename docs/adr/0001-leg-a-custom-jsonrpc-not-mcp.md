# Leg A speaks custom JSON-RPC, not MCP

The agent ↔ local-bridge leg ("Leg A") of agent-driven drawing needs a protocol; the
obvious 2026 default is MCP for any agent-tool surface. We use a **minimal custom
JSON-RPC** on Leg A, not MCP — because the portability and pedagogy vehicle for this
feature is the **Agent-agnostic drawing Skill** (it teaches an agent *how* to draw on our
canvas), not the wire protocol. Under that strategy MCP's free zero-glue interop is
redundant, and MCP's stateless tool/resource model fights our stateful single-active-canvas
session while pushing heavy Excalidraw payloads through the agent's token budget.

## Status

accepted — 2026-08-02 (Wayfinder Ticket 005)

## Considered Options

- **MCP on Leg A — rejected.** Gives free interop with any MCP-aware client, but: (a)
  redundant — the Skill is the portability vehicle, so "any MCP client, zero glue" is not a
  goal (interop档位 *ii*: the N agents we actually use, via a shipped skill); (b) MCP's
  stateless tool surface mismatches our stateful single-active-canvas session and would need
  an extra session layer; (c) large scene payloads routed as tool args consume the agent's
  token budget; (d) `initialize` / `tools.list` / `capabilities` handshake is pure overhead
  for a single-canvas target. Decisive point: **MCP does not teach the agent how to use the
  tool** — without the Skill the agent trial-and-errors; the Skill is what carries that
  knowledge, making MCP's interop upside worth less than its costs here.
- **Custom JSON-RPC on Leg A — chosen.** Lean, full control over session semantics and
  payload framing, consistent with the existing `chrome.runtime.onMessage`
  string-discriminated style (just framed over the bridge transport).

> Scope note: this decides only **Leg A** (agent ↔ bridge). **Leg B** (bridge ↔ editor page
> over `ws://127.0.0.1`) is a separate, already-locked decision — minimal custom JSON-RPC
> for our own private page (Wayfinder Tickets 008 / 010 / 012, the in-tab reverse-WS
> transport).

## Consequences

- **Server-push / streaming is no longer free.** MCP would have handed us a push channel for
  an agent to *observe* live canvas changes; custom JSON-RPC does not, by default. **v1 is
  request/response** (read-after-write; poll if needed). Push/streaming is deferred to the
  bidirectional command-map work and tracked as Map *Not-Yet-Specified* / Ticket 007.
- **The drawing Skill (Ticket 009) is the load-bearing artifact.** Design energy goes to the
  Skill (how to teach drawing), not the protocol. The protocol is plumbing.
- **Tickets 007 (command map) and 011 (auth / allow-list) are unblocked** and will be
  designed against this custom protocol.
