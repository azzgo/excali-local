import { Mock, beforeEach, describe, expect, test, vi } from "vitest";
import {
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slidesAtom,
} from "@/features/editor/store/presentation";
import { orderAttributeLabel } from "@/features/editor/type";
import { KeyForElements } from "@/features/editor/utils/local";
import { updateFrameElements } from "@/features/editor/utils/excalidraw-api.helper";
import { globalJotaiStore } from "../hooks/provider.helper";

interface FakeExcalidrawAPI {
  updateScene: Mock;
  getSceneElements: Mock;
}

describe("excalidrawAPI helper test", () => {
  let excalidrawAPI: FakeExcalidrawAPI;
  beforeEach(() => {
    excalidrawAPI = {
      updateScene: vi.fn(),
      getSceneElements: vi.fn(),
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
        localStorage.getItem(KeyForElements) as string
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
});
