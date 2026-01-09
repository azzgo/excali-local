import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDrawingCrud } from "@/features/gallery/hooks/use-drawing-crud";
import * as indexdb from "@/features/editor/utils/indexdb";

vi.mock("@/features/editor/utils/indexdb");

describe("useDrawingCrud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
