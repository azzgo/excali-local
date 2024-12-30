import { UnsubscribeCallback } from "@excalidraw/excalidraw/types/excalidraw/types";
import { atom } from "jotai";

export const isMarkingModeAtom = atom(false);

export const markerUnsubscriber = {
  current: null as UnsubscribeCallback | null,
};
