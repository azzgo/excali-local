/**
 * RoomScreen — the room session surface (Wayfinder 053 sessionLive; task
 * 044 replaces the shell placeholder). `#room/<shareId>` re-activates the
 * session directly (bookmarkable URL, 053 round 3) — no landing re-walk.
 *
 * Layout: the exclusive one-row SessionChrome above the canvas (053 round 2:
 * the chrome is its OWN row, NOT excalidraw's internal slot; canvas below),
 * a reserved banner strip under it (061 §8 — 046/047 fill the conn-health
 * banners), then the Excalidraw mount (same props as local-editor.tsx).
 *
 * Boot states:
 * - no server configured → notice + links (the room needs a relay to join)
 * - malformed shareId → invalid-room card (049 §4: 128-bit b64url token)
 * - configured + meta resolved → the session (chrome + canvas + seed prompt)
 *
 * Re-activation (061 §3): the session hook loads the persistent cache and
 * paints it immediately; the relay snapshot then wins (pure cache) or
 * three-way-merges (offline edits). Dead/empty room: cache auto-seeds
 * (rule B) or the seed prompt shows (rule C). The seed prompt here is a
 * minimal inline version — TODO(043-replace): 043's SeedPrompt + gallery
 * picker replace it once that task lands.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RoomEntry } from "collab-core";
import { parseInvite } from "collab-core";
import { Button } from "@/components/ui/button";
import { useEditorTheme } from "@/features/editor/hooks/use-editor-theme";
import Excalidraw from "@/features/editor/lib/excalidraw";
import { getRoom } from "@/features/editor/utils/indexdb";
import { useServerConfig } from "./hooks/use-server-config";
import { ROUTES } from "./routes";
import { SessionChrome } from "./session-chrome";
import type { CollabRoomMeta } from "./use-collab-session";
import type { WsFactory } from "collab-core";
import { useCollabSession } from "./use-collab-session";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

interface RoomScreenProps {
  lang: string;
  /** 128-bit capability token from #room/<shareId> (049 §4). */
  shareId: string;
  /** test seam: inject a WebSocket factory (collab-core transport). */
  wsFactory?: WsFactory;
}

/** 049 §4: base64url charset of the shareId token (length is the relay's
 * business — a too-short id simply fails admission there, 057 §5). */
const SHARE_ID_RE = /^[A-Za-z0-9_-]+$/;

