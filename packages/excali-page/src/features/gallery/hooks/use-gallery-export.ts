import { useState, useCallback } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useDrawingCrud } from "./use-drawing-crud";
import {
  sanitizeFilename,
  transformToExcalidrawFormat,
  downloadBlob,
  ExportMetadata,
} from "../utils/export-helpers";

const BATCH_SIZE = 50;
const EXPORT_VERSION = "1.1.0";

export function useGalleryExport() {
  const [t] = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const { getAll, getFullData, getCollections } = useDrawingCrud();

  const processBatch = async (
    zip: JSZip,
    drawings: Awaited<ReturnType<typeof getAll>>,
    startIndex: number,
    endIndex: number,
    exportedDrawingsMeta: NonNullable<ExportMetadata["drawings"]>,
  ): Promise<void> => {
    const batch = drawings.slice(startIndex, endIndex);

    for (const drawingMeta of batch) {
      const fullDrawing = await getFullData(drawingMeta.id);
      const excalidrawData = transformToExcalidrawFormat(fullDrawing);
      const filename = sanitizeFilename(drawingMeta.name || drawingMeta.id);
      const drawingPath = `drawings/${filename}.excalidraw`;

      zip.file(
        drawingPath,
        JSON.stringify(excalidrawData, null, 2)
      );
      exportedDrawingsMeta.push({
        id: drawingMeta.id,
        name: drawingMeta.name,
        path: drawingPath,
        collectionIds: drawingMeta.collectionIds || [],
        createdAt: drawingMeta.createdAt,
        updatedAt: drawingMeta.updatedAt,
      });
    }
  };

  const exportAllDrawingsToZip = useCallback(async () => {
    setIsExporting(true);

    try {
      const drawings = await getAll();

      if (drawings.length === 0) {
        toast.info(t("No drawings to export"));
        setIsExporting(false);
        return;
      }

      const zip = new JSZip();
      const exportedDrawingsMeta: NonNullable<ExportMetadata["drawings"]> = [];

      if (drawings.length >= BATCH_SIZE) {
        for (let i = 0; i < drawings.length; i += BATCH_SIZE) {
          await processBatch(
            zip,
            drawings,
            i,
            Math.min(i + BATCH_SIZE, drawings.length),
            exportedDrawingsMeta,
          );

          if (i + BATCH_SIZE < drawings.length) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        }
      } else {
        await processBatch(zip, drawings, 0, drawings.length, exportedDrawingsMeta);
      }

      const collections = await getCollections();

      const metadata: ExportMetadata = {
        exportedAt: new Date().toISOString(),
        count: drawings.length,
        version: EXPORT_VERSION,
        collections,
        drawings: exportedDrawingsMeta,
      };
      zip.file("data.json", JSON.stringify(metadata, null, 2));

      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `excalidraw-export-${timestamp}.zip`;
      downloadBlob(blob, filename);

      toast.success(
        t("Exported {{count}} drawings successfully", { count: drawings.length })
      );
    } catch (error) {
      console.error("Failed to export gallery:", error);
      toast.error(t("Failed to export gallery"));
    } finally {
      setIsExporting(false);
    }
  }, [getAll, getCollections, getFullData, t]);

  return {
    isExporting,
    exportAllDrawingsToZip,
  };
}
