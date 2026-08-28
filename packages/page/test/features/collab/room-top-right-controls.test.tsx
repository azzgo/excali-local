/**
 * RoomTopRightControls tests (Task 092).
 *
 * Covers:
 * - Present toggle: idle → startPresenting call
 * - Present toggle: presenting → stopPresenting call + active visual
 * - Gallery opener: calls toggleSidebar({name:"gallery",force:true})
 * - Gallery opener: absent when galleryIsOpenAtom=true
 *
 * Note: room-screen.test.tsx also mounts RoomTopRightControls via its
 * excalidraw mock stub, so all queries in this file are scoped to the
 * rendered container to avoid cross-file element collisions.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getDefaultStore } from "jotai";
import { galleryIsOpenAtom } from "@/features/gallery/store/gallery-atoms";
import { RoomTopRightControls } from "@/features/collab/room-top-right-controls";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

function makeApi(): ExcalidrawImperativeAPI {
  return {
    toggleSidebar: vi.fn(),
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    getFiles: vi.fn(() => ({})),
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
  vi.useRealTimers();
  getDefaultStore().set(galleryIsOpenAtom, false);
});

afterEach(() => {
  vi.useRealTimers();
});

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
    getDefaultStore().set(galleryIsOpenAtom, true);
    const { container } = renderControls(api, session);

    expect(within(container).queryByTestId("collab-gallery-toggle")).toBeNull();
    expect(within(container).getByTestId("collab-present-toggle")).toBeTruthy();
  });
});
