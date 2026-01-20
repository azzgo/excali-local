import {
  Mock,
  MockedFunction,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slidesAtom,
} from "@/features/editor/store/presentation";
import { orderAttributeLabel } from "@/features/editor/type";
import { KeyForElements } from "@/features/editor/utils/local";
import {
  updateFrameElements,
  loadDrawingToScene,
} from "@/features/editor/utils/excalidraw-api.helper";
import { globalJotaiStore } from "../hooks/provider.helper";
import { restoreAppState } from "@excalidraw/excalidraw";

vi.mock("@excalidraw/excalidraw");

interface FakeExcalidrawAPI {
  updateScene: Mock;
  getSceneElements: Mock;
  addFiles: Mock;
}

describe("excalidrawAPI helper test", () => {
  let excalidrawAPI: FakeExcalidrawAPI;
  beforeEach(() => {
    excalidrawAPI = {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(),
      addFiles: vi.fn(),
    };
    globalJotaiStore.set(slidesAtom, [
      {
        id: "slide-1",
        element: {} as any,
        name: "slide-1",
      },
      {
        id: "slide-2",
        element: {} as any,
        name: "slide-2",
      },
    ]);
    globalJotaiStore.set(presentationModeAtom, false);
    globalJotaiStore.set(showSlideQuickNavAtom, false);
    globalJotaiStore.set(slideGlobalIndexAtom, 0);
  });

  test("should update scene frames with ordered attributes", async () => {
    excalidrawAPI.getSceneElements.mockReturnValue([
      {
        type: "frame",
        id: "slide-1",
        isDeleted: false,
        element: ["rect-1"],
      },
      {
        type: "rectangle",
        id: "rect-1",
        x: 10,
        y: 10,
      },
      {
        type: "frame",
        id: "slide-2",
        isDeleted: false,
      },
    ]);
    updateFrameElements(excalidrawAPI as any, ["slide-2", "slide-1"]);
    await vi.waitFor(() => {
      expect(excalidrawAPI.updateScene).toHaveBeenCalledWith({
        elements: [
          {
            type: "frame",
            id: "slide-1",
            isDeleted: false,
            customData: {
              [orderAttributeLabel]: 1,
            },
            element: ["rect-1"],
          },
          {
            type: "rectangle",
            id: "rect-1",
            x: 10,
            y: 10,
          },
          {
            type: "frame",
            id: "slide-2",
            customData: {
              [orderAttributeLabel]: 0,
            },
            isDeleted: false,
          },
        ],
      });
      let savedElements = JSON.parse(
        localStorage.getItem(KeyForElements) as string,
      );

      expect(savedElements).toEqual([
        {
          type: "frame",
          id: "slide-1",
          isDeleted: false,
          customData: {
            [orderAttributeLabel]: 1,
          },
          element: ["rect-1"],
        },
        {
          type: "rectangle",
          id: "rect-1",
          x: 10,
          y: 10,
        },
        {
          type: "frame",
          id: "slide-2",
          customData: {
            [orderAttributeLabel]: 0,
          },
          isDeleted: false,
        },
      ]);
    });
  });

  describe("loadDrawingToScene", () => {
    beforeEach(() => {
      (restoreAppState as MockedFunction<any>).mockImplementation(
        (args) => args,
      );
    });
    test("should load drawing to scene with elements, appState and files", () => {
      const mockElements = [
        { id: "el-1", type: "rectangle", x: 0, y: 0 },
        { id: "el-2", type: "ellipse", x: 10, y: 10 },
      ];
      const mockAppState = {
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
        collaborators: [{ id: "user-1", name: "Test User" }],
        viewModeEnabled: true,
      };
      const mockFiles = {
        "file-1": {
          id: "file-1",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,abc123",
        },
      };

      loadDrawingToScene(
        excalidrawAPI as any,
        mockElements,
        mockAppState,
        mockFiles,
      );

      // Verify updateScene was called
      expect(excalidrawAPI.updateScene).toHaveBeenCalledTimes(1);
      expect(excalidrawAPI.updateScene).toHaveBeenCalledWith({
        elements: mockElements,
        appState: expect.objectContaining({
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          isLoading: false,
        }),
      });

      // Verify that collaborators and viewModeEnabled are omitted from appState
      const updateSceneCall = excalidrawAPI.updateScene.mock.calls[0][0];
      expect(updateSceneCall.appState).not.toHaveProperty("collaborators");
      expect(updateSceneCall.appState).not.toHaveProperty("viewModeEnabled");

      // Verify addFiles was called
      expect(excalidrawAPI.addFiles).toHaveBeenCalledTimes(1);
      expect(excalidrawAPI.addFiles).toHaveBeenCalledWith(mockFiles);
    });

    test("should handle empty elements and files", () => {
      const mockElements: any[] = [];
      const mockAppState = {
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
      };
      const mockFiles: any = {};

      loadDrawingToScene(
        excalidrawAPI as any,
        mockElements,
        mockAppState,
        mockFiles,
      );

      expect(excalidrawAPI.updateScene).toHaveBeenCalledWith({
        elements: [],
        appState: expect.objectContaining({
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          isLoading: false,
        }),
      });
      expect(excalidrawAPI.addFiles).toHaveBeenCalledWith({});
    });

    test("should set isLoading to false in appState regardless of input", () => {
      const mockElements = [{ id: "el-1", type: "rectangle" }];
      const mockAppState = {
        zoom: 1,
        isLoading: true, // Even if input has isLoading: true
      };
      const mockFiles = {};

      loadDrawingToScene(
        excalidrawAPI as any,
        mockElements,
        mockAppState,
        mockFiles,
      );

      const updateSceneCall = excalidrawAPI.updateScene.mock.calls[0][0];
      expect(updateSceneCall.appState.isLoading).toBe(false);
    });

    test("should preserve other appState properties", () => {
      const mockElements = [{ id: "el-1", type: "rectangle" }];
      const mockAppState = {
        zoom: 1.5,
        scrollX: 100,
        scrollY: 200,
        gridSize: 20,
        name: "Test Drawing",
        collaborators: [{ id: "user-1" }],
        viewModeEnabled: true,
      };
      const mockFiles = {};

      loadDrawingToScene(
        excalidrawAPI as any,
        mockElements,
        mockAppState,
        mockFiles,
      );

      const updateSceneCall = excalidrawAPI.updateScene.mock.calls[0][0];
      expect(updateSceneCall.appState.zoom).toBe(1.5);
      expect(updateSceneCall.appState.scrollX).toBe(100);
      expect(updateSceneCall.appState.scrollY).toBe(200);
      expect(updateSceneCall.appState.gridSize).toBe(20);
      expect(updateSceneCall.appState.name).toBe("Test Drawing");
    });
  });
});
