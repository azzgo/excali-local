import { ExportMetadata } from "./export-helpers";
import { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { BinaryFiles } from "@excalidraw/excalidraw/types";

export interface ParsedExcalidrawFile {
  elements: ExcalidrawElement[];
  appState: Record<string, any>;
  files: BinaryFiles;
}

export function getFilenameWithoutExtension(path: string): string {
  const segments = path.split("/");
  const filename = segments[segments.length - 1] || "";
  return filename.replace(/\.excalidraw$/i, "");
}

export function parseExportMetadata(raw: string): ExportMetadata | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (
      typeof parsed.exportedAt !== "string" ||
      typeof parsed.count !== "number" ||
      typeof parsed.version !== "string"
    ) {
      return null;
    }

    return parsed as ExportMetadata;
  } catch {
    return null;
  }
}

export function parseExcalidrawFile(raw: string): ParsedExcalidrawFile | null {
  try {
    const parsed = JSON.parse(raw) as {
      elements?: ExcalidrawElement[];
      appState?: Record<string, any>;
      files?: BinaryFiles;
    };

    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState:
        parsed.appState && typeof parsed.appState === "object" ? parsed.appState : {},
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
    };
  } catch {
    return null;
  }
}
