// get/save filed to indexdb
import { BinaryFileData } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { openDB } from "idb";

const DB_NAME = "excali";
const DB_VERSION = 2;
const STORE_NAME = "files";
const DRAWINGS_STORE = "drawings";
const COLLECTIONS_STORE = "collections";

async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v1: files store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      
      // v2: drawings and collections stores
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(DRAWINGS_STORE)) {
          const drawingsStore = db.createObjectStore(DRAWINGS_STORE, { keyPath: "id" });
          drawingsStore.createIndex("updatedAt", "updatedAt");
          drawingsStore.createIndex("collectionIds", "collectionIds", { multiEntry: true });
        }
        
        if (!db.objectStoreNames.contains(COLLECTIONS_STORE)) {
          const collectionsStore = db.createObjectStore(COLLECTIONS_STORE, { keyPath: "id" });
          collectionsStore.createIndex("createdAt", "createdAt");
        }
      }
    },
  });
}

type FileItem = {
  id: string;
  content: BinaryFileData;
};

export async function batchSaveFile(files: Array<FileItem>) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  for (const file of files) {
    await tx.store.put(file);
  }
  await tx.done;
}

export async function getFiles(): Promise<FileItem[]> {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const files = await tx.store.getAll();
  await tx.done;
  return files;
}

export interface Drawing {
  id: string;
  name: string;
  elements: string;
  appState: string;
  files: string;
  thumbnail: string;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DrawingMetadata {
  id: string;
  name: string;
  thumbnail: string;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

export async function saveDrawing(drawing: Drawing): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readwrite");
  await tx.store.put(drawing);
  await tx.done;
}

export async function getDrawings(collectionId?: string): Promise<DrawingMetadata[]> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readonly");
  
  const metadata: DrawingMetadata[] = [];
  
  let cursor;
  if (collectionId) {
    const index = tx.store.index("collectionIds");
    cursor = await index.openCursor(collectionId);
  } else {
    cursor = await tx.store.openCursor();
  }
  
  while (cursor) {
    const drawing = cursor.value as Drawing;
    metadata.push({
      id: drawing.id,
      name: drawing.name,
      thumbnail: drawing.thumbnail,
      collectionIds: drawing.collectionIds,
      createdAt: drawing.createdAt,
      updatedAt: drawing.updatedAt,
    });
    cursor = await cursor.continue();
  }
  
  await tx.done;
  
  return metadata.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateDrawing(id: string, updates: Partial<Drawing>): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readwrite");
  const existing = await tx.store.get(id);
  
  if (existing) {
    await tx.store.put({ ...existing, ...updates, updatedAt: Date.now() });
  }
  
  await tx.done;
}

export async function deleteDrawing(id: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readwrite");
  await tx.store.delete(id);
  await tx.done;
}

export async function createCollection(collection: Collection): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readwrite");
  await tx.store.put(collection);
  await tx.done;
}

export async function updateCollection(id: string, updates: Partial<Collection>): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readwrite");
  const existing = await tx.store.get(id);
  
  if (existing) {
    await tx.store.put({ ...existing, ...updates });
  }
  
  await tx.done;
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readwrite");
  await tx.store.delete(id);
  await tx.done;
}

export async function getCollections(): Promise<Collection[]> {
  const db = await initDB();
  const tx = db.transaction(COLLECTIONS_STORE, "readonly");
  const collections = await tx.store.getAll();
  await tx.done;
  return collections.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getDrawingFullData(drawingId: string): Promise<Pick<Drawing, 'id' | 'elements' | 'appState' | 'files'>> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readonly");
  const drawing = await tx.store.get(drawingId);
  await tx.done;
  
  if (!drawing) {
    throw new Error("Drawing not found");
  }
  
  return {
    id: drawing.id,
    elements: drawing.elements,
    appState: drawing.appState,
    files: drawing.files,
  };
}

export async function getDrawingsFilesOnly(): Promise<Array<{ id: string; files: string }>> {
  const db = await initDB();
  const tx = db.transaction(DRAWINGS_STORE, "readonly");
  
  const filesData: Array<{ id: string; files: string }> = [];
  let cursor = await tx.store.openCursor();
  
  while (cursor) {
    const drawing = cursor.value as Drawing;
    filesData.push({
      id: drawing.id,
      files: drawing.files,
    });
    cursor = await cursor.continue();
  }
  
  await tx.done;
  
  return filesData;
}
