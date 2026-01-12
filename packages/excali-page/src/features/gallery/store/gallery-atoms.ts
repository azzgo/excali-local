import { atom } from "jotai";

export const galleryIsOpenAtom = atom(false);

export const selectedCollectionIdAtom = atom<string | null>(null);

export const searchQueryAtom = atom("");

export const currentLoadedDrawingIdAtom = atom<string | null>(null);

