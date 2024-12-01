import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { nanoid } from "nanoid";
import { FileId } from "@excalidraw/excalidraw/types/element/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { useEffect } from "react";

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
        default:
          break;
      }
    };
    chrome?.runtime.onMessage.addListener(lisener);
    chrome?.runtime.sendMessage({ type: "READY" });
    return () => {
      chrome?.runtime.onMessage.removeListener(lisener);
    };
  }, [excalidrawAPI]);
}

type Area = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getSizeOfDataImage(dataUrl: string, area?: Area) {
  const mimeType = dataUrl.split(",")[0].split(":")[1].split(";")[0];
  const { promise, resolve } = Promise.withResolvers<{
    width: number;
    height: number;
    mimeType: string;
    imageUrl: string;
  }>();

  if (area) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2d context");
    }
    const image = new Image();
    image.onload = () => {
      canvas.width = area.width;
      canvas.height = area.height;
      canvas.style.position = "absolute";
      canvas.style.top = "-10000px";
      ctx.drawImage(
        image,
        area.x,
        area.y,
        area.width,
        area.height,
        0,
        0,
        area.width,
        area.height
      );
      resolve({
        width: area.width,
        height: area.height,
        mimeType,
        imageUrl: canvas.toDataURL(),
      });
      canvas.remove();
    };
    image.src = dataUrl;
    document.body.appendChild(canvas);
    return promise;
  } else {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.width,
        height: image.height,
        mimeType,
        imageUrl: dataUrl,
      });
      image.remove();
    };
    image.style.position = "absolute";
    image.style.top = "-10000px";
    image.src = dataUrl;
    document.body.appendChild(image);
  }
  return promise;
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
