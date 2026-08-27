/**
 * break-toast.test.tsx — task 083.
 *
 * Covers the follow-break toast wiring:
 * 1. Toast fires when own presenting starts while following (own-present-start).
 * 2. Toast fires when followed presenter stops presenting or leaves (presenter-left).
 * 3. No toast fires on manual unfollow (followTargetId → null via user click).
 * 4. Toast uses the CollabFollowBroke key with the correct name interpolation.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CollabSessionHandle, RosterMember } from "@/features/collab/use-collab-session";
import { useFollowBreakToast } from "@/features/collab/use-follow-break-toast";

// Module-level sonner mock — hoisted by vi.mock.
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string, opts?: { name?: string }) => `${key}:${opts?.name ?? ""}`],
}));

/* ------------------------------------------------------------------ */
/* fixtures                                                             */
/* ------------------------------------------------------------------ */

const PEERS: RosterMember[] = [
  { profileId: "self-1", name: "Ada", color: "hsl(0, 100%, 83%)", connId: "conn-self", self: true },
  { profileId: "a3f9c2d1", name: "Min", color: "hsl(220, 100%, 83%)", connId: "conn-a", self: false, presenting: true },
  { profileId: "9c1d2e3f", name: "王小明", color: "hsl(40, 100%, 83%)", connId: "conn-b", self: false },
];

const PEERS_AFTER_MIN_STOPS: RosterMember[] = [
  { profileId: "self-1", name: "Ada", color: "hsl(0, 100%, 83%)", connId: "conn-self", self: true },
  { profileId: "a3f9c2d1", name: "Min", color: "hsl(220, 100%, 83%)", connId: "conn-a", self: false, presenting: false },
  { profileId: "9c1d2e3f", name: "王小明", color: "hsl(40, 100%, 83%)", connId: "conn-b", self: false },
];

function makeSession(overrides: Partial<CollabSessionHandle> = {}): CollabSessionHandle {
  return {
    ready: true, conn: "connected", live: true, reconnect: null, lastError: null,
    lastSyncedAt: null, snapshotAvailable: true, emptyRoom: false,
    peers: PEERS,
    hadOfflineEdits: false, resets: null, roomName: null,
    rename: vi.fn(() => true), selfName: "Ada", renameSelf: vi.fn(() => true),
    connect: vi.fn(), leave: vi.fn(), seed: vi.fn(),
    broadcastScene: vi.fn(), onLocalChange: vi.fn(), onLocalPointer: vi.fn(),
    missingFileIds: new Set(), onLocalViewportChange: vi.fn(),
    presentingSelf: false, followTargetId: null,
    startPresenting: vi.fn(), stopPresenting: vi.fn(), setFollowTarget: vi.fn(),
    ...overrides,
  };
}

function ToastHarness({ session }: { session: CollabSessionHandle }) {
  useFollowBreakToast(session);
  return null;
}

/* ------------------------------------------------------------------ */
/* tests                                                                */
/* ------------------------------------------------------------------ */

