import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CollabEditor from "@/features/collab/collab-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/** Set location.hash and fire hashchange (the mock location is a plain object). */
const setHash = (hash: string) => {
  (window.location as { hash?: string }).hash = hash;
  act(() => {
    window.dispatchEvent(new Event("hashchange"));
  });
};

afterEach(cleanup);

describe("CollabEditor hash routing (053 round 3)", () => {
  beforeEach(() => {
    setHash("");
  });

  test("no hash → landing", () => {
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-landing")).toBeTruthy();
  });

  test("#config → config screen", () => {
    setHash("#config");
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-config")).toBeTruthy();
  });

  test("#create → create shell", () => {
    setHash("#create");
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-create")).toBeTruthy();
  });

  test("#join → join shell", () => {
    setHash("#join");
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-join")).toBeTruthy();
  });

  test("#rooms → rooms shell", () => {
    setHash("#rooms");
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-rooms")).toBeTruthy();
  });

  test("#room/<shareId> renders the room screen with the parsed shareId", () => {
    setHash("#room/c3d9f8");
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-room")).toBeTruthy();
    expect(screen.getByTestId("collab-room-shareid").textContent).toBe("c3d9f8");
  });

  test("unknown hash → landing", () => {
    setHash("#bogus");
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-landing")).toBeTruthy();
  });

  test("hashchange re-renders: landing → rooms → create on the SAME mount", () => {
    setHash("");
    render(<CollabEditor lang="en" />);
    expect(screen.getByTestId("collab-landing")).toBeTruthy();
    setHash("#rooms");
    expect(screen.getByTestId("collab-rooms")).toBeTruthy();
    setHash("#create");
    expect(screen.getByTestId("collab-create")).toBeTruthy();
    // back to landing (unknown hash path)
    setHash("#nope");
    expect(screen.getByTestId("collab-landing")).toBeTruthy();
  });
});
