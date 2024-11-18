import { useSetAtom } from "jotai";
import { slideIdOrderListAtom, slidesAtom } from "../store/presentation";
import { useCallback, useMemo } from "react";
import { assembleSlides } from "../utils/assemble";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { BinaryFiles } from "@excalidraw/excalidraw/types/types";
import { debounce } from "radash";
import { KeyForSlideIdList, setLocalStorage } from "../utils/local";

export const useUpdateSlides = () => {
  const setSlides = useSetAtom(slidesAtom);
  const updateSlideIdOrderList = useSetAtom(slideIdOrderListAtom);

  const updateSlides = useCallback(
    (elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
      requestAnimationFrame(() => {
        assembleSlides(elements, files).then((slides) => {
          updateSlideIdOrderList((slideIdOrderList) => {
            const slideIdList = slides.map((slide) => slide.id);
            const newSlideIdOrderList = slideIdOrderList.filter((id) =>
              slideIdList.includes(id)
            );
            slideIdList.forEach((id) => {
              if (!newSlideIdOrderList.includes(id)) {
                newSlideIdOrderList.push(id);
              }
            });
            setLocalStorage(KeyForSlideIdList, newSlideIdOrderList);
            return newSlideIdOrderList;
          });
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
