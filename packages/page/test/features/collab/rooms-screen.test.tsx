import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { deleteRoom, listRooms, saveRoomMeta, type RoomEntry } from "collab-core";
import RoomsScreen from "@/features/collab/rooms-screen";
import { fingerprint } from "@/features/collab/invite";
import { COLLAB_SERVER_CONFIG, type ServerConfig } from "@/features/collab/storage";
import { clearCollabStores } from "./helpers";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const KEY43 = "A".repeat(43);
const RELAY = "http://127.0.0.1:1999";
const FP = fingerprint(RELAY);

const setStoredConfig = (config: ServerConfig) => {
  localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(config));
};

const entry = (
  id: string,
  overrides: Partial<RoomEntry> = {},
): RoomEntry => ({
  id,
  label: `Room ${id}`,
  labelKind: "named" as const,
  tier: "team",
  fp: FP,
  pinned: false,
  lastJoined: 100,
  invite: `excali-collab:v1:room:${id}`,
  ...overrides,
});

/** Card testids in document order (excludes the -pin / -delete action buttons). */
const cardIds = () =>
  [...document.querySelectorAll<HTMLElement>("[data-testid^='collab-room-']")]
    .map((el) => el.dataset.testid!)
    .filter((id) => !id.endsWith("-pin") && !id.endsWith("-delete"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** fake-indexeddb persists across tests in one file — start each case clean. */
beforeEach(async () => {
  await clearCollabStores();
  (window.location as { hash?: string }).hash = "";
});

describe("CollabEditor My rooms (053 myRooms / 048)", () => {
  test("lists saved rooms: pinned first, then most recently joined", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    await saveRoomMeta(entry("share-a", { lastJoined: 100 }));
    await saveRoomMeta(entry("share-b", { pinned: true, lastJoined: 200 }));
    await saveRoomMeta(entry("share-c", { lastJoined: 300 }));

    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-b");
    expect(cardIds()).toEqual(["collab-room-share-b", "collab-room-share-c", "collab-room-share-a"]);
    expect(screen.getByText("Room share-b")).toBeTruthy();
    expect(screen.getAllByText("CollabTierBadgeTeam")).toHaveLength(3);
    expect(screen.getAllByText("CollabLastJoined")).toHaveLength(3);
  });

  test("empty list state", async () => {
    render(<RoomsScreen lang="en" />);
    await screen.findByText("CollabRoomsEmpty");
    expect(screen.getByText("CollabRoomsEmptyHint")).toBeTruthy();
  });

  test("fp-mismatch entry grays out (048: staleness signal, never deleted)", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    await saveRoomMeta(entry("share-fresh", {}));
    await saveRoomMeta(entry("share-stale", { fp: "ffffffff", lastJoined: 200 }));

    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-stale");

    const fresh = screen.getByTestId("collab-room-share-fresh");
    const stale = screen.getByTestId("collab-room-share-stale");
    expect(fresh.dataset.stale).toBeUndefined();
    expect(stale.dataset.stale).toBeDefined();
    // the stale-entry copy (048: "may belong to another server")
    expect(screen.getByText("CollabRoomStale")).toBeTruthy();
    // NOT auto-deleted — it still lists with its actions
    expect(cardIds()).toContain("collab-room-share-stale");
    expect(screen.getByTestId("collab-room-share-stale-delete")).toBeTruthy();
  });

  test("no server configured → nothing grays (fp needs a current config to compare)", async () => {
    await saveRoomMeta(entry("share-x", { fp: "ffffffff" }));
    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-x");
    expect(screen.getByTestId("collab-room-share-x").dataset.stale).toBeUndefined();
    expect(screen.queryByText("CollabRoomStale")).toBeNull();
  });

  test("pin toggle persists through saveRoomMeta", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    await saveRoomMeta(entry("share-pin", {}));
    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-pin");

    fireEvent.click(screen.getByTestId("collab-room-share-pin-pin"));
    await screen.findByText("CollabUnpin");
    let rooms = await listRooms();
    expect(rooms[0].pinned).toBe(true);

    fireEvent.click(screen.getByTestId("collab-room-share-pin-pin"));
    await screen.findByText("CollabPin");
    rooms = await listRooms();
    expect(rooms[0].pinned).toBe(false);
  });

  test("delete private room → key-loss warning modal; cancel keeps it", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    await saveRoomMeta(entry("share-priv", { tier: "private" }));
    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-priv");

    fireEvent.click(screen.getByTestId("collab-room-share-priv-delete"));
    expect(screen.getByTestId("collab-delete-modal")).toBeTruthy();
    // 048/053: deleting a private room removes its key — explicit warning
    expect(screen.getByText("CollabDeletePrivateWarning")).toBeTruthy();

    fireEvent.click(screen.getByTestId("collab-delete-cancel"));
    expect(screen.queryByTestId("collab-delete-modal")).toBeNull();
    expect((await listRooms()).map((r) => r.id)).toEqual(["share-priv"]);
  });

  test("delete private room → confirm removes it; session cache untouched (048)", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    await saveRoomMeta(entry("share-priv", { tier: "private" }));
    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-priv");

    fireEvent.click(screen.getByTestId("collab-room-share-priv-delete"));
    fireEvent.click(screen.getByTestId("collab-delete-confirm"));
    await screen.findByText("CollabRoomsEmpty");
    expect(await listRooms()).toHaveLength(0);
    expect(await deleteRoom("share-priv")).toBeUndefined(); // idempotent — already gone
  });

  test("delete team room → no key-loss warning", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    await saveRoomMeta(entry("share-team", {}));
    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-team");

    fireEvent.click(screen.getByTestId("collab-room-share-team-delete"));
    expect(screen.getByTestId("collab-delete-modal")).toBeTruthy();
    expect(screen.queryByText("CollabDeletePrivateWarning")).toBeNull();
  });

  test("clicking a room enters #room/<id> (053 round 3 bookmarkable URL)", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    await saveRoomMeta(entry("share-click", {}));
    render(<RoomsScreen lang="en" />);
    await screen.findByTestId("collab-room-share-click");

    fireEvent.click(screen.getByTestId("collab-room-share-click"));
    expect((window.location as { hash?: string }).hash).toBe("#room/share-click");
  });
});
