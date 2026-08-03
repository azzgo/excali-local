/**
 * canvas/v1 — REAL module helpers for the page dispatcher.
 *
 * Imports the in-repo patched tgz exports (offline-safe, no CDN):
 *   convertToExcalidrawElements / getCommonBounds — pure data transforms
 *   exportToCanvas / exportToSvg — browser-bound (canvas / SVG serialization)
 *
 * `exportPng` uses exportToCanvas (exportToBlob's parent) because the response
 * contract needs {dataURL, width, height} — a Blob carries no dimensions.
 * `scale` maps to exportToCanvas's getDimensions; binary travels as base64.
 */

import {
  convertToExcalidrawElements,
  exportToCanvas,
  exportToSvg,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import {
  blobToDataURL,
  type CanvasV1ExportPngOptions,
  type CanvasV1ExportSvgOptions,
  type CanvasV1Helpers,
} from "./canvas-v1";

/** Build the real helpers (page/browser side). */
export function buildCanvasV1Helpers(): CanvasV1Helpers {
  return {
    convertToExcalidrawElements: (data) =>
      convertToExcalidrawElements(data as Parameters<typeof convertToExcalidrawElements>[0]),

    getCommonBounds: (elements) =>
      getCommonBounds(elements as Parameters<typeof getCommonBounds>[0]),

    exportPng: async ({
      elements,
      appState,
      files,
      mimeType,
      scale,
    }: CanvasV1ExportPngOptions) => {
      const canvas = await exportToCanvas({
        elements: elements as Parameters<typeof exportToCanvas>[0]["elements"],
        appState: appState as Parameters<typeof exportToCanvas>[0]["appState"],
        files: (files ?? null) as Parameters<typeof exportToCanvas>[0]["files"],
        getDimensions:
          scale != null && scale !== 1
            ? (w, h) => ({
                width: Math.round(w * scale),
                height: Math.round(h * scale),
                scale,
              })
            : undefined,
      });
      const dataURL = await canvasToDataURL(canvas, mimeType);
      return { dataURL, width: canvas.width, height: canvas.height };
    },

    exportSvg: async ({ elements, appState, files }: CanvasV1ExportSvgOptions) => {
      const svg = await exportToSvg({
        elements: elements as Parameters<typeof exportToSvg>[0]["elements"],
        appState: appState as Parameters<typeof exportToSvg>[0]["appState"],
        files: (files ?? null) as Parameters<typeof exportToSvg>[0]["files"],
      });
      return new XMLSerializer().serializeToString(svg);
    },
  };
}

function canvasToDataURL(canvas: HTMLCanvasElement, mimeType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("export produced no blob"));
          return;
        }
        blobToDataURL(blob, mimeType ?? blob.type).then(resolve, reject);
      },
      mimeType ?? "image/png",
    );
  });
}
