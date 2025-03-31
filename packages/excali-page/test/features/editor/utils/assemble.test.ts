import { orderAttributeLabel } from "@/features/editor/type";
import { assembleSlides } from "@/features/editor/utils/assemble";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/excalidraw/element/types";
import { BinaryFiles } from "@excalidraw/excalidraw/types/excalidraw/types";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@excalidraw/excalidraw");

describe("assemble", () => {
  let elements: Partial<ExcalidrawElement>[];
  let files: Partial<BinaryFiles>;
  beforeEach(() => {
    elements = [
      {
        type: "frame",
        id: "frame-1",
        isDeleted: false,
      },
      {
        type: "rectangle",
        id: "2",
        frameId: "frame-1",
        x: 10,
        y: 10,
      },
      {
        type: "image",
        id: "3",
        fileId: "file-1" as any,
        frameId: "frame-2",
        x: 10,
        y: 10,
        width: 100,
        height: 100,
      },
      {
        type: "frame",
        id: "frame-2",
        name: "Slide 2",
        isDeleted: false,
      },
    ];
    files = {
      "1": {
        mimeType: "image/png",
        id: "file-1" as any,
        dataURL: "data:image/png;base64," as any,
        created: 0,
        lastRetrieved: 10,
      },
    };
  });
  test("should assemble slide thumbnails", async () => {
    const frames = await assembleSlides(
      elements as ExcalidrawElement[],
      files as any
    );
    expect(frames).toEqual([
      {
        id: "frame-1",
        name: "Frame 1",
        thumbnail: expect.any(String),
        element: elements[0],
      },
      {
        id: "frame-2",
        name: "Slide 2",
        thumbnail: expect.any(String),
        element: elements[3],
      },
    ]);
  });

  test("should assemble slide thumbnails with cache", async () => {
    const frames_1 = await assembleSlides(
      elements as ExcalidrawElement[],
      files as any
    );
    const frames_2 = await assembleSlides(
      elements as ExcalidrawElement[],
      files as any
    );
    expect(frames_2).toEqual(frames_1);
  });

  test("should order slides by custom order attribute", async () => {
    let elementsWithOrderAttribute = [
      {
        type: "frame",
        id: "frame-1",
        customData: {
          [orderAttributeLabel]: 1,
        },
        isDeleted: false,
      },
      {
        type: "frame",
        id: "frame-2",
        customData: {
          [orderAttributeLabel]: 0,
        },
        isDeleted: false,
      },
    ];
    const frames = await assembleSlides(
      elementsWithOrderAttribute as ExcalidrawElement[],
      files as any
    );
    expect(frames.map((f) => f.id)).toEqual(["frame-2", "frame-1"]);
  });
});
