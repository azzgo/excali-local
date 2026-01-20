import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { orderAttributeLabel } from "../type";
import { KeyForElements, setLocalStorage } from "./local";
import { ExcalidrawFrameElement } from "@excalidraw/excalidraw/dist/types/element/src/types";
import { restoreAppState } from "@excalidraw/excalidraw";
import { omit } from "radash";

export const updateFrameElements = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  frameIdList: string[],
) => {
  let elements = excalidrawAPI?.getSceneElements();
  for (let el of (elements ?? []) as ExcalidrawFrameElement[]) {
    if (frameIdList.includes(el.id)) {
      if (el.customData === undefined) {
        // @ts-expect-error use customData to store order
        el.customData = {};
      }
      el.customData[orderAttributeLabel] = frameIdList.indexOf(el.id);
    }
  }
  excalidrawAPI?.updateScene({ elements });
  setLocalStorage(KeyForElements, elements);
};

export const loadDrawingToScene = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elements: any[],
  appState: any,
  files: any,
) => {
  excalidrawAPI.updateScene({
    elements,
    appState: restoreAppState(
      omit({ ...appState, isLoading: false }, [
        "collaborators",
        "viewModeEnabled",
      ]),
      null,
    ),
  });
  excalidrawAPI.addFiles(files);
};
