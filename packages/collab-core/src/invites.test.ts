import { describe, expect, it } from "vitest"
import {
  INVITE_TOKEN_RE,
  encodeRoomInvite,
  encodeServerInvite,
  parseInvite,
  parsePreview,
  validateRelayUrl,
} from "./invites"
import type { RoomInvite, ServerInvite } from "./invites"

// Valid 43-char b64url (32 bytes) keys and a 22-char b64url (16 bytes) shareId.
const sk = "A".repeat(43)
const ck = "B".repeat(43)
const shareId = "C".repeat(22)
const roomSecret = "D".repeat(43)

/** Minimal base64url (no padding) encoder for crafting malformed tokens. */
function b64url(json: string): string {
  const bytes = new TextEncoder().encode(json)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const srvToken = (payload: unknown) => `excali-collab:v1:srv:${b64url(JSON.stringify(payload))}`
const roomToken = (payload: unknown) => `excali-collab:v1:room:${b64url(JSON.stringify(payload))}`

const VALID_SRV = { relay: "https://relay.example.com", org: "acme", sk, ck }

describe("INVITE_TOKEN_RE (054 Q1: sentence + code)", () => {
  it("extracts a room token from sentence + code chat text", () => {
    const code = encodeRoomInvite({ shareId, tier: "team" })
    const sentence = `Join me in「冲刺规划」(team) — paste this into Excali Local → Collaborate: ${code}`
    expect(INVITE_TOKEN_RE.exec(sentence)?.[0]).toBe(code)
  })

  it("extracts a server token from its sentence form", () => {
    const code = encodeServerInvite(VALID_SRV)
    const sentence = `Connect to「acme」in Excali Local → Options → Collaboration: ${code}`
    expect(INVITE_TOKEN_RE.exec(sentence)?.[0]).toBe(code)
  })

  it("matches a bare code verbatim", () => {
    const code = encodeRoomInvite({ shareId, tier: "private", roomSecret })
    expect(INVITE_TOKEN_RE.exec(code)?.[0]).toBe(code)
  })

  it("does not match non-invite text, other versions, or unknown kinds", () => {
    expect(INVITE_TOKEN_RE.exec("just chatting about excalidraw")?.[0]).toBeUndefined()
    expect(INVITE_TOKEN_RE.exec("excali-collab:v2:room:abc")?.[0]).toBeUndefined()
    expect(INVITE_TOKEN_RE.exec("excali-collab:v1:foo:abc")?.[0]).toBeUndefined()
  })
})

describe("parseInvite — extraction from text", () => {
  it("parses a room invite embedded in real chat-style text (054 Q1)", () => {
    const code = encodeRoomInvite({ shareId, tier: "team", fp: "fp-abc123" })
    const sentence = `Join me in「冲刺规划」(team) — paste this into Excali Local → Collaborate: ${code}`
    expect(parseInvite(sentence)).toEqual({ kind: "room", shareId, tier: "team", fp: "fp-abc123" })
  })

  it("parses a bare code", () => {
    const code = encodeRoomInvite({ shareId, tier: "private", roomSecret })
    expect(parseInvite(code)).toEqual({ kind: "room", shareId, tier: "private", roomSecret })
  })

  it("stops the token at trailing punctuation (chat apps append text)", () => {
    const code = encodeRoomInvite({ shareId, tier: "team" })
    expect(parseInvite(`Join me: ${code}. Thanks!`)).toMatchObject({ kind: "room", shareId, tier: "team" })
  })

  it("extracts the token from a URL fragment form (049 §4 fragment rule)", () => {
    const code = encodeRoomInvite({ shareId, tier: "private", roomSecret })
    expect(parseInvite(`https://excali.local/app#${code}`)).toMatchObject({
      kind: "room",
      shareId,
      tier: "private",
      roomSecret,
    })
  })

  it("returns none for text without an invite token", () => {
    expect(parseInvite("")).toEqual({ kind: "none" })
    expect(parseInvite("see you tomorrow at the standup")).toEqual({ kind: "none" })
  })
})

describe("encode → parse round-trip", () => {
  it("server invite round-trips (https relay)", () => {
    const invite: ServerInvite = VALID_SRV
    const token = encodeServerInvite(invite)
    expect(token.startsWith("excali-collab:v1:srv:")).toBe(true)
    expect(parseInvite(token)).toEqual({ kind: "server", ...invite })
  })

  it("server invite round-trips (wss relay)", () => {
    const invite: ServerInvite = { relay: "wss://relay.example.com", org: "acme", sk, ck }
    expect(parseInvite(encodeServerInvite(invite))).toEqual({ kind: "server", ...invite })
  })

  it("server invite round-trips (loopback dev relay, 060)", () => {
    const invite: ServerInvite = { relay: "http://127.0.0.1:1999", org: "dev", sk, ck }
    expect(parseInvite(encodeServerInvite(invite))).toEqual({ kind: "server", ...invite })
  })

  it("server invite length lands in the ~220–260 char range (057 §2)", () => {
    const token = encodeServerInvite(VALID_SRV)
    expect(token.length).toBeGreaterThanOrEqual(220)
    expect(token.length).toBeLessThanOrEqual(260)
  })

  it("round-trips a non-ASCII org label", () => {
    const invite: ServerInvite = { relay: "https://relay.example.com", org: "冲刺团队", sk, ck }
    expect(parseInvite(encodeServerInvite(invite))).toEqual({ kind: "server", ...invite })
  })

  it("room invite round-trips (team, no secret)", () => {
    const invite: RoomInvite = { shareId, tier: "team" }
    const token = encodeRoomInvite(invite)
    expect(token.startsWith("excali-collab:v1:room:")).toBe(true)
    expect(parseInvite(token)).toEqual({ kind: "room", ...invite })
  })

  it("room invite round-trips (private with roomSecret)", () => {
    const invite: RoomInvite = { shareId, tier: "private", roomSecret }
    expect(parseInvite(encodeRoomInvite(invite))).toEqual({ kind: "room", ...invite })
  })

  it("room invite round-trips (private with roomSecret + fp)", () => {
    const invite: RoomInvite = { shareId, tier: "private", roomSecret, fp: "srvfp-123" }
    expect(parseInvite(encodeRoomInvite(invite))).toEqual({ kind: "room", ...invite })
  })

  it("re-copy yields the identical payload (054 Q2: tier immutable at create)", () => {
    const invite: RoomInvite = { shareId, tier: "team" }
    expect(encodeRoomInvite(invite)).toBe(encodeRoomInvite(invite))
  })
})

describe("malformed input → named-field paste errors (049 §4)", () => {
  it("body that is not JSON → error naming the payload field", () => {
    expect(parseInvite(`excali-collab:v1:room:${b64url("not-json")}`)).toMatchObject({
      kind: "error",
      field: "payload",
    })
  })

  it("payload that is not an object → error naming the payload field", () => {
    expect(parseInvite(`excali-collab:v1:room:${b64url("[1,2,3]")}`)).toMatchObject({
      kind: "error",
      field: "payload",
    })
    expect(parseInvite(`excali-collab:v1:srv:${b64url('"just a string"')}`)).toMatchObject({
      kind: "error",
      field: "payload",
    })
  })

  it("server payload missing required fields → named-field error", () => {
    expect(parseInvite(srvToken({}))).toMatchObject({ kind: "error", field: "relay" })
    expect(
      parseInvite(srvToken({ relay: "https://relay.example.com" })),
    ).toMatchObject({ kind: "error", field: "org" })
  })

  it("empty org → error naming org", () => {
    expect(parseInvite(srvToken({ relay: "https://relay.example.com", org: "", sk, ck }))).toMatchObject({
      kind: "error",
      field: "org",
    })
  })

  it("room payload missing shareId → error naming shareId", () => {
    expect(parseInvite(roomToken({ tier: "team" }))).toMatchObject({ kind: "error", field: "shareId" })
  })

  it("invalid tier value → error naming tier", () => {
    expect(parseInvite(roomToken({ shareId, tier: "public" }))).toMatchObject({
      kind: "error",
      field: "tier",
    })
  })

  it("server invite with an http:// remote relay → error naming relay", () => {
    expect(parseInvite(srvToken({ relay: "http://remote.example.com", org: "acme", sk, ck }))).toMatchObject({
      kind: "error",
      field: "relay",
    })
  })
})

describe("sk/ck/roomSecret key validation (058 §1.1 named-field rule)", () => {
  it("wrong-length sk → error naming sk", () => {
    const short = parseInvite(srvToken({ ...VALID_SRV, sk: "A".repeat(22) }))
    expect(short).toMatchObject({ kind: "error", field: "sk" })
    const long = parseInvite(srvToken({ ...VALID_SRV, sk: "A".repeat(44) }))
    expect(long).toMatchObject({ kind: "error", field: "sk" })
  })

  it("non-base64url sk (padded base64 '=' char) → error naming sk", () => {
    expect(parseInvite(srvToken({ ...VALID_SRV, sk: "A".repeat(42) + "=" }))).toMatchObject({
      kind: "error",
      field: "sk",
    })
  })

  it("wrong-length ck → error naming ck (sk stays valid)", () => {
    expect(parseInvite(srvToken({ ...VALID_SRV, ck: "short" }))).toMatchObject({
      kind: "error",
      field: "ck",
    })
  })

  it("wrong-length roomSecret → error naming roomSecret", () => {
    expect(parseInvite(roomToken({ shareId, tier: "private", roomSecret: "D".repeat(10) }))).toMatchObject({
      kind: "error",
      field: "roomSecret",
    })
  })

  it("roomSecret on a team invite → error naming roomSecret (049: private only)", () => {
    expect(parseInvite(roomToken({ shareId, tier: "team", roomSecret }))).toMatchObject({
      kind: "error",
      field: "roomSecret",
    })
  })

  it("valid keys pass; errors carry a human-readable reason", () => {
    const ok = parseInvite(srvToken(VALID_SRV))
    expect(ok).toEqual({ kind: "server", ...VALID_SRV })
    const bad = parseInvite(srvToken({ ...VALID_SRV, ck: "nope" }))
    if (bad.kind !== "error") throw new Error("expected error")
    expect(bad.field).toBe("ck")
    expect(bad.reason.length).toBeGreaterThan(0)
  })
})

describe("validateRelayUrl (049 §4 + 060 §1 loopback carve-out)", () => {
  it("accepts https:/wss: for any host", () => {
    expect(validateRelayUrl("https://relay.example.com")).toBeNull()
    expect(validateRelayUrl("wss://relay.example.com/room")).toBeNull()
    expect(validateRelayUrl("https://127.0.0.1:1999")).toBeNull()
  })

  it("accepts http:/ws: only for loopback IP literals with a port", () => {
    expect(validateRelayUrl("http://127.0.0.1:1999")).toBeNull()
    expect(validateRelayUrl("ws://[::1]:1999")).toBeNull()
  })

  it("rejects http:/ws: for remote hosts (060: remote stays TLS-only)", () => {
    expect(validateRelayUrl("http://remote.example.com")).not.toBeNull()
    expect(validateRelayUrl("ws://example.com:1999")).not.toBeNull()
  })

  it("rejects localhost by name (060: IP literals only)", () => {
    expect(validateRelayUrl("http://localhost:1999")).not.toBeNull()
    expect(validateRelayUrl("ws://localhost:1999")).not.toBeNull()
  })

  it("rejects loopback without a port", () => {
    expect(validateRelayUrl("http://127.0.0.1")).not.toBeNull()
    expect(validateRelayUrl("ws://[::1]")).not.toBeNull()
  })

  it("rejects unparseable URLs and unsupported schemes", () => {
    expect(validateRelayUrl("not a url")).not.toBeNull()
    expect(validateRelayUrl("ftp://relay.example.com")).not.toBeNull()
  })
})

describe("room invites never carry a server address (049 §4, ADR invariant)", () => {
  it("the encoded room payload has no relay field", () => {
    const token = encodeRoomInvite({ shareId, tier: "private", roomSecret })
    const body = token.slice(token.indexOf(":room:") + 6)
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (body.length % 4)) % 4))
    const payload = JSON.parse(json) as Record<string, unknown>
    expect(payload).not.toHaveProperty("relay")
    expect(payload).not.toHaveProperty("server")
  })

  it("parsing a room invite yields a room result with no relay field", () => {
    const result = parseInvite(encodeRoomInvite({ shareId, tier: "team" }))
    expect(result.kind).toBe("room")
    if (result.kind === "room") {
      expect("relay" in result).toBe(false)
    }
  })
})

