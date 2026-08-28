import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import SlideNavbar from "@/features/editor/components/slide-navbar";
import { ProviderWrapper, globalJotaiStore } from "../hooks/provider.helper";
import {
  showSlideQuickNavAtom,
  slideIdOrderListRef,
  slidesAtom,
} from "@/features/editor/store/presentation";
import type { ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";

// -----------------------------------------------------------------------
// Mock helpers
// -----------------------------------------------------------------------

const updateFrameElementsMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/editor/utils/excalidraw-api.helper", () => ({
  updateFrameElements: updateFrameElementsMock,
}));

// Mock SlideSortableList to expose its onOrderChange via a spy so we can
// directly invoke the callback path without fighting dnd-kit internals.
let sortableListOnOrderChange: ((ids: string[]) => void) | undefined;

vi.mock("@/features/editor/components/slide-sortable-list", () => ({
  default: ({
    onOrderChange,
    initialSlides,
  }: {
    onOrderChange?: (ids: string[]) => void;
    initialSlides: Array<{ id: string; element: ExcalidrawFrameElement; name: string }>;
  }) => {
    sortableListOnOrderChange = onOrderChange;
    return (
      <div data-testid="slide-sortable-list">
        {initialSlides.map((s) => (
          <div key={s.id} data-slide-id={s.id}>
            {s.name}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [{ t: (key: string) => key }],
}));

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({ children }: { children?: React.ReactNode }) => children,
  Footer: ({ children }: { children?: React.ReactNode }) => children,
}));

const FAKE_ELEMENT = {} as ExcalidrawFrameElement;

const renderSlideNavbar = (
  applyOrder?: (frameIdList: string[]) => void,
  opts: {
    close?: () => void;
    showSlideQuickNav?: boolean;
    slides?: Array<{ id: string; element: ExcalidrawFrameElement; name: string }>;
  } = {}
) => {
  const { close = vi.fn(), showSlideQuickNav = true, slides = [] } = opts;
  globalJotaiStore.set(showSlideQuickNavAtom, showSlideQuickNav);
  globalJotaiStore.set(slidesAtom, slides);

  return render(
    <ProviderWrapper>
      <SlideNavbar
        close={close}
        excalidrawAPI={{} as never}
        applyOrder={applyOrder}
      />
    </ProviderWrapper>
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sortableListOnOrderChange = undefined;
  slideIdOrderListRef.current = null;
});

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("SlideNavbar defaults — legacy behavior unchanged", () => {
  test("renders SlideSortableList when showSlideQuickNav is true", () => {
    renderSlideNavbar(undefined, {
      showSlideQuickNav: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    expect(screen.getByTestId("slide-sortable-list")).toBeTruthy();
  });

  test("renders nothing when showSlideQuickNav is false", () => {
    renderSlideNavbar(undefined, {
      showSlideQuickNav: false,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    expect(screen.queryByTestId("slide-sortable-list")).toBeNull();
  });

  test("close is called when slideLength becomes 0", async () => {
    const close = vi.fn();
    renderSlideNavbar(undefined, {
      close,
      showSlideQuickNav: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    expect(close).not.toHaveBeenCalled();

    // Simulate slide count going to 0 via atom update
    act(() => {
      globalJotaiStore.set(slidesAtom, []);
    });

    await waitFor(() => {
      expect(close).toHaveBeenCalled();
    });
  });

  test("without applyOrder: onOrderChange calls the legacy inline updateFrameElements", async () => {
    renderSlideNavbar(undefined, {
      showSlideQuickNav: true,
      slides: [
        { id: "s1", element: FAKE_ELEMENT, name: "S1" },
        { id: "s2", element: FAKE_ELEMENT, name: "S2" },
      ],
    });

    expect(sortableListOnOrderChange).toBeTruthy();

    // Simulate a reorder: slide order changed to [s2, s1]
    act(() => {
      sortableListOnOrderChange!(["s2", "s1"]);
    });

    await waitFor(() => {
      expect(updateFrameElementsMock).toHaveBeenCalledWith(
        expect.anything(),
        ["s2", "s1"]
      );
    });
  });
});

describe("applyOrder prop", () => {
  test("applyOrder spy receives the ordered id list on reorder when provided", async () => {
    const applyOrder = vi.fn();
    renderSlideNavbar(applyOrder, {
      showSlideQuickNav: true,
      slides: [
        { id: "s1", element: FAKE_ELEMENT, name: "S1" },
        { id: "s2", element: FAKE_ELEMENT, name: "S2" },
      ],
    });

    expect(sortableListOnOrderChange).toBeTruthy();

    act(() => {
      sortableListOnOrderChange!(["s2", "s1"]);
    });

    await waitFor(() => {
      expect(applyOrder).toHaveBeenCalledWith(["s2", "s1"]);
      expect(applyOrder).toHaveBeenCalledTimes(1);
    });
  });

  test("applyOrder is called with ids, legacy updateFrameElements NOT called", async () => {
    const applyOrder = vi.fn();
    renderSlideNavbar(applyOrder, {
      showSlideQuickNav: true,
      slides: [
        { id: "s1", element: FAKE_ELEMENT, name: "S1" },
        { id: "s2", element: FAKE_ELEMENT, name: "S2" },
      ],
    });

    act(() => {
      sortableListOnOrderChange!(["s2", "s1"]);
    });

    await waitFor(() => {
      expect(applyOrder).toHaveBeenCalled();
      expect(updateFrameElementsMock).not.toHaveBeenCalled();
    });
  });

  test("without applyOrder: legacy updateFrameElements is called on reorder", async () => {
    renderSlideNavbar(undefined, {
      showSlideQuickNav: true,
      slides: [
        { id: "s1", element: FAKE_ELEMENT, name: "S1" },
        { id: "s2", element: FAKE_ELEMENT, name: "S2" },
      ],
    });

    act(() => {
      sortableListOnOrderChange!(["s2", "s1"]);
    });

    await waitFor(() => {
      expect(updateFrameElementsMock).toHaveBeenCalledWith(
        expect.anything(),
        ["s2", "s1"]
      );
    });
  });
});
