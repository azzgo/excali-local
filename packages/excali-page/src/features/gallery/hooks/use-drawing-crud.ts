import { useCallback } from "react";
import {
  Drawing,
  Collection,
  saveDrawing,
  getDrawings,
  updateDrawing,
  deleteDrawing,
  createCollection as createCollectionDB,
  getCollections as getCollectionsDB,
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

  const createCollection = useCallback(async (name: string) => {
    const collection: Collection = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
    };
    await createCollectionDB(collection);
    return collection;
  }, []);

  const getCollections = useCallback(async () => {
    return await getCollectionsDB();
  }, []);

  return {
    save,
    getAll,
    update,
    remove,
    createCollection,
    getCollections,
  };
}
