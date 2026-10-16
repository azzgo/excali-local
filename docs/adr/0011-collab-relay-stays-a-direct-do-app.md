# Collab relay stays a direct DO application: no actor-orchestration migration (RivetKit), no generic actor-core refactor

`packages/collab-relay` is a Cloudflare Durable Object application: one DO per
room, keyed by `shareId`. The obvious 2026 move for "portable stateful actors"
is to re-host it on an actor-orchestration platform — [RivetKit](https://rivet.dev)
being the concrete candidate, since it already runs a sibling project's
transport. This ADR records why we are **not** doing that, why we are **not**
refactoring the relay into a generic actor core + platform adapters either, and
what we do instead.

The question was raised against a wrong premise: *"excali-local only accepts
local HTTP"*. It does not. Realtime collab (ADR 0003) is already a **remote**
network surface — the extension dials `ws(s)://<relay>/party/<shareId>` directly
(`packages/collab-core/src/client.ts:122`, `:354`), and the `extension_pages` CSP
`connect-src` was deliberately widened to `wss: https:` for it. The "fully
offline / no remote services" claim in `README.md` and
`skills/excali-local/SKILL.md` is scoped to the **agent-bridge surface** (Leg A /
Leg B) and to *"the project operates no servers"* — never to "the extension
makes no remote connections". Collab is an explicit third route beside
`local` / `quick` / WebMCP.

## Status

accepted — 2026-10-16 (chat-time architectural review; decision record only, no
implementation change lands with it)

## The decision

**D1 — The relay stays a direct Durable Object application.** No
actor-orchestration platform (RivetKit or equivalent) is introduced into the
collab data path. The room server remains `partyserver` on workerd / Cloudflare
DO, dialled directly by the extension.

**D2 — No generic "actor core + platform adapter" refactor.** The relay is not
reshaped around an invented actor interface. The abstraction that matters
already exists (`RoomHooks` + `RoomStorage`, 5 methods) and its boundary is
correct; the un-abstracted part is an **execution-model guarantee**, which is a
contract, not an interface — see the appendix.

**D3 — Runtime portability is preserved as a documented seam, not a new
component.** If "must not run on workerd" ever becomes a real requirement, the
answer is a ~500-line second host over the existing 5-method seam, not an
orchestration platform. The seam's guarantees are written down once (appendix)
so that host is mechanical rather than archaeological. ADR 0010 already covers
the "not Cloudflare" case by running workerd directly.

## Why not migrate to an actor-orchestration platform

The mapping is genuinely good — and that is exactly why it buys nothing. The
live-cursors guide's model (one room actor per key, ephemeral presence in
`connState`, persistent content in `state`) is what the DO relay **already**
implements: per-room DO via `idFromName(shareId)`, `room.storage` for
`snapshot` / `room-name` / `file:<fileId>`, in-memory roster + pointer +
presenting flags that are never persisted (`docs/COLLAB.md` §Presenting;
`packages/collab-relay/src/room.ts:60-72`, `:444-446`).

What a platform would change is not the actor abstraction but **who provides
the actor runtime**:

| | today | with RivetKit |
| --- | --- | --- |
| artifacts the team deploys | **1** — the relay (`wrangler deploy`, or `workerd`) | **3** — control plane (Engine) + long-lived Runner host + gateway endpoint |
| browser connects to | the relay, directly | the Rivet gateway, routed to a runner |
| extension dependencies | **0** (`new WebSocket` + WebCrypto) | `rivetkit/client` (or an unverified raw-WS contract) |
| client-side credentials | server invite `sk`/`ck` (never sent to the relay) | + a publishable control-plane token |
| content-blindness | inherent (the relay forwards ciphertext) | must be preserved by using only `onWebSocket` raw — i.e. giving up typed actions / `state` / `connState` |
| what an upgrade touches | one artifact | engine + runner + gateway + per-pool runner-config, version-locked together |

Three arguments decide it:

