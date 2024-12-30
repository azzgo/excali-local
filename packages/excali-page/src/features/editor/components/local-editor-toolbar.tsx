import {
  IconCircleNumber1,
  IconPresentation,
  IconPresentationOff,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useSlide } from "../hooks/use-slide";
import Hint from "@/components/hint";
import { useTranslation } from "react-i18next";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useMarker } from "../hooks/use-marker";

interface SlideToolbarProps {
  excalidrawApi: ExcalidrawImperativeAPI | null;
}
const LocalEditorToolbar = ({ excalidrawApi }: SlideToolbarProps) => {
  const { presentationMode, slides, handleTogglePresentation } =
    useSlide(excalidrawApi);
  const [t] = useTranslation();
  const { toggleMarkerMode } = useMarker(excalidrawApi);
  const handlePresentationIconClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    handleTogglePresentation();
    excalidrawApi?.toggleSidebar({ name: "marker", force: false });
    event.currentTarget?.blur();
  };

  const handleMarkerIconClick = () => {
    excalidrawApi?.toggleSidebar({ name: "marker", force: true });
    toggleMarkerMode(true);
  };

  return (
    <div className="flex gap-x-2">
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