describe("useFollowBreakToast — follow-break toast wiring (083)", () => {
  beforeEach(() => { vi.useRealTimers(); toastMock.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  // 1. own-present-start: startPresenting clears followTargetId AND sets presentingSelf.
  //    The hook detects: prevTarget non-null, curTarget null, presentingSelf true.
  test("toast fires when own presenting starts while following (own-present-start)", () => {
    // Start following Min (who is presenting)
    const session = makeSession({ followTargetId: "a3f9c2d1", peers: PEERS });
    const { rerender } = render(<ToastHarness session={session} />);
    toastMock.mockClear();

    // Simulate what session.startPresenting() does:
    //   setFollowTargetIdState(null) + setPresentingSelf(true) → batched one render.
    // The hook detects: prevTarget="a3f9c2d1", curTarget=null, presentingSelf=true.
    const updatedSession = makeSession({ followTargetId: null, presentingSelf: true, peers: PEERS });
    rerender(<ToastHarness session={updatedSession} />);

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("CollabFollowBroke:Min");
  });

  // 2. presenter-left: session hook clears followTargetId when followed presenter stops.
  //    The hook detects: prevTarget non-null, curTarget=null, presentingSelf=false.
  //    Peer still in roster (presenting=false) → NOT manual unfollow → toast.
  test("toast fires when followed presenter stops presenting (presenter-left)", () => {
    const session = makeSession({ followTargetId: "a3f9c2d1", peers: PEERS });
    const { rerender } = render(<ToastHarness session={session} />);
    toastMock.mockClear();

    // Simulate what the session hook does when Min stops presenting:
    //   followTargetId cleared (Min was the follow target),
    //   presentingSelf stays false, peers show Min.presenting=false.
    const updatedSession = makeSession({
      followTargetId: null,          // session hook cleared this (Min was follow target)
      peers: PEERS_AFTER_MIN_STOPS,  // Min.presenting = false in roster
    });
    rerender(<ToastHarness session={updatedSession} />);

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("CollabFollowBroke:Min");
  });

  // 3. Manual unfollow: setFollowTarget(null) called directly by user.
  //    followTargetId null, presentingSelf false, peer still in roster → silent.
  test("no toast on manual unfollow (setFollowTarget(null))", () => {
    const session = makeSession({ followTargetId: "a3f9c2d1", peers: PEERS });
    const { rerender } = render(<ToastHarness session={session} />);
    toastMock.mockClear();

    // Manual unfollow: followTargetId cleared, presentingSelf stays false,
    // peer still in roster with presenting=false.
    const updatedSession = makeSession({ followTargetId: null, peers: PEERS });
    rerender(<ToastHarness session={updatedSession} />);

    expect(toastMock).not.toHaveBeenCalled();
  });

  // 4. name interpolation — Chinese name
  test("toast uses correct name for Chinese name (own-present-start)", () => {
    const peersWithXWM: RosterMember[] = PEERS.map((p) =>
      p.profileId === "9c1d2e3f" ? { ...p, presenting: true } : p,
    );
    const session = makeSession({ followTargetId: "9c1d2e3f", peers: peersWithXWM });
    const { rerender } = render(<ToastHarness session={session} />);
    toastMock.mockClear();

    const updatedSession = makeSession({ followTargetId: null, presentingSelf: true, peers: peersWithXWM });
    rerender(<ToastHarness session={updatedSession} />);

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("CollabFollowBroke:王小明");
  });

  // 5. Edge: not following anyone when break occurs → no toast
  test("no toast when not following anyone (presenter-left)", () => {
    const session = makeSession({ followTargetId: null, peers: PEERS });
    const { rerender } = render(<ToastHarness session={session} />);
    toastMock.mockClear();

    // Peer stops, but we were not following anyone
    const updatedSession = makeSession({ followTargetId: null, peers: PEERS_AFTER_MIN_STOPS });
    rerender(<ToastHarness session={updatedSession} />);

    expect(toastMock).not.toHaveBeenCalled();
  });

  // 6. Edge: own-present-start when not following → no toast (no one to show)
  test("no toast on own-present-start when not following", () => {
    const session = makeSession({ followTargetId: null, presentingSelf: false });
    const { rerender } = render(<ToastHarness session={session} />);
    toastMock.mockClear();

    const updatedSession = makeSession({ followTargetId: null, presentingSelf: true });
    rerender(<ToastHarness session={updatedSession} />);

    expect(toastMock).not.toHaveBeenCalled();
  });

  // 7. Presenter-left: peer completely gone from roster (not just presenting=false)
  test("toast fires when followed presenter leaves roster entirely", () => {
    const session = makeSession({ followTargetId: "a3f9c2d1", peers: PEERS });
    const { rerender } = render(<ToastHarness session={session} />);
    toastMock.mockClear();

    // Peer is gone from roster entirely (setPeers is called, removing them)
    const peersAfterGone: RosterMember[] = [PEERS[0], PEERS[2]]; // self + Wang only
    const updatedSession = makeSession({ followTargetId: null, peers: peersAfterGone });
    rerender(<ToastHarness session={updatedSession} />);

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("CollabFollowBroke:Min");
  });
});
