/**
 * Shared room-mint helper — the single implementation of "mint a room and
 * persist its meta" used by BOTH the #create flow (CreateScreen) and the
 * editor one-click handoff (TopRightToolbar → Collab ▾ "以当前画布创建房间").
 * Never copy-paste this logic into a second caller.
 *
 * Steps (053/049/048/050):
 *   - shareId   = 128-bit random capability token (049 §4, crypto.getRandomValues)
 *   - roomSecret = 32-byte b64url key for tier "private" (050 §2)
 *   - fp        = fingerprint of the configured relay (048 — staleness signal
 *                 only; no server configured → fp omitted → never grays)
 * then encodes the invite (collab-core) and saves the room meta (048: the
 * invite IS the room — the encoded code is stored verbatim).
 */
import {
  bytesToB64url,
  encodeRoomInvite,
  resolveIdentity,
  saveRoomMeta,
  type RoomInvite,
} from "collab-core";
import { fingerprint } from "./invite";
import type { ServerConfig } from "./storage";

export interface MintRoomOptions {
  /** Room label — a real name ("named") or the generated fallback ("auto"). */
  name: string;
  /** label provenance (ADR 0004): "named" = pushable real name, "auto" = fallback. */
  labelKind: "named" | "auto";
  /** Privacy tier — immutable at creation (054 Q2: changing tier = new room). */
  tier: "team" | "private";
  /** The configured relay — null mints without fp (048). */
  config: ServerConfig | null;
}

export interface MintedRoom {
  /** The room invite payload (shareId + tier [+ roomSecret] [+ fp]). */
  invite: RoomInvite;
  /** The encoded invite code — the room's shareable token. */
  code: string;
}

export async function mintRoom(opts: MintRoomOptions): Promise<MintedRoom> {
  const invite: RoomInvite = {
    shareId: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))),
    tier: opts.tier,
  };
  if (opts.tier === "private") {
    invite.roomSecret = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  }
  // 048: fp = staleness signal of the server the invite was minted against.
  // No server configured → fp omitted → the entry never grays.
  if (opts.config !== null) invite.fp = fingerprint(opts.config.relay);
  const code = encodeRoomInvite(invite);
  await saveRoomMeta({
    id: invite.shareId,
    label: opts.name,
    labelKind: opts.labelKind,
    tier: opts.tier,
    fp: invite.fp,
    pinned: false,
    lastJoined: Date.now(),
    invite: code,
    // 060: copy the profile default as the per-room display name on create.
    myName: (await resolveIdentity())?.name,
  });
  return { invite, code };
}
