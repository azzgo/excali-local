/**
 * use-collab-session — the room session hook (Wayfinder 053 sessionLive /
 * 055 presence / 061 re-activation + conn dot; task 044).
 *
 * Owns the CollabClient lifecycle for one `#room/<shareId>` session:
 *
 * - **Identity (mint-once).** profileId = install uuid, minted once per
 *   profile and persisted (use-agent-bridge pattern). The member Ed25519
 *   keypair (057 §3 hello `key`) is REUSED from the stored server config's
 *   `member` field when 048's Options already minted it, otherwise minted
 *   here and stored with the collab identity record.
 * - **Connect.** Builds CollabClientOptions (hello + 057 §3 admit signature
 *   via collab-core signHello; baseSecret = roomSecret for private rooms /
 *   org ck for team rooms — 057 §1 symmetry rule) and dials.
 * - **Re-activation (061 §3, amends 053 rule A).** On mount the cached
 *   session (collab-core loadSession, edited + base scenes) paints the
 *   canvas immediately (local-first). When the relay snapshot arrives:
 *   offline edits (base present and different from edited) → three-way
 *   mergeScene, apply, stash the reset list (046/047 render the amber
 *   notice), rebroadcast the merged scene; pure cache / no cache → snapshot
 *   wins. Dead/empty room + cache → the cache auto-seeds (rule B); dead +
 *   no cache → seed prompt (rule C).
 * - **Local edits.** Excalidraw onChange → 100ms-throttled full-scene
 *   broadcast (client.sendScene's trailing-edge throttle) + debounced
 *   saveSession(edited) to the persistent cache; base = last synced scene.
 * - **Presence.** onPeer → roster (self + peers, 055 dots); onPointer →
 *   collaborators map fed to updateScene (055 native cursor rendering).
 * - **saveToGallery** writes the current canvas to the gallery (061: local
 *   scene, works offline; explicit save only, no autosave indicator).
 * - **leave()** closes the client and drops the session cache (053: this
 *   room is ephemeral — explicit-save discipline; the gallery copy survives
 *   a Save & leave).
 * - **Background resume.** See use-background-resume.ts for the page-level
 *   stale-socket recovery policy; this hook supplies its current client.
 *
 * Seams for later tasks: `conn` + `reconnect` + `lastError` feed the conn
 * dot / banners (046 owns the full health copy), `resets` feeds the amber
 * reset notice (047), `emptyRoom` gates the seed prompt (043's component
 * replaces the inline minimal prompt).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CollabClient,
  MEMBER_NAME_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  b64urlToBytes,
  buildRoomUrl,
  clearSession,
  deriveColor,
  loadSession,
  mergeScene,
  saveSession,
  seedToPkcs8,
  signHello,
} from "collab-core";
import type {
  CollabClientState,
  CollabError,
  CollabScene,
  Element as MergeElement,
  FileHydrator,
  HelloPayload,
  IncomingPointer,
  IncomingScene,
  Member,
  RoomInvite,
  WelcomePayload,
  WsFactory,
} from "collab-core";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, DataURL, Zoom } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useThumbnail } from "@/features/gallery/hooks/use-thumbnail";
import { patchRoomMyName, patchRoomName, saveDrawing } from "@/features/editor/utils/indexdb";
import { resolveIdentity, type CollabIdentity, type ServerConfig } from "./storage";
export type { CollabIdentity } from "./storage";
import type { LabelMode } from "./labels";
import { createRoomFileHydrator, fileIdsInRect, uploadNewLocalFiles, visibleSceneRect } from "./use-collab-files";
import { useBackgroundResume } from "./use-background-resume";
import { debounce } from "radash";
import { toast } from "sonner";
import i18n from "i18next";

/* ------------------------------------------------------------------ */
/* types                                                                */
/* ------------------------------------------------------------------ */

/** Room facts the chrome + hello need. The screen resolves these from the
 * stored room entry (048) before mounting the session. */
export interface CollabRoomMeta {
  /** room label — defaults to the short shareId when no entry is stored */
  label: string;
  /**
   * label provenance (ADR 0004): "named" labels (create-time or mirrored from
   * the relay) may be PUSHED as the room name when the relay has none; "auto"
   * fallbacks never are.
   */
  labelKind: "named" | "auto";
  tier: "team" | "private";
  /** present only for tier "private" (the invite's per-room key, 050 §2) */
  roomSecret?: string;
  fp?: string;
  /** per-room display name (060): a one-time COPY of the profile default at
   * room entry. Absent → the session falls back to the profile default.
   */
  myName?: string;
  /** the room invite payload for copy-invite in the chrome (054) */
  invite: RoomInvite;
}

/** One roster dot (055): color dots only in the chrome; hover pops the
 * name + short id; the self dot is outlined. */
export interface RosterMember {
  profileId: string;
  name: string;
  /** hsl() hue — deriveColor(profileId), the 055 native rule */
  color: string;
  connId: string;
  self: boolean;
}

/** Per-recovery reset notice (061 §3): N local edits conflicted — the online
 * version was kept. 046/047 render + dismiss this; `at` keys one notice. */
export interface CollabResetNotice {
  count: number;
  ids: string[];
  at: number;
  /** 061: conflict breakdown — edit-edit/edit-vs-delete vs delete-vs-edit. */
  editN: number;
  delN: number;
}

export interface UseCollabSessionOptions {
  shareId: string;
  server: ServerConfig | null;
  room: CollabRoomMeta | null;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** 055 presence label mode — quiet omits `username` from the
   * collaborators map (local rendering only, zero wire change). */
  labelMode?: LabelMode;
  /** test/override seam: skip identity minting + storage */
  identity?: CollabIdentity;
  /** test seam: inject a WebSocket factory (collab-core transport) */
  wsFactory?: WsFactory;
}

