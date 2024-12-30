import { useSlide } from "@/features/editor/hooks/use-slide";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderWrapper, globalJotaiStore } from "./provider.helper";
import { renderHook, waitFor } from "@testing-library/react";
import {
  isFirstSlideAtom,
  isLastSlideAtom,
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slidesAtom,
} from "@/features/editor/store/presentation";

describe("useSlide", () => {
  let excalidrawAPI: any;
  beforeEach(() => {
    excalidrawAPI = {
      scrollToContent: vi.fn(),
      updateScene: vi.fn(),
    };
    globalJotaiStore.set(slidesAtom, [{
      id: "slide-1",
      element: [],
      name: "slide-1",
    }]);
    globalJotaiStore.set(presentationModeAtom, false);
    globalJotaiStore.set(showSlideQuickNavAtom, false);
    globalJotaiStore.set(slideGlobalIndexAtom, 0);
  });

  test("should change presentationMode", async () => {
    const { result } = renderHook(() => useSlide(excalidrawAPI), {
      wrapper: ProviderWrapper,
    });
    expect(result.current.presentationMode).toBe(false);
    result.current.handleTogglePresentation();
    await waitFor(() => {
      expect(result.current.presentationMode).toBe(true);
    });
  });

  test('should change slideGlobalIndex', async () => {
    globalJotaiStore.set(slidesAtom, [
      { id: "slide-1", element: [], name: "slide-1" },
      { id: "slide-2", element: [], name: "slide-2" },
    ]);
    const { result } = renderHook(() => useSlide(excalidrawAPI), {
      wrapper: ProviderWrapper,
    });
    expect(result.current.slides).toEqual([
      { id: "slide-1", element: [], name: "slide-1" },
      { id: "slide-2", element: [], name: "slide-2" },
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
