import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { saveDrawing } from "@/features/editor/utils/indexdb";
import { clearDrawings } from "./helpers";
import {
  EMPTY_SEED_SCENE,
  SeedGalleryPicker,
  SeedPrompt,
  planRoomEntry,
  type RoomEntryPlan,
} from "@/features/collab/seed-prompt";
import type { CollabSession } from "collab-core";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const el = (id: string, version = 1) => ({
  id,
  type: "rectangle",
  version,
  versionNonce: 1,
  x: 0,
  y: 0,
});

const session = (
  edited: unknown[],
  base: unknown[] | null = null,
): CollabSession => ({
  roomId: "share-id",
  edited: { elements: edited, appState: {} },
  base: base === null ? null : { elements: base, appState: {} },
  updatedAt: 1,
});

const assertPlan = (plan: RoomEntryPlan, action: RoomEntryPlan["action"]) => {
  expect(plan.action).toBe(action);
};

afterEach(() => {
  cleanup();
});

/** fake-indexeddb persists across tests in one file — start each case clean. */
beforeEach(async () => {
  await clearDrawings();
});

describe("SeedPrompt (053/054 Q7 — silent about death, first seed wins)", () => {
  test("renders the locked copy + both actions", () => {
    render(<SeedPrompt onStartBlank={() => {}} onLoadFromGallery={() => {}} />);
    expect(screen.getByText("CollabSeedTitle")).toBeTruthy();
    expect(screen.getByText("CollabSeedBody")).toBeTruthy();
    expect(screen.getByTestId("collab-seed-gallery")).toBeTruthy();
    expect(screen.getByTestId("collab-seed-blank")).toBeTruthy();
    expect(screen.queryByTestId("collab-seed-back")).toBeNull();
  });

  test("room label + back are optional", () => {
    const onBlank = vi.fn();
    const onBack = vi.fn();
    render(<SeedPrompt roomLabel="Q3 planning" onStartBlank={onBlank} onBack={onBack} />);
    expect(screen.getByText("Q3 planning")).toBeTruthy();
    fireEvent.click(screen.getByTestId("collab-seed-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("collab-seed-blank"));
    expect(onBlank).toHaveBeenCalledTimes(1);
  });

  test("gallery action forwards to the picker entry", () => {
    const onGallery = vi.fn();
    render(<SeedPrompt onStartBlank={() => {}} onLoadFromGallery={onGallery} />);
    fireEvent.click(screen.getByTestId("collab-seed-gallery"));
    expect(onGallery).toHaveBeenCalledTimes(1);
  });

  test("EMPTY_SEED_SCENE is a blank canvas (061: blank is a first seed too)", () => {
    expect(EMPTY_SEED_SCENE.elements).toEqual([]);
    expect(EMPTY_SEED_SCENE.appState).toEqual({});
  });
});

describe("SeedGalleryPicker (053 galleryPicker)", () => {
  test("lists gallery canvases; picking copies the scene (original untouched)", async () => {
    await saveDrawing({
      id: "draw-1",
      name: "Q3 planning",
      elements: JSON.stringify([el("e1")]),
      appState: JSON.stringify({ viewBackgroundColor: "#fff" }),
      files: JSON.stringify({ f1: { mimeType: "image/png" } }),
      thumbnail: "",
      collectionIds: [],
      createdAt: 100,
      updatedAt: 200,
    });
    await saveDrawing({
      id: "draw-2",
      name: "Architecture sketch",
      elements: JSON.stringify([el("e2")]),
      appState: "{}",
      files: "",
      thumbnail: "",
      collectionIds: [],
      createdAt: 100,
      updatedAt: 300,
    });

    const onPick = vi.fn();
    render(<SeedGalleryPicker onPick={onPick} onBack={() => {}} />);

    await screen.findByTestId("collab-seed-pick-draw-1");
    expect(screen.getByText("Q3 planning")).toBeTruthy();
    expect(screen.getByText("Architecture sketch")).toBeTruthy();

    fireEvent.click(screen.getByTestId("collab-seed-pick-draw-1"));
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    const scene = onPick.mock.calls[0][0];
    expect(scene.elements).toEqual([el("e1")]);
    expect(scene.appState).toEqual({ viewBackgroundColor: "#fff" });
    expect(scene.files).toEqual({ f1: { mimeType: "image/png" } });
  });

  test("empty gallery → no-canvases state", async () => {
    render(<SeedGalleryPicker onPick={() => {}} onBack={() => {}} />);
    await screen.findByText("CollabSeedNoDrawings");
  });
});

describe("planRoomEntry — 061 §3 re-activation rule (amends 053 rule A)", () => {
  const snapshot = [el("a", 3), el("b", 2)];

  test("A: alive room + no cache → enter (snapshot loads on connect)", () => {
    assertPlan(planRoomEntry({ roomStatus: "alive", cached: undefined, snapshot }), "enter");
  });

  test("A: alive + pure cache (base null — staged seed) → enter, snapshot wins", () => {
    const cached = session([el("a", 1)], null);
    assertPlan(planRoomEntry({ roomStatus: "alive", cached, snapshot }), "enter");
  });

  test("A: alive + pure cache (edited === base, no offline edits) → enter", () => {
    const cached = session([el("a", 1), el("b", 2)], [el("a", 1), el("b", 2)]);
    assertPlan(planRoomEntry({ roomStatus: "alive", cached, snapshot }), "enter");
  });

  test("A: alive + offline edits, single-sided → three-way merge, no resets", () => {
    const cached = session([el("a", 2), el("b", 2)], [el("a", 1), el("b", 2)]);
    const plan = planRoomEntry({ roomStatus: "alive", cached, snapshot: [el("a", 3), el("b", 2)] });
    expect(plan.action).toBe("merge");
    if (plan.action !== "merge") return;
    // offline edit on a (ours v2) vs online (theirs v3) — both changed → theirs wins
    expect(plan.resets).toHaveLength(1);
    expect(plan.resets[0].kind).toBe("edit-edit");
    expect(plan.resets[0].kept?.version).toBe(3);
    expect(plan.scene.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("A: alive + offline edits, remote-only change → merge cleanly, zero resets", () => {
    const cached = session([el("local", 1), el("a", 1)], [el("a", 1)]);
    const plan = planRoomEntry({
      roomStatus: "alive",
      cached,
      snapshot: [el("a", 3), el("remote", 1)],
    });
    expect(plan.action).toBe("merge");
    if (plan.action !== "merge") return;
    expect(plan.resets).toHaveLength(0);
    // local create appended; remote create + updated a arrive
    expect(plan.scene.map((e) => e.id).sort()).toEqual(["a", "local", "remote"]);
  });

  test("B: dead room + cache → enter (the cache seeds, no gallery/blank prompt)", () => {
    const cached = session([el("a", 1)]);
    assertPlan(planRoomEntry({ roomStatus: "dead", cached, snapshot: null }), "enter");
  });

  test("C: dead room + no cache → seed prompt (gallery/blank)", () => {
    assertPlan(
      planRoomEntry({ roomStatus: "dead", cached: undefined, snapshot: null }),
      "seed-prompt",
    );
  });

  test("alive-but-empty (no snapshot) behaves like dead", () => {
    const cached = session([el("a", 1)]);
    assertPlan(planRoomEntry({ roomStatus: "alive", cached, snapshot: null }), "enter");
    assertPlan(
      planRoomEntry({ roomStatus: "alive", cached: undefined, snapshot: null }),
      "seed-prompt",
    );
  });
});