export interface CollabSessionHandle {
  /** identity resolved + client constructed (else null — boot state) */
  ready: boolean;
  /** true while the session is CONNECTED — the 056 Q6 propagation-banner
   * gate (a config change under a live session raises the banner instead
   * of re-dialing; see the admission freeze below). */
  live: boolean;
  /** conn dot state (061 §1 vocabulary; 046 refines the full health copy) */
  conn: CollabClientState;
  /** last scheduled reconnect — rides the conn-dot tooltip (061 §1) */
  reconnect: { attempt: number; delayMs: number } | null;
  /** last wire/client error (fatal → 046/047 stale.admit / stale.gcm banners) */
  lastError: CollabError | null;
  /** 047: the session cache's updatedAt — the re-entry card's
   * "Last synced {time}" footer (061 Q4). null when nothing is cached. */
  lastSyncedAt: number | null;
  /** welcome said the relay has a snapshot (null before the first welcome) */
  snapshotAvailable: boolean | null;
  /** welcome said the room is empty — seed prompt position (053/061 C) */
  emptyRoom: boolean;
  /** roster — self first, then peers (055 dots; 045 builds the feed on this) */
  peers: RosterMember[];
  /** cached offline edits existed at connect (061 §3 — merge path taken) */
  hadOfflineEdits: boolean;
  /** per-recovery reset notice — 047 renders/dismisses */
  resets: CollabResetNotice | null;
  /** explicit re-dial (061 Q4 retry — 046/047 card) */
  connect: () => void;
  /** close the client + drop the session cache (053 leave modal) */
  leave: () => void;
  /** empty-room first seed with the current canvas (043 prompt / 061 rule B) */
  seed: () => void;
  /**
   * ADR 0004: the current SHARED room name — welcome.roomName or the latest
   * rename broadcast; null until the relay states one (the chrome then falls
   * back to the local label).
   */
  roomName: string | null;
  /** ADR 0004: offer a new shared room name (any member may rename, LWW).
   *  Returns true when the name was accepted (trimmed, non-empty, ≤ 100). */
  rename: (name: string) => boolean;
  /**
   * ADR 0006: the CURRENT display name of MY roster entry (the per-room
   * copy / latest in-room rename). null before the first welcome — the
   * chrome modal prefills from this, never the identity default.
   */
  selfName: string | null;
  /**
   * ADR 0006: rename MY display name in this room. Client-side guard
   * (trimmed, non-empty, ≤ 40); on success sends the member-name offer,
   * updates the own roster entry + collaborator chip, and persists myName
   * to the rooms entry. Returns true on success, false on invalid.
   */
  renameSelf: (name: string) => boolean;
  /** write the current canvas to the gallery (061: offline-safe, explicit) */
  saveToGallery: () => Promise<boolean>;

  /** Excalidraw onChange wiring — throttle + cache (049 §5) */
  onLocalChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void;
  /** Excalidraw onPointerUpdate — own-cursor broadcast (055), trailing-edge
   * throttled here (~1 frame; collab-core's sendPointer itself is immediate).
   * The local cursor is never rendered as a collaborator (055). */
  onLocalPointer: (payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "up" | "down";
  }) => void;
  /** 052: fileIds the relay answered FILE_NOT_FOUND for — the native
   *  missing-image placeholder renders; the single automatic retry lives
   *  inside the hydrator (051 §4). */
  missingFileIds: ReadonlySet<string>;
  /** 052: Excalidraw onScrollChange wiring — debounced lazy hydration of
   *  image refs that enter the viewport (051 §4). */
  onLocalViewportChange: (scrollX: number, scrollY: number, zoom: Zoom) => void;
}

/** Deep scene equality (canonical JSON, key order irrelevant — merge.ts
 * semantics): "offline edits" = edited differs from base. */
function scenesEqual(a: CollabScene, b: CollabScene): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Equality for wire scenes. AppState is deliberately excluded: the relay
 * transports elements only, so local viewport/UI changes must not keep a
 * session marked dirty forever. */
function elementsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
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

function toRosterMember(member: Member, self: boolean): RosterMember {
  return {
    profileId: member.profileId,
    name: member.name,
    color: deriveColor(member.profileId),
    connId: member.connId,
    self,
  };
}

/** Roster invariant (055): at most ONE entry per profileId. The relay
 * roster can legitimately hold the same profile TWICE around a background
 * resume — the old half-open connection lingers beside the fresh one —
 * and a fresh welcome echoes both. Keep the LAST entry per profileId
 * (relay roster order is join order, so the fresh connId is last). */
function dedupeMembersByProfile(members: Member[]): Member[] {
  const byProfile = new Map<string, Member>();
  for (const m of members) byProfile.set(m.profileId, m); // last wins
  return [...byProfile.values()];
}

/** Client-callback bundle — typed from the collab-core wire shapes so the
 * hook can build the client inside its session effect. */
export interface CollabSessionCallbacks {
  onConn: (state: CollabClientState) => void;
  onReconnect: (info: { attempt: number; delayMs: number }) => void;
  onError: (error: CollabError) => void;
  onWelcome: (welcome: WelcomePayload) => void;
  onSeedOffer: () => void;
  onPeer: (peer: { kind: "join" | "leave"; member?: Member }) => void;
  onPointer: (pointer: IncomingPointer) => void;
  onScene: (scene: IncomingScene) => void;
  /** ADR 0004: relay-stamped room-rename broadcast */
  onRoomName: (info: { name: string; from: string }) => void;
  /** ADR 0006: relay-stamped member-name broadcast (peer renamed self) */
  onMemberName: (info: { name: string; from: string }) => void;
}

/* ------------------------------------------------------------------ */
/* the hook                                                             */
/* ------------------------------------------------------------------ */

