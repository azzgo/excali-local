import {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/excalidraw/types/element/types";
import { isFrame } from "./filters";
import { exportToBlob } from "@excalidraw/excalidraw";
import { BinaryFiles } from "@excalidraw/excalidraw/types/types";

export const assembleSlides = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles
) => {
  const frames = elements.filter(isFrame) as ExcalidrawFrameElement[];

  return Promise.all(
    frames.map(async (frame, index) => {
      const thumbnail = await exportToBlob({
        elements: elements.filter((el) => el.frameId === frame.id),
        appState: {
          viewBackgroundColor: "transparent",
        },
        files,
      });

      return {
        id: frame.id,
        name: frame.name ?? `Frame ${index + 1}`,
        thumbnail: URL.createObjectURL(thumbnail),
        element: frame,
      };
    })
  );
};
