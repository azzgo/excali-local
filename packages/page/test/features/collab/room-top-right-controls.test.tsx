/**
 * RoomTopRightControls tests (Task 092, extended Task 100).
 *
 * Covers:
 * - Present toggle: idle → startPresenting call
 * - Present toggle: presenting → stopPresenting call + active visual
 * - Gallery opener: calls toggleSidebar({name:"gallery",force:true})
 * - Gallery opener: absent when galleryIsOpenAtom=true
 * - Present ON with frames: startPresenting + atom true + no viewModeEnabled call
 * - Present ON without frames: startPresenting only, atom stays false
 * - Present OFF: stopPresenting + slide mode exit
 * - Escape lockstep: presentationMode=false while presentingSelf → stopPresenting once
 * - Row order: [Gallery][Present]
 *
 * Note: room-screen.test.tsx also mounts RoomTopRightControls via its
 * excalidraw mock stub, so all queries in this file are scoped to the
 * rendered container to avoid cross-file element collisions.
 */
import { act, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getDefaultStore, Provider } from "jotai";
import { galleryIsOpenAtom } from "@/features/gallery/store/gallery-atoms";
import { presentationModeAtom, slidesAtom } from "@/features/editor/store/presentation";
import { RoomTopRightControls } from "@/features/collab/room-top-right-controls";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const testStore = getDefaultStore();

function makeApi(): ExcalidrawImperativeAPI {
  return {
    toggleSidebar: vi.fn(),
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
    setViewport: vi.fn(),
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
  session: ReturnType<typeof makeSession>
) {
  return render(
    <Provider store={testStore}>
      <RoomTopRightControls excalidrawAPI={excalidrawAPI} session={session} />
    </Provider>
  );
}

// store = testStore — same instance as ProviderWrapper

beforeEach(() => {
  // vi.useRealTimers() removed — vi.waitFor requires fake timers internally.
  testStore.set(galleryIsOpenAtom, false);
  // Reset slide state so each test starts clean (mirrors useRoomSlideStateReset on mount).
  testStore.set(slidesAtom, []);
  testStore.set(presentationModeAtom, false);
});

afterEach(() => {});

describe("RoomTopRightControls — present toggle", () => {
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

describe("RoomTopRightControls — gallery opener", () => {
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
    testStore.set(galleryIsOpenAtom, true);
    const { container } = renderControls(api, session);

    expect(within(container).queryByTestId("collab-gallery-toggle")).toBeNull();
    expect(within(container).getByTestId("collab-present-toggle")).toBeTruthy();
  });
});

describe("RoomTopRightControls — present coupling (Task 100)", () => {
  test("ON with frames → startPresenting + atom true + no viewModeEnabled call", async () => {
    const api = makeApi();
    const session = makeSession({ presentingSelf: false });
    const { container } = renderControls(api, session);
    // Preset AFTER render: useRoomSlideStateReset wipes slide atoms on mount,
    // so pre-render presets never survive. In the real room, slides arrive via
    // useUpdateSlides after mount too.
    act(() => {
      testStore.set(slidesAtom, [
        { id: "slide-1", element: {} as any, name: "slide-1" },
        { id: "slide-2", element: {} as any, name: "slide-2" },
      ]);
    });

    const btn = within(container).getByTestId("collab-present-toggle");
    fireEvent.click(btn);

    // session.startPresenting was called
    expect(session.startPresenting).toHaveBeenCalledTimes(1);

    // atom flipped to true
    await vi.waitFor(() => {
      expect(testStore.get(presentationModeAtom)).toBe(true);
    });

    // viewModeEnabled was NOT written to updateScene (ADR 0008 — room stays editorial)
    const viewModeCalls = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0]?.appState?.viewModeEnabled !== undefined
    );
    expect(viewModeCalls).toHaveLength(0);

    // setViewport was called (slide mode entry)
    await vi.waitFor(() => {
      expect(api.setViewport).toHaveBeenCalled();
    });
  });

  test("ON without frames → startPresenting only, atom stays false", async () => {
    const api = makeApi();
    testStore.set(slidesAtom, []);
    testStore.set(presentationModeAtom, false);
    const session = makeSession({ presentingSelf: false });
    const { container } = renderControls(api, session);

    const btn = within(container).getByTestId("collab-present-toggle");
    fireEvent.click(btn);

    expect(session.startPresenting).toHaveBeenCalledTimes(1);

    // Atom stays false — no slide mode entered without frames
    await vi.waitFor(() => {
      expect(testStore.get(presentationModeAtom)).toBe(false);
    });

    // setViewport not called
    expect(api.setViewport).not.toHaveBeenCalled();
  });

  test("OFF → stopPresenting + slide mode exit", async () => {
    const api = makeApi();
    const session = makeSession({ presentingSelf: true, stopPresenting: vi.fn() });
    const { container } = renderControls(api, session);
    // Preset AFTER render (mount reset wipes pre-render presets).
    act(() => {
      testStore.set(slidesAtom, [
        { id: "slide-1", element: {} as any, name: "slide-1" },
      ]);
      testStore.set(presentationModeAtom, true);
    });

    const btn = within(container).getByTestId("collab-present-toggle");
    fireEvent.click(btn);

    // stopPresenting called exactly once from handlePresentToggle's OFF path.
    // The lockstep effect does NOT refire: the atom flip lands while
    // togglingRef.current is still true (deferred reset), and no further
    // presentationMode transition occurs.
    expect(session.stopPresenting).toHaveBeenCalledTimes(1);

    // Atom flipped back to false (exit slide mode)
    await vi.waitFor(() => {
      expect(testStore.get(presentationModeAtom)).toBe(false);
    });

    // NOTE: no setViewport on exit — legacy toggle only scrolls when ENTERING
    // slide mode; the room path additionally never writes viewModeEnabled.
  });

  test("Escape lockstep: presentationMode=false while presentingSelf → stopPresenting once", async () => {
    // Simulates the Escape / manual exit path:
    // user presses Escape, handleTogglePresentation flips atom to false,
    // but session.presentingSelf is still true → stopPresenting must fire.
    const api = makeApi();
    const stopPresenting = vi.fn();
    const session = makeSession({ presentingSelf: true, stopPresenting });
    renderControls(api, session);
    // Preset AFTER render (mount reset wipes pre-render presets).
    act(() => {
      testStore.set(slidesAtom, []);
    });

    // Simulate slide mode being ON, then externally flipped OFF (Escape):
    // setting true re-renders (effect sees presentationMode=true → no fire);
    // flipping false then trips the lockstep exactly once.
    act(() => {
      testStore.set(presentationModeAtom, true);
    });
    act(() => {
      testStore.set(presentationModeAtom, false);
    });

    // stopPresenting should fire exactly once
    await vi.waitFor(() => {
      expect(stopPresenting).toHaveBeenCalledTimes(1);
    });
  });

  test("row order: Gallery left of Present (task 095)", () => {
    const api = makeApi();
    const session = makeSession();
    const { container } = renderControls(api, session);

    const children = Array.from(container.querySelector("div")?.children ?? []);
    expect(children).toHaveLength(2);
    expect(children[0].getAttribute("data-testid")).toBe("collab-gallery-toggle");
    expect(children[1].getAttribute("data-testid")).toBe("collab-present-toggle");
  });
});
