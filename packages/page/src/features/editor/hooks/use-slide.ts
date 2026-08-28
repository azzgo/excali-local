import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slideIdOrderListRef,
  slidesAtom,
} from "../store/presentation";

export interface UseSlideOptions {
  /**
   * When true (default), handleTogglePresentation calls
   * updateScene({appState:{viewModeEnabled}}) — the normal local-editor behaviour.
   * Set to false for the collab room: the room must never write viewModeEnabled
   * (ADR 0008) but still needs atom flips, quickNav closes, and scroll.
   */
  viewMode?: boolean;
}

export const useSlide = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  options?: UseSlideOptions
) => {
  const viewMode = options?.viewMode ?? true;
  const currentSlide = useAtomValue(slideGlobalIndexAtom);
  const toggleShowSlideQuickNav = useSetAtom(showSlideQuickNavAtom);
  const updateSlideIndex = useSetAtom(slideGlobalIndexAtom);
  const slides = useAtomValue(slidesAtom);
  const [presentationMode, setPresentationMode] = useAtom(presentationModeAtom);

  const scrollToSlide = useCallback(
    (targetSlide: { index?: number; id?: string }) => {
      if (targetSlide.index == null && !targetSlide.id) {
        return;
      }
      const index =
        typeof targetSlide.index === "number"
          ? targetSlide.index
          : slides.findIndex((slide) => slide.id === targetSlide.id);
      excalidrawAPI?.setViewport({
        target: slides[index].element,
        fit: "contain",
        animation: true,
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
      if (viewMode) {
        requestAnimationFrame(() => {
          excalidrawAPI?.updateScene({ appState: { viewModeEnabled: newMode } });
        });
      }
      return newMode;
    });
  }, [excalidrawAPI, scrollToSlide, viewMode]);

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
