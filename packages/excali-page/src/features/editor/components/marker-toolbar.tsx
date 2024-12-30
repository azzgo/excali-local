import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { IconCircleNumber1 } from "@tabler/icons-react";
import { useMarker } from "../hooks/use-marker";
import { Sidebar } from "@excalidraw/excalidraw";
import { useTranslation } from "react-i18next";

interface MarkerToolbarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

const MarkerToolbar = ({ excalidrawAPI }: MarkerToolbarProps) => {
  const { toggleMarkerMode } = useMarker(excalidrawAPI);
  const [t] = useTranslation();
  return (
    <div className="flex gap-x-4 items-center">
      <Sidebar.Trigger
        title={t("Marker")}
        className="[&_svg]:size-6"
        name="marker"
        onToggle={(open) => open && toggleMarkerMode(true)}
      >
        <IconCircleNumber1 />
      </Sidebar.Trigger>
    </div>
  );
};

export default MarkerToolbar;
