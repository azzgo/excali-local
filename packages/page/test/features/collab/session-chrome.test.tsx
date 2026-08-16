/**
 * SessionChrome tests (task 044 — Wayfinder 053 sessionLive / 055 roster /
 * 061 conn dot). The chrome receives a session handle; here it is a fake
 * handle (the REAL hook's behavior — hello, scenes, cache, gallery
 * persistence — is covered in use-collab-session.test.ts).
 *
 * Covers the task checklist: room label + privacy badge, roster dots from
 * peers with hover (name·short id), self outline, copy-invite → clipboard
 * with sentence+code, save-to-gallery → handle called + toast, conn-dot
 * states, and the leave modal's three actions.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SessionChrome } from "@/features/collab/session-chrome";
import type {
  CollabRoomMeta,
  CollabSessionHandle,
  RosterMember,
} from "@/features/collab/use-collab-session";
import { parseInvite } from "collab-core";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const SHARE_ID = "B".repeat(22);

const ROOM: CollabRoomMeta = {
  label: "Q3 planning",
  tier: "team",
  invite: { shareId: SHARE_ID, tier: "team" },
};

const PEERS: RosterMember[] = [
  { profileId: "self-1", name: "Ada", color: "hsl(0, 100%, 83%)", connId: "conn-self", self: true },
  { profileId: "a3f9c2d1", name: "Min", color: "hsl(220, 100%, 83%)", connId: "conn-a", self: false },
  { profileId: "9c1d2e3f", name: "王小明", color: "hsl(40, 100%, 83%)", connId: "conn-b", self: false },
];

function makeSession(overrides: Partial<CollabSessionHandle> = {}): CollabSessionHandle {
  return {
    ready: true,
    conn: "connected",
    reconnect: null,
    lastError: null,
    snapshotAvailable: true,
    emptyRoom: false,
    peers: PEERS,
    hadOfflineEdits: false,
    resets: null,
    connect: vi.fn(),
    leave: vi.fn(),
    seed: vi.fn(),
    saveToGallery: vi.fn(async () => true),
    onLocalChange: vi.fn(),
    ...overrides,
  };
}

const renderChrome = (session: CollabSessionHandle = makeSession(), room = ROOM) =>
  render(<SessionChrome room={room} session={session} />);

beforeEach(() => {
  (window.location as { hash?: string }).hash = "";
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  // Clipboard mock — copyText prefers navigator.clipboard.writeText.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe("SessionChrome — chrome bar", () => {
  test("renders the room label + privacy badge (team)", () => {
    renderChrome();
    expect(screen.getByTestId("collab-session-chrome")).toBeTruthy();
    expect(screen.getByTestId("collab-room-label").textContent).toBe("Q3 planning");
    expect(screen.getByTestId("collab-room-tier").textContent).toBe("CollabTierBadgeTeam");
  });

  test("private room renders the private badge", () => {
    renderChrome(makeSession(), {
      label: "Secret",
      tier: "private",
      roomSecret: "C".repeat(43),
      invite: { shareId: SHARE_ID, tier: "private", roomSecret: "C".repeat(43) },
    });
    expect(screen.getByTestId("collab-room-tier").textContent).toBe("CollabTierBadgePrivate");
  });

  test("conn dot: live = dot only; degraded states add a word (061 §1)", () => {
    const { rerender } = renderChrome(makeSession({ conn: "connected" }));
    expect(screen.getByTestId("collab-conn-dot").dataset.state).toBe("connected");
    expect(screen.queryByTestId("collab-conn-word")).toBeNull();

    rerender(<SessionChrome room={ROOM} session={makeSession({ conn: "reconnecting", reconnect: { attempt: 2, delayMs: 4000 } })} />);
    expect(screen.getByTestId("collab-conn-dot").dataset.state).toBe("reconnecting");
    expect(screen.getByTestId("collab-conn-word").textContent).toBe("CollabConnReconnecting");

    rerender(<SessionChrome room={ROOM} session={makeSession({ conn: "rejected" })} />);
    expect(screen.getByTestId("collab-conn-dot").dataset.state).toBe("rejected");
    expect(screen.getByTestId("collab-conn-word").textContent).toBe("CollabConnRejected");
  });

  test("roster dots render from peers; self dot is outlined", () => {
    renderChrome();
    const dots = screen.getAllByTestId(/^collab-roster-dot-/);
    expect(dots).toHaveLength(3);
    expect(screen.getByTestId(`collab-roster-dot-self-1`).dataset.self).toBe("true");
    expect(screen.getByTestId(`collab-roster-dot-a3f9c2d1`).dataset.self).toBeUndefined();
  });

  test("roster hover pops name · short id (055)", async () => {
    renderChrome();
    const dot = screen.getByTestId("collab-roster-dot-a3f9c2d1");
    fireEvent.pointerMove(dot);
    await waitFor(() => expect(screen.getByText("Min · a3f")).toBeTruthy());
    // self hover → localized "You"
    const self = screen.getByTestId("collab-roster-dot-self-1");
    fireEvent.pointerMove(self);
    await waitFor(() => expect(screen.getByText("CollabYou")).toBeTruthy());
  });

  test("departed peers fade out (still rendered at opacity 0 for ~250ms)", async () => {
    const session = makeSession();
    const { rerender } = renderChrome(session);
    expect(screen.getAllByTestId(/^collab-roster-dot-/)).toHaveLength(3);

    rerender(
      <SessionChrome
        room={ROOM}
        session={makeSession({ peers: PEERS.slice(0, 2) })}
      />,
    );
    // the departed dot lingers for the fade window
    expect(screen.getByTestId("collab-roster-dot-9c1d2e3f")).toBeTruthy();
    await waitFor(
      () =>
        expect(screen.queryByTestId("collab-roster-dot-9c1d2e3f")).toBeNull(),
      { timeout: 1000 },
    );
  });
});

describe("SessionChrome — actions", () => {
  test("copy invite writes the sentence + code to the clipboard (054)", async () => {
    renderChrome();
    fireEvent.click(screen.getByTestId("collab-copy-invite"));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1),
    );
    const text = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    // sentence (localized via the key mock) + newline + the encoded code;
    // the code is the b64url-encoded invite payload (049 §4) — round-trips
    // to this room via collab-core's parser.
    expect(text).toContain("CollabShareClipboard");
    const code = text.split("\n").at(-1) ?? "";
    expect(code.startsWith("excali-collab:v1:room:")).toBe(true);
    const parsed = parseInvite(code);
    expect(parsed.kind).toBe("room");
    if (parsed.kind === "room") expect(parsed.shareId).toBe(SHARE_ID);
    // brief "copied" feedback
    expect(screen.getByText("CollabCopied")).toBeTruthy();
  });

  test("save to gallery calls the session handle and toasts success", async () => {
    const saveToGallery = vi.fn(async () => true);
    renderChrome(makeSession({ saveToGallery }));
    fireEvent.click(screen.getByTestId("collab-save-to-gallery"));
    await waitFor(() => expect(saveToGallery).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("CollabSavedToGallery");
  });

  test("failed save toasts an error", async () => {
    const saveToGallery = vi.fn(async () => false);
    renderChrome(makeSession({ saveToGallery }));
    fireEvent.click(screen.getByTestId("collab-save-to-gallery"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("CollabSaveFailed"));
  });
});

describe("SessionChrome — leave modal (053)", () => {
  test("Stay closes the modal without leaving or saving", () => {
    const session = makeSession();
    renderChrome(session);
    fireEvent.click(screen.getByTestId("collab-leave"));
    expect(screen.getByTestId("collab-leave-modal")).toBeTruthy();

    fireEvent.click(screen.getByTestId("collab-leave-stay"));
    expect(screen.queryByTestId("collab-leave-modal")).toBeNull();
    expect(session.leave).not.toHaveBeenCalled();
    expect(session.saveToGallery).not.toHaveBeenCalled();
  });

  test("Leave without saving leaves immediately, no gallery write", () => {
    const session = makeSession();
    renderChrome(session);
    fireEvent.click(screen.getByTestId("collab-leave"));
    fireEvent.click(screen.getByTestId("collab-leave-discard"));

    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(session.saveToGallery).not.toHaveBeenCalled();
    expect((window.location as { hash?: string }).hash).toBe("#rooms");
  });

  test("Save & leave persists to the gallery first, then leaves", async () => {
    const saveToGallery = vi.fn(async () => true);
    const session = makeSession({ saveToGallery });
    renderChrome(session);
    fireEvent.click(screen.getByTestId("collab-leave"));
    fireEvent.click(screen.getByTestId("collab-leave-save"));

    await waitFor(() => expect(saveToGallery).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(session.leave).toHaveBeenCalledTimes(1));
    expect((window.location as { hash?: string }).hash).toBe("#rooms");
  });

  test("Save & leave with a failed save stays (the cache is the only copy)", async () => {
    const saveToGallery = vi.fn(async () => false);
    const session = makeSession({ saveToGallery });
    renderChrome(session);
    fireEvent.click(screen.getByTestId("collab-leave"));
    fireEvent.click(screen.getByTestId("collab-leave-save"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("CollabSaveFailed"));
    expect(session.leave).not.toHaveBeenCalled();
    expect((window.location as { hash?: string }).hash).not.toBe("#rooms");
  });
});
