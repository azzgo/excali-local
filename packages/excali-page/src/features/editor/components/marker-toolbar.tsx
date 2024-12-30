import Hint from "@/components/hint";
import { Button } from "@/components/ui/button";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import {
  IconCircleNumber1,
  IconCircleNumber1Filled,
} from "@tabler/icons-react";
import { useMarker } from "../hooks/use-marker";

interface MarkerToolbarProps {
  excalidrawApi: ExcalidrawImperativeAPI | null;
}

const MarkerToolbar = ({ excalidrawApi }: MarkerToolbarProps) => {
  const { isMarkerMode, toggleMarkerMode } = useMarker(excalidrawApi);

  return (
    <div className="flex gap-x-4 items-center">
      <Hint label="Marker" align="end" sideOffset={8}>
        <Button
          className="[&_svg]:size-6"
          variant="ghost"
          onClick={toggleMarkerMode}
        >
          {isMarkerMode ? <IconCircleNumber1Filled /> : <IconCircleNumber1 />}
        </Button>
      </Hint>
    </div>
  );
};

export default MarkerToolbar;
