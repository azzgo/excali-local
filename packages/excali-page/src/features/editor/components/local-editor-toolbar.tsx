import {
  IconCircleNumber1,
  IconPresentation,
  IconPresentationOff,
  IconLayoutGrid,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useSlide } from "../hooks/use-slide";
import Hint from "@/components/hint";
import { useTranslation } from "react-i18next";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useMarker } from "../hooks/use-marker";

interface SlideToolbarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}
const LocalEditorToolbar = ({ excalidrawAPI }: SlideToolbarProps) => {
  const { presentationMode, slides, handleTogglePresentation } =
    useSlide(excalidrawAPI);
  const [t] = useTranslation();
  const { toggleMarkerMode } = useMarker(excalidrawAPI);
  const handlePresentationIconClick = (
    event: React.MouseEvent<HTMLButtonElement>
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
    <div className="flex gap-x-2">
      <Hint label={t("Gallery")} align="end" sideOffset={8}>
        <Button
          disabled={presentationMode}
          variant="ghost"
          onClick={handleGalleryIconClick}
        >
          <IconLayoutGrid className="size-4" />
        </Button>
      </Hint>
      <Hint label={t("Marker")} align="end" sideOffset={8}>
        <Button
          disabled={presentationMode}
          variant="ghost"
          onClick={handleMarkerIconClick}
        >
          <IconCircleNumber1 className="size-4" />
        </Button>
      </Hint>
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
    </div>
  );
};

export default LocalEditorToolbar;
