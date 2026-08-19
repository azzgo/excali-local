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
 * - Re-entry card (047): shows only after the 10s no-answer timeout, with
 *   Retry / Open last synced copy / Leave; suppresses the offline banner.
 * - Degraded hint (047): ≥3 reconnects within 5 min → one amber hint, once.
 * - Fatal banner (047): 054 stale.admit/stale.gcm copy on fatal lastError.
 * - 047 copy is the LOCKED 061 table — asserted against the real i18next
 *   resources (the useTranslation mock stays key-echoing for components).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import i18n from "i18next";
import { initI18n } from "@/locales/locales";
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

// Components get a key-echoing t; the REAL i18next resources stay intact so
// the locked 061 copy table can be asserted verbatim (047 copy tests below).
vi.mock("react-i18next", async () => {
  const real = await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return {
    ...real,
    useTranslation: () => [(key: string) => key],
  };
});

beforeAll(() => {
  initI18n();
});

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

/** Module-level session fixture (047: the banner slot now consumes the
 * full health slice — conn/reconnect/peers/resets + lastError/
 * snapshotAvailable/connect/leave/saveToGallery). */
type SessionSlice = Pick<
  CollabSessionHandle,
  | "conn"
  | "reconnect"
  | "peers"
  | "resets"
  | "lastError"
  | "lastSyncedAt"
  | "snapshotAvailable"
  | "connect"
  | "leave"
  | "saveToGallery"
>;

function session(overrides: Partial<SessionSlice> = {}): SessionSlice {
  return {
    conn: "connected",
    reconnect: null,
    peers: PEERS,
    resets: null,
    lastError: null,
    lastSyncedAt: null,
    snapshotAvailable: true,
    connect: vi.fn(),
    leave: vi.fn(),
    saveToGallery: vi.fn(async () => true),
    ...overrides,
  };
}

/** Dialing with no welcome: conn connecting/reconnecting, no snapshot. */
function downSession(overrides: Partial<SessionSlice> = {}): SessionSlice {
  return session({
    conn: "connecting",
    reconnect: null,
    snapshotAvailable: null,
    ...overrides,
  });
}

describe("ConnHealthBanners", () => {
  test("silent while live (no banner, no notice) — clean resync stays quiet", () => {
    render(<ConnHealthBanners session={session()} />);
    expect(screen.queryByTestId("collab-offline-banner")).toBeNull();
    expect(screen.queryByTestId("collab-reset-notice")).toBeNull();
  });

  test("offline banner while reconnecting; reset notice only with real conflicts", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ConnHealthBanners session={session({ conn: "reconnecting", reconnect: { attempt: 1, delayMs: 2000 } })} />,
    );
    // offline is debounced (1.5s entry) — nothing yet
    expect(screen.queryByTestId("collab-offline-banner")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("collab-offline-banner")).toBeTruthy();

    rerender(
      <ConnHealthBanners
        session={session({ conn: "connected", reconnect: null, resets: NOTICE })}
      />,
    );
    // back live: minimum residency (1s hold) before collapsing
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId("collab-offline-banner")).toBeNull();
    expect(screen.getByTestId("collab-reset-notice")).toBeTruthy();
    vi.useRealTimers();
  });
});

/* ------------------------------------------------------------------ */
/* re-entry card (061 Q4 — task 047)                                    */
/* ------------------------------------------------------------------ */

