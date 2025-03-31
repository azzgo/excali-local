import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { orderAttributeLabel } from "../type";
import { KeyForElements, setLocalStorage } from "./local";
import {ExcalidrawFrameElement} from "@excalidraw/excalidraw/types/excalidraw/element/types";

export const updateFrameElements = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  frameIdList: string[]
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
