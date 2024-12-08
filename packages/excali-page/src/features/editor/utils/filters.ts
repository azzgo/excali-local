import { ExcalidrawElement } from "@excalidraw/excalidraw/types/excalidraw/element/types";

export const isFrame = (element: ExcalidrawElement) =>
  !element.isDeleted && element.type === "frame";
export const isDeleted = (element: ExcalidrawElement) => element.isDeleted;
export const isNotDeleted = (element: ExcalidrawElement) => !element.isDeleted;
