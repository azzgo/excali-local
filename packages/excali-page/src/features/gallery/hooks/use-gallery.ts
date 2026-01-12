import { useAtom } from "jotai";
import {
  galleryIsOpenAtom,
  selectedCollectionIdAtom,
  searchQueryAtom,
  currentLoadedDrawingIdAtom,
} from "../store/gallery-atoms";

export function useGallery() {
  const [isOpen, setIsOpen] = useAtom(galleryIsOpenAtom);
  const [selectedCollectionId, setSelectedCollectionId] = useAtom(selectedCollectionIdAtom);
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const [currentLoadedDrawingId, setCurrentLoadedDrawingId] = useAtom(currentLoadedDrawingIdAtom);

  return {
    isOpen,
    setIsOpen,
    selectedCollectionId,
    setSelectedCollectionId,
    searchQuery,
    setSearchQuery,
    currentLoadedDrawingId,
    setCurrentLoadedDrawingId,
  };
}
