/**
 * Conn-health tests (task 046 — Wayfinder 061).
 *
 * Covers:
 * - connDisplayState: connecting+reconnect → reconnecting (061 §1 blue-vs-amber).
 * - ConnDot: 4 states with the right dot classes + words (061 §1 colors);
 *   live = dot-only; degraded = dot + word; tooltip carries the retry detail.
 * - OfflineBanner: edits-kept + frozen-roster count (self excluded, Q3) +
 *   the one-line conflict pre-warning.
 * - ResetNotice: shows ONLY with resets; Show me → transient selection
 *   highlight (CaptureUpdateAction.NEVER, restore after); Got it dismisses
 *   per-recovery; never modal.
 * - ConnHealthBanners: composition — offline banner while reconnecting,
 *   reset notice when resets exist; silent on clean resync.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  ConnDot,
  ConnHealthBanners,
  connDisplayState,
  OfflineBanner,
  ResetNotice,
} from "@/features/collab/conn-health";
import type {
  CollabResetNotice,
  CollabSessionHandle,
  RosterMember,
} from "@/features/collab/use-collab-session";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER" },
  exportToBlob: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

afterEach(cleanup);

const PEERS: RosterMember[] = [
  { profileId: "self", name: "Ada", color: "hsl(0,100%,83%)", connId: "conn-self", self: true },
  { profileId: "p2", name: "Min", color: "hsl(220,100%,83%)", connId: "conn-2", self: false },
  { profileId: "p3", name: "Bob", color: "hsl(40,100%,83%)", connId: "conn-3", self: false },
];

const NOTICE: CollabResetNotice = {
  count: 2,
  ids: ["el-a", "el-b"],
  at: 111,
  editN: 1,
  delN: 1,
};

/* ------------------------------------------------------------------ */
/* connDisplayState (061 §1)                                            */
/* ------------------------------------------------------------------ */

describe("connDisplayState", () => {
  test("connecting + scheduled reconnect reads as reconnecting (blue-vs-amber)", () => {
    expect(connDisplayState("connecting", { attempt: 1, delayMs: 2000 })).toBe("reconnecting");
  });

  test("first connect (no reconnect scheduled) stays connecting", () => {
    expect(connDisplayState("connecting", null)).toBe("connecting");
  });

  test("other states pass through", () => {
    expect(connDisplayState("connected", { attempt: 2, delayMs: 4000 })).toBe("connected");
    expect(connDisplayState("rejected", null)).toBe("rejected");
  });
});

/* ------------------------------------------------------------------ */
/* ConnDot (061 §1)                                                     */
/* ------------------------------------------------------------------ */