export function useCollabSession({
  shareId,
  server,
  room,
  excalidrawAPI,
  identity: identityOverride,
  wsFactory,
  labelMode = "full",
}: UseCollabSessionOptions): CollabSessionHandle {
  const [identity, setIdentity] = useState<CollabIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [conn, setConn] = useState<CollabClientState>("idle");
  const [reconnect, setReconnect] = useState<{
    attempt: number;
    delayMs: number;
  } | null>(null);
  const [lastError, setLastError] = useState<CollabError | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [snapshotAvailable, setSnapshotAvailable] = useState<boolean | null>(null);
  const [emptyRoom, setEmptyRoom] = useState(false);
  const [peers, setPeers] = useState<RosterMember[]>([]);
  const [hadOfflineEdits, setHadOfflineEdits] = useState(false);
  const [resets, setResets] = useState<CollabResetNotice | null>(null);
  const [missingFileIds, setMissingFileIds] = useState<ReadonlySet<string>>(new Set());
  /** ADR 0004: the current SHARED room name (from welcome / rename broadcasts).
   *  null until the relay states one — the chrome falls back to the local label.
   *  The committed wire is still plaintext (058 envelope is future work), so the
   *  relay sees the name exactly like it sees scene payloads — no new leak class.
   */
  const [roomName, setRoomName] = useState<string | null>(null);

  // --- 056 Q6: admission snapshot ------------------------------------
  // A config change under a live session must NEVER re-dial (no auto-
  // reconnect, no auto-close): the session keeps running on the admission
  // it booted with, local edits keep working on that snapshot, and the
  // amber banner + manual Reload is the only path to the new config.
  // `server` is deliberately NOT a session-effect dep — it only feeds this
  // freeze, which is set once at first boot.
  const [admission, setAdmission] = useState<ServerConfig | null>(null);
  useEffect(() => {
    if (admission === null && server !== null) setAdmission(server);
  }, [admission, server]);

  const { generateThumbnail } = useThumbnail();

  // --- refs (stable closures for client callbacks) -------------------
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = excalidrawAPI;
  const labelModeRef = useRef<LabelMode>("full");
  const roomRef = useRef(room);
  roomRef.current = room;
  /**
   * ADR 0004: the current shared room name mirror — ref twin of `roomName` so
   * the client callbacks (built once in the session effect) can read it.
   */
  const roomNameRef = useRef<string | null>(null);
  /** The local label that may be PUSHED as the room name: set when the stored
   *  entry's labelKind is "named" (create-time or a previous rename/mirror),
   *  updated on every mirror so a reconnect re-pushes the latest known name.
   */
  const namedLabelRef = useRef<string | null>(null);
  const clientRef = useRef<CollabClient | null>(null);
  /** 052: the room FileHydrator (created once the client exists; disposed
   *  on leave/unmount — pending hydrates resolve not-found on teardown). */
  const hydratorRef = useRef<FileHydrator | null>(null);
  /** 052: fileIds the relay answered FILE_NOT_FOUND for — placeholder state. */
  const missingRef = useRef<Set<string>>(new Set());
  const peersRef = useRef<RosterMember[]>([]);
  const collaboratorsRef = useRef<Map<SocketId, Collaborator>>(new Map());
  const connIdToProfileRef = useRef<Map<string, string>>(new Map());
  const seqRef = useRef(0);
  const firstSceneRef = useRef(false);
  /** ADR 0007: latched by `onReconnect`; the next single scene is the reconciliation snapshot. */
  const midReconnectRef = useRef(false);
  /** Echo-guard triad: timing, remote-content, and established-content markers
   * cover synchronous and delayed updateScene echoes; see onLocalChange. */
  const applyingRemoteRef = useRef(false);
  const lastRemoteSceneRef = useRef<string | null>(null);
  const knownSceneJsonRef = useRef<string | null>(null);
  /** own-pointer broadcast throttle (055 — latest wins, one per ~frame) */
  const pointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPointerRef = useRef<{
    x: number;
    y: number;
    tool: "pointer" | "laser";
    button?: "up" | "down";
  } | null>(null);
  /** cached session at connect — the 061 §3 merge inputs */
  const pendingMergeRef = useRef<{
    base: CollabScene | null;
    edited: CollabScene;
  } | null>(null);
  /** last synced scene — the three-way merge base (061) */
  const baseSceneRef = useRef<CollabScene | null>(null);
  /** Last sequence accepted from each relay source. Live scenes are keyed by
   * relay connId; served snapshots (which intentionally have no `from`) use
   * one separate source. This prevents an older frame from the same sender,
   * or an out-of-order decrypt, from replacing a newer local scene. */
  const lastAppliedSeqRef = useRef<Map<string, number>>(new Map());
  /** Scene at session boot, used to recognize edits made before the first
   * relay snapshot arrives. */
  const localBaselineRef = useRef<CollabScene | null>(null);
  /** Latest scene reported by Excalidraw as a genuine local edit. */
  const localSceneRef = useRef<CollabScene | null>(null);
  const localDirtyRef = useRef(false);
  /** A local edit made before the first remote scene must not be discarded by
   * the initial snapshot; handleFirstScene merges it against the boot scene. */
  const pendingLocalSceneRef = useRef<CollabScene | null>(null);

  /** All programmatic api.updateScene calls funnel through this timing lane;
   * content lanes above handle echoes that arrive after the microtask. */
  const programmaticUpdate = useCallback(
    (update: Parameters<ExcalidrawImperativeAPI["updateScene"]>[0]) => {
      const api = apiRef.current;
      if (api === null) return;
      applyingRemoteRef.current = true;
      api.updateScene(update);
      queueMicrotask(() => {
        applyingRemoteRef.current = false;
      });
    },
    [],
  );

  const applyScene = useCallback(
    (elements: readonly unknown[]) => {
      const api = apiRef.current;
      if (api === null) return;
      // Content echo guard: remember what we are applying BEFORE updateScene so
      // any resulting onChange (whenever it fires) can be recognized as an echo.
      lastRemoteSceneRef.current = JSON.stringify(elements);
      // Pin the generalized content marker in ALL paths — including the
      // anti-flicker skip below: the wire content IS the canvas content, so
      // an echo of either the apply or the skip must be a no-op.
      knownSceneJsonRef.current = lastRemoteSceneRef.current;
      // Anti-flicker: applying a scene identical to the live one is a no-op
      // (skips a pointless full re-render of unchanged elements).
      if (lastRemoteSceneRef.current === JSON.stringify(api.getSceneElements())) {
        return;
      }
      programmaticUpdate({
        elements: elements as ExcalidrawElement[],
        collaborators: collaboratorsRef.current,
        captureUpdate: CaptureUpdateAction.NEVER, // ADR/049 §5: no undo entries
      });
    },
    [programmaticUpdate],
  );

  // --- 052 file sync --------------------------------------------------
  const addMissingFile = useCallback((fileId: string) => {
    if (missingRef.current.has(fileId)) return;
    const next = new Set(missingRef.current);
    next.add(fileId);
    missingRef.current = next;
    setMissingFileIds(next);
  }, []);

  const removeMissingFile = useCallback((fileId: string) => {
    if (!missingRef.current.has(fileId)) return;
    const next = new Set(missingRef.current);
    next.delete(fileId);
    missingRef.current = next;
    setMissingFileIds(next);
  }, []);

  /** Tracked hydrate: a FILE_NOT_FOUND resolution lands in missingFileIds
   *  (placeholder state, 051 §4); the automatic retry's success arrives via
   *  onFileReady, which clears it. */
  const hydrateTracked = useCallback(
    (fileId: string) => {
      const hydrator = hydratorRef.current;
      if (hydrator === null) return;
      void hydrator.hydrate(fileId).then((result) => {
        if (result.status === "not-found") addMissingFile(fileId);
      });
    },
    [addMissingFile],
  );

  /** Prefetch every known-uncached fileId (051 §4 scene-load policy) — the
   *  page-side tracked equivalent of hydrator.hydrateMissing(). */
  const prefetchMissingFiles = useCallback(() => {
    const hydrator = hydratorRef.current;
    if (hydrator === null) return;
    for (const fileId of hydrator.knownFileIds()) {
      if (hydrator.needsFile(fileId)) void hydrateTracked(fileId);
    }
  }, [hydrateTracked]);

  /** Lazy viewport scan (051 §4: hydrate when an element enters view).
   *  `scroll` carries the onScrollChange values (the patched tgz has
   *  onScrollChange, not onViewportChange); null → read the live viewport
   *  from the imperative API (post-apply scans). When the geometry is
   *  unavailable (stub API / early boot) it degrades to
   *  prefetchMissingFiles. Width/height always come from getAppState. */
  const scanViewportFiles = useCallback(
    (scroll: { scrollX: number; scrollY: number; zoomValue: number } | null) => {
      const hydrator = hydratorRef.current;
      const api = apiRef.current;
      if (hydrator === null || api === null) return;
      const appState = api.getAppState() as {
        scrollX?: unknown;
        scrollY?: unknown;
        zoom?: { value?: unknown } | null;
        width?: unknown;
        height?: unknown;
      };
      const zoomValue = scroll?.zoomValue ?? appState.zoom?.value;
      const scrollX = scroll?.scrollX ?? appState.scrollX;
      const scrollY = scroll?.scrollY ?? appState.scrollY;
      if (
        typeof scrollX !== "number" ||
        typeof scrollY !== "number" ||
        typeof zoomValue !== "number" ||
        zoomValue <= 0 ||
        typeof appState.width !== "number" ||
        typeof appState.height !== "number"
      ) {
        prefetchMissingFiles();
        return;
      }
      const rect = visibleSceneRect(scrollX, scrollY, zoomValue, appState.width, appState.height);
      for (const fileId of fileIdsInRect(api.getSceneElements(), rect)) {
        if (hydrator.needsFile(fileId)) void hydrateTracked(fileId);
      }
    },
    [prefetchMissingFiles, hydrateTracked],
  );

  const debouncedViewportScan = useMemo(
    () => debounce({ delay: 120 }, scanViewportFiles),
    [scanViewportFiles],
  );

  /** Excalidraw onScrollChange wiring — the 052 "onViewportChange
   *  equivalent" in the patched tgz (scroll/zoom flow into the debounced
   *  scan; width/height are read fresh from the imperative API). */
  const onLocalViewportChange = useCallback(
    (scrollX: number, scrollY: number, zoom: Zoom) => {
      debouncedViewportScan({ scrollX, scrollY, zoomValue: zoom.value });
    },
    [debouncedViewportScan],
  );

  const updateCollaborators = useCallback(
    (map: Map<SocketId, Collaborator>) => {
      collaboratorsRef.current = map;
      const api = apiRef.current;
      if (api === null) return;
      // Echo-guard triad lane 3: do not re-pin content for appState-only updates.
      programmaticUpdate({
        collaborators: map,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [programmaticUpdate],
  );

  const rebuildCollaborators = useCallback(
    (roster: RosterMember[]) => {
      const map = new Map<SocketId, Collaborator>();
      for (const m of roster) {
        // Include self in the collaborators map so the UserList always shows
        // the current user's avatar (even when alone in the room). Self has
        // no pointer field, so the local cursor is never rendered as a
        // collaborator cursor (055 rule preserved).
        map.set(m.profileId as SocketId, {
          id: m.profileId,
          // 055 label mode: quiet omits username → no canvas name chip
          ...(labelModeRef.current === "full" ? { username: m.name } : {}),
          color: { background: m.color, stroke: m.color },
          socketId: m.profileId as SocketId,
        });
      }
      connIdToProfileRef.current = new Map(
        roster.filter((m) => !m.self).map((m) => [m.connId, m.profileId]),
      );
      updateCollaborators(map);
    },
    [updateCollaborators],
  );

  /** Save the working scene to the persistent cache (053/061). `base` is the
   * last synced scene — local edits never overwrite it. */
  const persistSession = useCallback(
    (edited: CollabScene) => {
      void saveSession(shareId, { edited, base: baseSceneRef.current });
    },
    [shareId],
  );

  /**
   * ADR 0004: mirror a shared room name into the local `rooms` entry (the
   * label degrades to a mirror of the room name) and surface it on the handle.
   * The stored entry keeps its pinned/invite fields — the label + labelKind are
   * the only fields that ever change here. Mirrored names are `"named"`
   * (pushable): if the room dies and is re-seeded, THIS name becomes the new
   * room name again under the push rule.
   */
  const applyRoomName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed === "" || trimmed.length > ROOM_NAME_MAX_LENGTH) return;
      roomNameRef.current = trimmed;
      namedLabelRef.current = trimmed;
      setRoomName(trimmed);
      // Narrow mirror write: only the label + labelKind fields ever change
      // here (pinned/lastJoined/invite must survive), and it happens in one
      // transaction so it can't race a concurrent saveRoomMeta (ADR 0004).
      void patchRoomName(shareId, trimmed).catch(() => {
        /* mirror is best-effort — the relay remains the source of truth */
      });
    },
    [shareId],
  );

  /** ADR 0004: offer a new shared room name — anyone may rename, LWW. The
   * local mirror updates immediately (the broadcast echo excludes the sender),
   * so the chrome shows the new name without waiting for the round trip.
   *
   * Offline note: `sendRoomName` is fire-and-forget over the live socket —
   * if the connection is down it is silently dropped, while `applyRoomName`
   * has already mirrored the rename here and marked it "named". On reconnect
   * the on-welcome push rule (ADR 0004) re-offers this un-acked name, so the
   * rename still lands on the relay — eventual consistency, no action needed.
   */
  const rename = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed === "" || trimmed.length > ROOM_NAME_MAX_LENGTH) return false;
      clientRef.current?.sendRoomName(trimmed);
      applyRoomName(trimmed);
      return true;
    },
    [applyRoomName],
  );

  /**
   * ADR 0006: rename MY display name in this room. Client-side guard
   * mirrors the relay's validation (trim, non-empty, ≤ 40) so a bad name
   * never reaches the wire. On success: send the member-name offer, update
   * the OWN roster entry + collaborator chip immediately (no waiting for
   * the broadcast echo, which excludes the sender), and persist myName to
   * the rooms entry via a narrow single-transaction write (label/pinned/
   * invite etc. survive). Returns true on success, false on invalid.
   */
  const renameSelf = useCallback(
    (name: string): boolean => {
      const trimmed = name.trim();
      if (trimmed === "" || trimmed.length > MEMBER_NAME_MAX_LENGTH) return false;
      clientRef.current?.sendMemberName(trimmed);
      // Update the own roster entry (exactly one self entry — the 055
      // invariant) and rebuild the collaborator chip with the new name.
      const current = peersRef.current;
      const selfIdx = current.findIndex((m) => m.self);
      if (selfIdx !== -1) {
        const next = [...current];
        next[selfIdx] = { ...next[selfIdx], name: trimmed };
        peersRef.current = next;
        setPeers(next);
        rebuildCollaborators(next);
      }
      // Persist myName (ADR 0006) — narrow partial write in ONE tx so a
      // concurrent saveRoomMeta can never clobber the other fields.
      void patchRoomMyName(shareId, trimmed).catch(() => {
        /* best-effort — the roster stays the live source of truth */
      });
      return true;
    },
    [shareId, rebuildCollaborators],
  );

  // Debounced cache write for local edits (100ms — mirrors the broadcast
  // throttle, 049 §5); remote applies persist immediately instead.
  const debouncedPersist = useMemo(
    () => debounce({ delay: 100 }, persistSession),
    [persistSession],
  );

  // --- identity (mint-once) -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void resolveIdentity(identityOverride).then((resolved) => {
      if (cancelled || resolved === null) return;
      setIdentity(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [identityOverride]);

  // --- the session: cache paint + connect (one path, 061 §3) ----------
  useEffect(() => {
    if (
      admission === null ||
      room === null ||
      identity === null ||
      excalidrawAPI === null
    ) {
      return;
    }
    // 060: the effective display name = the per-room copy when present,
    // else the profile default (identity.name). identity is non-null here.
    const effectiveName = room?.myName ?? identity.name;
    let disposed = false;
    void (async () => {
      const cached = await loadSession(shareId).catch(() => undefined);
      if (disposed) return;

      const bootElements = [...(apiRef.current?.getSceneElements() ?? [])];
      // Echo-guard baseline: pin the boot canvas content (including
      // deleted — the array onChange reports) so mount-time onChange
      // commits replaying the boot scene are recognized as no-ops and
      // never broadcast (e.g. the empty-canvas commit right after join).
      knownSceneJsonRef.current = JSON.stringify(
        apiRef.current?.getSceneElementsIncludingDeleted() ?? [],
      );
      localBaselineRef.current = { elements: bootElements, appState: {} };
      localSceneRef.current = { elements: bootElements, appState: {} };
      localDirtyRef.current = false;
      pendingLocalSceneRef.current = null;

      // ADR 0004 push-rule source: the stored label is pushable only when its
      // provenance is a real name (create-time or a previous rename/mirror).
      // Joining without an entry (bookmark) or with an "auto" fallback never pushes.
      namedLabelRef.current = room.labelKind === "named" ? room.label : null;
      roomNameRef.current = null;

      // Local-first: paint the cached edited scene before the relay answers.
      if (cached !== undefined) {
        pendingMergeRef.current = { base: cached.base, edited: cached.edited };
        baseSceneRef.current = cached.base;
        // The cached edited scene is the visible boot baseline. Any change
        // after this point is a real local edit and must survive the first
        // relay snapshot, even when cached.base is null (pure cache).
        localBaselineRef.current = {
          elements: [...cached.edited.elements],
          appState: cached.edited.appState,
        };
        localSceneRef.current = cached.edited;
        applyScene(cached.edited.elements);
        setLastSyncedAt(cached.updatedAt);
        const offlineEdits =
          cached.base !== null && !scenesEqual(cached.edited, cached.base);
        setHadOfflineEdits(offlineEdits);
      }

      const callbacks: CollabSessionCallbacks = {
        onConn: setConn,
        // ADR 0007: the next scene becomes the reconciliation snapshot.
        onReconnect: (info) => {
          midReconnectRef.current = true;
          setReconnect(info);
        },
        onError: (err) => setLastError(err),
        onWelcome: (welcome) => {
          // 061: a healthy welcome restarts the backoff ladder — the retry
          // hint from any previous gap is stale and must not linger next to
          // a green conn dot.
          setReconnect(null);
          setSnapshotAvailable(welcome.snapshotAvailable);
          // ADR 0004: mirror the shared room name (welcome carries it); when
          // the relay has NO name and this device holds a genuinely named
          // label, push it — first naming, and dead-room revival (the
          // re-seeder's name becomes the new room name).
          if (typeof welcome.roomName === "string") {
            applyRoomName(welcome.roomName);
          } else if (namedLabelRef.current !== null) {
            clientRef.current?.sendRoomName(namedLabelRef.current);
          }
          // 055 roster invariant: one entry per profileId — the relay can
          // hold a stale half-open connection beside the fresh one (see
          // dedupeMembersByProfile); dedupe BEFORE building the roster.
          const roster: RosterMember[] = [
            {
              profileId: identity.profileId,
              name: effectiveName,
              color: deriveColor(identity.profileId),
              connId: welcome.connId,
              self: true,
            },
            ...dedupeMembersByProfile(
              welcome.peers.filter((m) => m.profileId !== identity.profileId),
            ).map((m) => toRosterMember(m, false)),
          ];
          peersRef.current = roster;
          setPeers(roster);
          rebuildCollaborators(roster);
        },
        onSeedOffer: () => {
          // 061 rule B: a cached scene seeds the room automatically — no
          // prompt. Rule C (no cache) shows the seed prompt.
          if (pendingMergeRef.current !== null) {
            void seedCurrentCanvas();
          } else {
            setEmptyRoom(true);
          }
        },
        onPeer: (peer) => {
          const current = peersRef.current;
          if (peer.kind === "join" && peer.member !== undefined) {
            // Same profileId rejoining with a FRESH connId (background
            // resume / reconnect): REPLACE the entry — a stale entry keeps
            // the dead connId and every pointer from the new connection
            // would map to nothing (connIdToProfileRef, 055).
            const joined = toRosterMember(peer.member, false);
            const known = current.some(
              (m) => m.profileId === peer.member!.profileId,
            );
            const next = known
              ? current.map((m) =>
                  m.profileId === peer.member!.profileId ? joined : m,
                )
              : [...current, joined];
            peersRef.current = next;
            setPeers(next);
            rebuildCollaborators(next);
            return;
          }
          if (peer.kind === "leave") {
            // Evict ONLY the exact member instance (profileId AND connId):
            // after a background resume the peer's OLD connection's leave
            // can arrive after the NEW one joined — a profileId-only match
            // would evict the live rejoined member and kill their cursor
            // mapping on this page.
            const next = current.filter(
              (m) =>
                !(
                  m.profileId === peer.member?.profileId &&
                  m.connId === peer.member?.connId
                ),
            );
            if (next.length !== current.length) {
              peersRef.current = next;
              setPeers(next);
              rebuildCollaborators(next);
            }
          }
        },
        onRoomName: ({ name, from }) => {
          // ADR 0004: mirror the rename and toast it — attribution maps the
          // relay-stamped connId through the roster to a member name. No
          // history, no undo, no persistent renamedBy: late joiners see the
          // name, not its author.
          const trimmed = name.trim();
          if (trimmed === "" || trimmed.length > ROOM_NAME_MAX_LENGTH) return;
          applyRoomName(trimmed);
          const renamer = peersRef.current.find((m) => m.connId === from);
          // The relay excludes the sender from the broadcast, so `from` is a
          // peer — but a stale roster (self echo on reconnect) is dropped.
          if (renamer === undefined || renamer.self) return;
          toast(i18n.t("CollabRenamedRoom", { name: renamer.name, roomName: trimmed }));
        },
        onMemberName: ({ name, from }) => {
          // ADR 0006: a PEER renamed themselves. Apply live and silently (no
          // toast, no reconnect — the name chip just updates). The relay
          // excludes the sender, so `from` is a peer; drop own echoes and
          // stale connIds (unknown roster / pre-welcome) defensively.
          const trimmed = name.trim();
          if (trimmed === "" || trimmed.length > MEMBER_NAME_MAX_LENGTH) return;
          const current = peersRef.current;
          const idx = current.findIndex((m) => m.connId === from);
          if (idx === -1 || current[idx].self) return;
          const next = [...current];
          next[idx] = { ...next[idx], name: trimmed };
          peersRef.current = next;
          setPeers(next);
          rebuildCollaborators(next);
        },
        onPointer: (pointer) => {
          const profileId = connIdToProfileRef.current.get(pointer.from);
          if (profileId === undefined) return;
          const map = new Map(collaboratorsRef.current);
          const prev = map.get(profileId as SocketId) ?? {};
          map.set(profileId as SocketId, {
            ...prev,
            pointer: { x: pointer.x, y: pointer.y, tool: pointer.tool },
            ...(pointer.button !== undefined ? { button: pointer.button } : {}),
          });
          updateCollaborators(map);
        },
        onScene: (scene) => {
          const source = scene.from ?? "relay-snapshot";
          const previousSeq = lastAppliedSeqRef.current.get(source);
          const elements = scene.t === "seed" ? scene.scene : scene.elements;

          // ADR 0007: a post-reconnect reconciliation snapshot. The relay's seq resets on DO
          // eviction, so bypass the live seq gate once and reconcile instead.
          if (midReconnectRef.current) {
            midReconnectRef.current = false;
            reconcilePostReconnect(source, scene.seq, elements);
            return;
          }

          // A reconnect/decrypt race can deliver an older scene after a
          // newer one from the same relay source. Never let it replace the
          // newer canvas state. `seq` is per sender, so the gate is scoped
          // by `from` rather than comparing unrelated peers' counters.
          if (previousSeq !== undefined && scene.seq <= previousSeq) return;
          lastAppliedSeqRef.current.set(source, scene.seq);
          setSnapshotAvailable(true);
          // 058 §1.3: seed and scene are the SAME resync path for the
          // receiver — normalize the union.
          const isFirst = !firstSceneRef.current;
          firstSceneRef.current = true;
          seqRef.current = Math.max(seqRef.current, scene.seq);
          // 052: register referenced fileIds on EVERY apply (snapshot AND
          // live — 051 §1 scenes carry references only).
          hydratorRef.current?.observeElements(elements);
          if (isFirst) {
            handleFirstScene(scene, elements);
            // 052: scene-load prefetch (051 §4) — covers the merged scene
            // too (handleFirstScene observed ours-only refs).
            prefetchMissingFiles();
            return;
          }
          const synced: CollabScene = { elements: [...elements], appState: {} };
          // A local edit can be created before its first throttled scene
          // reaches the relay. If the relay now sends the exact last-synced
          // scene back, it is stale relative to the local canvas; applying it
          // would erase the in-progress first Pencil stroke.
          if (
            localDirtyRef.current &&
            baseSceneRef.current !== null &&
            elementsEqual(elements, baseSceneRef.current.elements)
          ) {
            return;
          }
          // live scene → apply; base := this scene (last synced).
          applyScene(elements);
          baseSceneRef.current = synced;
          localSceneRef.current = synced;
          localDirtyRef.current = false;
          persistSession(synced);
          // 052: a live apply may bring NEW image refs — hydrate the ones
          // currently in view (lazy on-demand, 051 §4).
          scanViewportFiles(null);
        }
      };

      try {
        const client = await buildClient({
          shareId,
          server: admission,
          room,
          identity,
          effectiveName,
          wsFactory,
          callbacks,
        });
        if (disposed) {
          client.close();
          return;
        }
        clientRef.current = client;
        setReady(true);
        // 052: the room FileHydrator — created BEFORE connect() so no
        // welcome/scene can beat it to the wire (onScene observes refs
        // through hydratorRef). Private rooms derive the 050 content key +
        // member signer here; FileConfigError degrades file sync off while
        // the session itself keeps running.
        let hydrator: FileHydrator | null = null;
        try {
          hydrator = await createRoomFileHydrator({
            client,
            room,
            shareId,
            identity,
            onFileReady: (file) => {
              // A blob arrived (first fetch or the 051 §4 automatic
              // retry) — feed it to the editor so the native placeholder
              // re-renders as the image. Fire-and-forget; the blob is
              // cached, so the onChange echo never re-uploads.
              removeMissingFile(file.fileId);
              const api = apiRef.current;
              if (api === null) return;
              api.addFiles([
                { id: file.fileId, mimeType: file.mimeType, dataURL: file.dataURL as DataURL, created: Date.now() },
              ]);
            },
            onError: (err) => {
              // Fetch-side failures (a GcmAuthError is the 054 stale-key
              // signal — 046/047 banner wiring is a later task).
              console.warn("[collab] file hydrate error:", err);
            },
          });
        } catch (err) {
          console.warn("[collab] file sync unavailable:", err);
        }
        if (disposed) {
          hydrator?.dispose();
          // A racing teardown (dep change / unmount / hot reload) closed the
          // client mid-boot — never leave clientRef pointing at a terminal
          // instance; the re-run effect owns the ref from here.
          clientRef.current = null;
          client.close();
          return;
        }
        hydratorRef.current = hydrator;
        if (hydrator !== null) {
          // Cache-paint / pre-existing scene: register refs + prefetch
          // (the relay snapshot's first apply runs the same path via
          // onScene — created-before-connect makes either arrival order
          // safe).
          hydrator.observeElements([...(apiRef.current?.getSceneElements() ?? [])]);
          prefetchMissingFiles();
        }
        client.connect();
      } catch (err) {
        // Admission cannot be constructed locally (bad org seed / missing
        // room key) — surface once; 046/047 render the banner.
        if (!disposed) {
          setLastError({
            code: "ADMISSION_INVALID",
            reason: err instanceof Error ? err.message : String(err),
            fatal: true,
          });
          setConn("rejected");
        }
      }
    })();
    return () => {
      disposed = true;
      clientRef.current?.close();
      clientRef.current = null;
      hydratorRef.current?.dispose();
      hydratorRef.current = null;
      missingRef.current = new Set();
      setMissingFileIds(new Set());
      if (pointerTimerRef.current !== null) {
        clearTimeout(pointerTimerRef.current);
        pointerTimerRef.current = null;
      }
      pendingPointerRef.current = null;
      firstSceneRef.current = false;
      midReconnectRef.current = false;
      lastAppliedSeqRef.current.clear();
      localBaselineRef.current = null;
      localSceneRef.current = null;
      localDirtyRef.current = false;
      pendingLocalSceneRef.current = null;
      knownSceneJsonRef.current = null;
      pendingMergeRef.current = null;
      roomNameRef.current = null;
      namedLabelRef.current = null;
      setRoomName(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admission, room, identity, excalidrawAPI, shareId]);

  useBackgroundResume(() => clientRef.current);

  /** Shared three-way merge for re-entry (ADR 0005) and mid-session reconnect (ADR 0007):
   * mergeScene → applyScene → reset notice → rebroadcast-if-divergent → persist. */
  const reconcileScene = useCallback(
    ({
      base,
      ours,
      theirs,
      appState,
    }: {
      base: readonly unknown[];
      ours: readonly unknown[];
      theirs: readonly unknown[];
      appState: unknown;
    }) => {
      // 061 §3: offline/local edits → three-way merge, online wins on conflicts;
      // local-only creates (including a first Pencil stroke) survive the snapshot.
      const merged = mergeScene({
        base: base as MergeElement[],
        ours: ours as MergeElement[],
        theirs: theirs as MergeElement[],
      });
      // 052: the merged scene may keep image refs unique to ours — register
      // them so the first-apply prefetch can hydrate them.
      hydratorRef.current?.observeElements(merged.scene);
      applyScene(merged.scene);
      if (merged.resets.length > 0) {
        setResets({
          count: merged.resets.length,
          ids: merged.resets.map((r) => r.id),
          at: Date.now(),
          editN: merged.resets.filter((r) => r.kind !== "delete-vs-edit").length,
          delN: merged.resets.filter((r) => r.kind === "delete-vs-edit").length,
        });
      }
      const mergedScene: CollabScene = { elements: merged.scene, appState };
      const synced: CollabScene = { elements: [...theirs], appState: {} };
      baseSceneRef.current = synced;
      localSceneRef.current = mergedScene;
      localDirtyRef.current = !elementsEqual(merged.scene, theirs);
      persistSession(mergedScene);
      // Only rebroadcast when the merged result differs from the online scene
      // (a local-only create survived); a redundant full-scene broadcast is the flash.
      if (localDirtyRef.current) {
        seqRef.current += 1;
        clientRef.current?.sendScene([...merged.scene], seqRef.current);
      }
    },
    [applyScene, persistSession],
  );

  /** ADR 0007: consume the one post-reconnect snapshot — merge if we had unsynced edits, else adopt silently. */
  const reconcilePostReconnect = useCallback(
    (source: string, seq: number, elements: readonly unknown[]) => {
      lastAppliedSeqRef.current.set(source, seq);
      setSnapshotAvailable(true);
      seqRef.current = Math.max(seqRef.current, seq);
      hydratorRef.current?.observeElements([...elements]);
      const base = baseSceneRef.current?.elements ?? [];
      const ours = localSceneRef.current?.elements ?? [];
      if (localDirtyRef.current) {
        reconcileScene({
          base,
          ours,
          theirs: elements,
          appState: localSceneRef.current?.appState ?? {},
        });
        return;
      }
      // No unsynced local edits → adopt the relay snapshot as-is (silent).
      applyScene(elements);
      const synced: CollabScene = { elements: [...elements], appState: {} };
      baseSceneRef.current = synced;
      localSceneRef.current = synced;
      localDirtyRef.current = false;
      persistSession(synced);
      scanViewportFiles(null);
    },
    [applyScene, persistSession, reconcileScene, scanViewportFiles],
  );

  const handleFirstScene = useCallback(
    (scene: IncomingScene, elements: readonly unknown[]) => {
      const pending = pendingMergeRef.current;
      const pendingLocal = pendingLocalSceneRef.current;
      // ADR 0005 re-entry rule — the merge decision is ONE expression,
      // `pendingLocal !== null && pending?.base !== null`, whose states encode
      // the full truth table:
      //   • no cached merge (pending null — `?.base` → undefined) → the first
      //     genuine pre-snapshot local stroke survives (there is no staged
      //     seed to contaminate the merge base);
      //   • pending.base non-null (synced before) → the established 061 §3
      //     three-way merge below, pre-snapshot first-stroke carve-out
      //     preserved;
      //   • pending.base === null (staged seed / pure cache) → the room is
      //     authoritative: snapshot applied as-is, no merge, no rebroadcast
      //     (053 rule A).
      // NOTE: the carve-out is narrowed to GENUINE pre-snapshot local strokes,
      // never to staged seeds (ADR 0005 Consequences) — but NOT to the
      // "synced before" branch alone: `pending?.base !== null` is also true
      // when `pending` is undefined (no cache), so an uncached joiner's real
      // first stroke still merges below (that is correct, do not "fix" it).
      const shouldMergeLocal = pendingLocal !== null && pending?.base !== null;
      const mergeBase = shouldMergeLocal
        ? pending?.base?.elements ??
          pending?.edited.elements ??
          localBaselineRef.current?.elements ??
          []
        : pending?.base?.elements ?? null;
      const mergeOurs = shouldMergeLocal
        ? pendingLocal.elements
        : pending?.edited.elements ?? null;
      if (mergeBase !== null && mergeOurs !== null) {
        // 061 §3: offline/local edits → three-way merge, online wins on conflicts;
        // local-only creates survive. Delegated to the shared reconcileScene helper.
        reconcileScene({
          base: mergeBase,
          ours: mergeOurs,
          theirs: elements,
          appState: pendingLocal?.appState ?? pending?.edited.appState ?? {},
        });
        pendingLocalSceneRef.current = null;
        pendingMergeRef.current = null;
        return;
      }
      // Never synced (base null) → relay snapshot wins as-is (053 rule A /
      // ADR 0005 branch 1): the staged seed is discarded silently, nothing
      // merges and nothing is rebroadcast.
      applyScene(elements);
      const synced: CollabScene = { elements: [...elements], appState: {} };
      baseSceneRef.current = synced;
      localSceneRef.current = synced;
      localDirtyRef.current = false;
      pendingLocalSceneRef.current = null;
      pendingMergeRef.current = null;
      persistSession(synced);
    },
    [applyScene, persistSession, reconcileScene],
  );

  /** Seed the room with the current canvas (first seed wins, 049 §2). */
  const seedCurrentCanvas = useCallback((): Promise<void> => {
    const api = apiRef.current;
    const client = clientRef.current;
    if (api === null || client === null) return Promise.resolve();
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    seqRef.current += 1;
    client.sendSeed([...elements] as unknown[], seqRef.current);
    // 052: the session cache stays refs-only — the gallery is the durable
    // blob record; the ephemeral room cache never stores dataURLs.
    const scene: CollabScene = { elements: [...elements] as unknown[], appState };
    baseSceneRef.current = scene;
    setEmptyRoom(false);
    persistSession(scene);
    return Promise.resolve();
  }, [persistSession]);

  // --- exposed actions ------------------------------------------------

  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  const leave = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    hydratorRef.current?.dispose();
    hydratorRef.current = null;
    missingRef.current = new Set();
    setMissingFileIds(new Set());
    setConn("idle");
    setPeers([]);
    peersRef.current = [];
    setEmptyRoom(false);
    setSnapshotAvailable(null);
    setLastSyncedAt(null);
    setReady(false);
    firstSceneRef.current = false;
    midReconnectRef.current = false;
    lastAppliedSeqRef.current.clear();
    localBaselineRef.current = null;
    localSceneRef.current = null;
    localDirtyRef.current = false;
    pendingLocalSceneRef.current = null;
    knownSceneJsonRef.current = null;
    pendingMergeRef.current = null;
    roomNameRef.current = null;
    namedLabelRef.current = null;
    setRoomName(null);
    void clearSession(shareId);
  }, [shareId]);

  const seed = useCallback(() => {
    void seedCurrentCanvas();
  }, [seedCurrentCanvas]);

  const saveToGallery = useCallback(async (): Promise<boolean> => {
    const api = apiRef.current;
    if (api === null) return false;
    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      let thumbnail = "";
      try {
        thumbnail = await generateThumbnail(elements, files);
      } catch {
        /* thumbnail is best-effort — the scene itself is the save */
      }
      const now = Date.now();
      const shortId = shareId.slice(0, 6);
      // ADR 0004: the shared room name (mirror) wins over the boot label.
      const label = roomNameRef.current ?? roomRef.current?.label ?? shortId;
      await saveDrawing({
        // Stable id per room — re-saving overwrites the same gallery entry
        // (explicit-save discipline, 061: gallery keeps blobs per 052).
        id: `room-${shareId}`,
        name: `${label} · ${shortId}`,
        elements: JSON.stringify(elements),
        appState: JSON.stringify(appState),
        files: JSON.stringify(files),
        thumbnail,
        collectionIds: [],
        createdAt: now,
        updatedAt: now,
      });
      return true;
    } catch {
      return false;
    }
  }, [shareId, generateThumbnail]);

  const onLocalChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      // Echo-guard triad: timing, remote-content, then established-content.
      if (applyingRemoteRef.current) return;
      const json = JSON.stringify(elements);
      if (json === lastRemoteSceneRef.current) return;
      if (json === knownSceneJsonRef.current) return;
      knownSceneJsonRef.current = json;
      const localScene: CollabScene = {
        elements: [...elements] as unknown[],
        appState,
      };
      localSceneRef.current = localScene;
      const dirtyBase = baseSceneRef.current ?? localBaselineRef.current;
      localDirtyRef.current =
        dirtyBase !== null && !elementsEqual(localScene.elements, dirtyBase.elements);
      if (!firstSceneRef.current && localDirtyRef.current) {
        pendingLocalSceneRef.current = localScene;
      }
      const client = clientRef.current;
      if (client !== null) {
        seqRef.current += 1;
        // client.sendScene throttles the full-scene broadcast (100ms trailing
        // edge, 049 §5) — the latest scene wins.
        client.sendScene([...elements] as unknown[], seqRef.current);
      }
      // 052: upload blobs newly inserted on THIS device (fire-and-forget;
      // FileTooLargeError and friends are warn'd inside, never thrown into
      // React). The element already carries the fileId ref — the scene
      // broadcast carries references only. Cached entries dedup, so
      // hydrated blobs (addFiles echo) never re-upload.
      const hydrator = hydratorRef.current;
      if (hydrator !== null && Object.keys(files).length > 0) {
        void uploadNewLocalFiles(hydrator, files);
      }
      // 052: the session cache stays refs-only — the gallery is the durable
      // blob record; the ephemeral room cache never stores dataURLs.
      debouncedPersist({ elements: [...elements] as unknown[], appState });
    },
    [debouncedPersist],
  );

  // --- presence label mode: rebuild the collaborators map on change ------
  useEffect(() => {
    labelModeRef.current = labelMode;
    rebuildCollaborators(peersRef.current);
  }, [labelMode, rebuildCollaborators]);

  /** Own-cursor broadcast (055): Excalidraw's onPointerUpdate → sendPointer.
   * Trailing-edge throttle (~1 frame, latest wins) — the wire send itself
   * is immediate (collab-core sendPointer). */
  const onLocalPointer = useCallback(
    (payload: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "up" | "down";
    }) => {
      pendingPointerRef.current = {
        x: payload.pointer.x,
        y: payload.pointer.y,
        tool: payload.pointer.tool,
        ...(payload.button !== undefined ? { button: payload.button } : {}),
      };
      if (pointerTimerRef.current !== null) return;
      pointerTimerRef.current = setTimeout(() => {
        pointerTimerRef.current = null;
        const pending = pendingPointerRef.current;
        pendingPointerRef.current = null;
        if (pending === null) return;
        clientRef.current?.sendPointer(
          pending.x,
          pending.y,
          pending.tool,
          pending.button,
        );
      }, 16);
    },
    [],
  );

  return {
    ready,
    live: ready && conn === "connected",
    conn,
    reconnect,
    lastError,
    lastSyncedAt,
    snapshotAvailable,
    emptyRoom,
    peers,
    hadOfflineEdits,
    resets,
    roomName,
    rename,
    // ADR 0006: the current self roster entry name (per-room) — null
    // before the first welcome; fall back to the boot effective name so the
    // chrome modal still has a prefill while the socket is opening.
    selfName: peers.find((p) => p.self)?.name ?? room?.myName ?? identity?.name ?? null,
    renameSelf,
    connect,
    leave,
    seed,
    saveToGallery,
    onLocalChange,
    onLocalPointer,
    missingFileIds,
    onLocalViewportChange,
  };
}

