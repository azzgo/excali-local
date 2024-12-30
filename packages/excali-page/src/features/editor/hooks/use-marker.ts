import {
  convertToExcalidrawElements,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import {
  ExcalidrawImperativeAPI,
  UnsubscribeCallback,
} from "@excalidraw/excalidraw/types/excalidraw/types";
import { useEffect, useRef } from "react";
import { isMarkingModeAtom } from "../store/marker";
import { useAtom } from "jotai";

const defaultMarkerSize = 50;
const defaultMarkerFontSize = 20;

export const useMarker = (excalidrawApi: ExcalidrawImperativeAPI | null) => {
  const unsubscriber = useRef<UnsubscribeCallback>();
  const [isMarkerMode, updateMarkMode] = useAtom(isMarkingModeAtom);
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
        updateMarkMode(false);
      }
    });
  }, [excalidrawApi]);

  const handleClick = () => {
    updateMarkMode((prev) => {
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

  return {
    handleClick,
    isMarkerMode,
  };
};
