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
const EXPORT_VERSION = "1.0.0";

export function useGalleryExport() {
  const [t] = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const { getAll, getFullData } = useDrawingCrud();

  const processBatch = async (
    zip: JSZip,
    drawingIds: string[],
    startIndex: number,
    endIndex: number
  ): Promise<void> => {
    const batch = drawingIds.slice(startIndex, endIndex);

    for (const drawingId of batch) {
      const fullDrawing = await getFullData(drawingId);
      const excalidrawData = transformToExcalidrawFormat(fullDrawing);
      const drawingMetadata = (await getAll()).find((d) => d.id === drawingId);
      const filename = drawingMetadata
        ? sanitizeFilename(drawingMetadata.name)
        : sanitizeFilename(drawingId);

      zip.file(
        `drawings/${filename}.excalidraw`,
        JSON.stringify(excalidrawData, null, 2)
      );
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
      const drawingIds = drawings.map((d) => d.id);

      if (drawingIds.length >= BATCH_SIZE) {
        for (let i = 0; i < drawingIds.length; i += BATCH_SIZE) {
          await processBatch(zip, drawingIds, i, Math.min(i + BATCH_SIZE, drawingIds.length));

          if (i + BATCH_SIZE < drawingIds.length) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        }
      } else {
        await processBatch(zip, drawingIds, 0, drawingIds.length);
      }

      const metadata: ExportMetadata = {
        exportedAt: new Date().toISOString(),
        count: drawings.length,
        version: EXPORT_VERSION,
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
  }, [getAll, getFullData, t]);

  return {
    isExporting,
    exportAllDrawingsToZip,
  };
}
