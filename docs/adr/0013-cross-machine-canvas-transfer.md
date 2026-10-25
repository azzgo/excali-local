# Cross-machine Canvas transfer: a second LAN listener, plaintext, transfer-only, receiver-confirmed

The first cross-machine feature is not a room and not a relay — it is one user
carrying one canvas from machine A to machine B on the same network, without
saving a file and without passing through the relay. The obvious implementations
(a LAN room, a P2P session, a resumable sync) are all wrong for what is wanted.
This ADR records the narrow shape.

## Status

accepted — 2026-10-01 (chat-time; first slice of the *Peering* concept in
[CONTEXT.md](../../CONTEXT.md))

## The decision

**1. The feature is a move, not a relationship.** A **Canvas transfer** is
one-shot, explicitly initiated, and complete when the receiver's canvas has been
replaced. It creates no session, no roster, no room, and no ongoing connection.
"Synchronization across machines" is explicitly not this feature; S3-style
bidirectional merge was rejected because it would drag `collab-core/src/merge.ts`
semantics into the daemon.

**2. A second, separately-switched listening surface.** The existing daemon
surface stays exactly as it is: bound to `127.0.0.1`, permanently on, gated by the
origin allow-list plus the two consent gates. The **LAN listener** is:

- **off by default**, opened by an explicit user act (`excali-bridge lan on`),
  and re-closed on the next start unless the user persisted it;
- bound to `0.0.0.0` on a **system-assigned ephemeral port** — fixed ports lose
  on multi-homed machines and port conflicts. The port changes on every restart
  by design; the receiver's current address is exchanged by hand (a copy-paste
  of `IP:lanPort` from its `/health`), never assumed;
- **carrying only transfer**: offer / accept / reject / chunk-carry. It must not
  reuse `originAllowed()` — that function *rejects* an empty `Origin`
  (`packages/bridge/internal/server/server.go:207`), and a Go peer sends no
  `Origin` at all, so the check would reject every legitimate peer while saying
  nothing useful about the ones that should be refused. LAN exposure is not a
  widening of the loopback surface; it is a different surface with a different,
  smaller capability set.

**3. Discovery is deliberately absent, on every platform.** The review settled
on manual addresses, not mDNS: userland mDNS is not viable (macOS
`mDNSResponder` owns port 5353 and the OS delivers a multicast packet to one
socket; the common workaround violates RFC 6762 §11), doing it correctly needs
per-platform system APIs, and half of real networks block multicast anyway. A
peer is a **machine** with no account and no membership; its address is
exchanged by hand, and `excali-bridge peers` lists the peers the user added with
no GUI present. (An earlier draft of this ADR placed mDNS in the daemon; that
was dropped before implementation.)

**4. Trust: none proven, receiver decides.** Same-network parties are not
authenticated. A **Device fingerprint** identifies (so a machine can ignore its
own announcement) but proves nothing; a peer that announces a fingerprint has
authenticated nothing. The only gate is a human one: a **Transfer offer** carries
descriptive metadata only — device alias, fingerprint, element count, estimated
bytes, the canvas's local name — and **no content and no thumbnail** (a thumbnail
is content, and producing it requires reading the canvas). Canvas bytes leave the
sender only after acceptance. This deliberately repeats ADR 0003's stance:
self-asserted identity, no mini-CA, no per-peer revocation.

Wire confidentiality is **absent** in this slice: plaintext, same-network
observable and forgeable. Recorded in
[KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md). The mitigation to be added later
is anonymous, offer-scoped — never a PKI. LocalSend's model is the reference, and
its own unpatched discovery MitM (GHSA-424h-5f6m-x63f, CVSS 9.3 — spoofed UDP
source IP impersonating a "known" device) is the reason the fingerprint is
documented as identification only, never as authentication.

**5. Three-phase short session, for cheap correctness.** Adopting LocalSend's
prepare/upload shape: `prepare` describes and returns a per-transfer token;
the receiver's acceptance binds token + source address + deadline; the carry
happens exactly once. This buys replay/re-target/duplicate rejection for free, on
an otherwise unauthenticated wire. The daemon **does not parse the scene**: it
moves opaque bytes obtained from `scene.get` and injected via the load path, so
it carries no Excalidraw schema dependency and does not need to track Excalidraw
versions.

**6. Limits are per-surface, not one global number.** Chunk size reuses the
existing 200KB precedent (`packages/collab-core/src/chunk.ts`) because the wire
frame cap is 1MB (`packages/bridge/internal/ws/ws.go:37`) and multiple chunks per
message are fine. The **transfer** cap is 64MB — transfers are in-memory moves,
and a canvas with embedded images is realistically larger than the relay's 20MB
per-file storage cap. The relay's 20MB file cap is **unchanged**; the two numbers
answer different cost questions and must not be unified. Integrity is checked
once, on the whole scene's sha256.

**7. Acceptance is receiver-side and extension-first.** The offer surfaces on the
receiver's extension page when one is connected; the daemon holds offer metadata
**in memory only, with a 60s deadline**, and stores no canvas content before
acceptance. With no page present, the transfer waits out its deadline and fails
— it does not silently accumulate an unowned content cache on a LAN-open port.
Tray notification is a convenience, never the only path (the tray must stay
non-load-bearing per ADR 0012).

## Consequences

- The daemon gains a config file (LAN on/off, device alias, fingerprint) at the
  platform state/config location decided in ADR 0012 — one source of truth shared
  by CLI, tray, and the extension's Options page.
- `KNOWN_LIMITATIONS.md` gains a *Peering* section: plaintext/forgeable wire,
  same-network impersonation possible, discovery unavailable on networks that
  block multicast, LAN listener off by default and off again after restart.
- The `-32601`-style failure modes matter more than usual: an old daemon that has
  never heard of Peering must fail the offer loudly rather than be interpreted as
  a rejection; the Leg-A handshake version negotiation
  (`WSHandshakeError unsupported-version`) already provides the surface for this.
- Rooms stay exactly as ADR 0003 defines them. If "LAN collab" is ever wanted, it
  is a new ADR, and it must answer the secure-context question (a plain-browser
  participant cannot get `crypto.subtle` without TLS) that this ADR avoids by not
  involving browsers at all.