/* ------------------------------------------------------------------ */
/* client construction                                                  */
/* ------------------------------------------------------------------ */

interface BuildClientInput {
  shareId: string;
  server: ServerConfig;
  room: CollabRoomMeta;
  identity: CollabIdentity;
  /** 060 effective display name — per-room copy or the profile default */
  effectiveName: string;
  wsFactory?: WsFactory;
  callbacks: CollabSessionCallbacks;
}

/** Build the CollabClient for one room session. Throws when admission
 * cannot be constructed locally (bad org seed, missing private-room key) —
 * the caller surfaces it as a fatal client error. */
async function buildClient({
  shareId,
  server,
  room,
  identity,
  effectiveName,
  wsFactory,
  callbacks,
}: BuildClientInput): Promise<CollabClient> {
  // A private room without its per-room key is undecryptable (050 §2): the
  // 054 no-key state — fatal (046/047 stale.gcm-family banner).
  if (room.tier === "private" && room.roomSecret === undefined) {
    callbacks.onConn("rejected");
    callbacks.onError({
      code: "E2E_AUTH_FAILED",
      reason: "room key missing (private room without its invite)",
      fatal: true,
    });
    throw new Error("room key missing for private room");
  }

  const color = deriveColor(identity.profileId);
  const hello: HelloPayload = {
    profileId: identity.profileId,
    name: effectiveName,
    color: { background: color, stroke: color },
    privacy: room.tier,
    room: shareId,
    admit: { org: server.org, sig: "" },
    key: identity.pub,
  };
  // 057 §3: the org seed signs the canonical hello string.
  const orgKey = await crypto.subtle.importKey(
    "pkcs8",
    seedToPkcs8(b64urlToBytes(server.sk)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  hello.admit.sig = await signHello(hello, orgKey);

  return new CollabClient({
    url: buildRoomUrl(server.relay, shareId),
    wsFactory,
    profileId: identity.profileId,
    name: effectiveName,
    color: { background: color, stroke: color },
    privacy: room.tier,
    room: shareId,
    admit: hello.admit,
    key: identity.pub,
    // 057 §1 symmetry rule: roomSecret for private rooms, org ck for team.
    baseSecret: room.tier === "private" ? room.roomSecret : server.ck,
    onStateChange: callbacks.onConn,
    onReconnect: callbacks.onReconnect,
    onError: callbacks.onError,
    onWelcome: callbacks.onWelcome,
    onSeedOffer: callbacks.onSeedOffer,
    onPeer: callbacks.onPeer,
    onPointer: callbacks.onPointer,
    onScene: callbacks.onScene,
    onRoomName: callbacks.onRoomName,
    onMemberName: callbacks.onMemberName,
  });
}
