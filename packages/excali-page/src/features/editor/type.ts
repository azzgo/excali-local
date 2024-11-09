import { ExcalidrawFrameElement } from "@excalidraw/excalidraw/types/element/types";

export interface Slide {
  id: string;
  name: string;
  thumbnail?: string;
  element: ExcalidrawFrameElement;
}

export type Slides = Slide[];
