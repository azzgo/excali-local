import { useCallback } from "react";
import {
  Drawing,
  Collection,
  saveDrawing,
  getDrawings,
  getDrawingFullData,
  getDrawingsFilesOnly,
  updateDrawing,
  deleteDrawing,
  createCollection as createCollectionDB,
  getCollections as getCollectionsDB,
  updateCollection as updateCollectionDB,
  deleteCollection as deleteCollectionDB,
} from "../../editor/utils/indexdb";

export function useDrawingCrud() {
  const save = useCallback(async (drawing: Drawing) => {
    await saveDrawing(drawing);
  }, []);

  const getAll = useCallback(async (collectionId?: string) => {
    return await getDrawings(collectionId);
  }, []);

  const getFullData = useCallback(async (id: string) => {
    return await getDrawingFullData(id);
  }, []);

  const getFilesOnly = useCallback(async () => {
    return await getDrawingsFilesOnly();
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

  const updateCollection = useCallback(async (id: string, updates: Partial<Collection>) => {
    await updateCollectionDB(id, updates);
  }, []);

  const deleteCollection = useCallback(async (id: string) => {
    await deleteCollectionDB(id);
    const drawings = await getDrawings();
    for (const drawing of drawings) {
      if (drawing.collectionIds?.includes(id)) {
        const newCollectionIds = drawing.collectionIds.filter(cid => cid !== id);
        await updateDrawing(drawing.id, { collectionIds: newCollectionIds });
      }
    }
  }, []);

  return {
    save,
    getAll,
    getFullData,
    getFilesOnly,
    update,
    remove,
    createCollection,
    getCollections,
    updateCollection,
    deleteCollection,
  };
}
