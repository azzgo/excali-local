import { useCallback } from "react";
import {
  Drawing,
  saveDrawing,
  getDrawings,
  updateDrawing,
  deleteDrawing,
} from "../../editor/utils/indexdb";

export function useDrawingCrud() {
  const save = useCallback(async (drawing: Drawing) => {
    await saveDrawing(drawing);
  }, []);

  const getAll = useCallback(async (collectionId?: string) => {
    return await getDrawings(collectionId);
  }, []);

  const update = useCallback(async (id: string, updates: Partial<Drawing>) => {
    await updateDrawing(id, updates);
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteDrawing(id);
  }, []);

  return {
    save,
    getAll,
    update,
    remove,
  };
}
