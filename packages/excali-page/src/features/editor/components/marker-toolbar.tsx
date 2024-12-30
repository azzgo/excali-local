import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { IconCircleNumber1 } from "@tabler/icons-react";
import { useMarker } from "../hooks/use-marker";
import { Sidebar } from "@excalidraw/excalidraw";

interface MarkerToolbarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

const MarkerToolbar = ({ excalidrawAPI }: MarkerToolbarProps) => {
  const { toggleMarkerMode } = useMarker(excalidrawAPI);
  return (
    <div className="flex gap-x-4 items-center">
      <Sidebar.Trigger
        title="Marker"
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
