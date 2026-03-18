import { useCallback, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";
import { useDrawingCrud } from "./use-drawing-crud";
import { Collection, Drawing } from "../../editor/utils/indexdb";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { BinaryFiles } from "@excalidraw/excalidraw/types/excalidraw/types";
import {
  getFilenameWithoutExtension,
  parseExcalidrawFile,
  parseExportMetadata,
} from "../utils/import-helpers";

const BATCH_SIZE = 50;

export type GalleryImportMode = "append" | "overwrite";

interface ImportResult {
  importedCount: number;
  failedCount: number;
}

type ZipValidationError =
  | "Invalid backup package: missing data.json"
  | "Invalid backup package: malformed data.json"
  | "Invalid backup package: missing drawings";

export function useGalleryImport(
  generateThumbnail: (
    elements: readonly ExcalidrawElement[],
    files: BinaryFiles
  ) => Promise<string>
) {
  const [t] = useTranslation();
  const [isImporting, setIsImporting] = useState(false);
  const { save, getCollections, saveCollection, clearGalleryData } = useDrawingCrud();

  const getZipValidationError = useCallback(
    async (zip: JSZip): Promise<ZipValidationError | null> => {
      const metadataEntry = zip.file("data.json");
      if (!metadataEntry) {
        return "Invalid backup package: missing data.json";
      }

      const metadata = parseExportMetadata(await metadataEntry.async("string"));
      if (!metadata) {
        return "Invalid backup package: malformed data.json";
      }

      const drawingEntries = Object.values(zip.files).filter(
        (entry) => !entry.dir && /^drawings\/.+\.excalidraw$/i.test(entry.name)
      );
      if (drawingEntries.length === 0) {
        return "Invalid backup package: missing drawings";
      }

      return null;
    },
    []
  );

  const validateZipFile = useCallback(
    async (zipFile: File): Promise<boolean> => {
      try {
        const zip = await JSZip.loadAsync(zipFile);
        const validationError = await getZipValidationError(zip);
        if (validationError) {
          toast.error(t(validationError));
          return false;
        }
        return true;
      } catch (error) {
        console.error("Failed to import gallery:", error);
        toast.error(t("Failed to import gallery"));
        return false;
      }
    },
    [getZipValidationError, t]
  );

  const importFromZip = useCallback(
    async (zipFile: File, mode: GalleryImportMode): Promise<ImportResult> => {
      setIsImporting(true);
      let importedCount = 0;
      let failedCount = 0;

      try {
        const zip = await JSZip.loadAsync(zipFile);
        const validationError = await getZipValidationError(zip);
        if (validationError) {
          toast.error(t(validationError));
          return { importedCount: 0, failedCount: 0 };
        }
        const metadata = parseExportMetadata(await zip.file("data.json")!.async("string"))!;
        const drawingEntries = Object.values(zip.files).filter(
          (entry) => !entry.dir && /^drawings\/.+\.excalidraw$/i.test(entry.name)
        );

        if (mode === "overwrite") {
          await clearGalleryData();
        }

        const collectionIdMap = new Map<string, string>();
        if (metadata.collections?.length) {
          const existingCollections = mode === "append" ? await getCollections() : [];
          const existingCollectionByName = new Map(
            existingCollections.map((collection) => [collection.name.toLowerCase(), collection.id])
          );

          for (const collection of metadata.collections) {
            const existingId = existingCollectionByName.get(collection.name.toLowerCase());
            if (mode === "append" && existingId) {
              collectionIdMap.set(collection.id, existingId);
              continue;
            }

            const restoredCollection: Collection = {
              id: mode === "overwrite" ? collection.id : crypto.randomUUID(),
              name: collection.name,
              createdAt: collection.createdAt || Date.now(),
            };
            await saveCollection(restoredCollection);
            collectionIdMap.set(collection.id, restoredCollection.id);
          }
        }

        const drawingMetaByPath = new Map(
          (metadata.drawings || []).map((drawingMeta) => [drawingMeta.path, drawingMeta])
        );

        for (let i = 0; i < drawingEntries.length; i += BATCH_SIZE) {
          const batch = drawingEntries.slice(i, i + BATCH_SIZE);
          for (const entry of batch) {
            try {
              const raw = await entry.async("string");
              const parsed = parseExcalidrawFile(raw);
              if (!parsed) {
                failedCount += 1;
                continue;
              }

              const drawingMeta = drawingMetaByPath.get(entry.name);
              const now = Date.now();
              const collectionIds = (drawingMeta?.collectionIds || [])
                .map((id) => collectionIdMap.get(id))
                .filter((id): id is string => Boolean(id));
              const thumbnail = await generateThumbnail(parsed.elements, parsed.files);

              const drawing: Drawing = {
                id: nanoid(),
                name: drawingMeta?.name || getFilenameWithoutExtension(entry.name),
                elements: JSON.stringify(parsed.elements),
                appState: JSON.stringify(parsed.appState),
                files: JSON.stringify(parsed.files),
                thumbnail,
                collectionIds,
                createdAt: drawingMeta?.createdAt || now,
                updatedAt: drawingMeta?.updatedAt || now,
              };
              await save(drawing);
              importedCount += 1;
            } catch (error) {
              console.error("Failed to import drawing:", entry.name, error);
              failedCount += 1;
            }
          }

          if (i + BATCH_SIZE < drawingEntries.length) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        }

        if (importedCount > 0) {
          toast.success(t("Imported {{count}} drawings successfully", { count: importedCount }));
        }
        if (failedCount > 0) {
          toast.error(t("Failed to import {{count}} drawing(s)", { count: failedCount }));
        }

        return { importedCount, failedCount };
      } catch (error) {
        console.error("Failed to import gallery:", error);
        toast.error(t("Failed to import gallery"));
        return { importedCount: 0, failedCount: 0 };
      } finally {
        setIsImporting(false);
      }
    },
    [
      clearGalleryData,
      generateThumbnail,
      getCollections,
      getZipValidationError,
      save,
      saveCollection,
      t,
    ]
  );

  return {
    isImporting,
    validateZipFile,
    importFromZip,
  };
}
