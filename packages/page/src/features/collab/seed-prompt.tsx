import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  mergeScene,
  type CollabScene,
  type CollabSession,
  type Element,
  type ResetRecord,
} from "collab-core";
import { Button } from "@/components/ui/button";
import { getDrawings, getDrawingFullData } from "@/features/editor/utils/indexdb";

/* ------------------------------------------------------------------ */
/* 061 §3 re-activation conflict rule — the shared room-entry decision  */
/* ------------------------------------------------------------------ */

/** Room liveness as seen by the caller (044 session hook: from the welcome). */
export type RoomStatus = "alive" | "dead";

/** The entry plan (053 round 3 / 061 §3). */
export type RoomEntryPlan =
  /** enter the room — the session applies the relay snapshot / cache seed */
  | { action: "enter" }
  /**
   * alive room + cache WITH offline edits → three-way merge already resolved
   * (base/ours/theirs via mergeScene, 061 §3). `resets` feeds the amber reset
   * notice ("N local edits conflicted — the online version was kept").
   */
  | { action: "merge"; scene: Element[]; resets: ResetRecord[] }
  /** dead room + no cache → the seed prompt (gallery / blank), 054 Q7 */
  | { action: "seed-prompt" };

export interface RoomEntryInput {
  roomStatus: RoomStatus;
  /** the room's session cache — undefined when nothing was ever staged */
  cached: CollabSession | undefined;
  /**
   * relay snapshot elements when the room is alive AND has one; null when the
   * room is dead or the snapshot is unavailable (053 round 3: relay snapshot
   * wins / cache seeds / seed prompt).
   */
  snapshot: readonly Element[] | null;
}

/**
 * 061 §3 (amends 053 round 3 rule A). Single code path for re-activation:
 *
 *   alive + snapshot, no cache          → enter (snapshot loads on connect)
 *   alive + snapshot, pure cache        → enter (snapshot wins, cache overwritten)
 *   alive + snapshot, offline edits     → merge (three-way, online wins on tie)
 *   dead + cache                        → enter (the cache seeds the room)
 *   dead + no cache                     → seed prompt (gallery / blank)
 *
 * "Pure cache" = base scene null (nothing ever synced — e.g. a staged blank/
 * gallery seed that lost the first-seed race) or the edited scene is identical
 * to the base scene (no offline edits since the last sync). Offline edits =
 * base present and different from edited.
 *
 * The join/create screens (043) drive this with `snapshot: null` (no session
 * yet); the room screen (044) drives it with the real welcome snapshot.
 */
export function planRoomEntry({ roomStatus, cached, snapshot }: RoomEntryInput): RoomEntryPlan {
  if (roomStatus === "alive" && snapshot !== null) {
    if (cached === undefined) return { action: "enter" };
    if (cached.base === null || scenesEqual(cached.edited, cached.base)) {
      return { action: "enter" }; // pure cache — snapshot wins (053 rule A)
    }
    const { scene, resets } = mergeScene({
      base: cached.base.elements as Element[],
      ours: cached.edited.elements as Element[],
      theirs: snapshot,
    });
    return { action: "merge", scene, resets };
  }
  // Dead room (or alive-but-empty): cache seeds (B) / seed prompt (C).
  if (cached !== undefined) return { action: "enter" };
  return { action: "seed-prompt" };
}

/** The staged scene for "Start blank" — an empty canvas is a first seed too. */
export const EMPTY_SEED_SCENE: CollabScene = { elements: [], appState: {} };

/** Deep scene equality (canonical JSON, key order irrelevant — merge.ts semantics). */
function scenesEqual(a: CollabScene, b: CollabScene): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined || typeof v === "function") continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/* ------------------------------------------------------------------ */
/* the seed prompt (054 Q7: silent about room death, first seed wins)   */
/* ------------------------------------------------------------------ */

interface SeedPromptProps {
  /**
   * Optional room label — shown above the note (create flow passes the room
   * name; join/re-activation omit it).
   */
  roomLabel?: string;
  /** Primary action: open the gallery picker (053 galleryPicker screen). */
  onLoadFromGallery?: () => void;
  /** Ghost action: stage an empty canvas and enter the room. */
  onStartBlank: () => void;
  /** Ghost back (parent's previous step) when the parent wants one. */
  onBack?: () => void;
}

