import { describe, expect, it } from "vitest";
import {
  getFilenameWithoutExtension,
  parseExcalidrawFile,
  parseExportMetadata,
} from "@/features/gallery/utils/import-helpers";

describe("import-helpers", () => {
  describe("getFilenameWithoutExtension", () => {
    it("should strip .excalidraw extension", () => {
      expect(getFilenameWithoutExtension("drawings/test_file.excalidraw")).toBe("test_file");
    });

    it("should return filename for non-excalidraw file names", () => {
      expect(getFilenameWithoutExtension("drawings/test_file.json")).toBe("test_file.json");
    });
  });

  describe("parseExportMetadata", () => {
    it("should parse valid metadata", () => {
      const metadata = parseExportMetadata(
        JSON.stringify({
          exportedAt: "2026-03-18T00:00:00.000Z",
          count: 2,
          version: "1.1.0",
        })
      );

      expect(metadata).toEqual({
        exportedAt: "2026-03-18T00:00:00.000Z",
        count: 2,
        version: "1.1.0",
      });
    });

    it("should return null for invalid metadata", () => {
      expect(parseExportMetadata(JSON.stringify({ version: "1.1.0" }))).toBeNull();
      expect(
        parseExportMetadata(
          JSON.stringify({
            exportedAt: "2026-03-18T00:00:00.000Z",
            count: 1,
          })
        )
      ).toBeNull();
      expect(parseExportMetadata("not-json")).toBeNull();
    });
  });

  describe("parseExcalidrawFile", () => {
    it("should parse valid excalidraw file", () => {
      const parsed = parseExcalidrawFile(
        JSON.stringify({
          elements: [{ id: "el-1", type: "rectangle" }],
          appState: { theme: "light" },
          files: { "file-1": { id: "file-1" } },
        })
      );

      expect(parsed).toEqual({
        elements: [{ id: "el-1", type: "rectangle" }],
        appState: { theme: "light" },
        files: { "file-1": { id: "file-1" } },
      });
    });

    it("should use defaults for missing fields", () => {
      const parsed = parseExcalidrawFile(JSON.stringify({}));

      expect(parsed).toEqual({
        elements: [],
        appState: {},
        files: {},
      });
    });

    it("should return null for invalid JSON", () => {
      expect(parseExcalidrawFile("broken")).toBeNull();
    });
  });
});
