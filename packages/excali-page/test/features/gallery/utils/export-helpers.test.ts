import { describe, it, expect, beforeAll } from "vitest";
import { sanitizeFilename, transformToExcalidrawFormat } from "@/features/gallery/utils/export-helpers";
import { Drawing } from "@/features/editor/utils/indexdb";

beforeAll(() => {
  global.window = {
    location: {
      origin: "http://localhost:3000",
    },
  } as any;
});

describe("sanitizeFilename", () => {
  it("should replace special characters with underscores", () => {
    expect(sanitizeFilename("file<name>test")).toBe("file_name_test");
    expect(sanitizeFilename('file:name"test')).toBe("file_name_test");
    expect(sanitizeFilename("file/name\\test")).toBe("file_name_test");
    expect(sanitizeFilename("file|name?test*")).toBe("file_name_test_");
  });

  it("should replace spaces with underscores", () => {
    expect(sanitizeFilename("my drawing name")).toBe("my_drawing_name");
    expect(sanitizeFilename("test  multiple   spaces")).toBe(
      "test_multiple_spaces"
    );
  });

  it("should convert to lowercase", () => {
    expect(sanitizeFilename("MyDrawing")).toBe("mydrawing");
    expect(sanitizeFilename("TEST_FILE")).toBe("test_file");
  });

  it("should handle mixed transformations", () => {
    expect(sanitizeFilename("My Drawing: Test<File>")).toBe(
      "my_drawing__test_file_"
    );
  });

  it("should handle empty string", () => {
    expect(sanitizeFilename("")).toBe("");
  });

  it("should handle already sanitized names", () => {
    expect(sanitizeFilename("valid_name")).toBe("valid_name");
  });
});

describe("transformToExcalidrawFormat", () => {
  const createMockDrawing = (
    overrides: Partial<Pick<Drawing, "id" | "elements" | "appState" | "files">>
  ): Pick<Drawing, "id" | "elements" | "appState" | "files"> => ({
    id: "test-id",
    elements: JSON.stringify([{ type: "rectangle", id: "rect1" }]),
    appState: JSON.stringify({
      viewBackgroundColor: "#f0f0f0",
      theme: "dark",
      gridSize: 20,
    }),
    files: JSON.stringify({ file1: { mimeType: "image/png" } }),
    ...overrides,
  });

  it("should transform drawing to valid Excalidraw format", () => {
    const drawing = createMockDrawing({});
    const result = transformToExcalidrawFormat(drawing);

    expect(result.type).toBe("excalidraw");
    expect(result.version).toBe(2);
    expect(result.source).toBe(window.location.origin);
    expect(result.elements).toEqual([{ type: "rectangle", id: "rect1" }]);
    expect(result.appState.viewBackgroundColor).toBe("#f0f0f0");
    expect(result.appState.theme).toBe("dark");
    expect(result.appState.gridSize).toBe(20);
    expect(result.files).toEqual({ file1: { mimeType: "image/png" } });
  });

  it("should handle missing optional appState fields with defaults", () => {
    const drawing = createMockDrawing({
      appState: JSON.stringify({}),
    });
    const result = transformToExcalidrawFormat(drawing);

    expect(result.appState.viewBackgroundColor).toBe("#ffffff");
    expect(result.appState.theme).toBe("light");
    expect(result.appState.gridSize).toBe(null);
  });

  it("should preserve additional appState fields", () => {
    const drawing = createMockDrawing({
      appState: JSON.stringify({
        viewBackgroundColor: "#000000",
        customField: "custom value",
        anotherField: 123,
      }),
    });
    const result = transformToExcalidrawFormat(drawing);

    expect(result.appState.customField).toBe("custom value");
    expect(result.appState.anotherField).toBe(123);
  });

  it("should handle empty elements array", () => {
    const drawing = createMockDrawing({
      elements: JSON.stringify([]),
    });
    const result = transformToExcalidrawFormat(drawing);

    expect(result.elements).toEqual([]);
  });

  it("should handle empty files object", () => {
    const drawing = createMockDrawing({
      files: JSON.stringify({}),
    });
    const result = transformToExcalidrawFormat(drawing);

    expect(result.files).toEqual({});
  });

  it("should use default for null gridSize", () => {
    const drawing = createMockDrawing({
      appState: JSON.stringify({
        gridSize: null,
      }),
    });
    const result = transformToExcalidrawFormat(drawing);

    expect(result.appState.gridSize).toBe(null);
  });

  it("should use default for undefined gridSize", () => {
    const drawing = createMockDrawing({
      appState: JSON.stringify({}),
    });
    const result = transformToExcalidrawFormat(drawing);

    expect(result.appState.gridSize).toBe(null);
  });
});
