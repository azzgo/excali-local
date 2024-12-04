import { ExcalidrawElement, ExcalidrawFrameLikeElement, NonDeleted, NonDeletedExcalidrawElement } from "./element/types";
import { AppClassProperties, AppState, StaticCanvasAppState } from "./types";
import { ExcalidrawElementsIncludingDeleted } from "./scene/Scene";
export declare const bindElementsToFramesAfterDuplication: (nextElements: ExcalidrawElement[], oldElements: readonly ExcalidrawElement[], oldIdToDuplicatedId: Map<ExcalidrawElement["id"], ExcalidrawElement["id"]>) => void;
export declare function isElementIntersectingFrame(element: ExcalidrawElement, frame: ExcalidrawFrameLikeElement): boolean;
export declare const getElementsCompletelyInFrame: (elements: readonly ExcalidrawElement[], frame: ExcalidrawFrameLikeElement) => ExcalidrawElement[];
export declare const isElementContainingFrame: (elements: readonly ExcalidrawElement[], element: ExcalidrawElement, frame: ExcalidrawFrameLikeElement) => boolean;
export declare const getElementsIntersectingFrame: (elements: readonly ExcalidrawElement[], frame: ExcalidrawFrameLikeElement) => ExcalidrawElement[];
export declare const elementsAreInFrameBounds: (elements: readonly ExcalidrawElement[], frame: ExcalidrawFrameLikeElement) => boolean;
export declare const elementOverlapsWithFrame: (element: ExcalidrawElement, frame: ExcalidrawFrameLikeElement) => boolean;
export declare const isCursorInFrame: (cursorCoords: {
    x: number;
    y: number;
}, frame: NonDeleted<ExcalidrawFrameLikeElement>) => boolean;
export declare const groupsAreAtLeastIntersectingTheFrame: (elements: readonly NonDeletedExcalidrawElement[], groupIds: readonly string[], frame: ExcalidrawFrameLikeElement) => boolean;
export declare const groupsAreCompletelyOutOfFrame: (elements: readonly NonDeletedExcalidrawElement[], groupIds: readonly string[], frame: ExcalidrawFrameLikeElement) => boolean;
/**
 * Returns a map of frameId to frame elements. Includes empty frames.
 */
export declare const groupByFrameLikes: (elements: readonly ExcalidrawElement[]) => Map<string, ExcalidrawElement[]>;
export declare const getFrameChildren: (allElements: ExcalidrawElementsIncludingDeleted, frameId: string) => ExcalidrawElement[];
export declare const getFrameLikeElements: (allElements: ExcalidrawElementsIncludingDeleted) => ExcalidrawFrameLikeElement[];
/**
 * Returns ExcalidrawFrameElements and non-frame-children elements.
 *
 * Considers children as root elements if they point to a frame parent
 * non-existing in the elements set.
 *
 * Considers non-frame bound elements (container or arrow labels) as root.
 */
export declare const getRootElements: (allElements: ExcalidrawElementsIncludingDeleted) => ExcalidrawElement[];
export declare const getElementsInResizingFrame: (allElements: ExcalidrawElementsIncludingDeleted, frame: ExcalidrawFrameLikeElement, appState: AppState) => ExcalidrawElement[];
export declare const getElementsInNewFrame: (allElements: ExcalidrawElementsIncludingDeleted, frame: ExcalidrawFrameLikeElement) => ExcalidrawElement[];
export declare const getContainingFrame: (element: ExcalidrawElement, elementsMap?: Map<string, ExcalidrawElement>) => ExcalidrawFrameLikeElement | null;
/**
 * Retains (or repairs for target frame) the ordering invriant where children
 * elements come right before the parent frame:
 * [el, el, child, child, frame, el]
 */
export declare const addElementsToFrame: (allElements: ExcalidrawElementsIncludingDeleted, elementsToAdd: NonDeletedExcalidrawElement[], frame: ExcalidrawFrameLikeElement) => ExcalidrawElement[];
export declare const removeElementsFromFrame: (allElements: ExcalidrawElementsIncludingDeleted, elementsToRemove: NonDeletedExcalidrawElement[], appState: AppState) => ExcalidrawElement[];
export declare const removeAllElementsFromFrame: (allElements: ExcalidrawElementsIncludingDeleted, frame: ExcalidrawFrameLikeElement, appState: AppState) => ExcalidrawElement[];
export declare const replaceAllElementsInFrame: (allElements: ExcalidrawElementsIncludingDeleted, nextElementsInFrame: ExcalidrawElement[], frame: ExcalidrawFrameLikeElement, appState: AppState) => ExcalidrawElement[];
/** does not mutate elements, but returns new ones */
export declare const updateFrameMembershipOfSelectedElements: (allElements: ExcalidrawElementsIncludingDeleted, appState: AppState, app: AppClassProperties) => ExcalidrawElementsIncludingDeleted;
/**
 * filters out elements that are inside groups that contain a frame element
 * anywhere in the group tree
 */
export declare const omitGroupsContainingFrameLikes: (allElements: ExcalidrawElementsIncludingDeleted, selectedElements?: readonly ExcalidrawElement[]) => ExcalidrawElement[];
/**
 * depending on the appState, return target frame, which is the frame the given element
 * is going to be added to or remove from
 */
export declare const getTargetFrame: (element: ExcalidrawElement, appState: StaticCanvasAppState) => import("./element/types").ExcalidrawFrameElement | import("./element/types").ExcalidrawMagicFrameElement | null;
export declare const isElementInFrame: (element: ExcalidrawElement, allElements: ExcalidrawElementsIncludingDeleted, appState: StaticCanvasAppState) => boolean;
export declare const getFrameLikeTitle: (element: ExcalidrawFrameLikeElement, frameIdx: number) => string;