describe("re-entry card (061 Q4)", () => {
  test("appears only after the 10s no-answer timeout, with the 054 nobody-answered copy", () => {
    vi.useFakeTimers();
    render(
      <ConnHealthBanners
        session={downSession({ lastSyncedAt: 1_700_000_000_000 })}
        roomLabel="Sprint planning"
        relay="wss://relay.acme-design.com/x"
      />,
    );
    // 054 join.srvdown family — never the rejected family
    expect(screen.queryByTestId("collab-reentry-card")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(9999);
    });
    expect(screen.queryByTestId("collab-reentry-card")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByTestId("collab-reentry-card")).toBeTruthy();
    expect(screen.getByTestId("collab-reentry-title").textContent).toBe("CollabReentryDownTitle");
    expect(screen.getByTestId("collab-reentry-body").textContent).toContain("CollabReentryDownBody");
    expect(screen.getByTestId("collab-reentry-last-synced").textContent).toContain("CollabReentryLastSynced");
    expect(screen.getByTestId("collab-reentry-retry")).toBeTruthy();
    expect(screen.getByTestId("collab-reentry-open-cache")).toBeTruthy();
    expect(screen.getByTestId("collab-reentry-leave")).toBeTruthy();
    // the offline banner must NOT stack on the card
    expect(screen.queryByTestId("collab-offline-banner")).toBeNull();
    vi.useRealTimers();
  });

  test("Retry re-dials and re-arms a fresh 10s window; welcome clears the card", () => {
    vi.useFakeTimers();
    const connect = vi.fn();
    const { rerender } = render(
      <ConnHealthBanners session={downSession({ connect })} />,
    );
    act(() => {
      vi.advanceTimersByTime(10001);
    });
    expect(screen.getByTestId("collab-reentry-card")).toBeTruthy();
    fireEvent.click(screen.getByTestId("collab-reentry-retry"));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("collab-reentry-card")).toBeNull();
    // still down → the card comes back after a fresh 10s
    act(() => {
      vi.advanceTimersByTime(10001);
    });
    expect(screen.getByTestId("collab-reentry-card")).toBeTruthy();
    // the server answers → welcome → phase over, card gone for good
    rerender(
      <ConnHealthBanners
        session={session({
          conn: "connected",
          reconnect: null,
          snapshotAvailable: true,
          connect,
        })}
      />,
    );
    expect(screen.queryByTestId("collab-reentry-card")).toBeNull();
    vi.useRealTimers();
  });

  test("Open last synced copy dismisses the card for the session; offline banner takes over", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ConnHealthBanners session={downSession()} />);
    act(() => {
      vi.advanceTimersByTime(10001);
    });
    expect(screen.getByTestId("collab-reentry-card")).toBeTruthy();
    fireEvent.click(screen.getByTestId("collab-reentry-open-cache"));
    expect(screen.queryByTestId("collab-reentry-card")).toBeNull();
    // client is now in the never-giving-up retry loop (Q6): the offline
    // banner owns the strip and the card never returns this session
    rerender(
      <ConnHealthBanners
        session={session({
          conn: "reconnecting",
          reconnect: { attempt: 0, delayMs: 1000 },
          snapshotAvailable: null,
        })}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(120000);
    });
    expect(screen.queryByTestId("collab-reentry-card")).toBeNull();
    expect(screen.getByTestId("collab-offline-banner")).toBeTruthy();
    vi.useRealTimers();
  });

  test("Leave closes the session", () => {
    vi.useFakeTimers();
    const leave = vi.fn();
    render(<ConnHealthBanners session={downSession({ leave })} />);
    act(() => {
      vi.advanceTimersByTime(10001);
    });
    fireEvent.click(screen.getByTestId("collab-reentry-leave"));
    expect(leave).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

/* ------------------------------------------------------------------ */
/* degraded hint (061 Q5 — task 047)                                    */
/* ------------------------------------------------------------------ */

describe("degraded hint (061 Q5)", () => {
  test("silence until ≥3 reconnects within 5 min, then ONE hint; stays silent after", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { rerender } = render(<ConnHealthBanners session={session()} />);
    expect(screen.queryByTestId("collab-degraded-hint")).toBeNull();
    const reconn = (attempt: number) => ({ attempt, delayMs: 1000 * 2 ** attempt });
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(0) })} />);
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(1) })} />);
    expect(screen.queryByTestId("collab-degraded-hint")).toBeNull();
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(2) })} />);
    expect(screen.getByTestId("collab-degraded-hint")).toBeTruthy();
    expect(screen.getByTestId("collab-degraded-title").textContent).toBe("CollabConnUnstableTitle");
    expect(screen.getByTestId("collab-degraded-body").textContent).toBe("CollabConnUnstableBody");
    // more reconnects → still exactly one hint (per-session one-shot)
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(3) })} />);
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(4) })} />);
    expect(screen.getAllByTestId("collab-degraded-hint")).toHaveLength(1);
    vi.useRealTimers();
  });

  test("reconnects older than 5 min don't count (sliding window)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { rerender } = render(<ConnHealthBanners session={session()} />);
    const reconn = (attempt: number) => ({ attempt, delayMs: 1000 });
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(0) })} />);
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(1) })} />);
    // 6 minutes later two more reconnects — only 2 inside the window → quiet
    act(() => {
      vi.advanceTimersByTime(6 * 60 * 1000);
    });
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(2) })} />);
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(3) })} />);
    expect(screen.queryByTestId("collab-degraded-hint")).toBeNull();
    rerender(<ConnHealthBanners session={session({ reconnect: reconn(4) })} />);
    expect(screen.getByTestId("collab-degraded-hint")).toBeTruthy();
    vi.useRealTimers();
  });

  test("pre-welcome reconnects don't count; never shows while reconnecting (no stacking)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { rerender } = render(
      <ConnHealthBanners session={downSession({ conn: "reconnecting", reconnect: { attempt: 0, delayMs: 1000 } })} />,
    );
    // re-entry retry loop: attempts 0..2 before any welcome
    rerender(
      <ConnHealthBanners session={downSession({ conn: "reconnecting", reconnect: { attempt: 1, delayMs: 2000 } })} />,
    );
    rerender(
      <ConnHealthBanners session={downSession({ conn: "reconnecting", reconnect: { attempt: 2, delayMs: 4000 } })} />,
    );
    expect(screen.queryByTestId("collab-degraded-hint")).toBeNull();
    // welcome arrives; the stale attempt must not be double-counted
    rerender(
      <ConnHealthBanners
        session={session({ conn: "connected", reconnect: { attempt: 2, delayMs: 4000 } })}
      />,
    );
    expect(screen.queryByTestId("collab-degraded-hint")).toBeNull();
    // three more reconnects AFTER the welcome → hint (only while live)
    rerender(<ConnHealthBanners session={session({ reconnect: { attempt: 3, delayMs: 8000 } })} />);
    rerender(<ConnHealthBanners session={session({ reconnect: { attempt: 4, delayMs: 16000 } })} />);
    rerender(<ConnHealthBanners session={session({ reconnect: { attempt: 5, delayMs: 30000 } })} />);
    expect(screen.getByTestId("collab-degraded-hint")).toBeTruthy();
    // reconnecting again → offline banner shows, hint never stacks on it
    rerender(
      <ConnHealthBanners
        session={session({
          conn: "reconnecting",
          reconnect: { attempt: 6, delayMs: 30000 },
        })}
      />,
    );
    // offline banner is debounced (1.5s entry)
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("collab-offline-banner")).toBeTruthy();
    expect(screen.queryByTestId("collab-degraded-hint")).toBeNull();
    vi.useRealTimers();
  });
});

