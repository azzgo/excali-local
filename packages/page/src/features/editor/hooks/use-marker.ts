import {
  convertToExcalidrawElements,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useRef } from "react";
import { isMarkingModeAtom, markerUnsubscriber } from "../store/marker";
import { useAtom } from "jotai";

const defaultMarkerSize = 50;
const defaultMarkerFontSize = 20;
// csp.14 tgz: AppState carries currentItemStrokeWidthKey (thin/medium/bold),
// not a numeric width — map to the STROKE_WIDTH values (1/2/4).
const markerStrokeWidths: Record<string, number> = { thin: 1, medium: 2, bold: 4 };

export const useMarker = (excalidrawAPI: ExcalidrawImperativeAPI | null) => {
  const [isMarkerMode, updateMarkMode] = useAtom(isMarkingModeAtom);
  const markerCount = useRef(0);

  const startMarkerModeBehavior = useCallback(() => {
    markerUnsubscriber.current?.();
    excalidrawAPI?.setActiveTool({
      type: "custom",
      customType: "marker",
      locked: true,
    });
    const onPointerUpUnsubscriber = excalidrawAPI?.onPointerUp(
      (activeTool, _, event) => {
        if (
          activeTool.type === "custom" &&
          activeTool.customType === "marker"
        ) {
          const appState = excalidrawAPI.getAppState();
          const point = viewportCoordsToSceneCoords(event, appState);
          const size = defaultMarkerSize / appState.zoom.value;
          const fontSize = defaultMarkerFontSize / appState.zoom.value;
          const markNumber = ++markerCount.current;
          // get digtal of markNumber
          const markDigits = String(markNumber).length;

          excalidrawAPI?.updateScene({
            elements: excalidrawAPI.getSceneElements().concat(
              convertToExcalidrawElements([
                {
                  type: "ellipse",
                  x: point.x - size / 2,
                  y: point.y - size / 2,
                  width: Math.max(size, markDigits * fontSize + 20),
                  height: size,
                  label: {
                    text: `${markNumber}`,
                    fontSize,
                    fontFamily: appState.currentItemFontFamily,
                  },
                  strokeColor: appState.currentItemStrokeColor,
                  backgroundColor: appState.currentItemBackgroundColor,
                  fillStyle: appState.currentItemFillStyle,
                  strokeWidth: markerStrokeWidths[appState.currentItemStrokeWidthKey ?? "medium"] ?? 2,
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
    markerUnsubscriber.current = () => {
      onPointerUpUnsubscriber?.();
      markerCount.current = 0;
    };
  }, [excalidrawAPI]);

  const toggleMarkerMode = (force?: boolean) => {
    updateMarkMode((prev) => {
      markerUnsubscriber.current?.();
      const newState = typeof force === "boolean" ? force : !prev;
      if (newState) {
        startMarkerModeBehavior();
      } else {
        excalidrawAPI?.setActiveTool({ type: "selection" });
      }
      return newState;
    });
  };

  return {
    toggleMarkerMode,
    isMarkerMode,
  };
};
