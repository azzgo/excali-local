import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import SlideNavigation from "@/features/editor/components/slide-navigation";
import { ProviderWrapper, globalJotaiStore } from "../hooks/provider.helper";
import {
  presentationModeAtom,
  showSlideQuickNavAtom,
  slideGlobalIndexAtom,
  slidesAtom,
} from "@/features/editor/store/presentation";
import type { ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";

// Mirror the current useSlide return shape (no isFirstSlide/isLastSlide — those are read via atoms)
type UseSlideReturn = {
  presentationMode: boolean;
  slides: Array<{ id: string; element: ExcalidrawFrameElement; name: string }>;
  slideNext: ReturnType<typeof vi.fn>;
  slidePrev: ReturnType<typeof vi.fn>;
  scrollToSlide: ReturnType<typeof vi.fn>;
  handleTogglePresentation: ReturnType<typeof vi.fn>;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({ children }: { children?: React.ReactNode }) => children,
  Footer: ({ children }: { children?: React.ReactNode }) => children,
}));

// Shared mutable state — updated per-test so the hoisted factory returns the right values
const sharedSlideResult: UseSlideReturn = {
  presentationMode: false,
  slides: [],
  slideNext: vi.fn(),
  slidePrev: vi.fn(),
  scrollToSlide: vi.fn(),
  handleTogglePresentation: vi.fn(),
};

const useSlideMock = vi.hoisted(() => {
  return (_api: unknown) => sharedSlideResult;
});

vi.mock("@/features/editor/hooks/use-slide", () => ({
  useSlide: useSlideMock,
}));

const FAKE_ELEMENT = {} as ExcalidrawFrameElement;

interface RenderOptions {
  hideNav?: boolean;
  hideWhenEmpty?: boolean;
  presentationMode?: boolean;
  slides?: Array<{ id: string; element: ExcalidrawFrameElement; name: string }>;
}

const renderSlideNavigation = (opts: RenderOptions = {}) => {
  const { hideNav = false, hideWhenEmpty = false, presentationMode = false, slides = [] } = opts;
  globalJotaiStore.set(presentationModeAtom, presentationMode);
  globalJotaiStore.set(slidesAtom, slides);
  // isFirstSlideAtom and isLastSlideAtom are derived — drive them via slideGlobalIndexAtom
  globalJotaiStore.set(slideGlobalIndexAtom, 0);
  globalJotaiStore.set(showSlideQuickNavAtom, false);

  // Reset spies and update shared mock so useSlide() returns the right values for this test
  sharedSlideResult.presentationMode = presentationMode;
  sharedSlideResult.slides = slides;
  sharedSlideResult.slideNext = vi.fn();
  sharedSlideResult.slidePrev = vi.fn();
  sharedSlideResult.scrollToSlide = vi.fn();
  sharedSlideResult.handleTogglePresentation = vi.fn();

  return render(
    <ProviderWrapper>
      <SlideNavigation
        excalidrawAPI={{} as never}
        hideNav={hideNav}
        hideWhenEmpty={hideWhenEmpty}
      />
    </ProviderWrapper>
  );
};

afterEach(cleanup);

describe("SlideNavigation defaults — legacy behavior unchanged", () => {
  test("in presentationMode: prev/next nav block renders (Edit Slides button absent)", () => {
    renderSlideNavigation({
      presentationMode: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    // prev/next are icon-only buttons (no visible text) wrapped in TooltipTrigger.
    // Count buttons: 2 prev/next when presenting, Edit Slides absent.
    const allBtns = screen.queryAllByRole("button");
    expect(allBtns.length).toBe(2);
    expect(screen.queryByRole("button", { name: /Edit Slides/i })).toBeNull();
  });

  test("not presenting: Edit Slides button renders and is disabled at 0 slides", () => {
    renderSlideNavigation({ presentationMode: false, slides: [] });
    const btn = screen.getByRole("button", { name: /Edit Slides/i });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  test("not presenting: Edit Slides button renders and is enabled at >0 slides", () => {
    renderSlideNavigation({
      presentationMode: false,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    const btn = screen.getByRole("button", { name: /Edit Slides/i });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  test("Escape key in presentationMode calls handleTogglePresentation", () => {
    renderSlideNavigation({
      presentationMode: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sharedSlideResult.handleTogglePresentation).toHaveBeenCalled();
  });

  test("ArrowRight key in presentationMode calls slideNext", () => {
    renderSlideNavigation({
      presentationMode: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(sharedSlideResult.slideNext).toHaveBeenCalled();
  });

  test("ArrowLeft key in presentationMode calls slidePrev", () => {
    renderSlideNavigation({
      presentationMode: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(sharedSlideResult.slidePrev).toHaveBeenCalled();
  });

  test("keys do nothing when not in presentationMode", () => {
    renderSlideNavigation({ presentationMode: false });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(sharedSlideResult.handleTogglePresentation).not.toHaveBeenCalled();
    expect(sharedSlideResult.slideNext).not.toHaveBeenCalled();
    expect(sharedSlideResult.slidePrev).not.toHaveBeenCalled();
  });
});

describe("hideNav prop", () => {
  test("nav block is absent in presentationMode when hideNav is true", () => {
    renderSlideNavigation({
      presentationMode: true,
      hideNav: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    const prevBtn = screen.queryByRole("button", { name: /Slide Previous/i });
    const nextBtn = screen.queryByRole("button", { name: /Slide Next/i });
    expect(prevBtn).toBeNull();
    expect(nextBtn).toBeNull();
  });

  test("Escape key does nothing when hideNav is true even in presentationMode", () => {
    renderSlideNavigation({
      presentationMode: true,
      hideNav: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sharedSlideResult.handleTogglePresentation).not.toHaveBeenCalled();
  });

  test("ArrowRight does nothing when hideNav is true even in presentationMode", () => {
    renderSlideNavigation({
      presentationMode: true,
      hideNav: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(sharedSlideResult.slideNext).not.toHaveBeenCalled();
  });

  test("ArrowLeft does nothing when hideNav is true even in presentationMode", () => {
    renderSlideNavigation({
      presentationMode: true,
      hideNav: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(sharedSlideResult.slidePrev).not.toHaveBeenCalled();
  });
});

describe("hideWhenEmpty prop", () => {
  test("Edit Slides button is absent at 0 slides when hideWhenEmpty is true", () => {
    renderSlideNavigation({ presentationMode: false, hideWhenEmpty: true, slides: [] });
    expect(screen.queryByRole("button", { name: /Edit Slides/i })).toBeNull();
  });

  test("Edit Slides button renders (enabled) at >0 slides when hideWhenEmpty is true", () => {
    renderSlideNavigation({
      presentationMode: false,
      hideWhenEmpty: true,
      slides: [{ id: "s1", element: FAKE_ELEMENT, name: "S1" }],
    });
    const btn = screen.getByRole("button", { name: /Edit Slides/i });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  test("hideWhenEmpty=false (default): button renders (disabled) even at 0 slides — legacy behavior", () => {
    renderSlideNavigation({ presentationMode: false, hideWhenEmpty: false, slides: [] });
    const btn = screen.getByRole("button", { name: /Edit Slides/i });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
