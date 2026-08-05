import { atom } from "jotai";

export const galleryIsOpenAtom = atom(false);

export const selectedCollectionIdAtom = atom<string | null>(null);

export const searchQueryAtom = atom("");

export const currentLoadedDrawingIdAtom = atom<string | null>(null);

/**
 * Monotonic revision counter bumped after every gallery WRITE (agent dispatcher
 * or the sidebar itself). Sidebar effects depend on it so external mutations
 * (e.g. agent `gallery.save`) refresh the open sidebar live. Reads never bump.
 */
export const galleryRevisionAtom = atom(0);

