import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  bytesToB64url,
  encodeRoomInvite,
  resolveIdentity,
  saveRoomMeta,
  saveSession,
  type CollabScene,
  type RoomInvite,
} from "collab-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROUTES, roomRoute } from "./routes";
import { useServerConfig } from "./hooks/use-server-config";
import { fingerprint } from "./invite";
import ShareStep from "./share-step";
import { EMPTY_SEED_SCENE, SeedGalleryPicker, SeedPrompt } from "./seed-prompt";
import { cn } from "@/lib/utils";

interface CreateScreenProps {
  lang: string;
}

type CreateStep = "form" | "share" | "seed" | "gallery";

/**
 * Create room flow (Wayfinder 053 createRoom → created → seedPrompt screens):
 *
 *   1. name + privacy tier (team/private, 053 DECISION — tier is immutable at
 *      create per 054 Q2: changing tier = new room) → Create mints the room:
 *       - shareId = 128-bit random capability token (049 §4, crypto.getRandomValues)
 *       - roomSecret = 32-byte b64url key for tier "private" (050 §2)
 *       - fp = fingerprint of the configured relay (048 — staleness signal only)
 *      then encodes the invite (collab-core) and saves the room meta (048:
 *      `excali` DB v3 `rooms` store — the invite IS the room).
 *   2. intermediate share step (053: invite is the room; forgetting it loses
 *      it — sentence + code copy, 054 Q1) — same #create URL (053 round 3).
 *   3. seed prompt on entry to the EMPTY new room (061: "This room is empty",
 *      silent about death — first seed wins). "Start blank" / "Load from my
 *      Gallery" stage the choice into the session cache (the 061 rule-B seed
 *      mechanism) and enter `#room/<shareId>` — the bookmarkable room URL.
 */
export default function CreateScreen({ lang }: CreateScreenProps) {
  const [t] = useTranslation();
  const { config } = useServerConfig();
  const [name, setName] = useState("");
  const [tier, setTier] = useState<"team" | "private">("team");
  const [step, setStep] = useState<CreateStep>("form");
  const [room, setRoom] = useState<{ name: string; invite: RoomInvite; code: string } | null>(null);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const invite: RoomInvite = {
      shareId: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))),
      tier,
    };
    if (tier === "private") {
      invite.roomSecret = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
    }
    // 048: fp = staleness signal of the server the invite was minted against.
    // No server configured → fp omitted → the entry never grays.
    if (config !== null) invite.fp = fingerprint(config.relay);
    const code = encodeRoomInvite(invite);
    await saveRoomMeta({
      id: invite.shareId,
      label: trimmed,
      // ADR 0004: a create-time name is a REAL name — pushable when the room
      // is alive-with-no-name or re-seeded after death.
      labelKind: "named",
      tier,
      fp: invite.fp,
      pinned: false,
      lastJoined: Date.now(),
      invite: code,
      // 060: copy the profile default as the per-room display name on create.
      myName: (await resolveIdentity())?.name,
    });
    setRoom({ name: trimmed, invite, code });
    setStep("share");
  };

  /** Stage the chosen first seed into the session cache and enter the room. */
  const stageAndEnter = async (scene: CollabScene) => {
    if (room === null) return;
    // base: null — nothing synced yet; an alive-with-snapshot room overwrites
    // this staged seed (053 rule A), a dead room lets it seed (061 rule B).
    await saveSession(room.invite.shareId, { edited: scene, base: null });
    window.location.hash = roomRoute(room.invite.shareId);
  };

  const startBlank = () => void stageAndEnter(EMPTY_SEED_SCENE);

  return (
    <div
      data-testid="collab-create"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        {step === "form" && (
          <div className="space-y-4">
            <h1 className="text-lg font-semibold tracking-tight">{t("CollabCreateRoom")}</h1>
            <p className="text-sm text-muted-foreground">{t("CollabCreateIntro")}</p>

            <div className="space-y-1.5">
              <label htmlFor="collab-room-name" className="text-xs font-semibold">
                {t("CollabCreateNameLabel")}
              </label>
              <Input
                id="collab-room-name"
                data-testid="collab-create-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 planning"
              />
              <p className="text-[11px] text-muted-foreground">{t("CollabCreateNameHint")}</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">{t("CollabCreateTierLabel")}</label>
              <div className="overflow-hidden rounded-lg border" role="radiogroup" aria-label={t("CollabCreateTierLabel")}>
                <label
                  data-testid="collab-create-tier-team"
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 border-b p-3",
                    tier === "team" && "bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="collab-tier"
                    checked={tier === "team"}
                    onChange={() => setTier("team")}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{t("CollabCreateTierTeam")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("CollabCreateTierTeamDesc")}
                    </span>
                  </span>
                </label>
                <label
                  data-testid="collab-create-tier-private"
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 p-3",
                    tier === "private" && "bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="collab-tier"
                    checked={tier === "private"}
                    onChange={() => setTier("private")}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{t("CollabCreateTierPrivate")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("CollabCreateTierPrivateDesc")}
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <Button
              data-testid="collab-create-submit"
              className="w-full"
              disabled={name.trim() === ""}
              onClick={() => void handleCreate()}
            >
              {t("CollabCreateRoom")}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                window.location.hash = ROUTES.landing;
              }}
            >
              {t("CollabBack")}
            </Button>
          </div>
        )}

        {step === "share" && room !== null && (
          <div className="space-y-3">
            {/* 053 created screen: ok note — the invite is the room */}
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-500/40 dark:bg-emerald-500/10">
              <div className="font-semibold">{t("CollabShareCreatedNote")}</div>
            </div>
            <ShareStep name={room.name} invite={room.invite} onSkip={() => setStep("seed")} />
            <p className="text-center text-[11px] text-muted-foreground">
              {t("CollabShareAlwaysAvailable")}
            </p>
          </div>
        )}

        {step === "seed" && room !== null && (
          <SeedPrompt
            roomLabel={room.name}
            onLoadFromGallery={() => setStep("gallery")}
            onStartBlank={startBlank}
            onBack={() => setStep("share")}
          />
        )}

        {step === "gallery" && room !== null && (
          <SeedGalleryPicker onPick={(scene) => void stageAndEnter(scene)} onBack={() => setStep("seed")} />
        )}
      </div>
    </div>
  );
}
