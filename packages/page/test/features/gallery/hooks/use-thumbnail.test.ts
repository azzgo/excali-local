import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThumbnail } from "@/features/gallery/hooks/use-thumbnail";
import * as excalidraw from "@excalidraw/excalidraw";

vi.mock("@excalidraw/excalidraw");

describe("useThumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should return generateThumbnail method", () => {
    const { result } = renderHook(() => useThumbnail());

    expect(result.current.generateThumbnail).toBeInstanceOf(Function);
  });

  test("should generate thumbnail as base64 data URL", async () => {
    const mockBlob = new Blob(["mock-image-data"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const mockElements = [
      {
        id: "1",
        type: "rectangle" as const,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ];

    const mockFiles = {};

    const { result } = renderHook(() => useThumbnail());
    const thumbnail = await result.current.generateThumbnail(
      mockElements as any,
      mockFiles
    );

    expect(excalidraw.exportToBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: mockElements,
        files: mockFiles,
        mimeType: "image/webp",
        quality: 0.5,
        exportPadding: 10,
      })
    );

    expect(thumbnail).toMatch(/^data:image\/webp;base64,/);
  });

  test("should call getDimensions with correct scale calculation", async () => {
    const mockBlob = new Blob(["mock-image-data"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const mockElements: any[] = [];
    const mockFiles = {};

    const { result } = renderHook(() => useThumbnail());
    await result.current.generateThumbnail(mockElements, mockFiles);

    const exportCall = vi.mocked(excalidraw.exportToBlob).mock.calls[0][0];
    const getDimensions = exportCall.getDimensions;

    expect(getDimensions).toBeInstanceOf(Function);

    const dimensions = getDimensions!(400, 800);
    expect(dimensions).toEqual({
      width: 100,
      height: 200,
      scale: 0.25,
    });
  });

  test("should handle transparent background", async () => {
    const mockBlob = new Blob(["mock-image-data"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const { result } = renderHook(() => useThumbnail());
    await result.current.generateThumbnail([] as any, {});

    expect(excalidraw.exportToBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        appState: expect.objectContaining({
          viewBackgroundColor: "transparent",
        }),
      })
    );
  });

  test("should handle empty canvas", async () => {
    const mockBlob = new Blob(["empty-canvas"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const { result } = renderHook(() => useThumbnail());
    const thumbnail = await result.current.generateThumbnail([], {});

    expect(excalidraw.exportToBlob).toHaveBeenCalledTimes(1);
    expect(thumbnail).toMatch(/^data:image\/webp;base64,/);
  });

  test("should handle very large canvas dimensions", async () => {
    const mockBlob = new Blob(["large-canvas"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const mockElements = [
      {
        id: "1",
        type: "rectangle" as const,
        x: 0,
        y: 0,
        width: 10000,
        height: 10000,
      },
    ];

    const { result } = renderHook(() => useThumbnail());
    const thumbnail = await result.current.generateThumbnail(mockElements as any, {});

    expect(excalidraw.exportToBlob).toHaveBeenCalledTimes(1);
    expect(thumbnail).toMatch(/^data:image\/webp;base64,/);

    const exportCall = vi.mocked(excalidraw.exportToBlob).mock.calls[0][0];
    const getDimensions = exportCall.getDimensions;

    const dimensions = getDimensions!(10000, 10000);
    expect(dimensions.width).toBe(200);
    expect(dimensions.height).toBe(200);
    expect(dimensions.scale).toBe(0.02);
  });

  test("should handle canvas with very wide aspect ratio", async () => {
    const mockBlob = new Blob(["wide-canvas"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const { result } = renderHook(() => useThumbnail());
    await result.current.generateThumbnail([], {});

    const exportCall = vi.mocked(excalidraw.exportToBlob).mock.calls[0][0];
    const getDimensions = exportCall.getDimensions;

    const dimensions = getDimensions!(2000, 500);
    expect(dimensions.width).toBe(800);
    expect(dimensions.height).toBe(200);
    expect(dimensions.scale).toBe(0.4);
  });

  test("should handle canvas with very tall aspect ratio", async () => {
    const mockBlob = new Blob(["tall-canvas"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const { result } = renderHook(() => useThumbnail());
    await result.current.generateThumbnail([], {});

    const exportCall = vi.mocked(excalidraw.exportToBlob).mock.calls[0][0];
    const getDimensions = exportCall.getDimensions;

    const dimensions = getDimensions!(500, 2000);
    expect(dimensions.width).toBe(50);
    expect(dimensions.height).toBe(200);
    expect(dimensions.scale).toBe(0.1);
  });

  test("should propagate error when exportToBlob fails", async () => {
    const mockError = new Error("Export failed");
    vi.mocked(excalidraw.exportToBlob).mockRejectedValue(mockError);

    const mockElements = [
      {
        id: "1",
        type: "rectangle" as const,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ];

    const { result } = renderHook(() => useThumbnail());

    await expect(
      result.current.generateThumbnail(mockElements as any, {})
    ).rejects.toThrow("Export failed");
  });

  test("should handle Blob to base64 conversion error", async () => {
    const mockBlob = new Blob(["mock-image-data"], { type: "image/webp" });
    vi.mocked(excalidraw.exportToBlob).mockResolvedValue(mockBlob);

    const originalFileReader = global.FileReader;
    const mockFileReader = {
      readAsDataURL: vi.fn(function(this: any) {
        setTimeout(() => {
          if (this.onerror) {
            this.onerror(new Error("FileReader error"));
          }
        }, 0);
      }),
      result: null,
      error: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    global.FileReader = vi.fn(() => mockFileReader) as any;

    const { result } = renderHook(() => useThumbnail());

    await expect(result.current.generateThumbnail([], {})).rejects.toThrow();

    global.FileReader = originalFileReader;
  });
});
