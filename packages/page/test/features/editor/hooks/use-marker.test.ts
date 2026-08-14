import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderWrapper, globalJotaiStore } from "./provider.helper";
import { renderHook } from "@testing-library/react";
import {
  isMarkingModeAtom,
  markerUnsubscriber,
} from "@/features/editor/store/marker";
import { useMarker } from "@/features/editor/hooks/use-marker";

vi.mock("@excalidraw/excalidraw");

describe("useMarker", () => {
  beforeEach(() => {
    globalJotaiStore.set(isMarkingModeAtom, false);
  });

  test("should return marker state and a method to toggle marker mode", async () => {
    const excalidrawAPI = {
      setActiveTool: vi.fn(),
      onChange: vi.fn(),
      onPointerUp: vi.fn(),
    };

    const { result } = renderHook(() => useMarker(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });

    expect(result.current.isMarkerMode).toBe(false);
    expect(result.current.toggleMarkerMode).toBeInstanceOf(Function);
  });

  test("should enter marker mode", async () => {
    let markerListener: any;
    const excalidrawAPI = {
      setActiveTool: vi.fn(),
      getAppState: vi.fn().mockReturnValue({ zoom: { value: 1 } }),
      getSceneElements: vi.fn().mockReturnValue([]),
      updateScene: vi.fn(),
      onChange: vi.fn(),
      onPointerUp: vi.fn().mockImplementation((fn) => {
        markerListener = fn;
        return vi.fn();
      }),
    };

    const { result } = renderHook(() => useMarker(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });

    result.current.toggleMarkerMode(true);

    await vi.waitFor(() => {
      expect(result.current.isMarkerMode).toBe(true);
      expect(excalidrawAPI.setActiveTool).toHaveBeenCalledWith({
        type: "custom",
        customType: "marker",
        locked: true,
      });
      expect(excalidrawAPI.onPointerUp).toHaveBeenCalled();
      expect(markerUnsubscriber.current).toBeInstanceOf(Function);
    });

    markerListener({ type: "custom", customType: "marker" }, null, {});
    await vi.waitFor(() => {
      expect(excalidrawAPI.getAppState).toHaveBeenCalled();
      expect(excalidrawAPI.getSceneElements).toHaveBeenCalled();
      expect(excalidrawAPI.updateScene).toHaveBeenCalled;
    });
  });

  test("should exit marker mode", async () => {
    const excalidrawAPI = {
      setActiveTool: vi.fn(),
      onChange: vi.fn(),
    };

    const { result } = renderHook(() => useMarker(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });

    result.current.toggleMarkerMode(false);

    await vi.waitFor(() => {
      expect(result.current.isMarkerMode).toBe(false);
      expect(excalidrawAPI.setActiveTool).toHaveBeenCalledWith({
        type: "selection",
      });
      expect(markerUnsubscriber.current).toBeInstanceOf(Function);
    });
  });
});
