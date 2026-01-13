import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  saveDrawing,
  getDrawings,
  getDrawingFullData,
  getDrawingsFilesOnly,
  updateDrawing,
  deleteDrawing,
  createCollection,
  getCollections,
  updateCollection,
  deleteCollection,
  type Drawing,
  type DrawingMetadata,
  type Collection,
} from "@/features/editor/utils/indexdb";

vi.mock("idb", () => {
  const mockStore = {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(),
    openCursor: vi.fn(),
    index: vi.fn(),
  };

  const mockTransaction = {
    store: mockStore,
    done: Promise.resolve(),
  };

  const mockDB = {
    transaction: vi.fn(() => mockTransaction),
    objectStoreNames: { contains: vi.fn(() => false) },
    createObjectStore: vi.fn(() => ({
      createIndex: vi.fn(),
    })),
  };

  return {
    openDB: vi.fn(() => Promise.resolve(mockDB)),
  };
});

describe("IndexedDB - Lazy Loading Functions", () => {
  let mockDB: any;
  let mockTransaction: any;
  let mockStore: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    const { openDB } = await import("idb");
    mockDB = await openDB("test", 1);
    mockTransaction = mockDB.transaction("test", "readonly");
    mockStore = mockTransaction.store;
  });

  describe("getDrawings - Metadata Only", () => {
    test("should return only metadata fields for all drawings", async () => {
      const mockFullDrawings: Drawing[] = [
        {
          id: "1",
          name: "Drawing 1",
          elements: '[{"id":"elem1"}]',
          appState: '{"zoom":1}',
          files: '{"file1":"data"}',
          thumbnail: "thumb1",
          collectionIds: [],
          createdAt: 1000,
          updatedAt: 2000,
        },
        {
          id: "2",
          name: "Drawing 2",
          elements: '[{"id":"elem2"}]',
          appState: '{"zoom":2}',
          files: '{}',
          thumbnail: "thumb2",
          collectionIds: ["col1"],
          createdAt: 1500,
          updatedAt: 2500,
        },
      ];

      let cursorIndex = 0;
      const cursors = [
        { value: mockFullDrawings[0], continue: vi.fn(() => Promise.resolve(cursors[1])) },
        { value: mockFullDrawings[1], continue: vi.fn(() => Promise.resolve(null)) },
      ];

      mockStore.openCursor.mockResolvedValue(cursors[0]);

      const result = await getDrawings();

      expect(mockStore.openCursor).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      
      expect(result[0]).toEqual({
        id: "2",
        name: "Drawing 2",
        thumbnail: "thumb2",
        collectionIds: ["col1"],
        createdAt: 1500,
        updatedAt: 2500,
      });

      expect(result[0]).not.toHaveProperty("elements");
      expect(result[0]).not.toHaveProperty("appState");
      expect(result[0]).not.toHaveProperty("files");
    });

    test("should filter by collectionId using index", async () => {
      const mockIndex = {
        openCursor: vi.fn(() => Promise.resolve(null)),
      };

      mockStore.index.mockReturnValue(mockIndex);

      await getDrawings("collection-123");

      expect(mockStore.index).toHaveBeenCalledWith("collectionIds");
      expect(mockIndex.openCursor).toHaveBeenCalledWith("collection-123");
    });

    test("should sort by updatedAt descending", async () => {
      const mockDrawings = [
        {
          id: "1",
          name: "Old",
          thumbnail: "t1",
          collectionIds: [],
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: "2",
          name: "New",
          thumbnail: "t2",
          collectionIds: [],
          createdAt: 2000,
          updatedAt: 3000,
        },
      ];

      const cursors = [
        { value: mockDrawings[0] as Drawing, continue: vi.fn(() => Promise.resolve(cursors[1])) },
        { value: mockDrawings[1] as Drawing, continue: vi.fn(() => Promise.resolve(null)) },
      ];

      mockStore.openCursor.mockResolvedValue(cursors[0]);

      const result = await getDrawings();

      expect(result[0].id).toBe("2");
      expect(result[1].id).toBe("1");
    });

    test("should return empty array when no drawings exist", async () => {
      mockStore.openCursor.mockResolvedValue(null);

      const result = await getDrawings();

      expect(result).toEqual([]);
    });
  });

  describe("getDrawingFullData - Full Data Only", () => {
    test("should return only id, elements, appState, files for a drawing", async () => {
      const mockDrawing: Drawing = {
        id: "drawing-123",
        name: "Test Drawing",
        elements: '[{"type":"rectangle"}]',
        appState: '{"zoom":1.5}',
        files: '{"fileId":"fileData"}',
        thumbnail: "thumbnail-data",
        collectionIds: ["col1", "col2"],
        createdAt: 1000,
        updatedAt: 2000,
      };

      mockStore.get.mockResolvedValue(mockDrawing);

      const result = await getDrawingFullData("drawing-123");

      expect(mockStore.get).toHaveBeenCalledWith("drawing-123");
      expect(result).toEqual({
        id: "drawing-123",
        elements: '[{"type":"rectangle"}]',
        appState: '{"zoom":1.5}',
        files: '{"fileId":"fileData"}',
      });

      expect(result).not.toHaveProperty("name");
      expect(result).not.toHaveProperty("thumbnail");
      expect(result).not.toHaveProperty("collectionIds");
      expect(result).not.toHaveProperty("createdAt");
      expect(result).not.toHaveProperty("updatedAt");
    });

    test("should throw error when drawing not found", async () => {
      mockStore.get.mockResolvedValue(undefined);

      await expect(getDrawingFullData("non-existent-id")).rejects.toThrow(
        "Drawing not found"
      );
    });

    test("should handle drawing with empty elements and files", async () => {
      const mockDrawing: Drawing = {
        id: "empty-drawing",
        name: "Empty",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "thumb",
        collectionIds: [],
        createdAt: 1000,
        updatedAt: 2000,
      };

      mockStore.get.mockResolvedValue(mockDrawing);

      const result = await getDrawingFullData("empty-drawing");

      expect(result.elements).toBe("[]");
      expect(result.appState).toBe("{}");
      expect(result.files).toBe("{}");
    });
  });

  describe("getDrawingsFilesOnly - Files Only", () => {
    test("should return only id and files for all drawings", async () => {
      const mockDrawings: Drawing[] = [
        {
          id: "1",
          name: "Drawing 1",
          elements: '[{"id":"elem1"}]',
          appState: '{"zoom":1}',
          files: '{"file1":"data1"}',
          thumbnail: "thumb1",
          collectionIds: [],
          createdAt: 1000,
          updatedAt: 2000,
        },
        {
          id: "2",
          name: "Drawing 2",
          elements: '[{"id":"elem2"}]',
          appState: '{"zoom":2}',
          files: '{"file2":"data2","file3":"data3"}',
          thumbnail: "thumb2",
          collectionIds: [],
          createdAt: 1500,
          updatedAt: 2500,
        },
      ];

      const cursors = [
        { value: mockDrawings[0], continue: vi.fn(() => Promise.resolve(cursors[1])) },
        { value: mockDrawings[1], continue: vi.fn(() => Promise.resolve(null)) },
      ];

      mockStore.openCursor.mockResolvedValue(cursors[0]);

      const result = await getDrawingsFilesOnly();

      expect(mockStore.openCursor).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      
      expect(result[0]).toEqual({
        id: "1",
        files: '{"file1":"data1"}',
      });

      expect(result[1]).toEqual({
        id: "2",
        files: '{"file2":"data2","file3":"data3"}',
      });

      expect(result[0]).not.toHaveProperty("name");
      expect(result[0]).not.toHaveProperty("elements");
      expect(result[0]).not.toHaveProperty("appState");
      expect(result[0]).not.toHaveProperty("thumbnail");
    });

    test("should return empty array when no drawings exist", async () => {
      mockStore.openCursor.mockResolvedValue(null);

      const result = await getDrawingsFilesOnly();

      expect(result).toEqual([]);
    });

    test("should handle drawings with empty files", async () => {
      const mockDrawing: Drawing = {
        id: "1",
        name: "No Files",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "thumb",
        collectionIds: [],
        createdAt: 1000,
        updatedAt: 2000,
      };

      const cursor = {
        value: mockDrawing,
        continue: vi.fn(() => Promise.resolve(null)),
      };

      mockStore.openCursor.mockResolvedValue(cursor);

      const result = await getDrawingsFilesOnly();

      expect(result[0].files).toBe("{}");
    });
  });

  describe("Data Isolation - No Cross-Contamination", () => {
    test("getDrawings should not load heavy fields", async () => {
      const mockDrawing: Drawing = {
        id: "1",
        name: "Test",
        elements: "HUGE_ELEMENTS_STRING",
        appState: "HUGE_APPSTATE_STRING",
        files: "HUGE_FILES_STRING",
        thumbnail: "thumb",
        collectionIds: [],
        createdAt: 1000,
        updatedAt: 2000,
      };

      const cursor = {
        value: mockDrawing,
        continue: vi.fn(() => Promise.resolve(null)),
      };

      mockStore.openCursor.mockResolvedValue(cursor);

      const result = await getDrawings();

      expect(result[0]).not.toHaveProperty("elements");
      expect(result[0]).not.toHaveProperty("appState");
      expect(result[0]).not.toHaveProperty("files");
    });

    test("getDrawingFullData should not load lightweight fields", async () => {
      const mockDrawing: Drawing = {
        id: "1",
        name: "Expensive Name",
        elements: "elements",
        appState: "appState",
        files: "files",
        thumbnail: "expensive-thumbnail",
        collectionIds: ["col1", "col2"],
        createdAt: 1000,
        updatedAt: 2000,
      };

      mockStore.get.mockResolvedValue(mockDrawing);

      const result = await getDrawingFullData("1");

      expect(result).not.toHaveProperty("name");
      expect(result).not.toHaveProperty("thumbnail");
      expect(result).not.toHaveProperty("collectionIds");
    });

    test("getDrawingsFilesOnly should not load other fields", async () => {
      const mockDrawing: Drawing = {
        id: "1",
        name: "Name",
        elements: "elements",
        appState: "appState",
        files: "files",
        thumbnail: "thumbnail",
        collectionIds: [],
        createdAt: 1000,
        updatedAt: 2000,
      };

      const cursor = {
        value: mockDrawing,
        continue: vi.fn(() => Promise.resolve(null)),
      };

      mockStore.openCursor.mockResolvedValue(cursor);

      const result = await getDrawingsFilesOnly();

      expect(result[0]).not.toHaveProperty("name");
      expect(result[0]).not.toHaveProperty("elements");
      expect(result[0]).not.toHaveProperty("appState");
      expect(result[0]).not.toHaveProperty("thumbnail");
    });
  });
});
