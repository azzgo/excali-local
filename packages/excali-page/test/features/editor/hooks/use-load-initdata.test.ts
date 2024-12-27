import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderWrapper, globalJotaiStore } from "./provider.helper";
import { slideIdOrderListAtom } from "@/features/editor/store/presentation";
import { renderHook, waitFor } from "@testing-library/react";
import { useLoadInitData } from "@/features/editor/hooks/use-load-initdata";
import {
  KeyForAppState,
  KeyForElements,
  KeyForLibraryItems,
  KeyForSlideIdList,
} from "@/features/editor/utils/local";

vi.mock("@excalidraw/excalidraw");
vi.mock("@/features/editor/utils/indexdb.ts");

import { getFiles } from "@/features/editor/utils/indexdb";
import { restoreAppState } from "@excalidraw/excalidraw";
import {clone} from "radash";

describe("use-load-initdata", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestIdleCallback"] });
    // @ts-expect-error it mocked
    getFiles.mockResolvedValue([]);
    // @ts-expect-error it mocked
    restoreAppState.mockReturnValue({});
  });
  test("useLoadInitData load empty data when first load", async () => {
    const { result } = renderHook(() => useLoadInitData(), {
      wrapper: ProviderWrapper,
    });
    vi.runAllTimers();
    await waitFor(async () => {
      expect(result.current.isLoaded).toBe(true);
      expect(result.current.data?.elements).toEqual([]);
      expect(result.current.data?.appState).toEqual({});
      expect(result.current.data?.files).toEqual({});
      await expect(result.current.data?.libraryItems).resolves.toEqual([]);
      expect(globalJotaiStore.get(slideIdOrderListAtom)).toEqual([]);
    });
  });

  test("useLoadInitData load data from local storage", async () => {
    // prepare local storage data
    const elements = [{ type: "rectangle" }];
    localStorage.setItem(KeyForElements, JSON.stringify(elements));
    const appState = { viewBackgroundColor: "#fff" };
    localStorage.setItem(KeyForAppState, JSON.stringify(appState));
    const slideIdList = ["slide-1"];
    localStorage.setItem(KeyForSlideIdList, JSON.stringify(slideIdList));
    const libraryItems = [{ type: "circle" }];
    localStorage.setItem(KeyForLibraryItems, JSON.stringify(libraryItems));
    // @ts-expect-error it mocked
    getFiles.mockResolvedValue([{ id: "file-1", content: "file-content" }]);
    // @ts-expect-error it mocked
    restoreAppState.mockReturnValue(appState);

    // render hook
    const { result } = renderHook(() => useLoadInitData(), {
      wrapper: ProviderWrapper,
    });
    // assert data
    vi.runAllTimers();
    await waitFor(async () => {
      expect(result.current.isLoaded).toBe(true);
      expect(result.current.data?.elements).toEqual(elements);
      expect(result.current.data?.files).toEqual({ "file-1": "file-content" });
      expect(result.current.data?.appState).toEqual(appState);
      await expect(result.current.data?.libraryItems).resolves.toEqual(
        libraryItems
      );
      expect(globalJotaiStore.get(slideIdOrderListAtom)).toEqual(slideIdList);
    });
  });

  test('useLoadInitData only load once', async () => {
    const { result, rerender } = renderHook(() => useLoadInitData(), {
      wrapper: ProviderWrapper,
    });
    vi.runAllTimers();
    let initData: any;
    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
      initData = clone(result.current.data);
    });
    // @ts-expect-error it mocked
    getFiles.mockResolvedValue([{ id: "file-1", content: "file-content" }]);
    // @ts-expect-error it mocked
    restoreAppState.mockReturnValue({});
    rerender();

    vi.runAllTimers();
    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
      expect(result.current.data).toEqual(initData);
    });
  });
});
