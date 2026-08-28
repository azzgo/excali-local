import { RoomTopRightControls } from "./room-top-right-controls";

/**
 * RoomScreen — the room session surface (Wayfinder 053 sessionLive; task
 * 044 replaces the shell placeholder). `#room/<shareId>` re-activates the
 * session directly (bookmarkable URL, 053 round 3) — no landing re-walk.
 *
 * Layout: the exclusive one-row SessionChrome above the canvas (053 round 2:
 * the chrome is its OWN row, NOT excalidraw's internal slot; canvas below),
 * then the Excalidraw mount (same props as local-editor.tsx). Session-level
 * notifications (conn-health + config propagation) float over the top-right of
 * the canvas as a toast stack so the canvas never reflows when they appear.
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
import { useCallback, useEffect, useRef, useState } from "react";
import { Footer } from "@excalidraw/excalidraw";
import { useAtom } from "jotai";
import { cn } from "@/lib/utils";
import SlideNavigation from "@/features/editor/components/slide-navigation";
import SlideNavbar from "@/features/editor/components/slide-navbar";
import { useUpdateSlides } from "@/features/editor/hooks/use-update-slides";
import { showSlideQuickNavAtom } from "@/features/editor/store/presentation";
import { useRoomSlideStateReset } from "./use-room-slide-state";
import { applySlideOrder } from "./apply-slide-order";
import { useTranslation } from "react-i18next";
import type { RoomEntry } from "collab-core";
import { fileIdFor, parseInvite } from "collab-core";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useEditorTheme } from "@/features/editor/hooks/use-editor-theme";
import Excalidraw from "@/features/editor/lib/excalidraw";
import { getRoom, getDrawingFullData } from "@/features/editor/utils/indexdb";
import { normalizeSceneImageRefs } from "@/features/gallery/utils/normalize-image-refs";
import type { DrawingMetadata } from "@/features/editor/utils/indexdb";
import { useServerConfig } from "./hooks/use-server-config";
import { useLabelMode } from "./labels";
import { ROUTES } from "./routes";
import { SessionChrome } from "./session-chrome";
import { ConfigPropagationBanner } from "./config-banner";
import { ConnHealthBanners } from "./conn-health";
import type { CollabRoomMeta } from "./use-collab-session";
import type { WsFactory } from "collab-core";
import { useCollabSession } from "./use-collab-session";
import { useFollowBreakToast } from "./use-follow-break-toast";
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import GallerySidebar from "@/features/gallery/components/gallery-sidebar";

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
      labelKind: entry.labelKind,
      tier: parsed.tier,
      roomSecret: parsed.roomSecret,
      fp: parsed.fp,
      invite: { shareId: parsed.shareId, tier: parsed.tier, roomSecret: parsed.roomSecret, fp: parsed.fp },
      myName: entry.myName,
    };
  }
  return {
    label: entry.label,
    labelKind: entry.labelKind,
    tier: entry.tier,
    invite: { shareId, tier: entry.tier },
    myName: entry.myName,
  };
}

/** No stored room entry (bookmark on a fresh install) — neutral defaults. */
function fallbackRoomMeta(shareId: string): CollabRoomMeta {
  const shortId = shareId.slice(0, 6);
  return {
    label: shortId,
    labelKind: "auto",
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
  useRoomSlideStateReset();
  const [t] = useTranslation();
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const { theme, handleThemeChange } = useEditorTheme();
  // 055 presence label mode — shared with the feed/chrome; the session hook
  // omits `username` from the collaborators map in quiet mode.
  const { mode: labelMode } = useLabelMode();
  const session = useCollabSession({ shareId, server, room, excalidrawAPI, wsFactory, labelMode });
  const updateSlides = useUpdateSlides();
  const [showSlideQuickNav, updateShowSlideQuickNav] = useAtom(showSlideQuickNavAtom);
  // 083: fire a toast when the follow relationship breaks involuntarily;
  // capture-phase gesture listeners on the canvas area break follow at the
  // onset of any local pan/zoom (ADR 0008) — see use-follow-break-toast.
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  useFollowBreakToast(session, canvasAreaRef);

  // 052: content-addressed ids for newly inserted images (fileId =
  // base64url(sha256(bytes)), 051 §3) so the element's fileId matches the
  // wire id — the relay is content-blind and keys by the claimed id, and
  // the upload path refuses mismatched ids (see use-collab-files).
  const generateIdForFile = useCallback(async (file: File): Promise<string> => {
    return fileIdFor(new Uint8Array(await file.arrayBuffer()));
  }, []);
  const onExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI | null) => {
    setExcalidrawAPI(api);
  }, []);

  // --- Gallery sidebar state (room-mode only) ---
  // pendingLoadDrawing: drawing awaiting confirm (null = no modal open)
  const [pendingLoadDrawing, setPendingLoadDrawing] = useState<DrawingMetadata | null>(null);
  // chosenDrawingId: in-memory gallery-drawing chosen for this room (the save seam)
  const [chosenDrawingId, setChosenDrawingId] = useState<string | null>(null);

  /** Gallery card click → show confirm modal (room-mode). */
  const onLoadDrawing = useCallback(async (drawing: DrawingMetadata) => {
    setPendingLoadDrawing(drawing);
  }, []);

  /** Confirm modal CONFIRM: load drawing into scene + set chosen-drawing id.
   * 086: normalizes the gallery drawing and broadcasts it as a REAL local edit
   * via the ordinary scene pipeline (ADR 0009 §1: no new wire message). The
   * broadcastScene escape hatch clears the echo guard so onChange is NOT swallowed
   * and the full-scene scene message travels the existing sendScene path.
   */
  const handleConfirmLoad = useCallback(async () => {
    if (!pendingLoadDrawing || !session.broadcastScene) {
      setPendingLoadDrawing(null);
      return;
    }
    try {
      const fullDrawing = await getDrawingFullData(pendingLoadDrawing.id);
      const elements = JSON.parse(fullDrawing.elements);
      const files = JSON.parse(fullDrawing.files);
      // ADR 0009 §2: normalize image fileIds before applying to scene
      const { elements: normEls, files: normFiles } = await normalizeSceneImageRefs(elements, files);
      // broadcastScene takes Excalidraw's BinaryFileData[] (this tgz's addFiles
      // is array-shaped, each entry carrying its own `id`); normalization
      // returns an id-less keyed map — stamp the id from each key.
      const binaryFiles: BinaryFileData[] = Object.entries(normFiles).map(([fileId, f]) => ({
        ...f,
        id: fileId,
      })) as BinaryFileData[];
      // 086: broadcastScene clears the echo guard, applies the scene, and registers
      // fileIds — the ordinary onChange pipeline handles seq bump + sendScene + persist.
      session.broadcastScene(normEls, binaryFiles);
      setChosenDrawingId(pendingLoadDrawing.id);
    } catch (err) {
      console.error("[room] failed to load drawing:", err);
    } finally {
      setPendingLoadDrawing(null);
    }
  }, [pendingLoadDrawing, session]);

  /** Confirm modal CANCEL: inert — just close the modal (canvas unchanged). */
  const handleCancelLoad = useCallback(() => {
    setPendingLoadDrawing(null);
  }, []);

  return (
    <div data-testid="collab-room" className="flex h-svh flex-col overflow-hidden bg-background">
      {/* the exclusive one-row session chrome above the canvas (053) */}
      <SessionChrome room={room} session={session} />

      {/* Session-level notification stack — floats over the top-right of the
       * canvas so alerts never push the canvas down. flex-col so the slide
       * quick-nav (SlideNavbar, task 101) gets natural height BELOW the canvas
       * when open — an h-full canvas + overflow-hidden clips it to invisibility
       * (the "Edit Slides click does nothing" bug). */}
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-50">
          <div data-testid="collab-notification-stack" className="pointer-events-auto absolute right-4 top-4 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2">
            <ConfigPropagationBanner live={session.live} />
            <ConnHealthBanners
              session={session}
              excalidrawAPI={excalidrawAPI}
              roomLabel={session.roomName ?? room.label}
              relay={server.relay}
            />
          </div>
        </div>

        {/* 083: the follow-break gesture listeners attach at the CANVAS
         * container level ONLY — a pointerdown on the notification stack /
         * seed prompt must never break follow (see use-follow-break-toast). */}
        <div ref={canvasAreaRef} data-testid="collab-canvas-area" className="flex-1 min-h-0">
          <Excalidraw
            autoFocus
            langCode={lang}
            aiEnabled={false}
            theme={theme}
            onThemeChange={handleThemeChange}
            showDeprecatedFonts={false}
            onExcalidrawAPI={onExcalidrawAPI}
            onPointerUpdate={session.onLocalPointer}
            onChange={(elements, appState, files) => {
              session.onLocalChange(elements, appState, files);
              updateSlides(elements, files);
            }}
            generateIdForFile={generateIdForFile}
            onScrollChange={(scrollX, scrollY, zoom) =>
              session.onLocalViewportChange(scrollX, scrollY, zoom)
            }
            renderTopRightUI={() => (
              <RoomTopRightControls
                excalidrawAPI={excalidrawAPI}
                session={session}
              />
            )}
          >
            <Footer>
              <SlideNavigation
                excalidrawAPI={excalidrawAPI}
                hideNav={!session.presentingSelf}
                hideWhenEmpty
              />
            </Footer>
            {/* Gallery sidebar (room-mode): mounts inside the Excalidraw Sidebar slot.
             * If the Excalidraw Sidebar island is unavailable (dock-panel fallback
             * taken), GallerySidebar still renders inside Excalidraw's children — it
             * owns its own <Sidebar> island, so it always lands in the dock panel
             * regardless of where in the DOM it is placed. */}
            <GallerySidebar
              excalidrawAPI={excalidrawAPI}
              onLoadDrawing={onLoadDrawing}
              chosenDrawingId={chosenDrawingId ?? undefined}
            />
          </Excalidraw>
        </div>
        <div className={cn(!showSlideQuickNav && "hidden")}>
          <SlideNavbar
            excalidrawAPI={excalidrawAPI}
            close={() => updateShowSlideQuickNav(false)}
            applyOrder={(frameIdList) => excalidrawAPI && applySlideOrder(excalidrawAPI, frameIdList)}
          />
        </div>

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

        {/* TEXT-ONLY confirm modal: "this replaces the room's current content,
         * visible to all members." No thumbnail, no don't-ask-again (Ticket 063 ④).
         * Cancel = inert locally; confirm = load into scene. */}
        <Modal
          open={pendingLoadDrawing !== null}
          title={t("CollabGalleryLoadConfirmTitle")}
          onDismiss={handleCancelLoad}
        >
          <p className="text-sm text-muted-foreground">
            {t("CollabGalleryLoadConfirmBody")}
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="ghost" onClick={handleCancelLoad}>
              {t("Cancel")}
            </Button>
            <Button data-testid="confirm-modal-confirm" onClick={handleConfirmLoad}>
              {t("CollabGalleryLoadConfirm")}
            </Button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
