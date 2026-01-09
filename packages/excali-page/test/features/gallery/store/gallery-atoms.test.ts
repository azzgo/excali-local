import { describe, expect, test, vi, beforeEach } from "vitest";
import { createStore } from "jotai";
import {
  galleryIsOpenAtom,
  selectedCollectionIdAtom,
  searchQueryAtom,
  currentLoadedDrawingIdAtom,
  drawingsListAtom,
} from "@/features/gallery/store/gallery-atoms";
import * as indexdb from "@/features/editor/utils/indexdb";

vi.mock("@/features/editor/utils/indexdb");

describe("gallery-atoms", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    vi.clearAllMocks();
  });

  test("galleryIsOpenAtom should have default value false", () => {
    const value = store.get(galleryIsOpenAtom);
    expect(value).toBe(false);
  });

  test("galleryIsOpenAtom should be settable", () => {
    store.set(galleryIsOpenAtom, true);
    expect(store.get(galleryIsOpenAtom)).toBe(true);
  });

  test("selectedCollectionIdAtom should have default value null", () => {
    const value = store.get(selectedCollectionIdAtom);
    expect(value).toBeNull();
  });

  test("selectedCollectionIdAtom should be settable", () => {
    store.set(selectedCollectionIdAtom, "collection-123");
    expect(store.get(selectedCollectionIdAtom)).toBe("collection-123");
  });

  test("searchQueryAtom should have default value empty string", () => {
    const value = store.get(searchQueryAtom);
    expect(value).toBe("");
  });

  test("searchQueryAtom should be settable", () => {
    store.set(searchQueryAtom, "test query");
    expect(store.get(searchQueryAtom)).toBe("test query");
  });

  test("currentLoadedDrawingIdAtom should have default value null", () => {
    const value = store.get(currentLoadedDrawingIdAtom);
    expect(value).toBeNull();
  });

  test("currentLoadedDrawingIdAtom should be settable", () => {
    store.set(currentLoadedDrawingIdAtom, "drawing-456");
    expect(store.get(currentLoadedDrawingIdAtom)).toBe("drawing-456");
  });

  test("drawingsListAtom should fetch all drawings when no collection selected", async () => {
    const mockDrawings: indexdb.Drawing[] = [
      {
        id: "1",
        name: "Drawing 1",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test1",
        collectionIds: [],
        createdAt: Date.now() - 2000,
        updatedAt: Date.now() - 2000,
      },
      {
        id: "2",
        name: "Drawing 2",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test2",
        collectionIds: ["collection-123"],
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000,
      },
    ];

    vi.mocked(indexdb.getDrawings).mockResolvedValue(mockDrawings);

    const drawings = await store.get(drawingsListAtom);

    expect(indexdb.getDrawings).toHaveBeenCalledWith(undefined);
    expect(drawings).toEqual(mockDrawings);
  });

  test("drawingsListAtom should fetch filtered drawings when collection selected", async () => {
    const mockDrawings: indexdb.Drawing[] = [
      {
        id: "2",
        name: "Drawing 2",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test2",
        collectionIds: ["collection-123"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    vi.mocked(indexdb.getDrawings).mockResolvedValue(mockDrawings);

    store.set(selectedCollectionIdAtom, "collection-123");
    const drawings = await store.get(drawingsListAtom);

    expect(indexdb.getDrawings).toHaveBeenCalledWith("collection-123");
    expect(drawings).toEqual(mockDrawings);
  });

  test("drawingsListAtom should filter by search query", async () => {
    const mockDrawings: indexdb.Drawing[] = [
      {
        id: "1",
        name: "Test Drawing",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test1",
        collectionIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "2",
        name: "Another Drawing",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test2",
        collectionIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    vi.mocked(indexdb.getDrawings).mockResolvedValue(mockDrawings);

    store.set(searchQueryAtom, "test");
    const drawings = await store.get(drawingsListAtom);

    expect(drawings).toHaveLength(1);
    expect(drawings[0].name).toBe("Test Drawing");
  });

  test("drawingsListAtom should filter case-insensitively", async () => {
    const mockDrawings: indexdb.Drawing[] = [
      {
        id: "1",
        name: "Test Drawing",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test1",
        collectionIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    vi.mocked(indexdb.getDrawings).mockResolvedValue(mockDrawings);

    store.set(searchQueryAtom, "TEST");
    const drawings = await store.get(drawingsListAtom);

    expect(drawings).toHaveLength(1);
    expect(drawings[0].name).toBe("Test Drawing");
  });

  test("drawingsListAtom should return empty array when no matches", async () => {
    const mockDrawings: indexdb.Drawing[] = [
      {
        id: "1",
        name: "Drawing 1",
        elements: "[]",
        appState: "{}",
        files: "{}",
        thumbnail: "data:image/webp;base64,test1",
        collectionIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    vi.mocked(indexdb.getDrawings).mockResolvedValue(mockDrawings);

    store.set(searchQueryAtom, "nonexistent");
    const drawings = await store.get(drawingsListAtom);

    expect(drawings).toHaveLength(0);
  });
});
