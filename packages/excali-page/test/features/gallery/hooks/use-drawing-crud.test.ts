import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDrawingCrud } from "@/features/gallery/hooks/use-drawing-crud";
import * as indexdb from "@/features/editor/utils/indexdb";

vi.mock("@/features/editor/utils/indexdb", () => ({
  saveDrawing: vi.fn(),
  getDrawings: vi.fn(),
  getDrawingFullData: vi.fn(),
  getDrawingsFilesOnly: vi.fn(),
  updateDrawing: vi.fn(),
  deleteDrawing: vi.fn(),
  createCollection: vi.fn(),
  getCollections: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
}));

describe("useDrawingCrud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Drawing CRUD Operations", () => {
    test("save should call saveDrawing", async () => {
      const { result } = renderHook(() => useDrawingCrud());

      const mockDrawing: indexdb.Drawing = {
        id: "1",
        name: "Test Drawing",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test",
        collectionIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await result.current.save(mockDrawing);

      expect(indexdb.saveDrawing).toHaveBeenCalledWith(mockDrawing);
      expect(indexdb.saveDrawing).toHaveBeenCalledTimes(1);
    });

    test("getAll should call getDrawings without filter", async () => {
      const mockDrawings: indexdb.DrawingMetadata[] = [
        {
          id: "1",
          name: "Drawing 1",
          thumbnail: "data:image/webp;base64,test1",
          collectionIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      vi.mocked(indexdb.getDrawings).mockResolvedValue(mockDrawings);

      const { result } = renderHook(() => useDrawingCrud());
      const drawings = await result.current.getAll();

      expect(indexdb.getDrawings).toHaveBeenCalledWith(undefined);
      expect(drawings).toEqual(mockDrawings);
    });

    test("getAll should call getDrawings with collection filter", async () => {
      const { result } = renderHook(() => useDrawingCrud());
      await result.current.getAll("collection-123");

      expect(indexdb.getDrawings).toHaveBeenCalledWith("collection-123");
    });

    test("getFullData should call getDrawingFullData with id", async () => {
      const mockFullData = {
        id: "drawing-123",
        elements: '[{"id":"1","type":"rectangle"}]',
        appState: '{"zoom":1}',
        files: '{}',
      };

      vi.mocked(indexdb.getDrawingFullData).mockResolvedValue(mockFullData);

      const { result } = renderHook(() => useDrawingCrud());
      const fullData = await result.current.getFullData("drawing-123");

      expect(indexdb.getDrawingFullData).toHaveBeenCalledWith("drawing-123");
      expect(indexdb.getDrawingFullData).toHaveBeenCalledTimes(1);
      expect(fullData).toEqual(mockFullData);
    });

    test("getFilesOnly should call getDrawingsFilesOnly", async () => {
      const mockFilesOnly = [
        { id: "1", files: '{"fileId1":"..."}' },
        { id: "2", files: '{}' },
      ];

      vi.mocked(indexdb.getDrawingsFilesOnly).mockResolvedValue(mockFilesOnly);

      const { result } = renderHook(() => useDrawingCrud());
      const filesOnly = await result.current.getFilesOnly();

      expect(indexdb.getDrawingsFilesOnly).toHaveBeenCalledTimes(1);
      expect(filesOnly).toEqual(mockFilesOnly);
    });

    test("update should call updateDrawing with id and updates", async () => {
      const { result } = renderHook(() => useDrawingCrud());

      const updates = { name: "Updated Name" };
      await result.current.update("drawing-123", updates);

      expect(indexdb.updateDrawing).toHaveBeenCalledWith("drawing-123", updates);
      expect(indexdb.updateDrawing).toHaveBeenCalledTimes(1);
    });

    test("remove should call deleteDrawing with id", async () => {
      const { result } = renderHook(() => useDrawingCrud());

      await result.current.remove("drawing-123");

      expect(indexdb.deleteDrawing).toHaveBeenCalledWith("drawing-123");
      expect(indexdb.deleteDrawing).toHaveBeenCalledTimes(1);
    });
  });

  describe("Collection CRUD Operations", () => {
    test("createCollection should call createCollection with new collection", async () => {
      const mockUUID = "550e8400-e29b-41d4-a716-446655440000" as `${string}-${string}-${string}-${string}-${string}`;

      vi.mocked(indexdb.createCollection).mockResolvedValue(undefined);
      vi.spyOn(crypto, "randomUUID").mockReturnValue(mockUUID);

      const { result } = renderHook(() => useDrawingCrud());
      const collection = await result.current.createCollection("New Collection");

      expect(indexdb.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockUUID,
          name: "New Collection",
          createdAt: expect.any(Number),
        })
      );
      expect(collection.id).toBe(mockUUID);
      expect(collection.name).toBe("New Collection");
    });

    test("getCollections should call getCollections", async () => {
      const mockCollections: indexdb.Collection[] = [
        { id: "1", name: "Collection 1", createdAt: Date.now() },
        { id: "2", name: "Collection 2", createdAt: Date.now() },
      ];

      vi.mocked(indexdb.getCollections).mockResolvedValue(mockCollections);

      const { result } = renderHook(() => useDrawingCrud());
      const collections = await result.current.getCollections();

      expect(indexdb.getCollections).toHaveBeenCalledTimes(1);
      expect(collections).toEqual(mockCollections);
    });

    test("updateCollection should call updateCollection with id and updates", async () => {
      const { result } = renderHook(() => useDrawingCrud());

      const updates = { name: "Renamed Collection" };
      await result.current.updateCollection("collection-123", updates);

      expect(indexdb.updateCollection).toHaveBeenCalledWith("collection-123", updates);
      expect(indexdb.updateCollection).toHaveBeenCalledTimes(1);
    });

    test("deleteCollection should delete collection and remove it from drawings", async () => {
      const mockDrawings: indexdb.DrawingMetadata[] = [
        {
          id: "drawing-1",
          name: "Drawing 1",
          thumbnail: "thumb1",
          collectionIds: ["collection-123", "collection-456"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "drawing-2",
          name: "Drawing 2",
          thumbnail: "thumb2",
          collectionIds: ["collection-456"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      vi.mocked(indexdb.getDrawings).mockResolvedValue(mockDrawings);

      const { result } = renderHook(() => useDrawingCrud());
      await result.current.deleteCollection("collection-123");

      expect(indexdb.deleteCollection).toHaveBeenCalledWith("collection-123");
      expect(indexdb.getDrawings).toHaveBeenCalledTimes(1);
      expect(indexdb.updateDrawing).toHaveBeenCalledWith("drawing-1", {
        collectionIds: ["collection-456"],
      });
      expect(indexdb.updateDrawing).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    test("save should propagate errors from saveDrawing", async () => {
      vi.mocked(indexdb.saveDrawing).mockRejectedValue(new Error("Save failed"));

      const { result } = renderHook(() => useDrawingCrud());

      const mockDrawing: indexdb.Drawing = {
        id: "1",
        name: "Test",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "thumb",
        collectionIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await expect(result.current.save(mockDrawing)).rejects.toThrow("Save failed");
    });

    test("getFullData should propagate errors from getDrawingFullData", async () => {
      vi.mocked(indexdb.getDrawingFullData).mockRejectedValue(
        new Error("Drawing not found")
      );

      const { result } = renderHook(() => useDrawingCrud());

      await expect(result.current.getFullData("non-existent-id")).rejects.toThrow(
        "Drawing not found"
      );
    });

    test("update should propagate errors from updateDrawing", async () => {
      vi.mocked(indexdb.updateDrawing).mockRejectedValue(new Error("Update failed"));

      const { result } = renderHook(() => useDrawingCrud());

      await expect(result.current.update("drawing-123", { name: "New" })).rejects.toThrow(
        "Update failed"
      );
    });

    test("remove should propagate errors from deleteDrawing", async () => {
      vi.mocked(indexdb.deleteDrawing).mockRejectedValue(new Error("Delete failed"));

      const { result } = renderHook(() => useDrawingCrud());

      await expect(result.current.remove("drawing-123")).rejects.toThrow("Delete failed");
    });

    test("deleteCollection should propagate errors from deleteCollection", async () => {
      vi.mocked(indexdb.deleteCollection).mockRejectedValue(
        new Error("Collection delete failed")
      );

      const { result } = renderHook(() => useDrawingCrud());

      await expect(result.current.deleteCollection("collection-123")).rejects.toThrow(
        "Collection delete failed"
      );
    });
  });
});