describe("ConnDot", () => {
  test("live: green steady, dot only, no word", () => {
    render(<ConnDot conn="connected" reconnect={null} />);
    const dot = screen.getByTestId("collab-conn-dot");
    expect(dot.querySelector("span")?.className).toContain("bg-emerald-500");
    expect(screen.queryByTestId("collab-conn-word")).toBeNull();
  });

  test("connecting: blue pulse + word", () => {
    render(<ConnDot conn="connecting" reconnect={null} />);
    const dot = screen.getByTestId("collab-conn-dot");
    expect(dot.querySelector("span")?.className).toContain("bg-sky-500");
    expect(dot.querySelector("span")?.className).toContain("animate-pulse");
    expect(screen.getByTestId("collab-conn-word")).toBeTruthy();
  });

  test("reconnecting: amber pulse + word + retry detail in tooltip", () => {
    render(<ConnDot conn="connecting" reconnect={{ attempt: 2, delayMs: 4000 }} />);
    const dot = screen.getByTestId("collab-conn-dot");
    expect(dot.querySelector("span")?.className).toContain("bg-amber-500");
    expect(dot.getAttribute("data-state")).toBe("connecting");
    expect(dot.getAttribute("title")).toContain("CollabConnReconnectDetail");
    expect(screen.getByTestId("collab-conn-word")).toBeTruthy();
  });

  test("rejected: red steady + word (fatal only)", () => {
    render(<ConnDot conn="rejected" reconnect={null} />);
    const dot = screen.getByTestId("collab-conn-dot");
    expect(dot.querySelector("span")?.className).toContain("bg-red-500");
    expect(screen.getByTestId("collab-conn-word")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* OfflineBanner (061 §2 + Q3)                                          */
/* ------------------------------------------------------------------ */

describe("OfflineBanner", () => {
  test("edits-kept title + frozen-roster count (self excluded) + conflict pre-warning", () => {
    render(<OfflineBanner peers={PEERS} />);
    expect(screen.getByTestId("collab-offline-title").textContent).toContain("CollabConnDropTitle");
    expect(screen.getByTestId("collab-offline-body").textContent).toContain("CollabConnDropBody");
    expect(screen.getByTestId("collab-offline-warn").textContent).toContain("CollabConnConflictWarn");
  });

  test("solo offline shows 0 collaborators, never negative", () => {
    render(<OfflineBanner peers={[{ profileId: "self", name: "Ada", color: "", connId: "c", self: true }]} />);
    expect(screen.getByTestId("collab-offline-body").textContent).toContain("CollabConnDropBody");
  });
});

/* ------------------------------------------------------------------ */
/* ResetNotice (061 §3)                                                 */
/* ------------------------------------------------------------------ */

describe("ResetNotice", () => {
  test("renders count + breakdown; Show me highlights the reset ids; Got it dismisses per-recovery", () => {
    vi.useFakeTimers(); // BEFORE render — the highlight setTimeout must be fake
    const api = {
      getAppState: vi.fn(() => ({ selectedElementIds: {} })),
      updateScene: vi.fn(),
      isDestroyed: false,
    } as unknown as ExcalidrawImperativeAPI;

    render(<ResetNotice notice={NOTICE} excalidrawAPI={api} />);
    expect(screen.getByTestId("collab-reset-title").textContent).toContain("CollabConnResetTitle");

    // Show me → transient selection highlight (NEVER capture, restore after)
    fireEvent.click(screen.getByTestId("collab-reset-show"));
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({
        appState: { selectedElementIds: { "el-a": true, "el-b": true } },
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
    // restore fires after the timeout
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    const restoreCall = (api.updateScene as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(restoreCall.captureUpdate).toBe(CaptureUpdateAction.NEVER);
    expect(restoreCall.appState.selectedElementIds).toEqual({});
    vi.useRealTimers();

    // Got it → per-recovery dismissal (same notice.at stays hidden)
    fireEvent.click(screen.getByTestId("collab-reset-ok"));
    expect(screen.queryByTestId("collab-reset-notice")).toBeNull();
  });

  test("a NEW recovery (different at) shows again after dismissal", () => {
    const { rerender } = render(<ResetNotice notice={NOTICE} />);
    fireEvent.click(screen.getByTestId("collab-reset-ok"));
    rerender(<ResetNotice notice={{ ...NOTICE, at: 222 }} />);
    expect(screen.getByTestId("collab-reset-notice")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* ConnHealthBanners (061 §8)                                           */
/* ------------------------------------------------------------------ */

describe("ConnHealthBanners", () => {
  function session(overrides: Partial<CollabSessionHandle> = {}): Pick<
    CollabSessionHandle,
    "conn" | "reconnect" | "peers" | "resets"
  > {
    return {
      conn: "connected",
      reconnect: null,
      peers: PEERS,
      resets: null,
      ...overrides,
    };
  }

  test("silent while live (no banner, no notice) — clean resync stays quiet", () => {
    render(<ConnHealthBanners session={session()} />);
    expect(screen.queryByTestId("collab-offline-banner")).toBeNull();
    expect(screen.queryByTestId("collab-reset-notice")).toBeNull();
  });

  test("offline banner while reconnecting; reset notice only with real conflicts", () => {
    const { rerender } = render(
      <ConnHealthBanners session={session({ conn: "connecting", reconnect: { attempt: 1, delayMs: 2000 } })} />,
    );
    expect(screen.getByTestId("collab-offline-banner")).toBeTruthy();

    rerender(
      <ConnHealthBanners
        session={session({ conn: "connected", reconnect: null, resets: NOTICE })}
      />,
    );
    expect(screen.queryByTestId("collab-offline-banner")).toBeNull();
    expect(screen.getByTestId("collab-reset-notice")).toBeTruthy();
  });
});
