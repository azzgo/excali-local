import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  encodeRoomInvite,
  loadSession,
  listRooms,
  saveRoomMeta,
  saveSession,
  type CollabScene,
  type RoomInvite,
} from "collab-core";
import { Button } from "@/components/ui/button";
import { ROUTES, roomRoute } from "./routes";
import { useServerConfig } from "./hooks/use-server-config";
import {
  dialServer,
  parsePastedInvite,
  pasteSeverity,
  type PasteSeverity,
} from "./invite";
import PasteWarnings from "./paste-warnings";
import { EMPTY_SEED_SCENE, SeedGalleryPicker, SeedPrompt } from "./seed-prompt";

interface JoinScreenProps {
  lang: string;
}

type JoinStep = "paste" | "seed" | "gallery";

/**
 * Join room flow (Wayfinder 053 joinRoom → seedPrompt; 054 severity grammar):
 *
 *   1. paste box accepts the sentence+code clipboard payload OR a bare code
 *      (054 Q1 — collab-core's parser regex-extracts the token).
 *   2. severity (task 050's pasteSeverity): no-key → red + Join disabled
 *      (054 Q4); fp-mismatch → amber + Continue anyway (054 Q5 / 048 warn-only);
 *      garbage → red error. Loopback relays are never probed (060 — neutral).
 *   3. Continue dials the configured relay (054 Q9 live dial): nobody answered
 *      → red joinSrvDown card (Retry / Check server config — deliberately
 *      worded apart from the rejected family). No server configured → the
 *      joinNoSrvErr blocked card (053) — a room invite carries no server
 *      address (ADR invariant), routing needs a configured server.
 *   4. Valid → saveRoomMeta (048 rooms store; re-joins keep their label and
 *      pin) → re-activation rule (061 §3): cached session → enter
 *      `#room/<shareId>` directly (dead+cache → cache seeds; alive+cache →
 *      snapshot wins / merge at connect); no cache → seed prompt (dead or
 *      empty room — "This room is empty", silent about death, 054 Q7).
 */
