import { atom } from "jotai";
import { Drawing, getDrawings, getCollections } from "../../editor/utils/indexdb";

export const galleryIsOpenAtom = atom(false);

export const selectedCollectionIdAtom = atom<string | null>(null);

export const searchQueryAtom = atom("");

export const currentLoadedDrawingIdAtom = atom<string | null>(null);

export const galleryRefreshAtom = atom(0);

export const collectionsRefreshAtom = atom(0);

export const currentPageAtom = atom(1);
export const pageSize = 20;

export const drawingsListAtom = atom(async (get) => {
  get(galleryRefreshAtom);
  const collectionId = get(selectedCollectionIdAtom);
  const searchQuery = get(searchQueryAtom);
  const page = get(currentPageAtom);
  
  let drawings = await getDrawings(collectionId ?? undefined);
  
  if (searchQuery) {
    drawings = drawings.filter((drawing) =>
      drawing.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }
  
  const startIndex = 0;
  const endIndex = page * pageSize;
  const hasMore = drawings.length > endIndex;
  
  return {
    drawings: drawings.slice(startIndex, endIndex),
    hasMore,
    total: drawings.length,
  };
});

export const collectionsListAtom = atom(async (get) => {
  get(collectionsRefreshAtom);
  return await getCollections();
});
