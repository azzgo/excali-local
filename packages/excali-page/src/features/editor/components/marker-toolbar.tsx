import Hint from "@/components/hint";
import { Button } from "@/components/ui/button";
import {
  convertToExcalidrawElements,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import {
  ExcalidrawImperativeAPI,
  UnsubscribeCallback,
} from "@excalidraw/excalidraw/types/excalidraw/types";
import {
  IconCircleNumber1,
  IconCircleNumber1Filled,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

interface MarkerToolbarProps {
  excalidrawApi: ExcalidrawImperativeAPI | null;
}

const defaultMarkerSize = 50;
const defaultMarkerFontSize = 20;

const MarkerToolbar = ({ excalidrawApi }: MarkerToolbarProps) => {
  const unsubscriber = useRef<UnsubscribeCallback>();
  const [isActivated, setIsActivated] = useState(false);
  const markerCount = useRef(0);

  useEffect(() => {
    () => {
      excalidrawApi?.setActiveTool({ type: "selection" });
      unsubscriber.current?.();
    };
  }, [excalidrawApi]);

  useEffect(() => {
    return excalidrawApi?.onChange((_, appState) => {
      if (
        appState.activeTool?.type !== "custom" &&
        appState.activeTool.customType !== "marker"
      ) {
        setIsActivated(false);
      }
    });
  }, [excalidrawApi]);

  const handleClick = () => {
    setIsActivated((prev) => {
      unsubscriber?.current?.();
      const newState = !prev;
      if (newState) {
        excalidrawApi?.setActiveTool({
          type: "custom",
          customType: "marker",
          locked: true,
        });
        const onPointerUpUnsubscriber = excalidrawApi?.onPointerUp(
          (activeTool, _, event) => {
            if (
              activeTool.type === "custom" &&
              activeTool.customType === "marker"
            ) {
              const appState = excalidrawApi.getAppState();
              const point = viewportCoordsToSceneCoords(event, appState);
              const size = defaultMarkerSize / appState.zoom.value;
              const fontSize = defaultMarkerFontSize / appState.zoom.value;
              excalidrawApi?.updateScene({
                elements: excalidrawApi.getSceneElements().concat(
                  convertToExcalidrawElements([
                    {
                      type: "ellipse",
                      x: point.x - size / 2,
                      y: point.y - size / 2,
                      width: size,
                      height: size,
                      label: {
                        text: `${++markerCount.current}`,
                        fontSize,
                      },
                      strokeColor: appState.currentItemStrokeColor,
                      backgroundColor: appState.currentItemBackgroundColor,
                      fillStyle: appState.currentItemFillStyle,
                      strokeWidth: appState.currentItemStrokeWidth,
                      roughness: appState.currentItemRoughness,
                      opacity: appState.currentItemOpacity,
                      strokeStyle: appState.currentItemStrokeStyle,
                    },
                  ])
                ),
              });
            }
          }
        );
        unsubscriber.current = () => {
          onPointerUpUnsubscriber?.();
          markerCount.current = 0;
        };
      } else {
        excalidrawApi?.setActiveTool({ type: "selection" });
      }
      return newState;
    });
  };
  return (
    <div className="flex gap-x-4 items-center">
      <Hint label="Marker" align="end" sideOffset={8}>
        <Button className="[&_svg]:size-6" variant="ghost" onClick={handleClick}>
          {isActivated ? <IconCircleNumber1Filled /> : <IconCircleNumber1 />}
        </Button>
      </Hint>
    </div>
  );
};

export default MarkerToolbar;
