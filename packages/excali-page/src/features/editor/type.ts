import { ExcalidrawFrameElement } from "@excalidraw/excalidraw/types/excalidraw/element/types";
export const orderAttributeLabel = "excali_local_order";

export interface Slide {
  id: string;
  name: string;
  thumbnail?: string;
  element: ExcalidrawFrameElement;
}

export type Slides = Slide[];
