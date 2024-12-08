import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  orderedSlidesAtom,
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slideIdOrderListAtom,
  slideIdOrderListRef,
} from "../store/presentation";

export const useSlide = (excalidrawApi: ExcalidrawImperativeAPI | null) => {
  const [presentationMode, setPresentationMode] = useAtom(presentationModeAtom);
  const currentSlide = useAtomValue(slideGlobalIndexAtom);
  const toggleShowSlideQuickNav = useSetAtom(showSlideQuickNavAtom);
  const updateSlideIndex = useSetAtom(slideGlobalIndexAtom);
  const orderedSlides = useAtomValue(orderedSlidesAtom);
  const updateSlideIdOrderList = useSetAtom(slideIdOrderListAtom);

  const scrollToSlide = useCallback(
    (targetSlide: { index?: number; id?: string }) => {
      if (targetSlide.index == null && !targetSlide.id) {
        return;
      }
      const index =
        typeof targetSlide.index === "number"
          ? targetSlide.index
          : orderedSlides.findIndex((slide) => slide.id === targetSlide.id);
      excalidrawApi?.scrollToContent(orderedSlides[index].element, {
        animate: true,
        fitToContent: true,
      });
      updateSlideIndex(index);
    },
    [excalidrawApi, orderedSlides, updateSlideIndex]
  );

  const handleTogglePresentation = useCallback(() => {
    setPresentationMode((mode) => {
      const newMode = !mode;
      if (newMode) {
        toggleShowSlideQuickNav(false);
        if (Array.isArray(slideIdOrderListRef.current)) {
          updateSlideIdOrderList(slideIdOrderListRef.current);
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
      requestAnimationFrame(() => {
        excalidrawApi?.updateScene({ appState: { viewModeEnabled: newMode } });
      });
      return newMode;
    });
  }, [excalidrawApi, scrollToSlide]);

  const slidePrev = useCallback(() => {
    const nextSlideIndex = Math.max(0, currentSlide - 1);
    scrollToSlide({ index: nextSlideIndex });
  }, [currentSlide, scrollToSlide]);

  const slideNext = useCallback(() => {
    const nextSlideIndex = Math.min(orderedSlides.length - 1, currentSlide + 1);
    scrollToSlide({ index: nextSlideIndex });
  }, [currentSlide, orderedSlides, scrollToSlide]);

  return {
    presentationMode,
    slides: orderedSlides,
    scrollToSlide,
    slidePrev,
    slideNext,
    handleTogglePresentation,
  };
};
