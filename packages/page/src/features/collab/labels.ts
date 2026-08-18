/**
 * Presence label mode (Wayfinder 055 — decided: user-selectable display mode,
 * default 最全). Pure local rendering choice: `quiet` mode simply omits
 * `username` when the page builds Excalidraw's collaborators map — zero wire
 * changes, each user's own broadcast is unaffected. (Task 075 — the control
 * is now presented as a single "show user list" checkbox; quiet = hide the
 * right-side UserList, which Excalidraw filters by `username`.)
 *
 * Modes:
 * - `full`  (default): the Excalidraw right-side UserList is shown; the
 *   roster hover / presence feed always show the full `名·短id` label.
 * - `quiet`: the collaborators map omits `username` → Excalidraw's UserList
 *   filter drops every member, hiding the list. The feed labels stay full
 *   (075 — the toggle's only effect is UserList visibility).
 *
 * Persistence follows the collab feature's storage pattern (use-collab-session
 * identity / storage.ts): chrome.storage.local in the extension, localStorage
 * fallback when getBrowser() is null (webapp form — also the test path).
 * Shared via a module jotai atom so every consumer (session chrome roster,
 * presence feed, the session hook's collaborators builder) sees one value.
 */
import { useCallback, useEffect } from "react";
import { atom, useAtom } from "jotai";
import { getBrowser } from "@/lib/utils";

export type LabelMode = "full" | "quiet";

export const DEFAULT_LABEL_MODE: LabelMode = "full";

/** chrome.storage.local / localStorage key for the presence label mode. */
export const LABEL_MODE_KEY = "collabLabelMode";

/** 055: short id in labels — 3 chars, e.g. "Ada·a3f". */
export function shortProfileId(profileId: string): string {
  return profileId.slice(0, 3);
}

/**
 * The label shown for a member in the roster hover / presence feed — always
 * the full `名·短id` form (075: the quiet mode's only effect is hiding the
 * Excalidraw UserList; feed labels no longer degrade to the short id).
 */
export function formatLabel(name: string, profileId: string): string {
  const sid = shortProfileId(profileId);
  return `${name} · ${sid}`;
}

export function isLabelMode(value: unknown): value is LabelMode {
  return value === "full" || value === "quiet";
}

/* ------------------------------------------------------------------ */
/* persistence (chrome.storage.local / localStorage, storage.ts pattern) */
/* ------------------------------------------------------------------ */

async function readLabelMode(): Promise<LabelMode | null> {
  const browser = getBrowser();
  if (browser?.storage?.local) {
    try {
      const result = await browser.storage.local.get(LABEL_MODE_KEY);
      return isLabelMode(result[LABEL_MODE_KEY]) ? result[LABEL_MODE_KEY] : null;
    } catch {
      return null;
    }
  }
  try {
    const raw = globalThis.localStorage?.getItem(LABEL_MODE_KEY) ?? null;
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLabelMode(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeLabelMode(mode: LabelMode): Promise<void> {
  const browser = getBrowser();
  if (browser?.storage?.local) {
    try {
      await browser.storage.local.set({ [LABEL_MODE_KEY]: mode });
    } catch {
      /* storage unavailable — mode degrades to per-session */
    }
    return;
  }
  try {
    globalThis.localStorage?.setItem(LABEL_MODE_KEY, JSON.stringify(mode));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* shared state                                                        */
/* ------------------------------------------------------------------ */

const labelModeAtom = atom<LabelMode>(DEFAULT_LABEL_MODE);
/** hydration finished (persisted value applied — consumers may gate on it) */
const labelModeLoadedAtom = atom(false);

/**
 * The presence label mode, shared across the session chrome roster, the
 * presence feed and the collaborators map. Hydrates from storage on first
 * use; `setMode` persists immediately. Live-updates across open editor pages
 * via chrome.storage.onChanged (webapp form: same-page atom sharing).
 */
export function useLabelMode(): {
  mode: LabelMode;
  setMode: (mode: LabelMode) => void;
  loaded: boolean;
} {
  const [mode, setMode] = useAtom(labelModeAtom);
  const [loaded, setLoaded] = useAtom(labelModeLoadedAtom);

  useEffect(() => {
    let cancelled = false;
    void readLabelMode()
      .then((stored) => {
        if (cancelled) return;
        // Always re-apply on mount: the persisted value, or the default when
        // storage is empty/unavailable — keeps the shared atom in sync with
        // storage (and makes fresh mounts deterministic).
        setMode(stored ?? DEFAULT_LABEL_MODE);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    const browser = getBrowser();
    if (browser?.storage?.local && browser.storage?.onChanged) {
      const onChange = (
        changes: Record<string, { newValue?: unknown }>,
        area: string,
      ) => {
        if (area === "local" && changes[LABEL_MODE_KEY] !== undefined) {
          const next = changes[LABEL_MODE_KEY].newValue;
          if (isLabelMode(next)) setMode(next);
        }
      };
      browser.storage.onChanged.addListener(onChange);
      return () => {
        cancelled = true;
        browser.storage.onChanged.removeListener(onChange);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [setMode, setLoaded]);

  const set = useCallback(
    (next: LabelMode) => {
      setMode(next);
      void writeLabelMode(next);
    },
    [setMode],
  );

  return { mode, setMode: set, loaded };
}
