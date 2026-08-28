/**
 * applySlideOrder — room-safe slide-order applier.
 *
 * Mirrors the semantics of `updateFrameElements`
 * (`features/editor/utils/excalidraw-api.helper.ts`) but removes the two hazards
 * introduced in b29cd4b that are unsafe in collab rooms:
 *
 *  1. **No in-place mutation** — `updateFrameElements` mutated
 *     `el.customData[orderAttributeLabel]` on the original element objects.
 *     In a collab room those same objects are tracked by the sync layer; mutating
 *     them bypasses the scene-update broadcast and can corrupt the remote state.
 *     This function produces entirely new frame objects for affected frames and
 *     passes all other elements through BY REFERENCE (no clone overhead).
 *
 *  2. **No `setLocalStorage`** — `updateFrameElements` wrote
 *     `localStorage["excalidraw"]` on every order change.  The local editor boots
 *     from that key; in a collab room the key carries room-scoped frame data that
 *     would bleed into the local editor's IndexedDB gallery.  This function
 *     intentionally skips localStorage — the room sync layer (or the calling
 *     context) persists as appropriate.
 *
 * The single `updateScene({ elements, captureUpdate: IMMEDIATELY })` call is an
 * ordinary local edit that the collab transport broadcasts to all peers.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { orderAttributeLabel } from "@/features/editor/type";
import type { ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";

/**
 * Apply a slide order to the scene by writing `excali_local_order` into the
 * `customData` of each frame whose id appears in `frameIdList`.
 *
 * @param excalidrawAPI  The Excalidraw imperative API (from `onExcalidrawAPI`).
 * @param frameIdList    Ordered list of frame ids — the frame at index *i*
 *                       gets `customData[orderAttributeLabel] = i`.
 */
export function applySlideOrder(
  excalidrawAPI: ExcalidrawImperativeAPI,
  frameIdList: string[],
): void {
  const sceneElements = excalidrawAPI.getSceneElements();

  // Build the updated element list:
  // - Frames in frameIdList → new object with updated customData (immutable)
  // - Everything else → pass through BY REFERENCE (no mutation, no clone)
  const updatedElements = sceneElements.map((el) => {
    const frame = el as ExcalidrawFrameElement;
    if (frameIdList.includes(frame.id)) {
      return {
        ...frame,
        customData: {
          ...(frame.customData ?? {}),
          [orderAttributeLabel]: frameIdList.indexOf(frame.id),
        },
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return el;
  });

  excalidrawAPI.updateScene({
    elements: updatedElements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
