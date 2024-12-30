import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { IconCircleNumber1 } from "@tabler/icons-react";
import { useMarker } from "../hooks/use-marker";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import Hint from "@/components/hint";

interface MarkerToolbarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

const MarkerToolbar = ({ excalidrawAPI }: MarkerToolbarProps) => {
  const { toggleMarkerMode } = useMarker(excalidrawAPI);
  const [t] = useTranslation();
  const handleMarkerIconClick = () => {
    excalidrawAPI?.toggleSidebar({ name: "marker", force: true });
    toggleMarkerMode(true);
  };
  return (
    <div className="flex gap-x-4 items-center">
      <Hint label={t("Marker")} align="end" sideOffset={8}>
        <Button variant="ghost" onClick={handleMarkerIconClick}>
          <IconCircleNumber1 className="size-4" />
        </Button>
      </Hint>
    </div>
  );
};

export default MarkerToolbar;
