import { beforeEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { ProviderWrapper, globalJotaiStore } from "./provider.helper";
import { slideIdOrderListAtom } from "@/features/editor/store/presentation";
import { renderHook, waitFor } from "@testing-library/react";
import { useLoadInitData } from "@/features/editor/hooks/use-load-initdata";

vi.mock("@excalidraw/excalidraw", () => {
  return {
    restoreAppState: vi.fn().mockReturnValue({}),
  };
});

vi.mock("@/features/editor/utils/indexdb.ts", () => {
  return {
    getFiles: vi.fn().mockResolvedValue([]),
    backupFiles: vi.fn(),
  };
});

describe("use-load-initdata", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestIdleCallback"] });
  });
  test("useLoadInitData load empty data when first load", async () => {
    const { result } = renderHook(() => useLoadInitData(), {
      wrapper: ProviderWrapper,
    });
    vi.runAllTimers();
    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
      // @ts-expect-error no need very specific type to match
      expectTypeOf(result.current.data).toMatchTypeOf<{
        elements: any[];
        appState: {};
        files: {};
        libraryItems: Promise<any[]>;
      }>();
      expect(globalJotaiStore.get(slideIdOrderListAtom)).toEqual([]);
    });
  });

  test.todo('other scenarios');
});