/* ------------------------------------------------------------------ */
/* fatal banner (061 Q7 + 054 — task 047)                               */
/* ------------------------------------------------------------------ */

describe("fatal banner (061 Q7 + 054)", () => {
  test("054 stale.admit copy verbatim on a fatal lastError; NOT on non-fatal errors", () => {
    const { rerender } = render(
      <ConnHealthBanners
        session={session({
          conn: "rejected",
          lastError: { code: "ADMISSION_INVALID", reason: "sig", fatal: true },
        })}
      />,
    );
    expect(screen.getByTestId("collab-fatal-banner")).toBeTruthy();
    expect(screen.getByTestId("collab-fatal-title").textContent).toBe("CollabConnFatalTitle");
    expect(screen.getByTestId("collab-fatal-body").textContent).toBe("CollabConnFatalBody");
    expect(screen.queryByTestId("collab-offline-banner")).toBeNull();
    // non-fatal (e.g. a chunk hiccup) → no red banner at all
    rerender(
      <ConnHealthBanners
        session={session({
          conn: "connected",
          lastError: { code: "SEED_REJECTED", reason: "nope", fatal: false },
        })}
      />,
    );
    expect(screen.queryByTestId("collab-fatal-banner")).toBeNull();
  });

  test("E2E_AUTH_FAILED (GCM stale key, room recreated) → 054 stale.gcm copy verbatim", () => {
    render(
      <ConnHealthBanners
        session={session({
          conn: "rejected",
          lastError: { code: "E2E_AUTH_FAILED", reason: "gcm", fatal: true },
        })}
      />,
    );
    expect(screen.getByTestId("collab-fatal-title").textContent).toBe("CollabConnFatalGcmTitle");
    expect(screen.getByTestId("collab-fatal-body").textContent).toBe("CollabConnFatalGcmBody");
  });

  test("Save to gallery + Leave actions; failed save surfaces the toast", async () => {
    const saveToGallery = vi.fn(async () => false);
    const leave = vi.fn();
    render(
      <ConnHealthBanners
        session={session({
          conn: "rejected",
          lastError: { code: "MESSAGE_TOO_LARGE", reason: "big", fatal: true },
          saveToGallery,
          leave,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("collab-fatal-save"));
    await waitFor(() => expect(saveToGallery).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("collab-fatal-leave"));
    expect(leave).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* locked 061 copy table — verbatim against the real resources (047)    */
/* ------------------------------------------------------------------ */

describe("locked 061/054 copy (verbatim)", () => {
  test("re-entry card uses the 054 join.srvdown nobody-answered family, EN", () => {
    expect(i18n.t("CollabReentryDownTitle", { lng: "en" })).toBe(
      "Can't reach your team server",
    );
    expect(i18n.t("CollabReentryDownBody", { lng: "en" })).toBe(
      "{{room}} · {{relay}} · nothing answered for {{timeout}}s. The room isn't lost — the server may be redeploying or asleep.",
    );
    expect(i18n.t("CollabReentryOpenCache", { lng: "en" })).toBe("Open last synced copy");
  });

  test("fatal banner carries 054 stale.admit / stale.gcm word-identical, EN", () => {
    // stale.admit — keys rotated (054)
    expect(i18n.t("CollabConnFatalTitle", { lng: "en" })).toBe(
      "The server rejected this member key",
    );
    expect(i18n.t("CollabConnFatalBody", { lng: "en" })).toBe(
      "The invite is probably outdated. Paste a fresh server invite in Options → Collaboration. Your edits stay in this tab — save them to your gallery before leaving.",
    );
    // stale.gcm — room recreated (054)
    expect(i18n.t("CollabConnFatalGcmTitle", { lng: "en" })).toBe(
      "This room's key doesn't match",
    );
    expect(i18n.t("CollabConnFatalGcmBody", { lng: "en" })).toBe(
      "The room may have been recreated. Ask the host to copy the full room invite again. Your edits stay in this tab — save them to your gallery before leaving.",
    );
  },
  );

  test("degraded hint copy (061 Q5) and the zh-CN half of the locked table", () => {
    expect(i18n.t("CollabConnUnstableTitle", { lng: "en" })).toBe("Connection is unstable");
    expect(i18n.t("CollabConnUnstableBody", { lng: "en" })).toBe(
      "Edits are still syncing, but the link to your team server keeps dropping. Nothing for you to do — shown once, just so you know.",
    );
    expect(i18n.t("CollabReentryDownTitle", { lng: "zh-CN" })).toBe("无法连接你的团队服务器");
    expect(i18n.t("CollabConnFatalTitle", { lng: "zh-CN" })).toBe("服务器拒绝了此成员密钥");
    expect(i18n.t("CollabConnFatalGcmTitle", { lng: "zh-CN" })).toBe("房间密钥不匹配");
    expect(i18n.t("CollabReentryLastSynced", { lng: "en" })).toBe(
      "Last synced {{time}} · from your local session cache",
    );
  });
});
