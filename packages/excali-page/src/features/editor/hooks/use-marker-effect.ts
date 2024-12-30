import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { isMarkingModeAtom, markerUnsubscriber } from "../store/marker";

export function useMarkerEvent(excalidrawApi: ExcalidrawImperativeAPI | null) {
  const updateMarkMode = useSetAtom(isMarkingModeAtom);

  useEffect(() => {
    () => {
      excalidrawApi?.setActiveTool({ type: "selection" });
      markerUnsubscriber.current?.();
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
}
