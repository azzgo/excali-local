import { Drawable } from "roughjs/bin/core";
import { ExcalidrawElement } from "../element/types";
import { ElementShape, ElementShapes } from "./types";
import { AppState } from "../types";
export declare class ShapeCache {
    private static rg;
    private static cache;
    /**
     * Retrieves shape from cache if available. Use this only if shape
     * is optional and you have a fallback in case it's not cached.
     */
    static get: <T extends ExcalidrawElement>(element: T) => T["type"] extends keyof ElementShapes ? ElementShapes[T["type"]] | undefined : ElementShape | undefined;
    static set: <T extends ExcalidrawElement>(element: T, shape: T["type"] extends keyof ElementShapes ? ElementShapes[T["type"]] : Drawable) => WeakMap<ExcalidrawElement, ElementShape>;
    static delete: (element: ExcalidrawElement) => boolean;
    static destroy: () => void;
    /**
     * Generates & caches shape for element if not already cached, otherwise
     * returns cached shape.
     */
    static generateElementShape: <T extends import("../element/types").ExcalidrawRectangleElement | import("../element/types").ExcalidrawDiamondElement | import("../element/types").ExcalidrawEllipseElement | import("../element/types").ExcalidrawTextElement | import("../element/types").ExcalidrawLinearElement | import("../element/types").ExcalidrawFreeDrawElement | import("../element/types").ExcalidrawImageElement | import("../element/types").ExcalidrawFrameElement | import("../element/types").ExcalidrawMagicFrameElement | import("../element/types").ExcalidrawIframeElement | import("../element/types").ExcalidrawEmbeddableElement>(element: T, renderConfig: {
        isExporting: boolean;
        canvasBackgroundColor: AppState["viewBackgroundColor"];
    } | null) => ((T["type"] extends keyof ElementShapes ? ElementShapes[T["type"]] | undefined : ElementShape | undefined) & ({} | null)) | (T["type"] extends keyof ElementShapes ? ElementShapes[T["type"]] : Drawable | null);
}
