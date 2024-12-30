import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { isMarkingModeAtom, markerUnsubscriber } from "../store/marker";

export function useMarkerEvent(excalidrawAPI: ExcalidrawImperativeAPI | null) {
  const updateMarkMode = useSetAtom(isMarkingModeAtom);

  useEffect(() => {
    return () => {
      excalidrawAPI?.setActiveTool({ type: "selection" });
      updateMarkMode(false);
      markerUnsubscriber.current?.();
    };
  }, [excalidrawAPI]);

  useEffect(() => {
    return excalidrawAPI?.onChange((_, appState) => {
      if (
        appState.activeTool?.type !== "custom" &&
        appState.activeTool.customType !== "marker"
      ) {
        updateMarkMode(false);
      }
    });
  }, [excalidrawAPI]);
}
