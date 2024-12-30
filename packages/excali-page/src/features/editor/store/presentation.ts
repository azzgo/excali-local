import { atom } from "jotai";
import { Slides } from "../type";

export const presentationModeAtom = atom(false);
export const slidesAtom = atom<Slides>([]);
export const slideIdOrderListAtom = atom<string[]>([]);
export const slideIdOrderListRef = {
  current: null as string[] | null,
};
export const orderedSlidesAtom = atom((get) => {
  const slides = get(slidesAtom);
  const orderIdList = get(slideIdOrderListAtom);
  const orderedSlides = [...slides];
  orderedSlides.sort((a, b) => {
    return orderIdList.indexOf(a.id) - orderIdList.indexOf(b.id);
  });
  return orderedSlides;
});

export const showSlideQuickNavAtom = atom(false);

export const slideGlobalIndexAtom = atom(0);

export const isFirstSlideAtom = atom((get) => {
  return get(slideGlobalIndexAtom) <= 0;
});

export const isLastSlideAtom = atom((get) => {
  return get(slideGlobalIndexAtom) >= get(slidesAtom).length - 1;
});
