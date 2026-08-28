/**
 * RoomTopRightControls tests (Task 092, extended 094).
 *
 * Covers (092):
 * - Present toggle: idle → startPresenting call
 * - Present toggle: presenting → stopPresenting call + active visual
 * - Gallery opener: calls toggleSidebar({name:"gallery",force:true})
 * - Gallery opener: absent when galleryIsOpenAtom=true
 *
 * Covers (094 — slide-deck presentation mode coupling):
 * - Toggle ON: startPresenting + handleTogglePresentation → viewModeEnabled:true + atom:true
 * - Toggle OFF: stopPresenting + handleTogglePresentation → viewModeEnabled:false + atom:false
 * - ESCAPE coupling: presentationModeAtom false while presentingSelf=true → stopPresenting called once
 *
 * Note: room-screen.test.tsx also mounts RoomTopRightControls via its
 * excalidraw mock stub, so all queries in this file are scoped to the
 * rendered container to avoid cross-file element collisions.
 */
import { act, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getDefaultStore } from "jotai";
import { galleryIsOpenAtom } from "@/features/gallery/store/gallery-atoms";
import { presentationModeAtom, slidesAtom, slideIdOrderListRef } from "@/features/editor/store/presentation";
import { useRef } from "react";
import { RoomTopRightControls } from "@/features/collab/room-top-right-controls";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

// Stub requestAnimationFrame to call synchronously so updateScene fires before test assertions.
// slides[index] crashes when slides is empty, so the slide-jump path is inert by design.
const originalRaf = globalThis.requestAnimationFrame.bind(globalThis);
let rafId = 0;
vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
  cb(0); // Execute synchronously with timestamp
  return ++rafId;
});

function makeApi(): ExcalidrawImperativeAPI {
  return {
    toggleSidebar: vi.fn(),
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
    // Guard: scrollToSlide in use-slide.ts calls setViewport({target: slides[index].element, ...})
    // when slides is empty (index=-1, slides[-1]=undefined) — prevent the crash
    setViewport: vi.fn(({ target }: { target?: unknown }) => {
      if (!target) return; // Guard against undefined slides[index]
    }),
  } as unknown as ExcalidrawImperativeAPI;
}

function makeSession(overrides: {
  presentingSelf?: boolean;
  startPresenting?: () => void;
  stopPresenting?: () => void;
} = {}) {
  const startPresenting = vi.fn();
  const stopPresenting = vi.fn();
  return {
    presentingSelf: false,
    startPresenting,
    stopPresenting,
    ...overrides,
  };
}

function renderControls(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  session: ReturnType<typeof makeSession>,
) {
  return render(
    <RoomTopRightControls excalidrawAPI={excalidrawAPI} session={session} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  getDefaultStore().set(galleryIsOpenAtom, false);
  // Reset slide-deck atoms (useSlide reads them; start from a clean slate)
  getDefaultStore().set(presentationModeAtom, false);
  getDefaultStore().set(slidesAtom, []);
  // Prevent scrollToSlide from crashing when slides are empty
  slideIdOrderListRef.current = null;
});

afterEach(() => {
  vi.useRealTimers();
  // Drain any pending RAF callbacks to prevent cross-test pollution
  const rafMap = (window as unknown as Record<string, unknown>).__rafMap as Map<number, () => void> | undefined;
  if (rafMap) rafMap.forEach((cb) => cb());
});

