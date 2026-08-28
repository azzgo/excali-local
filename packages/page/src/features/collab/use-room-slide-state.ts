/**
 * useRoomSlideStateReset — resets the slide store on mount AND on unmount.
 *
 * The editor's slide atoms (slidesAtom, slideGlobalIndexAtom, presentationModeAtom,
 * showSlideQuickNavAtom) are module-global (defined in
 * `features/editor/store/presentation.ts`).  In a collab room the same JS engine
 * hosts both the local editor and the room session; without isolation the last slide
 * state bleeds into subsequent local-editor boots and can corrupt remote sync
 * (e.g. a lingering `presentationModeAtom = true` causes the canvas to open in
 * presentation mode for the next room joiner).
 *
 * This hook resets the atoms to their default values and nulls the
 * slideIdOrderListRef on both mount and unmount, so the store is clean entering a
 * room session and clean again after the user leaves.
 *
 * Uses `getDefaultStore()` because the app mounts `<Provider>` with no `store` prop
 * (`src/main.tsx`) — Jotai's default store is the app store.
 */
import { useEffect } from "react";
import { getDefaultStore } from "jotai";
import {
  presentationModeAtom,
  slidesAtom,
  slideGlobalIndexAtom,
  showSlideQuickNavAtom,
  slideIdOrderListRef,
} from "@/features/editor/store/presentation";

/**
 * Call this hook inside any component that lives for the duration of a collab
 * session (e.g. the room screen wrapper).  It resets slide state on mount and
 * restores the clean default on unmount.
 *
 * ```tsx
 * function RoomSession({ shareId }: { shareId: string }) {
 *   useRoomSlideStateReset();
 *   // ... rest of the session
 * }
 * ```
 */
export function useRoomSlideStateReset(): void {
  useEffect(() => {
    const store = getDefaultStore();

    // Set all atoms to their defaults
    store.set(slidesAtom, []);
    store.set(slideGlobalIndexAtom, 0);
    store.set(showSlideQuickNavAtom, false);
    store.set(presentationModeAtom, false);

    // Null the ref (plain module object — direct assignment, no atom)
    slideIdOrderListRef.current = null;

    // Cleanup: reset again on unmount so the store is pristine for any
    // component that mounts after this one.
    return () => {
      store.set(slidesAtom, []);
      store.set(slideGlobalIndexAtom, 0);
      store.set(showSlideQuickNavAtom, false);
      store.set(presentationModeAtom, false);
      slideIdOrderListRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
