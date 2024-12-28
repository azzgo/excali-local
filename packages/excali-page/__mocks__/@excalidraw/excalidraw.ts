import { vi } from "vitest";

export const restoreAppState = vi.fn().mockReturnValue({});
export const exportToBlob = vi.fn().mockResolvedValue(new Blob());
