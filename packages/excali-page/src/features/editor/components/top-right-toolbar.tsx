import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import {
  IconCircleNumber1,
  IconLayoutGrid,
  IconPresentation,
  IconPresentationOff,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { useAtomValue } from "jotai";
import { galleryIsOpenAtom } from "../../gallery/store/gallery-atoms";
import { useSlide } from "../hooks/use-slide";

interface TopRightToolbarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  isMobile: boolean;
  editorType: "local" | "quick";
}

const TopRightToolbar = ({
  excalidrawAPI,
  isMobile,
  editorType,
}: TopRightToolbarProps) => {
  const { presentationMode, slides, handleTogglePresentation } =
    useSlide(excalidrawAPI);
  const [t] = useTranslation();
  const isGalleryOpen = useAtomValue(galleryIsOpenAtom);

  const handlePresentationIconClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    handleTogglePresentation();
    excalidrawAPI?.toggleSidebar({ name: "marker", force: false });
    event.currentTarget?.blur();
  };

  const handleMarkerIconClick = () => {
    excalidrawAPI?.toggleSidebar({ name: "marker", force: true });
  };

  const handleGalleryIconClick = () => {
    excalidrawAPI?.toggleSidebar({ name: "gallery", force: true });
  };

  return (
    <div className="flex gap-x-2 items-center">
      {!isGalleryOpen && (
        <Hint label={t("Gallery")} align="end" sideOffset={8}>
          <Button
            disabled={presentationMode}
            variant="ghost"
            onClick={handleGalleryIconClick}
          >
            <IconLayoutGrid className="size-4" />
          </Button>
        </Hint>
      )}
      {!isMobile && (
        <Hint label={t("Marker")} align="end" sideOffset={8}>
          <Button
            disabled={presentationMode}
            variant="ghost"
            onClick={handleMarkerIconClick}
          >
            <IconCircleNumber1 className="size-4" />
          </Button>
        </Hint>
      )}
      {editorType === "local" && (
        <Hint
          label={
            presentationMode ? t("Exit Presentation") : t("Enter Presentation")
          }
          align="end"
          sideOffset={8}
        >
          <Button
            disabled={slides.length === 0}
            variant="ghost"
            onClick={handlePresentationIconClick}
          >
            {presentationMode ? <IconPresentationOff /> : <IconPresentation />}
          </Button>
        </Hint>
      )}
    </div>
  );
};

export default TopRightToolbar;