1. **The runtime guarantee and the portability benefit are structurally
   coupled.** RivetKit has two deployment shapes and they are mutually
   exclusive. The Cloudflare Workers shape (actors in DOs via
   `@rivetkit/cloudflare-workers`) needs **no** Runner process — but it is
   *identical to today's runtime* plus a mandatory external control plane, so it
   buys **zero** portability. The self-hosted shape (Engine + long-lived Runner)
   does buy portability — and requires exactly the process you were trying to
   avoid. There is no configuration that gets the benefit without the Runner.
2. **Content-blindness cancels the remaining value.** ADR 0003's review
   amendment is absolute: the relay stores no plaintext. RivetKit's typed
   actions, `state` and `connState` all assume the actor may inspect payloads.
   Under the raw-WS variant the relay keeps forwarding opaque, member-signed
   frames — at which point the platform has contributed an orchestration layer
   for **one** actor type and one key space. Orchestration layers are for many
   actor types across a fleet.
3. **The product principle forbids the shared-infrastructure shortcut.** ADR
   0003's premise is *"the extension project operates no servers"* and *"one
   relay per extension — your team deploys it"*. Reusing an existing Engine
   (e.g. a sibling project's) to amortise the control plane would make that
   project the middleware for users' collaboration.

The live-cursors guide's genuinely transferable content is its
**production-hardening** list, not its runtime. Measured against the code:

| guide guidance | relay today |
| --- | --- |
| client 20–30 Hz throttle, flush the final position | ✅ ~100 ms trailing-edge on pointer / present / scene |
| server-side per-connection rate limit | ✅ `RateGuard`, 200 msgs/s sliding window per conn, non-fatal drop (`guards.ts:135-180`, wired at `index.ts:113`) — deliberately a *flood guard*, not a per-type throttle, per 052 §5 |
| cap text length / entry counts | ✅ `ROOM_NAME_MAX_LENGTH`, `MEMBER_NAME_MAX_LENGTH`, `MAX_FRAME_BYTES`, `MAX_CHUNKS_PER_MESSAGE`, 20 MB/file |
| bind identity to the connection, never trust a client-supplied `userId` | ✅ stronger than the guide: relay-stamped `from` at envelope level + per-frame Ed25519 member signatures verified client-side against the roster |
| clamp pointer coordinates | ❌ unclamped — and correctly a **client-side** fix: `pointer` is pure pass-through and never stored (`room.ts:567-569`) |

So the only actionable guide item is a small client-side clamp. Everything else
is already done or is a recorded, reasoned decision.

## Why not the generic actor-core refactor

The refactor is **already in the codebase**. `packages/collab-relay/src/`:

```
index.ts    242 lines  ← the ONLY file importing partyserver (the adapter)
server.ts   618 lines  ← core: createRelayServer(hooks)
room.ts     683 lines  ← core: RoomState({ hooks, storage, fileStore, memberKeys })
files.ts    400 lines  ← core: createFileStore({ roomId, storage, hooks })
guards.ts   177 lines  ← core
verify.ts   377 lines  ← core
```

Three file headers state the split outright: *"Wire/admission/room logic
(server.ts / room.ts / files.ts / guards.ts / verify.ts) is runtime-agnostic and
unchanged"* (`index.ts`), *"no PartyKit runtime — storage + hooks are injected"*
(`files.ts`), *"runtime-agnostic, implemented by the partyserver host"*
(`server.ts`). The whole host contract is:

```ts
interface RoomHooks   { send(connId, frame); broadcast(frame, except?) }
interface RoomStorage { get(key); put(key, value); delete(key) }
```

What is **not** abstracted, and cannot be expressed as an interface, is the
**execution model**. The DO guarantees per-room serialized execution — no
interleaving between `await`s — and the core's correctness depends on it:

- first-seed-wins needs no arbitration *because* the DO serialises the race
  (`docs/COLLAB.md`: *"the relay's single DO instance serializes the race"*);
- last-write-wins is defined as *relay arrival order*;
- persistence is deliberately **off the critical path**: `handleRoomName` mutates
  memory and broadcasts before the `await this.storage.put(...)` that only logs
  on failure (`room.ts:451-459`), and `acceptSnapshot` assigns `this.snap` before
  broadcasting (`room.ts:529-556`).

Any framework that owns state and continues only after awaiting persistence —
RivetKit's `state` is exactly that shape — changes those semantics. That is not
a refactor risk to be managed; it is the abstraction failing at the one property
that matters. The two real platform constants that do leak into the core are
parameters, not architecture: the 256 KB DO per-message cap
(`MAX_DO_MESSAGE_BYTES`, from which the chunk threshold derives) and the 128 KB
per-value storage limit that forces the `snapshot:frame:<i>` key split
(`room.ts:524-530`).

## Considered Options

- **Migrate the relay to RivetKit actors — rejected.** The component-count,
  content-blindness and coupling arguments above. Cost estimate for the record:
  relay host swap **M (1–2 weeks)** — only `index.ts` + a host adapter, since
  `RoomState` / `FileStore` / `guards` / `verify` move verbatim — plus **S–M** on
  the client (`buildRoomUrl` + the WS factory) plus a **new, unbounded**
  operational surface (control plane, Runner hosts, gateway, per-pool
  runner-configs, version lockstep). The cost is not the reason; the missing
  benefit is.
- **Refactor to a generic actor core today — rejected (YAGNI).** Abstraction
  pays when there are ≥2 real adapters, or the second is imminent, or the leak is
  producing bugs. There is **1** adapter (partyserver); the injection seam is
  already exercised by the test hosts, so it is validated; ADR 0010 already
  answers "not Cloudflare"; and the known leak (ghost connections after DO
  restarts with surviving sockets) is already compensated in `index.ts`.
  Designing the interface now would freeze DO's accidental properties and call
  them generic.
- **Write a second (native Node/SQLite) host now — rejected, kept as the
  fallback.** It is the *better* portability answer (no control plane, no
  Runner, **and no client change** — still
  `ws(s)://<host>/party/<shareId>`), but no trigger has fired. Keeping it cheap
  is a documentation task, not a code task: see the appendix.
- **Server-side opaque buffering / durable queues for offline members —
  rejected.** Offline convergence is already solved client-side by the ADR 0005
  re-entry rule and the three-way merge (ADR 0007). Buffering ciphertext
  server-side would *increase* relay footprint and contradict `docs/COLLAB.md`'s
  "nothing user-visible ever accumulates server-side".
- **Rate-limiting as a strictly per-type throttle (the guide's posture) —
  rejected, deliberately.** 052 §5 chose a generous flood guard over a throttle;
  the reasoning is recorded in `guards.ts` (200/s is far above every legitimate
  pattern: scene ≈10/s, pointer bursts, a 20 MB file-put ≈105 chunk frames).
- **Pointer-coordinate clamping at the relay — rejected as the wrong host.**
  `pointer` is never stored (`room.ts:567-569`), so a clamp belongs in the
  client's presence-apply path in `collab-core`. Recorded as a follow-up, not a
  relay guard.

## Revisit triggers

This decision holds **until the relay stops being a dumb ciphertext pipe**.
Concretely, revisit this ADR when any one of the following lands:

1. **Host powers** appear (kick, transfer, privacy change, ownership handover) —
   the exact trigger ADR 0003 recorded when deferring a host token.
2. **A server-side room registry** or a browsable room list is wanted — ADR 0003
   rejected this; a reversal makes the relay a real service with actor
   inventory.
3. **Room ↔ org binding and room-level isolation between orgs** (today
   documented as future work) plus moderation or audit surfaces.
4. **Per-org quotas and metering on the relay** — i.e. genuinely multi-tenant
   hosted relay operation.
5. **A runtime constraint that "run workerd yourself" cannot satisfy** — not
   "we would prefer another runtime".
6. **Collaboration is re-hosted as a shared service for several projects**, so
   the control-plane cost is amortised across more than one actor type.

Absent one of those, introducing an orchestration platform means paying a
control plane to run one actor type.

## Consequences

- **The collab data path is frozen as: extension → your relay → per-room DO.**
  No gateway, no control plane, no runner. `docs/COLLAB.md` remains accurate.
- **The client stays dependency-free on this path** — `WebSocket` + WebCrypto
  only. This is now an explicit architectural property, not an accident.
- **Runtime portability is preserved at zero cost** by the appendix contract.
  Cost to realise it: implement 5 methods and satisfy 8 invariants; the client
  and the wire contract do not change.
- **`ADR 0010`'s "(ADR-0011+)" cross-reference is disambiguated** to avoid
  collision with this record: it now reads "(a future ADR)". The celld
  re-promotion trigger itself is unchanged.
- **Recorded follow-ups (not done here, not blocking):**
  - The pointer-coordinate clamp in the client's presence path — the one
    actionable item from the live-cursors guide.
  - **Documentation drift found during this review:**
    `docs/KNOWN_LIMITATIONS.md:119` still says *"the relay reference does not
    rate-limit or throttle traffic"*, which `guards.ts`'s `RateGuard` has
    superseded. The honest wording is "a flood guard exists (200 msgs/s per
    connection, non-fatal drop); a per-type throttle does not, by design
    (052 §5)". Both language halves of the pair need the correction.
- **Not in scope, recorded:** RivetKit's docs could not settle whether a
  non-`rivetkit/client` raw WebSocket can address an actor, nor whether one
  namespace may host multiple providers with distinct registries. Both would
  matter only under trigger 6.

## Appendix: relay host contract

The abstraction we chose instead of a generic actor interface: the guarantees a
second host must uphold. This list is extracted from the code and its comments;
item 6 is the reason `snapshot` is stored as a chunk set rather than one value,
and item 8 is behaviour that was found the hard way (production-stress), then
compensated in `index.ts`.

**A host must guarantee:**

1. **Per-room serialized execution.** Messages for one room are processed one at
   a time; no interleaving across `await` points, and no concurrent entry from
   two connections. (The core's seed-race and LWW semantics depend on this.)
2. **`RoomStorage` with `get` / `put` / `delete`**, readable after a cold start
   and surviving a process restart.
3. **Stable connection identity** for the lifetime of a connection, and a close
   notification that always arrives (including abnormal close).
4. **Order preservation** for frames delivered to the same connection (LWW is
   defined as relay arrival order).
5. **A single-frame ceiling of at least 256 KB**, with over-cap being a **fatal
   close** — never silent truncation.
6. **A declared single-value storage limit.** Currently 128 KB, which forces the
   `snapshot:frame:<i>` split (`room.ts:524-530`). This is the one parameterizable
   value in the contract.
7. **Room destruction when empty**, plus the cold-start shape "in-memory empty,
   storage intact" — the core rebuilds from storage and must not assume any
   in-memory field survived.
8. **Detection or closure of ghost connections**: a socket may outlive the
   in-memory roster (hibernation / restart). Either the host surfaces the
   mismatch, or it lets the core close the socket so the client redials and
   re-hellos (`index.ts`, the `onMessage` ghost-recovery branch).

**A host need not guarantee** (the core owns these): chunk reassembly, per-frame
size and rate guards, signature and store verification, dedup, roster and
presence management, room-name / member-name validation.

## Cross-refs

- ADR 0003 — BYO relay realtime collab: the model, the three credential layers,
  the content-blind amendment, and the "project operates no servers" premise
  this ADR protects.
- ADR 0010 — self-host on workerd: the answer to "not Cloudflare", and the
  reason trigger 5 is currently unfired.
- `docs/COLLAB.md` §Security model, §Local dev loop — the surface this decision
  keeps accurate.
- RivetKit live-cursors guide (https://rivet.dev/guides/live-cursors/) — the
  pattern reference this review measured against; its transferable content is
  the hardening table, not the runtime.
- RivetKit runtime modes / Cloudflare Workers quickstart — the two deployment
  shapes behind argument 1.
