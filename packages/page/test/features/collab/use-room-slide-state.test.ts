/**
 * Unit tests for useRoomSlideStateReset.
 *
 * Verifies that the hook resets the module-global slide atoms (via
 * getDefaultStore()) on BOTH mount and unmount.  We assert against
 * getDefaultStore() because the app mounts `<Provider>` with no `store` prop
 * (`src/main.tsx`) — Jotai's default store is the app store.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDefaultStore } from "jotai";
import { useRoomSlideStateReset } from "@/features/collab/use-room-slide-state";
import {
  presentationModeAtom,
  slidesAtom,
  slideGlobalIndexAtom,
  showSlideQuickNavAtom,
  slideIdOrderListRef,
} from "@/features/editor/store/presentation";

// Keep a stable reference to the default store (the app store)
const appStore = getDefaultStore();

describe("useRoomSlideStateReset", () => {
  beforeEach(() => {
    // Seed non-default values so we can verify the hook actually resets them
    appStore.set(slidesAtom, [
      { id: "s1", name: "Slide 1", element: {} as any },
      { id: "s2", name: "Slide 2", element: {} as any },
    ]);
    appStore.set(presentationModeAtom, true);
    appStore.set(showSlideQuickNavAtom, true);
    appStore.set(slideGlobalIndexAtom, 5);
    slideIdOrderListRef.current = ["s1", "s2"];
  });

  afterEach(() => {
    cleanup();
    // Reset to defaults for isolation
    appStore.set(slidesAtom, []);
    appStore.set(presentationModeAtom, false);
    appStore.set(showSlideQuickNavAtom, false);
    appStore.set(slideGlobalIndexAtom, 0);
    slideIdOrderListRef.current = null;
  });

  test("resets all atoms and the ref to defaults on mount", () => {
    const { result } = renderHook(() => useRoomSlideStateReset());

    // The hook should have called getDefaultStore().set(...) for each atom
    expect(appStore.get(slidesAtom)).toEqual([]);
    expect(appStore.get(presentationModeAtom)).toBe(false);
    expect(appStore.get(showSlideQuickNavAtom)).toBe(false);
    expect(appStore.get(slideGlobalIndexAtom)).toBe(0);
    expect(slideIdOrderListRef.current).toBeNull();
  });

  test("resets atoms and ref again on unmount (cleanup)", () => {
    const { unmount } = renderHook(() => useRoomSlideStateReset());

    // Seed dirty values after mount (simulating a user fiddling with slides
    // inside the session)
    appStore.set(slidesAtom, [{ id: "s3", name: "Slide 3", element: {} as any }]);
    appStore.set(presentationModeAtom, true);
    appStore.set(showSlideQuickNavAtom, true);
    appStore.set(slideGlobalIndexAtom, 99);
    slideIdOrderListRef.current = ["s3"];

    // Unmount — cleanup should run and restore defaults
    unmount();

    expect(appStore.get(slidesAtom)).toEqual([]);
    expect(appStore.get(presentationModeAtom)).toBe(false);
    expect(appStore.get(showSlideQuickNavAtom)).toBe(false);
    expect(appStore.get(slideGlobalIndexAtom)).toBe(0);
    expect(slideIdOrderListRef.current).toBeNull();
  });

  test("idempotent: resetting already-default atoms is a no-op", () => {
    // Ensure defaults are already set
    appStore.set(slidesAtom, []);
    appStore.set(presentationModeAtom, false);
    appStore.set(showSlideQuickNavAtom, false);
    appStore.set(slideGlobalIndexAtom, 0);
    slideIdOrderListRef.current = null;

    renderHook(() => useRoomSlideStateReset());

    // Nothing should throw and values should remain at defaults
    expect(appStore.get(slidesAtom)).toEqual([]);
    expect(appStore.get(presentationModeAtom)).toBe(false);
    expect(appStore.get(showSlideQuickNavAtom)).toBe(false);
    expect(appStore.get(slideGlobalIndexAtom)).toBe(0);
    expect(slideIdOrderListRef.current).toBeNull();
  });
});
