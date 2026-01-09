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

    const mockElements = [];
    const mockFiles = {};

    const { result } = renderHook(() => useThumbnail());
    await result.current.generateThumbnail(mockElements as any, mockFiles);

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
        appState: {
          viewBackgroundColor: "transparent",
        },
      })
    );
  });
});