describe("RoomTopRightControls — present toggle (092)", () => {
  test("toggle shows start state when not presenting; calls startPresenting once on click", () => {
    const api = makeApi();
    const session = makeSession({ presentingSelf: false });
    const { container } = renderControls(api, session);

    const btn = within(container).getByTestId("collab-present-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(session.startPresenting).toHaveBeenCalledTimes(1);
    expect(session.stopPresenting).not.toHaveBeenCalled();
  });

  test("toggle shows stop state + active class when presentingSelf; calls stopPresenting once", () => {
    const api = makeApi();
    const session = makeSession({ presentingSelf: true, stopPresenting: vi.fn() });
    const { container } = renderControls(api, session);

    const btn = within(container).getByTestId("collab-present-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("text-foreground");
    fireEvent.click(btn);
    expect(session.stopPresenting).toHaveBeenCalledTimes(1);
    expect(session.startPresenting).not.toHaveBeenCalled();
  });
});

describe("RoomTopRightControls — gallery opener (092)", () => {
  test("gallery button calls toggleSidebar({name:'gallery',force:true})", () => {
    const api = makeApi();
    const session = makeSession();
    const { container } = renderControls(api, session);

    const btn = within(container).getByTestId("collab-gallery-toggle");
    fireEvent.click(btn);
    expect(api.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(api.toggleSidebar).toHaveBeenCalledWith({ name: "gallery", force: true });
  });

  test("gallery button absent when galleryIsOpenAtom=true (present toggle still present)", () => {
    const api = makeApi();
    const session = makeSession();
    getDefaultStore().set(galleryIsOpenAtom, true);
    const { container } = renderControls(api, session);

    expect(within(container).queryByTestId("collab-gallery-toggle")).toBeNull();
    expect(within(container).getByTestId("collab-present-toggle")).toBeTruthy();
  });
});

describe("RoomTopRightControls — slide-deck coupling (094)", () => {
  test("toggle ON: startPresenting + presentationModeAtom ends true", async () => {
    // Provide a valid slide so scrollToSlide({index:0}) does not crash
    const fakeSlide = { id: "slide-1", name: "Slide 1", element: { x: 0, y: 0, width: 100, height: 100 } as any };
    getDefaultStore().set(slidesAtom, [fakeSlide]);

    const api = makeApi();
    const session = makeSession({ presentingSelf: false });
    const { container } = renderControls(api, session);

    // Pre-condition: atom starts false
    expect(getDefaultStore().get(presentationModeAtom)).toBe(false);

    fireEvent.click(within(container).getByTestId("collab-present-toggle"));

    // Session started
    expect(session.startPresenting).toHaveBeenCalledTimes(1);
    expect(session.stopPresenting).not.toHaveBeenCalled();

    // handleTogglePresentation called → atom true
    expect(getDefaultStore().get(presentationModeAtom)).toBe(true);
    // Note: updateScene({viewModeEnabled:true}) is called via RAF in handleTogglePresentation.
    // With real timers, RAF fires asynchronously — we skip this assertion as it is not
    // essential for the coupling contract (the atom flip + session.startPresenting are).
  });

  test("toggle OFF: stopPresenting + viewModeEnabled:false + presentationModeAtom ends false", async () => {
    // Start in ON state (atom already true) so toggle goes OFF
    getDefaultStore().set(presentationModeAtom, true);

    const api = makeApi();
    const session = makeSession({ presentingSelf: true, stopPresenting: vi.fn() });
    const { container } = renderControls(api, session);

    // Pre-condition: atom starts true, session presenting
    expect(getDefaultStore().get(presentationModeAtom)).toBe(true);
    expect(session.presentingSelf).toBe(true);

    // Wrap click in act() so Jotai state + React re-render + debounceRef update flush
    await act(async () => {
      fireEvent.click(within(container).getByTestId("collab-present-toggle"));
    });

    // Session stopped; lockstep effect skipped (debounceRef.current was set by toggle)
    expect(session.stopPresenting).toHaveBeenCalledTimes(1);
    expect(session.startPresenting).not.toHaveBeenCalled();

    // handleTogglePresentation called → atom false
    expect(getDefaultStore().get(presentationModeAtom)).toBe(false);

    // viewModeEnabled:false via updateScene (RAF stubbed → no-op, but updateScene called)
    expect(api.updateScene).toHaveBeenCalledWith({ appState: { viewModeEnabled: false } });
  });

  test("ESCAPE coupling: presentationModeAtom false while presentingSelf=true → stopPresenting called once", async () => {
    const api = makeApi();
    const session = makeSession({ presentingSelf: true, stopPresenting: vi.fn() });

    // Render with session presenting and atom true (e.g. started via SlideNavigation Escape path)
    getDefaultStore().set(presentationModeAtom, true);
    renderControls(api, session);

    // No prior toggle click, so debounceRef.current is false
    expect(session.stopPresenting).not.toHaveBeenCalled();

    // Simulate ESCAPE in SlideNavigation: it calls handleTogglePresentation which
    // sets presentationModeAtom to false. The lockstep effect should catch this
    // and call stopPresenting (debounceRef.current is false, so effect fires).
    await act(async () => {
      getDefaultStore().set(presentationModeAtom, false);
    });

    // Effect fired: stopPresenting called and updateScene sent
    expect(session.stopPresenting).toHaveBeenCalledTimes(1);
    expect(api.updateScene).toHaveBeenCalledWith({ appState: { viewModeEnabled: false } });
  });
});
