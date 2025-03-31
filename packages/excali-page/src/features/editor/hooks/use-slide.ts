import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slideIdOrderListRef,
  slidesAtom,
} from "../store/presentation";
import { updateFrameElements } from "../utils/excalidraw-api.helper";

export const useSlide = (excalidrawAPI: ExcalidrawImperativeAPI | null) => {
  const [presentationMode, setPresentationMode] = useAtom(presentationModeAtom);
  const currentSlide = useAtomValue(slideGlobalIndexAtom);
  const toggleShowSlideQuickNav = useSetAtom(showSlideQuickNavAtom);
  const updateSlideIndex = useSetAtom(slideGlobalIndexAtom);
  const slides = useAtomValue(slidesAtom);

  const scrollToSlide = useCallback(
    (targetSlide: { index?: number; id?: string }) => {
      if (targetSlide.index == null && !targetSlide.id) {
        return;
      }
      const index =
        typeof targetSlide.index === "number"
          ? targetSlide.index
          : slides.findIndex((slide) => slide.id === targetSlide.id);
      excalidrawAPI?.scrollToContent(slides[index].element, {
        animate: true,
        fitToContent: true,
      });
      updateSlideIndex(index);
    },
    [excalidrawAPI, slides, updateSlideIndex]
  );

  const handleTogglePresentation = useCallback(() => {
    setPresentationMode((mode) => {
      const newMode = !mode;
      if (newMode) {
        toggleShowSlideQuickNav(false);
        if (Array.isArray(slideIdOrderListRef.current)) {
          // issue: the id order changed, but the cached orderedSlides in scrollToSlide function is not updated yet
          const slideId = slideIdOrderListRef.current[0];

          updateFrameElements(excalidrawAPI!, slideIdOrderListRef.current);

          slideIdOrderListRef.current = null;
          requestAnimationFrame(() => {
            scrollToSlide({ id: slideId });
            updateSlideIndex(0);
          });
        } else {
          requestAnimationFrame(() => {
            scrollToSlide({ index: 0 });
          });
        }
      }
      requestAnimationFrame(() => {
        excalidrawAPI?.updateScene({ appState: { viewModeEnabled: newMode } });
      });
      return newMode;
    });
  }, [excalidrawAPI, scrollToSlide]);

  const slidePrev = useCallback(() => {
    const nextSlideIndex = Math.max(0, currentSlide - 1);
    scrollToSlide({ index: nextSlideIndex });
  }, [currentSlide, scrollToSlide]);

  const slideNext = useCallback(() => {
    const nextSlideIndex = Math.min(slides.length - 1, currentSlide + 1);
    scrollToSlide({ index: nextSlideIndex });
  }, [currentSlide, slides, scrollToSlide]);

  return {
    presentationMode,
    slides,
    scrollToSlide,
    slidePrev,
    slideNext,
    handleTogglePresentation,
  };
};
