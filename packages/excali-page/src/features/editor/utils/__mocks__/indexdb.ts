import { vi } from 'vitest';

export const batchSaveFile = vi.fn();
export const getFiles = vi.fn().mockResolvedValue([]);

export const saveDrawing = vi.fn().mockResolvedValue(undefined);
export const getDrawings = vi.fn().mockResolvedValue([]);
export const updateDrawing = vi.fn().mockResolvedValue(undefined);
export const deleteDrawing = vi.fn().mockResolvedValue(undefined);
export const createCollection = vi.fn().mockResolvedValue(undefined);
export const getCollections = vi.fn().mockResolvedValue([]);

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

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}