export default function RoomScreen({ lang, shareId, wsFactory }: RoomScreenProps) {
  const [t] = useTranslation();
  const { config, loaded } = useServerConfig();
  const [roomMeta, setRoomMeta] = useState<CollabRoomMeta | null>(null);

  // Room facts (label/tier/invite) come from the stored room entry (048:
  // `excali` DB v3 `rooms` store — the invite IS the room). A bookmark on a
  // fresh install has no entry → neutral defaults (label = short id, team).
  useEffect(() => {
    let cancelled = false;
    void getRoom(shareId)
      .then((entry) => {
        if (cancelled) return;
        setRoomMeta(entry !== undefined ? roomMetaFromEntry(shareId, entry) : fallbackRoomMeta(shareId));
      })
      .catch(() => {
        if (!cancelled) setRoomMeta(fallbackRoomMeta(shareId));
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const invalidShareId = !SHARE_ID_RE.test(shareId) || shareId.length === 0;

  if (!loaded || roomMeta === null) {
    return (
      <div data-testid="collab-room" className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("CollabRoomShareId")}</span>
          <span data-testid="collab-room-shareid" className="font-mono break-all">
            {shareId}
          </span>
          <span className="ml-2">…</span>
        </div>
      </div>
    );
  }

  if (invalidShareId) {
    return (
      <div data-testid="collab-room" className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-md space-y-3">
          <h1 className="text-lg font-semibold tracking-tight">{t("CollabInvalidInvite")}</h1>
          <p className="text-sm text-muted-foreground">{t("CollabRoomBookmarkHint")}</p>
          <Button variant="outline" className="w-full" onClick={() => { window.location.hash = ROUTES.rooms; }}>
            {t("CollabMyRooms")}
          </Button>
        </div>
      </div>
    );
  }

  if (config === null) {
    return (
      <div data-testid="collab-room" className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-md space-y-3">
          <h1 className="text-lg font-semibold tracking-tight">{t("CollabLandingNoServer")}</h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("CollabRoomShareId")}</span>
            <span data-testid="collab-room-shareid" className="font-mono break-all">
              {shareId}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{t("CollabLandingNoServerHint")}</p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              window.location.hash = ROUTES.landing;
            }}
          >
            {t("CollabLandingPasteServerInvite")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <RoomSession lang={lang} shareId={shareId} server={config} room={roomMeta} wsFactory={wsFactory} />
  );
}

/** Build the chrome/hello room facts from the stored room entry (048). */
function roomMetaFromEntry(shareId: string, entry: RoomEntry): CollabRoomMeta {
  const parsed = parseInvite(entry.invite);
  if (parsed.kind === "room") {
    return {
      label: entry.label,
      tier: parsed.tier,
      roomSecret: parsed.roomSecret,
      fp: parsed.fp,
      invite: { shareId: parsed.shareId, tier: parsed.tier, roomSecret: parsed.roomSecret, fp: parsed.fp },
    };
  }
  return {
    label: entry.label,
    tier: entry.tier,
    invite: { shareId, tier: entry.tier },
  };
}

/** No stored room entry (bookmark on a fresh install) — neutral defaults. */
function fallbackRoomMeta(shareId: string): CollabRoomMeta {
  const shortId = shareId.slice(0, 6);
  return {
    label: shortId,
    tier: "team",
    invite: { shareId, tier: "team" },
  };
}

interface RoomSessionProps {
  lang: string;
  shareId: string;
  server: NonNullable<ReturnType<typeof useServerConfig>["config"]>;
  room: CollabRoomMeta;
  /** test seam: inject a WebSocket factory (collab-core transport). */
  wsFactory?: WsFactory;
}

function RoomSession({ lang, shareId, server, room, wsFactory }: RoomSessionProps) {
  const [t] = useTranslation();
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const { theme, handleThemeChange } = useEditorTheme();
  const session = useCollabSession({ shareId, server, room, excalidrawAPI, wsFactory });

  const onExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI | null) => {
    setExcalidrawAPI(api);
  }, []);

  return (
    <div data-testid="collab-room" className="flex h-svh flex-col overflow-hidden bg-background">
      {/* the exclusive one-row session chrome above the canvas (053) */}
      <SessionChrome room={room} session={session} />
      {/* 046/047 seam: conn-health banner strip renders here (061 §8 — a
          conditional one-row strip under the chrome, pushes the canvas down) */}
      <div data-testid="collab-conn-banner-slot" className="min-h-0" />
      <div className="relative flex-1 overflow-hidden">
        <Excalidraw
          autoFocus
          langCode={lang}
          aiEnabled={false}
          theme={theme}
          onThemeChange={handleThemeChange}
          showDeprecatedFonts={false}
          onExcalidrawAPI={onExcalidrawAPI}
          onChange={(elements, appState, files) =>
            session.onLocalChange(elements, appState, files)
          }
        />
        {/* seed prompt — empty room, no cache (053/061 rule C). Minimal
            inline version; TODO(043-replace): swap in 043's SeedPrompt
            (gallery picker + start blank) once that task lands. */}
        {session.emptyRoom && (
          <div
            data-testid="collab-seed-prompt"
            className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-6"
          >
            <div className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-4 shadow-lg">
              <div className="font-semibold">{t("CollabSeedTitle")}</div>
              <p className="text-xs text-muted-foreground">{t("CollabSeedNote")}</p>
              <Button
                data-testid="collab-seed-blank"
                className="w-full"
                onClick={() => session.seed()}
              >
                {t("CollabSeedStartBlank")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