/**
 * Seed prompt for empty/dead rooms (053 seedPrompt / 054 Q7 — copy locked).
 * "This room is empty" — deliberately SILENT about room death (hibernation is
 * never explained); "whoever seeds first sets everyone's starting point".
 * The picker is a separate step (SeedGalleryPicker); the actual seed broadcast
 * belongs to the session hook (044) — this component only stages the choice
 * via the session cache and hands the navigation to the parent.
 */
export function SeedPrompt({ roomLabel, onLoadFromGallery, onStartBlank, onBack }: SeedPromptProps) {
  const [t] = useTranslation();
  return (
    <div data-testid="collab-seed-prompt" className="space-y-3">
      <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-500/40 dark:bg-blue-500/10">
        <div className="font-semibold">{t("CollabSeedTitle")}</div>
        {roomLabel && <div className="mt-0.5 text-xs text-muted-foreground">{roomLabel}</div>}
        <p className="mt-1 text-xs text-blue-700/80 dark:text-blue-400/80">{t("CollabSeedBody")}</p>
      </div>
      {onLoadFromGallery && (
        <Button
          data-testid="collab-seed-gallery"
          className="w-full"
          onClick={onLoadFromGallery}
        >
          {t("CollabSeedLoadGallery")}
        </Button>
      )}
      <Button
        data-testid="collab-seed-blank"
        variant="ghost"
        className="w-full"
        onClick={onStartBlank}
      >
        {t("CollabSeedStartBlank")}
      </Button>
      {onBack && (
        <Button data-testid="collab-seed-back" variant="ghost" className="w-full" onClick={onBack}>
          {t("CollabBack")}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* gallery picker (053 galleryPicker screen — compact B-lite list)      */
/* ------------------------------------------------------------------ */

interface SeedGalleryPickerProps {
  /** The chosen canvas scene (elements/appState/files parsed from the store). */
  onPick: (scene: CollabScene) => void;
  /** Back to the seed prompt. */
  onBack: () => void;
}

/**
 * Compact "seed from my Gallery" picker (053 galleryPicker): flat list of the
 * gallery's canvases (most recently updated first — the gallery store's order),
 * each with name + updated date. Seeding leaves the original gallery canvas
 * untouched (053 bridge point) — the room holds an independent snapshot, so the
 * chosen drawing is COPIED into the staged session cache, never moved.
 */
export function SeedGalleryPicker({ onPick, onBack }: SeedGalleryPickerProps) {
  const [t] = useTranslation();
  const [drawings, setDrawings] = useState<Array<{ id: string; name: string; updatedAt: number }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getDrawings().then((list) => {
      if (cancelled) return;
      setDrawings(list);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = async (id: string) => {
    setPicking(true);
    try {
      const full = await getDrawingFullData(id);
      const scene: CollabScene = {
        elements: JSON.parse(full.elements),
        appState: JSON.parse(full.appState),
        ...(full.files ? { files: JSON.parse(full.files) } : {}),
      };
      onPick(scene);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div data-testid="collab-seed-picker" className="space-y-3">
      <h1 className="text-lg font-semibold tracking-tight">{t("CollabSeedPickerTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("CollabSeedPickerIntro")}</p>

      {loaded && drawings.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          {t("CollabSeedNoDrawings")}
        </div>
      )}

      <div className="space-y-2">
        {drawings.map((d) => (
          <button
            key={d.id}
            data-testid={`collab-seed-pick-${d.id}`}
            type="button"
            onClick={() => void handlePick(d.id)}
            disabled={picking}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-card p-3 text-left text-sm shadow-xs transition-colors hover:border-primary disabled:opacity-50"
          >
            <span className="min-w-0 truncate font-medium">{d.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(d.updatedAt).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>

      <Button data-testid="collab-seed-picker-back" variant="ghost" className="w-full" onClick={onBack}>
        {t("CollabBack")}
      </Button>
    </div>
  );
}
