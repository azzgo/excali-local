import { Drawing } from "../../editor/utils/indexdb";

/**
 * TypeScript interfaces for Excalidraw export format
 */

export interface ExcalidrawFile {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: any[];
  appState: {
    viewBackgroundColor: string;
    theme: string;
    gridSize: number | null;
    [key: string]: any;
  };
  files: Record<string, any>;
}

export interface ExportMetadata {
  exportedAt: string;
  count: number;
  version: string;
}

/**
 * Sanitizes a filename by replacing invalid filesystem characters with underscores,
 * converting to lowercase, and replacing spaces with underscores.
 * 
 * Invalid characters: < > : " / \ | ? *
 * 
 * @param filename - The filename to sanitize
 * @returns The sanitized filename
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

/**
 * Transforms a Drawing from IndexedDB storage format to Excalidraw export format.
 * 
 * This function parses JSON string fields (elements, appState, files) and constructs
 * a valid .excalidraw file structure compatible with excalidraw.com.
 * 
 * @param drawing - The drawing from IndexedDB
 * @returns An ExcalidrawFile object ready for export
 */
export function transformToExcalidrawFormat(
  drawing: Pick<Drawing, "id" | "elements" | "appState" | "files">
): ExcalidrawFile {
  const elements = JSON.parse(drawing.elements);
  const appState = JSON.parse(drawing.appState);
  const files = JSON.parse(drawing.files);

  return {
    type: "excalidraw",
    version: 2,
    source: window.location.origin,
    elements,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
      theme: appState.theme || "light",
      gridSize: appState.gridSize ?? null,
      ...appState,
    },
    files,
  };
}

/**
 * Downloads a Blob using native browser APIs without external dependencies.
 * 
 * Creates a temporary anchor element with a download attribute and programmatically
 * clicks it to trigger the browser's download mechanism. Cleans up the object URL
 * after download to prevent memory leaks.
 * 
 * Supported browsers: Chrome 52+, Firefox 20+, Safari 10+
 * 
 * @param blob - The Blob to download
 * @param filename - The desired filename for the download
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
