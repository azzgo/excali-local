import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderWrapper, globalJotaiStore } from "./provider.helper";
import {
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slideIdOrderListAtom,
  slidesAtom,
} from "@/features/editor/store/presentation";
import { useUpdateSlides } from "@/features/editor/hooks/use-update-slides";
import { renderHook } from "@testing-library/react";
import { assembleSlides } from "@/features/editor/utils/assemble";

vi.mock("@/features/editor/utils/assemble", () => ({
  assembleSlides: vi.fn(),
}));

describe("useUpdateSlides", () => {
  beforeEach(() => {
    globalJotaiStore.set(slidesAtom, []);
    globalJotaiStore.set(presentationModeAtom, false);
    globalJotaiStore.set(showSlideQuickNavAtom, false);
    globalJotaiStore.set(slideGlobalIndexAtom, 0);
    globalJotaiStore.set(slideIdOrderListAtom, []);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "setTimeout"] });
  });

  test("should update slides", async () => {
    // @ts-expect-error mocked
    assembleSlides.mockResolvedValue([
      {
        id: "slide-1",
        element: [],
        name: "slide-1",
      },
    ]);
    const { result } = renderHook(() => useUpdateSlides(), {
      wrapper: ProviderWrapper,
    });
    result.current(
      [
        [
          {
            type: "rectangle",
          },
        ],
      ] as any,
      { "file-id": {} } as any
    );
    vi.runAllTimers();
    expect(assembleSlides).toHaveBeenCalledWith(
      [
        [
          {
            type: "rectangle",
          },
        ],
      ] as any,
      { "file-id": {} } as any
    );

    // can not use test library waitfor now, so use vi.waitFor instead
    await vi.waitFor(() => {
      expect(globalJotaiStore.get(slidesAtom)).toEqual([
        {
          id: "slide-1",
          element: [],
          name: "slide-1",
        },
      ]);
      expect(globalJotaiStore.get(slideIdOrderListAtom)).toEqual(["slide-1"]);
    });
  });
});
