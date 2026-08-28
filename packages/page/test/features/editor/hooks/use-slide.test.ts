import { createElement } from "react";
import type { ReactNode } from "react";
import { Provider, createStore } from "jotai";
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
  setViewport: Mock;
  updateScene: Mock;
  getSceneElements: Mock;
}

describe("useSlide", () => {
  let excalidrawAPI: FakeExcalidrawAPI;
  beforeEach(() => {
    excalidrawAPI = {
      setViewport: vi.fn(),
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

  test("default (no options) fires updateScene({appState:{viewModeEnabled}})", async () => {
    const { result } = renderHook(() => useSlide(excalidrawAPI as any), {
      wrapper: ProviderWrapper,
    });
    expect(result.current.presentationMode).toBe(false);
    result.current.handleTogglePresentation();
    await waitFor(() => {
      expect(result.current.presentationMode).toBe(true);
    });
    // RAF fires the updateScene call
    await vi.waitFor(() => {
      expect(excalidrawAPI.updateScene).toHaveBeenCalledWith({
        appState: { viewModeEnabled: true },
      });
    });
  });

  test("{viewMode:false} never fires viewModeEnabled, atom + scroll still flow", async () => {
    // @ts-ignore — options param not typed yet
    const { result } = renderHook(() => useSlide(excalidrawAPI as any, { viewMode: false }), {
      wrapper: ProviderWrapper,
    });
    expect(result.current.presentationMode).toBe(false);
    result.current.handleTogglePresentation();
    await waitFor(() => {
      expect(result.current.presentationMode).toBe(true);
    });
    // viewModeEnabled must NOT be called
    const viewModeCalls = excalidrawAPI.updateScene.mock.calls.filter(
      (call) => call[0]?.appState?.viewModeEnabled !== undefined
    );
    expect(viewModeCalls).toHaveLength(0);
    // scroll still flowed via RAF
    await vi.waitFor(() => {
      expect(excalidrawAPI.setViewport).toHaveBeenCalled();
    });
  });

  test("{viewMode:true} is byte-identical to default", async () => {
    const apiB = {
      setViewport: vi.fn(),
      updateScene: vi.fn(),
      getSceneElements: vi.fn(),
    };
    // Isolated store for the second hook instance — two renderHook instances
    // sharing one store would flip the SAME presentationModeAtom twice
    // (true→false), defeating the comparison.
    const storeB = createStore();
    storeB.set(slidesAtom, [
      { id: "slide-1", element: {} as any, name: "slide-1" },
      { id: "slide-2", element: {} as any, name: "slide-2" },
    ]);
    const wrapperB = ({ children }: { children: ReactNode }) =>
      createElement(Provider, { store: storeB }, children);
    // @ts-ignore
    const { result: r1 } = renderHook(() => useSlide(apiB as any, { viewMode: true }), {
      wrapper: ProviderWrapper,
    });
    const { result: r2 } = renderHook(() => useSlide(excalidrawAPI as any), {
      wrapper: wrapperB,
    });
    r1.current.handleTogglePresentation();
    r2.current.handleTogglePresentation();
    await waitFor(() => {
      expect(r1.current.presentationMode).toBe(true);
      expect(r2.current.presentationMode).toBe(true);
    });
    await vi.waitFor(() => {
      expect(apiB.updateScene).toHaveBeenCalledWith({
        appState: { viewModeEnabled: true },
      });
      expect(excalidrawAPI.updateScene).toHaveBeenCalledWith({
        appState: { viewModeEnabled: true },
      });
    });
  });
});
