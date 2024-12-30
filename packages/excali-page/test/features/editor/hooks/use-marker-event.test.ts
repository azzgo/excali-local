import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderWrapper, globalJotaiStore } from "./provider.helper";
import { renderHook } from "@testing-library/react";
import {
  isMarkingModeAtom,
  markerUnsubscriber,
} from "@/features/editor/store/marker";
import { useMarkerEvent } from "@/features/editor/hooks/use-marker-effect";

vi.mock("@excalidraw/excalidraw");

describe("useMarker", () => {
  beforeEach(() => {
    globalJotaiStore.set(isMarkingModeAtom, false);
  });

  test("should response excalidrawAPI onChange", async () => {
    globalJotaiStore.set(isMarkingModeAtom, true);
    let onChangeListener: any;

    const excalidrawAPI = {
      setActiveTool: vi.fn(),
      onChange: vi.fn().mockImplementation((fn) => {
        onChangeListener = fn;
      }),
    };

    const {} = renderHook(() => useMarkerEvent(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });

    onChangeListener(
      {},
      { activeTool: { type: "custom", customType: "marker" } }
    );

    await vi.waitFor(() => {
      expect(globalJotaiStore.get(isMarkingModeAtom)).toBe(true);
    });

    onChangeListener({}, { activeTool: { type: "selection" } });

    await vi.waitFor(() => {
      expect(globalJotaiStore.get(isMarkingModeAtom)).toBe(false);
    });
  });

  test("should exit marker mode when umount", async () => {
    globalJotaiStore.set(isMarkingModeAtom, true);
    const excalidrawAPI = {
      setActiveTool: vi.fn(),
      onChange: vi.fn(),
    };

    markerUnsubscriber.current = vi.fn();

    const { unmount } = renderHook(() => useMarkerEvent(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });

    unmount();

    await vi.waitFor(() => {
      expect(globalJotaiStore.get(isMarkingModeAtom)).toBe(false);
      expect(excalidrawAPI.setActiveTool).toHaveBeenCalledWith({
        type: "selection",
      });
      expect(markerUnsubscriber.current).toHaveBeenCalled();
    });

    markerUnsubscriber.current = null;
  });
});
