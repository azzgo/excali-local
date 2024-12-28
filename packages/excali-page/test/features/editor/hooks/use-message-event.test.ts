import { useMessageEvent } from "@/features/editor/hooks/use-message-event";
import { getBrowser } from "@/features/editor/lib/browser";
import { getSizeOfDataImage } from "@/features/editor/utils/images";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@excalidraw/excalidraw");
vi.mock("@/features/editor/utils/images");
vi.mock("@/features/editor/lib/browser", () => {
  let runtime = {
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    sendMessage: vi.fn(),
  };
  return {
    getBrowser: () => ({
      runtime,
    }),
  };
});

describe("useMessageEvent", () => {
  let listener: (() => void) | undefined;
  beforeEach(() => {
    listener = undefined;
    // @ts-expect-error mocked
    getBrowser().runtime.onMessage.addListener.mockImplementation((fn) => {
      listener = fn;
    });
  });

  test("should not bind listern when excalidrawAPI not exist", async () => {
    renderHook(() => useMessageEvent({ excalidrawAPI: null }));
    await waitFor(() => {
      expect(listener).toBeUndefined();
    });
  });

  test("should bind listener when excalidrawAPI exist", async () => {
    const { unmount } = renderHook(() =>
      useMessageEvent({ excalidrawAPI: {} as any })
    );
    await waitFor(() => {
      // @ts-expect-error mocked
      expect(getBrowser().runtime.onMessage.addListener).toHaveBeenCalled();
      expect(listener).toBeDefined();
      // @ts-expect-error mocked
      expect(getBrowser().runtime.sendMessage).toHaveBeenCalledWith({
        type: "READY",
      });
    });
    unmount();
    await waitFor(() => {
      // @ts-expect-error mocked
      expect(getBrowser().runtime.onMessage.removeListener).toHaveBeenCalled();
    });
  });

  test("should update canvas with screenshot", async () => {
    // @ts-expect-error mocked
    getSizeOfDataImage.mockResolvedValue({
      imageUrl: "data:image/png;base64,",
      width: 100,
      height: 100,
      mimeType: "image/png",
    });
    const excalidrawAPI = {
      updateScene: vi.fn(),
      scrollToContent: vi.fn(),
      addFiles: vi.fn(),
    } as any;
    renderHook(() => useMessageEvent({ excalidrawAPI }));
    // @ts-expect-error mocked
    listener({
      type: "UPDATE_CANVAS_WITH_SCREENSHOT",
      dataUrl: "data:image/png;base64,",
      area: { x: 0, y: 0, width: 100, height: 100 },
    });
    await waitFor(() => {
      expect(excalidrawAPI.updateScene).toHaveBeenCalledWith({
        elements: [
          {
            type: "image",
            id: expect.any(String),
            fileId: expect.any(String),
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          },
        ],
      });
      expect(excalidrawAPI.scrollToContent).toHaveBeenCalled();
    });
  });
});
