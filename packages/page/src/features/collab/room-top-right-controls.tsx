/**
 * RoomTopRightControls — the canvas top-right overlay for room sessions.
 *
 * Renders into Excalidraw's `renderTopRightUI` slot (Task 092):
 * - Present toggle: start / stop self-presentation (ADR 0008).
 * - Gallery opener: opens the gallery sidebar (hidden when already open).
 *
 * Mirrors the shell of top-right-toolbar.tsx (flex gap-x-1, Hint→Button ghost).
 *
 * Present toggle coupling (Task 100):
 * - ON  → session.startPresenting() + (slides.length > 0 ? handleTogglePresentation(viewMode:false) : nothing)
 * - OFF → session.stopPresenting() + (presentationMode ? handleTogglePresentation() : nothing)
 * - Lockstep: presentationMode=false while presentingSelf → session.stopPresenting()
 *   (Escape / manual exit path keeps room and session in sync)
 * - useRoomSlideStateReset ensures the room always starts and ends clean.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { IconLayoutGrid, IconPresentation, IconPresentationOff } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { galleryIsOpenAtom } from "@/features/gallery/store/gallery-atoms";
import { presentationModeAtom, slidesAtom } from "@/features/editor/store/presentation";
import { useSlide } from "@/features/editor/hooks/use-slide";
import { useRoomSlideStateReset } from "@/features/collab/use-room-slide-state";
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

  // Reset slide atoms on mount/unmount so the room always starts clean.
  useRoomSlideStateReset();

  const presentationMode = useAtomValue(presentationModeAtom);
  const slides = useAtomValue(slidesAtom);
  const { handleTogglePresentation } = useSlide(excalidrawAPI, { viewMode: false });

  // Debounce ref: prevents the lockstep from firing on the same toggle cycle.
  const togglingRef = useRef(false);

  // Lockstep: presentationMode=false while presentingSelf → stopPresenting.
  // Catches Escape / manual slide-mode exit without an explicit Present-OFF click.
  // Mount guard prevents a stale initial render from firing on first mount.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!presentationMode && session.presentingSelf && !togglingRef.current) {
      session.stopPresenting();
    }
  }, [presentationMode, session.presentingSelf, session.stopPresenting]);

  const handlePresentToggle = () => {
    if (session.presentingSelf) {
      // OFF path: stop session, then exit slide mode if active.
      togglingRef.current = true;
      session.stopPresenting();
      if (presentationMode) {
        handleTogglePresentation();
      }
      // Defer reset so the lockstep effect (which runs after the re-render
      // triggered by handleTogglePresentation) sees togglingRef.current === true
      // and does NOT spuriously fire stopPresenting from within this toggle.
      setTimeout(() => {
        togglingRef.current = false;
      }, 0);
    } else {
      // ON path: start session, then enter slide mode if there are slides.
      togglingRef.current = true;
      session.startPresenting();
      if (slides.length > 0) {
        handleTogglePresentation();
      }
      setTimeout(() => {
        togglingRef.current = false;
      }, 0);
    }
  };

  return (
    <div className="flex gap-x-1 items-center">
      {/* Gallery opener — hidden when gallery sidebar is already open.
       *  Order matches the local editor (top-right-toolbar.tsx): gallery
       *  sits left of the presentation entry (task 095). */}
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
          onClick={handlePresentToggle}
        >
          {session.presentingSelf ? (
            <IconPresentationOff className="size-4" />
          ) : (
            <IconPresentation className="size-4" />
          )}
        </Button>
      </Hint>
    </div>
  );
}
