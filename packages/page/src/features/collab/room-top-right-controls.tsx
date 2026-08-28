/**
 * RoomTopRightControls — the canvas top-right overlay for room sessions.
 *
 * Renders into Excalidraw's `renderTopRightUI` slot (Task 092):
 * - Present toggle: start / stop self-presentation (ADR 0008) + slide-deck (094).
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
import { useEffect, useRef } from "react";
import { useSlide } from "@/features/editor/hooks/use-slide";

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
  const { presentationMode, handleTogglePresentation } = useSlide(excalidrawAPI);

  // Mount guard: skip the lockstep effect on the initial render
  // (only react to ESCAPE-induced atom changes, not mount-time state)
  const mounted = useRef(false);
  // Debounce ref: prevents the effect from firing when the toggle click's
  // handleTogglePresentation() call causes the same atom flip.
  const debounceRef = useRef(false);

  // Lockstep: when presentationMode turns OFF (e.g. SlideNavigation Escape)
  // while we are still presenting, call stopPresenting to keep both systems in sync.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!presentationMode && session.presentingSelf && !debounceRef.current) {
      session.stopPresenting();
      excalidrawAPI?.updateScene({ appState: { viewModeEnabled: false } });
    }
    debounceRef.current = false;
  }, [presentationMode, session, excalidrawAPI]);

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
          onClick={() => {
            const isOn = session.presentingSelf;
            if (isOn) {
              // OFF: stop session + exit slide mode via handleTogglePresentation
              session.stopPresenting();
              debounceRef.current = true;
              handleTogglePresentation();
            } else {
              // ON: start session + enter slide mode via handleTogglePresentation
              session.startPresenting();
              handleTogglePresentation();
            }
          }}
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
