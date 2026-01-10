import { atom } from "jotai";
import { Drawing, getDrawings, getCollections } from "../../editor/utils/indexdb";

export const galleryIsOpenAtom = atom(false);

export const selectedCollectionIdAtom = atom<string | null>(null);

export const searchQueryAtom = atom("");

export const currentLoadedDrawingIdAtom = atom<string | null>(null);

export const galleryRefreshAtom = atom(0);

export const collectionsRefreshAtom = atom(0);

export const drawingsListAtom = atom(async (get) => {
  get(galleryRefreshAtom);
  const collectionId = get(selectedCollectionIdAtom);
  const searchQuery = get(searchQueryAtom);
  
  let drawings = await getDrawings(collectionId ?? undefined);
  
  if (searchQuery) {
    drawings = drawings.filter((drawing) =>
      drawing.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }
  
  return drawings;
});

export const collectionsListAtom = atom(async (get) => {
  get(collectionsRefreshAtom);
  return await getCollections();
});
