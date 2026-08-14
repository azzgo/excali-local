import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { useGalleryImport } from "@/features/gallery/hooks/use-gallery-import";

const {
  mockSave,
  mockGetCollections,
  mockSaveCollection,
  mockClearGalleryData,
  mockLoadAsync,
} = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockGetCollections: vi.fn(),
  mockSaveCollection: vi.fn(),
  mockClearGalleryData: vi.fn(),
  mockLoadAsync: vi.fn(),
}));

vi.mock("@/features/gallery/hooks/use-drawing-crud", () => ({
  useDrawingCrud: () => ({
    save: mockSave,
    getCollections: mockGetCollections,
    saveCollection: mockSaveCollection,
    clearGalleryData: mockClearGalleryData,
  }),
}));

vi.mock("jszip", () => ({
  default: {
    loadAsync: mockLoadAsync,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [
    (key: string, options?: { count?: number }) =>
      options?.count !== undefined
        ? key.replace("{{count}}", String(options.count))
        : key,
  ],
}));

function createZipMock({
  entries,
  metadata,
}: {
  entries: Array<{ name: string; content: string; dir?: boolean }>;
  metadata?: Record<string, unknown> | null;
}) {
  const files = Object.fromEntries(
    entries.map((entry) => [
      entry.name,
      {
        name: entry.name,
        dir: Boolean(entry.dir),
        async: vi.fn().mockResolvedValue(entry.content),
      },
    ])
  );

  return {
    files,
    file: vi.fn((name: string) => {
      if (name !== "data.json" || metadata === null) return null;
      if (metadata === undefined) {
        return {
          async: vi.fn().mockResolvedValue(
            JSON.stringify({
              exportedAt: "2026-03-18T00:00:00.000Z",
              count: entries.filter((entry) =>
                /^drawings\/.+\.excalidraw$/i.test(entry.name)
              ).length,
              version: "1.1.0",
            })
          ),
        };
      }
      return {
        async: vi.fn().mockResolvedValue(JSON.stringify(metadata)),
      };
    }),
  };
}

describe("useGalleryImport", () => {
  const generateThumbnail = vi.fn().mockResolvedValue("thumb");

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCollections.mockResolvedValue([]);
    generateThumbnail.mockResolvedValue("thumb");
  });

  it("imports drawings in append mode", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/a.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
          {
            name: "drawings/b.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const response = await result.current.importFromZip(
      new File(["mock"], "backup.zip"),
      "append"
    );

    expect(response).toEqual({ importedCount: 2, failedCount: 0 });
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockClearGalleryData).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Imported 2 drawings successfully");
  });

  it("clears existing data in overwrite mode before import", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/a.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    await result.current.importFromZip(new File(["mock"], "backup.zip"), "overwrite");

    expect(mockClearGalleryData).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockClearGalleryData.mock.invocationCallOrder[0]).toBeLessThan(
      mockSave.mock.invocationCallOrder[0]
    );
  });

  it("restores collections and mapping from metadata", async () => {
    mockGetCollections.mockResolvedValue([{ id: "existing-c1", name: "Work", createdAt: 1 }]);
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/a.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
        metadata: {
          exportedAt: "2026-03-18T00:00:00.000Z",
          count: 1,
          version: "1.1.0",
          collections: [
            { id: "c1", name: "Work", createdAt: 1 },
            { id: "c2", name: "Personal", createdAt: 2 },
          ],
          drawings: [{ id: "d1", name: "A", path: "drawings/a.excalidraw", collectionIds: ["c1", "c2"] }],
        },
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    await result.current.importFromZip(new File(["mock"], "backup.zip"), "append");

    expect(mockSaveCollection).toHaveBeenCalledTimes(1);
    expect(mockSaveCollection).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Personal" })
    );
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "A",
        collectionIds: expect.arrayContaining(["existing-c1"]),
      })
    );
  });

  it("fails when zip misses data.json", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/legacy.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
        metadata: null,
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const response = await result.current.importFromZip(
      new File(["mock"], "legacy.zip"),
      "append"
    );

    expect(response).toEqual({ importedCount: 0, failedCount: 0 });
    expect(mockSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Invalid backup package: missing data.json");
  });

  it("allows valid data.json without collection metadata", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/legacy.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
        metadata: {
          exportedAt: "2026-03-18T00:00:00.000Z",
          count: 1,
          version: "1.1.0",
        },
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const response = await result.current.importFromZip(
      new File(["mock"], "legacy.zip"),
      "append"
    );

    expect(response).toEqual({ importedCount: 1, failedCount: 0 });
    expect(mockSaveCollection).not.toHaveBeenCalled();
  });

  it("returns error for zip without drawings files", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [{ name: "data.json", content: "{}", dir: false }],
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const response = await result.current.importFromZip(
      new File(["mock"], "empty.zip"),
      "append"
    );

    expect(response).toEqual({ importedCount: 0, failedCount: 0 });
    expect(mockSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Invalid backup package: missing drawings");
  });

  it("returns error when data.json is malformed", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/ok.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
        metadata: {
          count: 1,
          version: "1.1.0",
        },
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const response = await result.current.importFromZip(
      new File(["mock"], "malformed.zip"),
      "append"
    );

    expect(response).toEqual({ importedCount: 0, failedCount: 0 });
    expect(mockSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Invalid backup package: malformed data.json");
  });

  it("returns error when zip has no drawings under drawings/ folder", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "root.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
        metadata: {
          exportedAt: "2026-03-18T00:00:00.000Z",
          count: 1,
          version: "1.1.0",
        },
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const response = await result.current.importFromZip(
      new File(["mock"], "missing-drawings-folder.zip"),
      "append"
    );

    expect(response).toEqual({ importedCount: 0, failedCount: 0 });
    expect(mockSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Invalid backup package: missing drawings");
  });

  it("handles partial import failures", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/ok.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
          {
            name: "drawings/bad.excalidraw",
            content: "not-json",
          },
        ],
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const response = await result.current.importFromZip(
      new File(["mock"], "partial.zip"),
      "append"
    );

    expect(response).toEqual({ importedCount: 1, failedCount: 1 });
    expect(toast.success).toHaveBeenCalledWith("Imported 1 drawings successfully");
    expect(toast.error).toHaveBeenCalledWith("Failed to import 1 drawing(s)");
  });

  it("toggles isImporting during import lifecycle", async () => {
    let resolveLoadAsync: (value: unknown) => void = () => {};
    const loadPromise = new Promise((resolve) => {
      resolveLoadAsync = resolve;
    });
    mockLoadAsync.mockReturnValue(loadPromise);

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    expect(result.current.isImporting).toBe(false);

    const importPromise = result.current.importFromZip(
      new File(["mock"], "state.zip"),
      "append"
    );

    await waitFor(() => {
      expect(result.current.isImporting).toBe(true);
    });

    resolveLoadAsync(
      createZipMock({
        entries: [
          {
            name: "drawings/state.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
      })
    );

    await importPromise;

    await waitFor(() => {
      expect(result.current.isImporting).toBe(false);
    });
  });

  it("validateZipFile returns false for invalid package before import", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/a.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
        metadata: null,
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const valid = await result.current.validateZipFile(
      new File(["mock"], "invalid.zip")
    );

    expect(valid).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Invalid backup package: missing data.json");
  });

  it("validateZipFile returns true for valid package", async () => {
    mockLoadAsync.mockResolvedValue(
      createZipMock({
        entries: [
          {
            name: "drawings/a.excalidraw",
            content: JSON.stringify({ elements: [], appState: {}, files: {} }),
          },
        ],
      })
    );

    const { result } = renderHook(() => useGalleryImport(generateThumbnail));
    const valid = await result.current.validateZipFile(
      new File(["mock"], "valid.zip")
    );

    expect(valid).toBe(true);
  });
});
