import {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { isFrame } from "./filters";
import { exportToBlob } from "@excalidraw/excalidraw";
import { BinaryFiles } from "@excalidraw/excalidraw/types/excalidraw/types";
import { orderAttributeLabel } from "../type";

type FrameId = string;
type FrameCacheKey = {
  updatedKey?: string;
};

const cachedFrameMap = new Map<FrameId, FrameCacheKey>();
const cachedThumbnail = new WeakMap<FrameCacheKey, string>();

const generateThumbnailKey = (
  frameId: FrameId,
  elements: readonly ExcalidrawElement[]
) => {
  const elementPosStr = elements.map((el) => `${el.x}${el.y}`).join(",");
  return `${frameId}-${elementPosStr}`;
};
export const assembleSlides = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles
) => {
  const frames = elements.filter(isFrame) as ExcalidrawFrameElement[];
  frames.sort((a, b) => {
    return a.customData?.[orderAttributeLabel] - b.customData?.[orderAttributeLabel];
  });

  return Promise.all(
    frames.map(async (frame, index) => {
      const hasCached = cachedFrameMap.has(frame.id);
      if (!hasCached) {
        cachedFrameMap.set(frame.id, {});
      }
      const cachedSymbolKey = cachedFrameMap.get(frame.id)!;
      let snapElement = elements.filter((el) => el.frameId === frame.id);

      const updatedKey = generateThumbnailKey(frame.id, snapElement);
      const shouldUpdate = cachedSymbolKey.updatedKey !== updatedKey;
      let thumbnail;
      if (shouldUpdate) {
        const oldTHumbnail = cachedThumbnail.get(cachedSymbolKey);
        if (oldTHumbnail) {
          URL.revokeObjectURL(oldTHumbnail);
        }
        cachedSymbolKey.updatedKey = updatedKey;
        const blob = await exportToBlob({
          elements: snapElement,
          appState: {
            viewBackgroundColor: "transparent",
          },
          files,
        });
        thumbnail = URL.createObjectURL(blob);
        cachedThumbnail.set(cachedSymbolKey, thumbnail);
      } else {
        thumbnail = cachedThumbnail.get(cachedSymbolKey);
      }

      return {
        id: frame.id,
        name: frame.name ?? `Frame ${index + 1}`,
        thumbnail,
        element: frame,
      };
    })
  );
};
