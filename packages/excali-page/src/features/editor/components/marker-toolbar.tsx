import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { IconCircleNumber1, IconLayoutGrid } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { useAtomValue } from "jotai";
import { galleryIsOpenAtom } from "../../gallery/store/gallery-atoms";

interface MarkerToolbarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  isMobile: boolean;
}

const TopRightToolbar = ({ excalidrawAPI, isMobile }: MarkerToolbarProps) => {
  const [t] = useTranslation();
  const isGalleryOpen = useAtomValue(galleryIsOpenAtom);

  const handleMarkerIconClick = () => {
    excalidrawAPI?.toggleSidebar({ name: "marker", force: true });
  };
  const handleGalleryIconClick = () => {
    excalidrawAPI?.toggleSidebar({ name: "gallery", force: true });
  };
  return (
    <div className="flex gap-x-4 items-center">
      {!isGalleryOpen && (
        <Hint label={t("Gallery")} align="end" sideOffset={8}>
          <Button variant="ghost" onClick={handleGalleryIconClick}>
            <IconLayoutGrid className="size-4" />
          </Button>
        </Hint>
      )}
      {!isMobile && (
        <Hint label={t("Marker")} align="end" sideOffset={8}>
          <Button variant="ghost" onClick={handleMarkerIconClick}>
            <IconCircleNumber1 className="size-4" />
          </Button>
        </Hint>
      )}
    </div>
  );
};

export default TopRightToolbar;
