import { exportToBlob } from "@excalidraw/excalidraw";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { BinaryFiles } from "@excalidraw/excalidraw/types/excalidraw/types";
import { useCallback, useRef } from "react";

const THUMBNAIL_HEIGHT = 200;
const THUMBNAIL_QUALITY = 0.5;

export function useThumbnail() {
  const cacheRef = useRef<Map<string, string>>(new Map());
  
  const generateThumbnail = useCallback(
    async (
      elements: readonly ExcalidrawElement[],
      files: BinaryFiles
    ): Promise<string> => {
      const cacheKey = JSON.stringify({ 
        ids: elements.map(e => e.id), 
        fileIds: Object.keys(files) 
      });
      
      if (cacheRef.current.has(cacheKey)) {
        return cacheRef.current.get(cacheKey)!;
      }
      
      const blob = await exportToBlob({
        elements,
        appState: {
          viewBackgroundColor: "transparent",
          exportEmbedScene: false,
        },
        files,
        mimeType: "image/webp",
        quality: THUMBNAIL_QUALITY,
        exportPadding: 10,
        getDimensions: (width, height) => {
          const scale = THUMBNAIL_HEIGHT / height;
          return {
            width: Math.round(width * scale),
            height: THUMBNAIL_HEIGHT,
            scale,
          };
        },
      });

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          cacheRef.current.set(cacheKey, result);
          
          if (cacheRef.current.size > 50) {
            const firstKey = cacheRef.current.keys().next().value;
            cacheRef.current.delete(firstKey);
          }
          
          resolve(result);
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
