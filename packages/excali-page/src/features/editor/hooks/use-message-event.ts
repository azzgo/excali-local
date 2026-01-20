import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { nanoid } from "nanoid";
import { FileId } from "@excalidraw/excalidraw/dist/types/element/src/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { useEffect } from "react";
import { getSizeOfDataImage } from "../utils/images";
import { getBrowser } from "@/lib/utils";
import { loadDrawingToScene } from "../utils/excalidraw-api.helper";

interface useMessageEventProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

export function useMessageEvent({ excalidrawAPI }: useMessageEventProps) {
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const lisener: Parameters<
      typeof chrome.runtime.onMessage.addListener
    >[0] = (message) => {
      switch (message.type) {
        case "UPDATE_CANVAS_WITH_SCREENSHOT":
          const { dataUrl, area } = message;
          if (!dataUrl) {
            return;
          }
          getSizeOfDataImage(dataUrl, area).then(
            ({ imageUrl, width, height, mimeType }) => {
              // 如果有设备像素比信息，需要相应调整显示尺寸
              const displayWidth = area?.devicePixelRatio
                ? width / area.devicePixelRatio
                : width;
              const displayHeight = area?.devicePixelRatio
                ? height / area.devicePixelRatio
                : height;

              updateCanvasWithScreenshot(
                excalidrawAPI,
                mimeType,
                imageUrl,
                displayWidth,
                displayHeight,
              );
            },
          );
          break;
        case "UPDATE_CANVAS_WITH_JSON":
          const { json } = message;
          if (!json) {
            return;
          }
          const elements = json.elements;
          const appState = json.appState;
          const files = json.files;

          loadDrawingToScene(excalidrawAPI, elements, appState, files);
        default:
          break;
      }
    };
    getBrowser()?.runtime?.onMessage?.addListener(lisener);
    getBrowser()?.runtime?.sendMessage({ type: "READY" });
    return () => {
      getBrowser()?.runtime?.onMessage?.removeListener(lisener);
    };
  }, [excalidrawAPI]);
}

async function updateCanvasWithScreenshot(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  mimeType: string,
  imageUrl: string,
  width: number,
  height: number,
) {
  if (!imageUrl) {
    return;
  }

  const fileId: FileId = new String(nanoid()) as FileId;
  fileId._brand = "FileId";
  excalidrawAPI?.addFiles([
    {
      id: fileId,
      mimeType: mimeType as any,
      dataURL: imageUrl as any,
      created: Date.now(),
    },
  ]);
  const imageElements = convertToExcalidrawElements([
    {
      type: "image",
      id: nanoid(),
      fileId: fileId,
      x: 0,
      y: 0,
      width: width,
      height: height,
    },
  ]);
  excalidrawAPI?.updateScene({
    elements: imageElements,
  });
  excalidrawAPI?.scrollToContent(imageElements, { fitToContent: true });
}
