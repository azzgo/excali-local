import { exportToBlob } from "@excalidraw/excalidraw";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { BinaryFiles } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useCallback } from "react";

const THUMBNAIL_HEIGHT = 200;
const THUMBNAIL_QUALITY = 0.5;

export function useThumbnail() {
  const generateThumbnail = useCallback(
    async (
      elements: readonly ExcalidrawElement[],
      files: BinaryFiles
    ): Promise<string> => {
      const blob = await exportToBlob({
        elements,
        appState: {
          viewBackgroundColor: "transparent",
        },
        files,
        mimeType: "image/webp",
        quality: THUMBNAIL_QUALITY,
        exportPadding: 10,
        getDimensions: (width, height) => {
          const scale = THUMBNAIL_HEIGHT / height;
          return {
            width: width * scale,
            height: THUMBNAIL_HEIGHT,
            scale,
          };
        },
      });

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },
    []
  );

  return {
    generateThumbnail,
  };
}
