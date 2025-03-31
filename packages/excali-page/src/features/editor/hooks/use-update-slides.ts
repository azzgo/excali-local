import { useSetAtom } from "jotai";
import { slidesAtom } from "../store/presentation";
import { useCallback, useMemo } from "react";
import { assembleSlides } from "../utils/assemble";
import { debounce } from "radash";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { BinaryFiles } from "@excalidraw/excalidraw/types/excalidraw/types";

export const useUpdateSlides = () => {
  const setSlides = useSetAtom(slidesAtom);

  const updateSlides = useCallback(
    (elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
      requestAnimationFrame(() => {
        assembleSlides(elements, files).then((slides) => {
          setSlides(slides);
        });
      });
    },
    []
  );

  const debouncedUpdateSlides = useMemo(() => {
    return debounce({ delay: 300 }, updateSlides);
  }, [updateSlides]);

  return debouncedUpdateSlides;
};