export default function JoinScreen({ lang }: JoinScreenProps) {
  const [t] = useTranslation();
  const { config, loaded } = useServerConfig();
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState<PasteSeverity>({ kind: "ok" });
  const [parsedRoom, setParsedRoom] = useState<RoomInvite | null>(null);
  const [noServer, setNoServer] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [step, setStep] = useState<JoinStep>("paste");
  const [room, setRoom] = useState<RoomInvite | null>(null);

  const handleChange = (value: string) => {
    setText(value);
    setNoServer(false);
    const parsed = parsePastedInvite(value);
    if (parsed.kind === "room") {
      const { shareId, tier, roomSecret, fp } = parsed;
      setParsedRoom({ shareId, tier, roomSecret, fp });
      setSeverity(pasteSeverity(parsed, { server: config }));
    } else {
      setParsedRoom(null);
      setSeverity(parsed.kind === "server" ? { kind: "ok" } : pasteSeverity(parsed, { server: config }));
    }
  };

  // The server config may arrive after the first paste (async storage read):
  // re-classify so the fp-mismatch check compares against the real fingerprint.
  useEffect(() => {
    if (text !== "") handleChange(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  /** Continue (or fp "Continue anyway") — dial the relay, then enter or warn. */
  const handleContinue = async () => {
    if (parsedRoom === null || dialing) return;
    if (config === null) {
      // 053 joinNoSrvErr: a room invite belongs to a server — no routing possible.
      setNoServer(true);
      return;
    }
    setNoServer(false);
    setDialing(true);
    try {
      const dial = await dialServer(config.relay);
      if (dial === "unreachable") {
        // 054 joinSrvDown: "nobody answered" (never the rejected family).
        setSeverity({ kind: "unreachable", inviteKind: "room" });
        return;
      }
      await enterRoom(parsedRoom);
    } finally {
      setDialing(false);
    }
  };

  /** Valid room invite → save meta, then the 061 re-activation rule. */
  const enterRoom = async (invite: RoomInvite) => {
    const code = encodeRoomInvite(invite);
    const existing = (await listRooms()).find((r) => r.id === invite.shareId);
    await saveRoomMeta({
      id: invite.shareId,
      // 054 Q6: the payload carries no room name — re-joins keep their label,
      // first joins get a neutral fallback.
      label:
        existing?.label ??
        t("CollabJoinedRoomLabel", { shortId: invite.shareId.slice(0, 6) }),
      tier: invite.tier,
      fp: invite.fp,
      pinned: existing?.pinned ?? false,
      lastJoined: Date.now(),
      invite: code,
    });
    const cached = await loadSession(invite.shareId);
    if (cached !== undefined) {
      // 061 §3: dead + cache → cache seeds (B); alive + cache → snapshot wins
      // (A, pure cache) or three-way merge at connect (A, offline edits) —
      // every cached case enters without a prompt.
      window.location.hash = roomRoute(invite.shareId);
      return;
    }
    // Dead + no cache → seed prompt (C) — also the empty-new-room case (054 Q7).
    setRoom(invite);
    setStep("seed");
  };

  /** Stage the chosen first seed into the session cache and enter the room. */
  const stageAndEnter = async (scene: CollabScene) => {
    if (room === null) return;
    await saveSession(room.shareId, { edited: scene, base: null });
    window.location.hash = roomRoute(room.shareId);
  };

  const canContinue =
    parsedRoom !== null &&
    severity.kind !== "no-key" &&
    severity.kind !== "error" &&
    !dialing;

  const isServerInvite = parsedRoom === null && parsePastedInvite(text).kind === "server";

  return (
    <div
      data-testid="collab-join"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        {step === "paste" && (
          <div className="space-y-3">
            <h1 className="text-lg font-semibold tracking-tight">{t("CollabJoinTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("CollabJoinIntro")}</p>

            <div className="space-y-1.5">
              <label htmlFor="collab-join-invite" className="text-xs font-semibold">
                {t("CollabJoinInviteLabel")}
              </label>
              <textarea
                id="collab-join-invite"
                data-testid="collab-join-invite"
                rows={3}
                value={text}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="excali-collab:v1:room:..."
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>

            {noServer && (
              <div
                data-testid="collab-join-no-server"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
              >
                <div className="font-semibold text-amber-700 dark:text-amber-400">
                  {t("CollabJoinNoServer")}
                </div>
                <Button
                  data-testid="collab-join-setup-server"
                  className="mt-2 w-full"
                  onClick={() => {
                    window.location.hash = ROUTES.landing;
                  }}
                >
                  {t("CollabSetUpServer")}
                </Button>
              </div>
            )}

            {isServerInvite && (
              <div
                data-testid="collab-join-server-hint"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
              >
                <p className="text-amber-700 dark:text-amber-400">{t("CollabJoinServerInviteHint")}</p>
              </div>
            )}

            <Button
              data-testid="collab-join-continue"
              className="w-full"
              disabled={!canContinue}
              onClick={() => void handleContinue()}
            >
              {dialing ? t("CollabChecking") : t("CollabContinue")}
            </Button>

            <PasteWarnings
              severity={severity}
              serverRelay={config?.relay}
              onContinue={() => void handleContinue()}
              onRetry={() => void handleContinue()}
              onPasteAgain={() => {
                setText("");
                setSeverity({ kind: "ok" });
                setParsedRoom(null);
              }}
              onCheckConfig={() => {
                window.location.hash = ROUTES.config;
              }}
            />

            {loaded && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  window.location.hash = ROUTES.landing;
                }}
              >
                {t("CollabBack")}
              </Button>
            )}
          </div>
        )}

        {step === "seed" && room !== null && (
          <SeedPrompt
            onLoadFromGallery={() => setStep("gallery")}
            onStartBlank={() => void stageAndEnter(EMPTY_SEED_SCENE)}
            onBack={() => setStep("paste")}
          />
        )}

        {step === "gallery" && room !== null && (
          <SeedGalleryPicker
            onPick={(scene) => void stageAndEnter(scene)}
            onBack={() => setStep("seed")}
          />
        )}
      </div>
    </div>
  );
}
