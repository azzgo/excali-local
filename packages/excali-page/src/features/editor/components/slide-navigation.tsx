import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { Button } from "@/components/ui/button";
import { useSlide } from "../hooks/use-slide";
import { useCallback } from "react";
import {
  isFirstSlideAtom,
  isLastSlideAtom,
  showSlideQuickNavAtom,
} from "../store/presentation";
import { useEvent } from "react-use";
import { useAtom, useAtomValue } from "jotai";
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronUp,
} from "@tabler/icons-react";
import Hint from "@/components/hint";
import { useTranslation } from "react-i18next";
interface SlideNavigationProps {
  excalidrawApi: ExcalidrawImperativeAPI | null;
}
const SlideNavigation = ({ excalidrawApi }: SlideNavigationProps) => {
  const isFirstSlide = useAtomValue(isFirstSlideAtom);
  const isLastSlide = useAtomValue(isLastSlideAtom);
  const {
    presentationMode,
    slides,
    slideNext,
    slidePrev,
    handleTogglePresentation,
  } = useSlide(excalidrawApi);
  const [showSlideQuickNavbar, toggleShowSlideQuickNav] = useAtom(
    showSlideQuickNavAtom
  );

  const slideControlCallback = useCallback(
    (event: KeyboardEvent) => {
      if (!presentationMode) {
        return;
      }
      if (event.key === "Escape") {
        handleTogglePresentation();
        return;
      }
      if (event.key === "ArrowRight") {
        slideNext();
      }
      if (event.key === "ArrowLeft") {
        slidePrev();
      }
    },
    [presentationMode, handleTogglePresentation, slideNext, slidePrev]
  );

  useEvent("keydown", slideControlCallback);
  const [t] = useTranslation();

  return (
    <>
      {presentationMode && (
        <div className="m-auto h-full flex items-center">
          <Hint label="Slide Previous" sideOffset={8} align="end">
            <Button disabled={isFirstSlide} variant="ghost" onClick={slidePrev}>
              <IconArrowLeft className="size-4" />
            </Button>
          </Hint>
          <Hint label="Slide Next" sideOffset={8} align="start">
            <Button disabled={isLastSlide} variant="ghost" onClick={slideNext}>
              <IconArrowRight className="size-4" />
            </Button>
          </Hint>
        </div>
      )}
      {!presentationMode && !showSlideQuickNavbar && (
        <div className="m-auto flex items-center">
          <Button
            disabled={slides.length === 0}
            variant="outline"
            className="bg-[var(--color-surface-low)] hover:bg-[var(--button-hover-bg)] border-none"
            onClick={() => toggleShowSlideQuickNav(true)}
          >
            <IconChevronUp className="size-4" />
            {t("Edit Slides")}
          </Button>
        </div>
      )}
    </>
  );
};

export default SlideNavigation;
