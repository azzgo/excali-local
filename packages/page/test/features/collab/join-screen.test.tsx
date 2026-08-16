import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  encodeRoomInvite,
  encodeServerInvite,
  listRooms,
  loadSession,
  saveSession,
} from "collab-core";
import JoinScreen from "@/features/collab/join-screen";
import * as inviteModule from "@/features/collab/invite";
import { COLLAB_SERVER_CONFIG, type ServerConfig } from "@/features/collab/storage";
import { clearCollabStores } from "./helpers";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/** 32-byte base64url key (43 chars, no padding) — collab-core validates length. */
const KEY43 = "A".repeat(43);
/** 16-byte base64url shareId (22 chars) — collab-core validates length. */
const SHARE_ID = "B".repeat(22);
/** Loopback relay (060): dialServer returns "skipped" without probing. */
const RELAY = "http://127.0.0.1:1999";
const FP = inviteModule.fingerprint(RELAY);

const setStoredConfig = (config: ServerConfig) => {
  localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(config));
};

const configured = (relay: string = RELAY) =>
  setStoredConfig({ relay, org: "dev", sk: KEY43, ck: KEY43 });

const roomInvite = (overrides: Partial<Parameters<typeof encodeRoomInvite>[0]> = {}) =>
  encodeRoomInvite({ shareId: SHARE_ID, tier: "team", fp: FP, ...overrides });

const paste = (text: string) => {
  fireEvent.change(screen.getByTestId("collab-join-invite"), {
    target: { value: text },
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  localStorage.clear();
});

/** fake-indexeddb persists across tests in one file — start each case clean. */
beforeEach(async () => {
  await clearCollabStores();
  (window.location as { hash?: string }).hash = "";
});

describe("CollabEditor join flow (053/054/048/061)", () => {
  test("garbage paste → red error, Join disabled (054)", () => {
    configured();
    render(<JoinScreen lang="en" />);
    paste("this is not an invite at all");
    expect(screen.getByText("CollabNoInviteFound")).toBeTruthy();
    expect(
      (screen.getByTestId("collab-join-continue") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("private room invite without key → red no-key card, Join disabled (054 Q4)", () => {
    configured();
    render(<JoinScreen lang="en" />);
    paste(roomInvite({ tier: "private" }));
    expect(screen.getByText("CollabNoKeyTitle")).toBeTruthy();
    expect(
      (screen.getByTestId("collab-join-continue") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("fp-mismatch → amber warning + Continue anyway enabled (054 Q5 / 048 warn-only)", () => {
    configured();
    render(<JoinScreen lang="en" />);
    paste(roomInvite({ fp: "deadbeef" }));
    expect(screen.getByText("CollabFpTitle")).toBeTruthy();
    // warn-only — never routing: the continue path stays open
    const continueAnyway = screen.getByTestId("collab-warning-continue") as HTMLButtonElement;
    expect(continueAnyway.disabled).toBe(false);
    expect(
      (screen.getByTestId("collab-join-continue") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test("server invite pasted into join → hint card, Join disabled (wrong kind)", () => {
    configured();
    render(<JoinScreen lang="en" />);
    paste(encodeServerInvite({ relay: "https://relay.example.com", org: "Acme", sk: KEY43, ck: KEY43 }));
    expect(screen.getByTestId("collab-join-server-hint")).toBeTruthy();
    expect(
      (screen.getByTestId("collab-join-continue") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("valid invite, no server configured → blocked card + Set up server → landing (053 joinNoSrvErr)", async () => {
    render(<JoinScreen lang="en" />);
    paste(roomInvite());
    fireEvent.click(screen.getByTestId("collab-join-continue"));
    await screen.findByTestId("collab-join-no-server");
    expect(screen.getByText("CollabJoinNoServer")).toBeTruthy();
    fireEvent.click(screen.getByTestId("collab-join-setup-server"));
    expect((window.location as { hash?: string }).hash).toBe("");
  });

  test("valid invite, no cache → meta saved, seed prompt shown (dead + no cache, 061 C)", async () => {
    configured();
    render(<JoinScreen lang="en" />);
    paste(roomInvite());
    fireEvent.click(screen.getByTestId("collab-join-continue"));

    // seed prompt — silent about death (054 Q7: "This room is empty")
    await screen.findByTestId("collab-seed-prompt");
    expect(screen.getByText("CollabSeedTitle")).toBeTruthy();
    expect(screen.getByText("CollabSeedBody")).toBeTruthy();

    // 048: the room meta was saved with the canonical invite code
    const rooms = await listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe(SHARE_ID);
    expect(rooms[0].fp).toBe(FP);
    expect(rooms[0].invite).toBe(roomInvite());
    expect(rooms[0].pinned).toBe(false);

    // start blank → staged empty seed + direct entry via the room URL
    fireEvent.click(screen.getByTestId("collab-seed-blank"));
    await waitFor(() =>
      expect((window.location as { hash?: string }).hash).toBe(`#room/${SHARE_ID}`),
    );
    const session = await loadSession(SHARE_ID);
    expect(session?.edited.elements).toEqual([]);
    expect(session?.base).toBeNull();
  });

  test("re-join with a cached session → enters directly, no seed prompt (061 A/B)", async () => {
    configured();
    await saveSession(SHARE_ID, {
      edited: { elements: [{ id: "e1", type: "rectangle", version: 1 }], appState: {} },
      base: null,
    });
    render(<JoinScreen lang="en" />);
    paste(roomInvite());
    fireEvent.click(screen.getByTestId("collab-join-continue"));

    expect(screen.queryByTestId("collab-seed-prompt")).toBeNull();
    await waitFor(() =>
      expect((window.location as { hash?: string }).hash).toBe(`#room/${SHARE_ID}`),
    );
  });

  test("relay unreachable at join → red joinSrvDown card with Retry (054 Q9, nobody answered)", async () => {
    configured("https://collab.example.com");
    const dialSpy = vi
      .spyOn(inviteModule, "dialServer")
      .mockResolvedValue("unreachable");
    render(<JoinScreen lang="en" />);
    paste(roomInvite());
    fireEvent.click(screen.getByTestId("collab-join-continue"));

    // joinSrvDown family — deliberately NOT the rejected/stale family
    await screen.findByText("CollabJoinSrvDownTitle");
    expect(screen.getByText("CollabJoinSrvDownBody")).toBeTruthy();
    expect(dialSpy).toHaveBeenCalledWith("https://collab.example.com");

    // Retry re-dials; the room was never entered
    fireEvent.click(screen.getByTestId("collab-warning-retry"));
    await screen.findByText("CollabJoinSrvDownTitle");
    expect(dialSpy).toHaveBeenCalledTimes(2);
    expect((window.location as { hash?: string }).hash).toBe("");
  });

  test("loopback relay (060) is never an error state — join proceeds", async () => {
    configured();
    render(<JoinScreen lang="en" />);
    paste(roomInvite());
    fireEvent.click(screen.getByTestId("collab-join-continue"));
    await screen.findByTestId("collab-seed-prompt");
    expect(screen.queryByText("CollabJoinSrvDownTitle")).toBeNull();
  });
});
