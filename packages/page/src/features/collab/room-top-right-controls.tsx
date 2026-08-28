/**
 * RoomTopRightControls — the canvas top-right overlay for room sessions.
 *
 * Renders into Excalidraw's `renderTopRightUI` slot (Task 092):
 * - Present toggle: start / stop self-presentation (ADR 0008).
 * - Gallery opener: opens the gallery sidebar (hidden when already open).
 *
 * Mirrors the shell of top-right-toolbar.tsx (flex gap-x-1, Hint→Button ghost).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { IconLayoutGrid, IconPresentation, IconPresentationOff } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { galleryIsOpenAtom } from "@/features/gallery/store/gallery-atoms";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";

interface RoomTopRightControlsProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  session: {
    presentingSelf: boolean;
    startPresenting: () => void;
    stopPresenting: () => void;
  };
}

export function RoomTopRightControls({
  excalidrawAPI,
  session,
}: RoomTopRightControlsProps) {
  const [t] = useTranslation();
  const isGalleryOpen = useAtomValue(galleryIsOpenAtom);

  return (
    <div className="flex gap-x-1 items-center">
      {/* Present toggle */}
      <Hint
        label={
          session.presentingSelf
            ? t("CollabStopPresenting")
            : t("CollabStartPresenting")
        }
        align="end"
        sideOffset={8}
      >
        <Button
          variant="ghost"
          data-testid="collab-present-toggle"
          aria-pressed={session.presentingSelf}
          className={session.presentingSelf ? "text-foreground" : undefined}
          onClick={() =>
            session.presentingSelf
              ? session.stopPresenting()
              : session.startPresenting()
          }
        >
          {session.presentingSelf ? (
            <IconPresentationOff className="size-4" />
          ) : (
            <IconPresentation className="size-4" />
          )}
        </Button>
      </Hint>

      {/* Gallery opener — hidden when gallery sidebar is already open */}
      {!isGalleryOpen && (
        <Hint label={t("Gallery")} align="end" sideOffset={8}>
          <Button
            variant="ghost"
            data-testid="collab-gallery-toggle"
            onClick={() =>
              excalidrawAPI?.toggleSidebar({ name: "gallery", force: true })
            }
          >
            <IconLayoutGrid className="size-4" />
          </Button>
        </Hint>
      )}
    </div>
  );
}
