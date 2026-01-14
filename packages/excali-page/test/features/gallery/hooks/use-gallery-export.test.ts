import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useGalleryExport } from "@/features/gallery/hooks/use-gallery-export";
import { toast } from "sonner";
import * as exportHelpers from "@/features/gallery/utils/export-helpers";

const mockGetAll = vi.fn();
const mockGetFullData = vi.fn();

vi.mock("@/features/gallery/hooks/use-drawing-crud", () => ({
  useDrawingCrud: () => ({
    getAll: mockGetAll,
    getFullData: mockGetFullData,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [
    (key: string, options?: any) => {
      if (key === "Exported {{count}} drawings successfully") {
        return `Exported ${options?.count} drawings successfully`;
      }
      return key;
    },
  ],
}));

vi.mock("@/features/gallery/utils/export-helpers", async () => {
  const actual = await vi.importActual<any>("@/features/gallery/utils/export-helpers");
  return {
    ...actual,
    downloadBlob: vi.fn(),
  };
});

describe("useGalleryExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("should return isExporting as false initially", () => {
      const { result } = renderHook(() => useGalleryExport());
      expect(result.current.isExporting).toBe(false);
    });

    it("should return exportAllDrawingsToZip function", () => {
      const { result } = renderHook(() => useGalleryExport());
      expect(typeof result.current.exportAllDrawingsToZip).toBe("function");
    });
  });

  describe("state transitions during export", () => {
    it("should set isExporting to true during export and false after completion", async () => {
      let resolveGetAll: any;
      const getAllPromise = new Promise((resolve) => {
        resolveGetAll = resolve;
      });
      
      mockGetAll.mockReturnValue(getAllPromise);
      mockGetFullData.mockResolvedValue({
        id: "1",
        elements: "[]",
        appState: "{}",
        files: "{}",
      });

      const { result } = renderHook(() => useGalleryExport());

      expect(result.current.isExporting).toBe(false);

      const exportPromise = result.current.exportAllDrawingsToZip();
      
      await vi.waitFor(() => {
        expect(result.current.isExporting).toBe(true);
      });

      resolveGetAll([{ id: "1", name: "Drawing 1" }]);
      
      await exportPromise;

      await vi.waitFor(() => {
        expect(result.current.isExporting).toBe(false);
      });
    });

    it("should set isExporting to false after error", async () => {
      mockGetAll.mockRejectedValue(new Error("[test] Database error"));

      const { result } = renderHook(() => useGalleryExport());

      const exportPromise = result.current.exportAllDrawingsToZip();

      await exportPromise;

      await waitFor(() => {
        expect(result.current.isExporting).toBe(false);
      });
    });
  });

  describe("error handling", () => {
    it("should show info toast when gallery is empty", async () => {
      mockGetAll.mockResolvedValue([]);

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(toast.info).toHaveBeenCalledWith("No drawings to export");
      expect(exportHelpers.downloadBlob).not.toHaveBeenCalled();
    });

    it("should show error toast when getAll fails", async () => {
      mockGetAll.mockRejectedValue(new Error("[test] Failed to fetch drawings"));

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(toast.error).toHaveBeenCalledWith("Failed to export gallery");
      expect(exportHelpers.downloadBlob).not.toHaveBeenCalled();
    });

    it("should show error toast when getFullData fails", async () => {
      mockGetAll.mockResolvedValue([{ id: "1", name: "Drawing 1" }]);
      mockGetFullData.mockRejectedValue(new Error("[test] Failed to fetch drawing"));

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(toast.error).toHaveBeenCalledWith("Failed to export gallery");
      expect(exportHelpers.downloadBlob).not.toHaveBeenCalled();
    });

    it("should log error to console when export fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("[test] Export failed");
      mockGetAll.mockRejectedValue(error);

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to export gallery:",
        error
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("batch processing", () => {
    it("should process small datasets without batching", async () => {
      const drawings = Array.from({ length: 10 }, (_, i) => ({
        id: `drawing-${i}`,
        name: `Drawing ${i}`,
      }));

      mockGetAll.mockResolvedValue(drawings);
      mockGetFullData.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          elements: "[]",
          appState: "{}",
          files: "{}",
        })
      );

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(mockGetFullData).toHaveBeenCalledTimes(10);
      expect(toast.success).toHaveBeenCalledWith(
        "Exported 10 drawings successfully"
      );
    });

    it("should process large datasets with batching", async () => {
      const drawings = Array.from({ length: 60 }, (_, i) => ({
        id: `drawing-${i}`,
        name: `Drawing ${i}`,
      }));

      mockGetAll.mockResolvedValue(drawings);
      mockGetFullData.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          elements: "[]",
          appState: "{}",
          files: "{}",
        })
      );

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(mockGetFullData).toHaveBeenCalledTimes(60);
      expect(toast.success).toHaveBeenCalledWith(
        "Exported 60 drawings successfully"
      );
    });
  });

  describe("successful export", () => {
    it("should call downloadBlob with correct filename format", async () => {
      mockGetAll.mockResolvedValue([{ id: "1", name: "Test Drawing" }]);
      mockGetFullData.mockResolvedValue({
        id: "1",
        elements: "[]",
        appState: "{}",
        files: "{}",
      });

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(exportHelpers.downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^excalidraw-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/)
      );
    });

    it("should show success toast with correct count", async () => {
      mockGetAll.mockResolvedValue([
        { id: "1", name: "Drawing 1" },
        { id: "2", name: "Drawing 2" },
        { id: "3", name: "Drawing 3" },
      ]);
      mockGetFullData.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          elements: "[]",
          appState: "{}",
          files: "{}",
        })
      );

      const { result } = renderHook(() => useGalleryExport());
      await result.current.exportAllDrawingsToZip();

      expect(toast.success).toHaveBeenCalledWith(
        "Exported 3 drawings successfully"
      );
    });
  });
});
