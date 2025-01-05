import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { nanoid } from "nanoid";
import { FileId } from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { useEffect } from "react";
import { getBrowser } from "../lib/browser";
import { getSizeOfDataImage } from "../utils/images";
import { rewriteFont } from "@/lib/utils";

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
              updateCanvasWithScreenshot(
                excalidrawAPI,
                mimeType,
                imageUrl,
                width,
                height
              );
            }
          );
          break;
        case "REPLACE_FONTS":
          const { fonts } = message;
          if (!fonts) {
            return;
          }
          Object.keys(fonts).forEach((font) => {
            if (fonts[font]) {
              switch (font) {
                case "handwriting":
                  rewriteFont("Virgil", fonts[font]);
                  break;
                case "normal":
                  rewriteFont("Helvetica", fonts[font]);
                  break;
                case "code":
                  rewriteFont("Cascadia", fonts[font]);
                  break;
              }
            }
          });
          break;
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
  height: number
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
