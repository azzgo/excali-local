import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { IconPresentation, IconPresentationOff } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useSlide } from "../hooks/use-slide";
import Hint from "@/components/hint";
import { useTranslation } from "react-i18next";

interface SlideToolbarProps {
  excalidrawApi: ExcalidrawImperativeAPI | null;
}
const SlideToolbar = ({ excalidrawApi }: SlideToolbarProps) => {
  const { presentationMode, slides, handleTogglePresentation } =
    useSlide(excalidrawApi);
  const [t] = useTranslation();
  return (
    <div className="flex gap-x-4">
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
          onClick={handleTogglePresentation}
        >
          {presentationMode ? <IconPresentationOff /> : <IconPresentation />}
        </Button>
      </Hint>
    </div>
  );
};

export default SlideToolbar;
