import { vi } from 'vitest';

export const batchSaveFile = vi.fn();
export const getFiles = vi.fn().mockResolvedValue([]);
