import { useCallback } from "react";
import { getDrawingsFilesOnly, getFiles, batchSaveFile } from "../../editor/utils/indexdb";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";

const LAST_CLEANUP_KEY = "gallery_last_cleanup";
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

export function useFileCleanup(excalidrawAPI: ExcalidrawImperativeAPI | null) {
  const shouldRunCleanup = useCallback(() => {
    const lastCleanup = localStorage.getItem(LAST_CLEANUP_KEY);
    if (!lastCleanup) return true;
    
    const timeSinceLastCleanup = Date.now() - parseInt(lastCleanup, 10);
    return timeSinceLastCleanup >= CLEANUP_INTERVAL;
  }, []);

  const cleanupOrphanedFiles = useCallback(async () => {
    try {
      const drawings = await getDrawingsFilesOnly();
      const allFiles = await getFiles();
      
      const referencedFileIds = new Set<string>();
      
      // Get files from saved drawings
      drawings.forEach((drawing: { id: string; files: string }) => {
        try {
          const files = JSON.parse(drawing.files);
          Object.keys(files).forEach((fileId) => {
            referencedFileIds.add(fileId);
          });
        } catch (error) {
          console.error(`Failed to parse files for drawing ${drawing.id}:`, error);
        }
      });
      
      // Get files from current working canvas
      if (excalidrawAPI) {
        try {
          const currentFiles = excalidrawAPI.getFiles();
          Object.keys(currentFiles).forEach((fileId) => {
            referencedFileIds.add(fileId);
          });
        } catch (error) {
          console.error("Failed to get current canvas files:", error);
        }
      }
      
      const orphanedFiles = allFiles.filter(
        (file) => !referencedFileIds.has(file.id)
      );
      
      if (orphanedFiles.length > 0) {
        const filesToKeep = allFiles.filter((file) =>
          referencedFileIds.has(file.id)
        );
        
        await batchSaveFile(filesToKeep);
        
        console.log(`Cleaned up ${orphanedFiles.length} orphaned files`);
      }
      
      localStorage.setItem(LAST_CLEANUP_KEY, Date.now().toString());
      
      return {
        cleaned: orphanedFiles.length,
        total: allFiles.length,
      };
    } catch (error) {
      console.error("Failed to cleanup orphaned files:", error);
      throw error;
    }
  }, [excalidrawAPI]);

  const runCleanupIfNeeded = useCallback(async () => {
    if (shouldRunCleanup()) {
      return await cleanupOrphanedFiles();
    }
    return null;
  }, [shouldRunCleanup, cleanupOrphanedFiles]);

  return {
    cleanupOrphanedFiles,
    runCleanupIfNeeded,
    shouldRunCleanup,
  };
}