describe("parsePreview (054 Q6: tier + key presence only)", () => {
  it("server preview shows org, relay and key presence", () => {
    const parsed = parseInvite(encodeServerInvite(VALID_SRV))
    if (parsed.kind !== "server") throw new Error("expected server invite")
    expect(parsePreview(parsed)).toEqual({
      kind: "server",
      org: "acme",
      relay: "https://relay.example.com",
      hasKeys: true,
    })
  })

  it("team room previews hasKey:false (no key in payload)", () => {
    const parsed = parseInvite(encodeRoomInvite({ shareId, tier: "team" }))
    if (parsed.kind !== "room") throw new Error("expected room invite")
    expect(parsePreview(parsed)).toEqual({ kind: "room", tier: "team", hasKey: false })
  })

  it("private room with roomSecret previews hasKey:true", () => {
    const parsed = parseInvite(encodeRoomInvite({ shareId, tier: "private", roomSecret }))
    if (parsed.kind !== "room") throw new Error("expected room invite")
    expect(parsePreview(parsed)).toEqual({ kind: "room", tier: "private", hasKey: true })
  })

  it("private room without roomSecret previews hasKey:false (054 Q4 no-key path)", () => {
    const parsed = parseInvite(encodeRoomInvite({ shareId, tier: "private" }))
    if (parsed.kind !== "room") throw new Error("expected room invite")
    expect(parsePreview(parsed)).toEqual({ kind: "room", tier: "private", hasKey: false })
  })
})

describe("encode input validation", () => {
  it("encodeServerInvite rejects invalid relays", () => {
    expect(() => encodeServerInvite({ ...VALID_SRV, relay: "http://remote.example.com" })).toThrow()
    expect(() => encodeServerInvite({ ...VALID_SRV, relay: "localhost:1999" })).toThrow()
  })

  it("encodeServerInvite rejects malformed or wrong-length keys", () => {
    expect(() => encodeServerInvite({ ...VALID_SRV, sk: "too-short" })).toThrow()
    expect(() => encodeServerInvite({ ...VALID_SRV, ck: "x".repeat(44) })).toThrow()
  })

  it("encodeRoomInvite rejects roomSecret on team tier and bad shareId", () => {
    expect(() => encodeRoomInvite({ shareId, tier: "team", roomSecret })).toThrow()
    expect(() => encodeRoomInvite({ shareId: "short", tier: "private" })).toThrow()
    expect(() => encodeRoomInvite({ shareId, tier: "private", fp: "" })).toThrow()
  })
})
