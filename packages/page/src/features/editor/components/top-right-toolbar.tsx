import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  IconCircleNumber1,
  IconDotsVertical,
  IconExternalLink,
  IconLayoutGrid,
  IconPresentation,
  IconPresentationOff,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { saveSession, type CollabScene } from "collab-core";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAtomValue } from "jotai";
import { galleryIsOpenAtom } from "../../gallery/store/gallery-atoms";
import { useSlide } from "../hooks/use-slide";
import { mintRoom } from "@/features/collab/create-room";
import { useServerConfig } from "@/features/collab/hooks/use-server-config";
import { roomRoute } from "@/features/collab/routes";
import AgentActivationControl from "./agent-activation-control";

interface TopRightToolbarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  isMobile: boolean;
  editorType: "local" | "quick";
}

/** Navigate to the collab editor (same-directory index.html — works in the
 *  extension at /editor/index.html and in the vite dev server at /index.html). */
const collabEditorUrl = (hash: string = "") =>
  `index.html?type=collab${hash}`;

const TopRightToolbar = ({
  excalidrawAPI,
  isMobile,
  editorType,
}: TopRightToolbarProps) => {
  const { presentationMode, slides, handleTogglePresentation } =
    useSlide(excalidrawAPI);
  const [t] = useTranslation();
  const isGalleryOpen = useAtomValue(galleryIsOpenAtom);
  const { config } = useServerConfig();
  const [creatingRoom, setCreatingRoom] = useState(false);

  const handlePresentationIconClick = () => {
    handleTogglePresentation();
    excalidrawAPI?.toggleSidebar({ name: "marker", force: false });
  };

  const handleMarkerIconClick = () => {
    excalidrawAPI?.toggleSidebar({ name: "marker", force: true });
  };

  const handleGalleryIconClick = () => {
    excalidrawAPI?.toggleSidebar({ name: "gallery", force: true });
  };

  /** Collab ▾ — one-click handoff: mint a team room, stage THIS canvas as the
   *  seed (ADR 0005 staged-seed: base null → dead room lets it seed, an
   *  alive-with-snapshot room overwrites it), then jump straight into the
   *  room URL. No intermediate screens. */
  const handleCreateRoomFromCanvas = useCallback(async () => {
    if (creatingRoom) return;
    setCreatingRoom(true);
    try {
      const scene: CollabScene = {
        elements: [...(excalidrawAPI?.getSceneElements() ?? [])],
        appState: excalidrawAPI?.getAppState() ?? {},
      };
      const { invite } = await mintRoom({
        name: t("CollabDefaultRoomName"),
        labelKind: "auto",
        tier: "team",
        config,
      });
      await saveSession(invite.shareId, { edited: scene, base: null });
      window.location.href = collabEditorUrl(roomRoute(invite.shareId));
    } catch (error) {
      console.error("[collab] create room from canvas failed:", error);
      toast.error(t("CollabCreateFromCanvasFailed"));
    } finally {
      setCreatingRoom(false);
    }
  }, [creatingRoom, excalidrawAPI, t, config]);

  const handleOpenCollabPage = useCallback(() => {
    window.location.href = collabEditorUrl();
  }, []);

  const presentationItem = (
    <DropdownMenuItem
      data-testid="more-menu-presentation"
      disabled={slides.length === 0}
      onSelect={handlePresentationIconClick}
    >
      {presentationMode ? <IconPresentationOff /> : <IconPresentation />}
      {presentationMode ? t("Exit Presentation") : t("Enter Presentation")}
    </DropdownMenuItem>
  );

  return (
    <div className="flex gap-x-2 items-center">
      {editorType === "local" && (
        <>
          <AgentActivationControl
            excalidrawAPI={excalidrawAPI}
            editorType="local"
          />
          {/* No divider line — region separation is whitespace alone: a wider
              gap (2× the icon-button gap) between AgentControl and the icons. */}
          <div className="w-4 shrink-0" aria-hidden="true" />
        </>
      )}
      {!isGalleryOpen && (
        <Hint label={t("Gallery")} align="end" sideOffset={8}>
          <Button
            disabled={presentationMode}
            variant="ghost"
            onClick={handleGalleryIconClick}
          >
            <IconLayoutGrid className="size-4" />
          </Button>
        </Hint>
      )}
      {editorType === "local" && (
        <>
          <DropdownMenu>
            {/* Canonical nesting: tooltip outside, trigger inside — Hint swallows
                unknown props, so it must wrap (not sit under) the trigger for
                DropdownMenuTrigger asChild's events to reach the Button. */}
            <Hint label={t("Collab")} align="end" sideOffset={8}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  data-testid="collab-menu-trigger"
                >
                  <IconUsersGroup className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="collab-menu-create"
                disabled={creatingRoom}
                onSelect={() => void handleCreateRoomFromCanvas()}
              >
                <IconUsersGroup className="size-4" />
                {t("CollabCreateFromCanvas")}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="collab-menu-open"
                onSelect={handleOpenCollabPage}
              >
                <IconExternalLink className="size-4" />
                {t("CollabOpenPage")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <Hint label={t("More")} align="end" sideOffset={8}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  data-testid="more-menu-trigger"
                >
                  <IconDotsVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end">
              {!isMobile && (
                <DropdownMenuItem
                  data-testid="more-menu-marker"
                  disabled={presentationMode}
                  onSelect={handleMarkerIconClick}
                >
                  <IconCircleNumber1 className="size-4" />
                  {t("Marker")}
                </DropdownMenuItem>
              )}
              {presentationItem}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {editorType !== "local" && !isMobile && (
        <Hint label={t("Marker")} align="end" sideOffset={8}>
          <Button
            disabled={presentationMode}
            variant="ghost"
            onClick={handleMarkerIconClick}
          >
            <IconCircleNumber1 className="size-4" />
          </Button>
        </Hint>
      )}
    </div>
  );
};

export default TopRightToolbar;
