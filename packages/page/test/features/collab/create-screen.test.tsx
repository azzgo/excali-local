import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  encodeRoomInvite,
  listRooms,
  loadSession,
  parseInvite,
} from "collab-core";
import CreateScreen from "@/features/collab/create-screen";
import { fingerprint } from "@/features/collab/invite";
import { COLLAB_SERVER_CONFIG, type ServerConfig } from "@/features/collab/storage";
import { clearCollabStores } from "./helpers";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/** 32-byte base64url key (43 chars, no padding) — collab-core validates length. */
const KEY43 = "A".repeat(43);
/** Loopback relay (060): never probed — the create flow never dials anyway. */
const RELAY = "http://127.0.0.1:1999";

const setStoredConfig = (config: ServerConfig) => {
  localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(config));
};

const fillNameAndSubmit = (name: string) => {
  fireEvent.change(screen.getByTestId("collab-create-name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByTestId("collab-create-submit"));
};

/** Run the form → share step and return the parsed invite from the preview. */
const createRoom = async (name: string) => {
  fillNameAndSubmit(name);
  await screen.findByTestId("collab-share-step");
  const preview = screen.getByTestId("collab-share-preview").textContent ?? "";
  const parsed = parseInvite(preview);
  expect(parsed.kind).toBe("room");
  if (parsed.kind !== "room") throw new Error("expected a room invite");
  return parsed;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** fake-indexeddb persists across tests in one file — start each case clean. */
beforeEach(async () => {
  await clearCollabStores();
  (window.location as { hash?: string }).hash = "";
});

describe("CollabEditor create flow (053/054/048)", () => {
  test("submit is disabled until a room name is entered", () => {
    render(<CreateScreen lang="en" />);
    const submit = screen.getByTestId("collab-create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("collab-create-name"), {
      target: { value: "Q3 planning" },
    });
    expect((screen.getByTestId("collab-create-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("team room: 128-bit shareId minted, invite encoded, room meta saved with fp", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    render(<CreateScreen lang="en" />);
    const parsed = await createRoom("Q3 planning");

    // 049 §4: shareId = 16 random bytes → 22-char b64url (no padding)
    expect(parsed.shareId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(parsed.tier).toBe("team");
    expect(parsed.roomSecret).toBeUndefined();
    // 048: fp = fingerprint of the relay the invite was minted against
    expect(parsed.fp).toBe(fingerprint(RELAY));

    // 048: the invite IS the room — the encoded code is stored as meta
    const rooms = await listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].label).toBe("Q3 planning");
    expect(rooms[0].tier).toBe("team");
    expect(rooms[0].pinned).toBe(false);
    expect(rooms[0].fp).toBe(fingerprint(RELAY));
    expect(rooms[0].invite).toBe(encodeRoomInvite(parsed));
    expect(rooms[0].lastJoined).toBeGreaterThan(0);
  });

  test("private room: 32-byte roomSecret minted into the invite", async () => {
    setStoredConfig({ relay: RELAY, org: "dev", sk: KEY43, ck: KEY43 });
    render(<CreateScreen lang="en" />);
    fireEvent.click(screen.getByTestId("collab-create-tier-private"));
    const parsed = await createRoom("Design review");

    expect(parsed.tier).toBe("private");
    // 050 §2: roomSecret = 32 bytes b64url → 43 chars, no padding
    expect(parsed.roomSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rooms = await listRooms();
    expect(rooms[0].tier).toBe("private");
    // 054 Q2: tier is immutable at create — the stored invite re-encodes identically
    expect(rooms[0].invite).toBe(encodeRoomInvite(parsed));
  });

  test("no server configured → invite carries no fp (nothing to gray against)", async () => {
    render(<CreateScreen lang="en" />);
    const parsed = await createRoom("Solo board");
    expect(parsed.fp).toBeUndefined();
  });

  test("share step → skip → seed prompt → start blank stages an empty seed and enters #room/<shareId>", async () => {
    render(<CreateScreen lang="en" />);
    const parsed = await createRoom("Q3 planning");

    // intermediate share step (053) — skip = enter room
    fireEvent.click(screen.getByTestId("collab-share-skip"));
    await screen.findByTestId("collab-seed-prompt");
    expect(screen.getByText("CollabSeedTitle")).toBeTruthy();

    // 061: first seed staged into the session cache; entry via the bookmarkable URL
    fireEvent.click(screen.getByTestId("collab-seed-blank"));
    await waitFor(() =>
      expect((window.location as { hash?: string }).hash).toBe(`#room/${parsed.shareId}`),
    );
    const session = await loadSession(parsed.shareId);
    expect(session?.edited.elements).toEqual([]);
    expect(session?.base).toBeNull();
  });

  test("share step → seed prompt → gallery picker back returns to the prompt", async () => {
    render(<CreateScreen lang="en" />);
    await createRoom("Q3 planning");
    fireEvent.click(screen.getByTestId("collab-share-skip"));
    await screen.findByTestId("collab-seed-prompt");
    fireEvent.click(screen.getByTestId("collab-seed-gallery"));
    await screen.findByTestId("collab-seed-picker");
    fireEvent.click(screen.getByTestId("collab-seed-picker-back"));
    expect(screen.getByTestId("collab-seed-prompt")).toBeTruthy();
  });
});
