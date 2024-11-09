// get/save filed to indexdb
import { BinaryFileData } from "@excalidraw/excalidraw/types/types";
import { openDB } from "idb";

const DB_NAME = "excali";
const DB_VERSION = 1;
const STORE_NAME = "files";

async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
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
