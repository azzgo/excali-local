import { useSlide } from "@/features/editor/hooks/use-slide";
import { Mock, beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderWrapper, globalJotaiStore } from "./provider.helper";
import { renderHook, waitFor } from "@testing-library/react";
import {
  isFirstSlideAtom,
  isLastSlideAtom,
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slideIdOrderListRef,
  slidesAtom,
} from "@/features/editor/store/presentation";
import { orderAttributeLabel } from "@/features/editor/type";
import { KeyForElements } from "@/features/editor/utils/local";

interface FakeExcalidrawAPI {
  scrollToContent: Mock;
  updateScene: Mock;
  getSceneElements: Mock;
}

describe("useSlide", () => {
  let excalidrawAPI: FakeExcalidrawAPI;
  beforeEach(() => {
    excalidrawAPI = {
      scrollToContent: vi.fn(),
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

  test("should change presentationMode", async () => {
    const { result } = renderHook(() => useSlide(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });
    expect(result.current.presentationMode).toBe(false);
    result.current.handleTogglePresentation();
    await waitFor(() => {
      expect(result.current.presentationMode).toBe(true);
    });
  });

  test("should change slideGlobalIndex", async () => {
    globalJotaiStore.set(slidesAtom, [
      { id: "slide-1", element: {} as any, name: "slide-1" },
      { id: "slide-2", element: {} as any, name: "slide-2" },
    ]);
    const { result } = renderHook(() => useSlide(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });
    expect(result.current.slides).toEqual([
      { id: "slide-1", element: {}, name: "slide-1" },
      { id: "slide-2", element: {}, name: "slide-2" },
    ]);
    expect(globalJotaiStore.get(slideGlobalIndexAtom)).toBe(0);
    result.current.slideNext();
    await vi.waitFor(() => {
      expect(globalJotaiStore.get(slideGlobalIndexAtom)).toBe(1);
    });
    result.current.slidePrev();
    await vi.waitFor(() => {
      expect(globalJotaiStore.get(slideGlobalIndexAtom)).toBe(0);
      expect(globalJotaiStore.get(isFirstSlideAtom)).toBe(true);
    });
    result.current.scrollToSlide({ id: "slide-2" });
    await vi.waitFor(() => {
      expect(globalJotaiStore.get(slideGlobalIndexAtom)).toBe(1);
      expect(globalJotaiStore.get(isLastSlideAtom)).toBe(true);
    });
  });
});
