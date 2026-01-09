import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  galleryIsOpenAtom,
  selectedCollectionIdAtom,
  searchQueryAtom,
  currentLoadedDrawingIdAtom,
  drawingsListAtom,
} from "../store/gallery-atoms";

export function useGallery() {
  const [isOpen, setIsOpen] = useAtom(galleryIsOpenAtom);
  const [selectedCollectionId, setSelectedCollectionId] = useAtom(selectedCollectionIdAtom);
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const [currentLoadedDrawingId, setCurrentLoadedDrawingId] = useAtom(currentLoadedDrawingIdAtom);
  const drawings = useAtomValue(drawingsListAtom);

  return {
    isOpen,
    setIsOpen,
    selectedCollectionId,
    setSelectedCollectionId,
    searchQuery,
    setSearchQuery,
    currentLoadedDrawingId,
    setCurrentLoadedDrawingId,
    drawings,
  };
}
