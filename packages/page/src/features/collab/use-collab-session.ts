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
 *
 * Seams for later tasks: `conn` + `reconnect` + `lastError` feed the conn
 * dot / banners (046 owns the full health copy), `resets` feeds the amber
 * reset notice (047), `emptyRoom` gates the seed prompt (043's component
 * replaces the inline minimal prompt).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CollabClient,
  b64urlToBytes,
  buildRoomUrl,
  bytesToB64url,
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
import { getBrowser } from "@/lib/utils";
import { useThumbnail } from "@/features/gallery/hooks/use-thumbnail";
import { saveDrawing } from "@/features/editor/utils/indexdb";
import { COLLAB_SERVER_CONFIG, type ServerConfig } from "./storage";
import type { LabelMode } from "./labels";
import { createRoomFileHydrator, fileIdsInRect, uploadNewLocalFiles, visibleSceneRect } from "./use-collab-files";
import { debounce } from "radash";

/* ------------------------------------------------------------------ */
/* identity (mint-once per profile)                                     */
/* ------------------------------------------------------------------ */

/** chrome.storage.local / localStorage key for the collab identity record. */
export const COLLAB_PROFILE_ID_KEY = "collabProfileId";

/** Mint-once collab identity: install uuid + display name + member keypair. */
export interface CollabIdentity {
  profileId: string;
  /** default display name — a stable short handle until a name setting exists */
  name: string;
  /** member Ed25519 seed, 32B b64url (the pub derives from it, 057 §3) */
  seed: string;
  /** member Ed25519 public key, 32B b64url — the hello `key` */
  pub: string;
}

function isCollabIdentity(value: unknown): value is CollabIdentity {
  const v = value as CollabIdentity | null;
  return (
    v !== null &&
    typeof v === "object" &&
    typeof v.profileId === "string" &&
    v.profileId !== "" &&
    typeof v.name === "string" &&
    typeof v.seed === "string" &&
    v.seed !== "" &&
    typeof v.pub === "string" &&
    v.pub !== ""
  );
}

/** Storage-area mirror of use-server-config: chrome.storage.local or the
 * webapp localStorage fallback (getBrowser() null — also the test path). */
async function storageGet(key: string): Promise<unknown> {
  const browser = getBrowser();
  if (browser?.storage?.local) {
    try {
      const result = await browser.storage.local.get(key);
      return result[key];
    } catch {
      return null;
    }
  }
  try {
    const raw = globalThis.localStorage?.getItem(key) ?? null;
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

async function storageSet(key: string, value: unknown): Promise<void> {
  const browser = getBrowser();
  if (browser?.storage?.local) {
    try {
      await browser.storage.local.set({ [key]: value });
    } catch {
      /* storage unavailable — identity degrades to per-session */
    }
    return;
  }
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** The raw stored server config (Options' CollabServerConfig shape) — the
 * page-side ServerConfig type drops the 048 `member` keypair, which we read
 * here to reuse instead of re-minting. */
async function readRawServerConfig(): Promise<Record<string, unknown> | null> {
  const browser = getBrowser();
  if (browser?.storage?.local) {
    try {
      const result = await browser.storage.local.get(COLLAB_SERVER_CONFIG);
      const raw = result[COLLAB_SERVER_CONFIG];
      return typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  try {
    const raw = globalThis.localStorage?.getItem(COLLAB_SERVER_CONFIG) ?? null;
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Mint a member Ed25519 keypair (057 §3) — seed + public key, b64url
 * (mirrors the Options-side mintMemberKeypair; WebCrypto Ed25519 on
 * Chrome 113+/Edge 113+/Firefox 129+, 057 runtime verification). */
async function mintMemberKeypair(): Promise<{ seed: string; pub: string }> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  // PKCS#8 for Ed25519 = fixed 16-byte DER prefix || seed (057 §1).
  return {
    seed: bytesToB64url(new Uint8Array(pkcs8).slice(16)),
    pub: bytesToB64url(new Uint8Array(raw)),
  };
}

/** Resolve (or mint-once + persist) the collab identity. Reuses the member
 * keypair already stored in the server config by 048's Options when present
 * (task 044: "check if 048 already stores member keys; if yes reuse"). */
async function resolveIdentity(
  override?: CollabIdentity,
): Promise<CollabIdentity | null> {
  if (override !== undefined) return override;
  try {
    const stored = await storageGet(COLLAB_PROFILE_ID_KEY);
    if (isCollabIdentity(stored)) return stored;

    // Reuse the 048 member keypair when the Options section minted one.
    const rawConfig = await readRawServerConfig();
    const member = rawConfig?.member as { seed?: unknown; pub?: unknown } | null;
    const seed = typeof member?.seed === "string" ? member.seed : "";
    const pub = typeof member?.pub === "string" ? member.pub : "";

    let keys: { seed: string; pub: string };
    if (seed !== "" && pub !== "") {
      keys = { seed, pub };
    } else {
      keys = await mintMemberKeypair();
    }

    const profileId = crypto.randomUUID();
    const identity: CollabIdentity = {
      profileId,
      name: profileId.slice(0, 4),
      ...keys,
    };
    await storageSet(COLLAB_PROFILE_ID_KEY, identity);
    return identity;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* types                                                                */
/* ------------------------------------------------------------------ */

/** Room facts the chrome + hello need. The screen resolves these from the
 * stored room entry (048) before mounting the session. */
export interface CollabRoomMeta {
  /** room label — defaults to the short shareId when no entry is stored */
  label: string;
  tier: "team" | "private";
  /** present only for tier "private" (the invite's per-room key, 050 §2) */
  roomSecret?: string;
  fp?: string;
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
  const applyingRemoteRef = useRef(false);
  /** Serialized elements of the last remote-applied scene — the content echo
   * guard. The timing guard above is NOT enough: updateScene's onChange can
   * fire after the clearing microtask (React render commit), and a rebroadcast
   * of a just-applied REMOTE scene (seq+1) defeats the relay's byte-dup
   * suppression and ping-pongs stale scenes between members — visually:
   * mid-drag shapes snapping back to their start point, typed text
   * backspacing. Content comparison is timing-proof. */
  const lastRemoteSceneRef = useRef<string | null>(null);
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

  const applyScene = useCallback((elements: readonly unknown[]) => {
    const api = apiRef.current;
    if (api === null) return;
    // Content echo guard: remember what we are applying BEFORE updateScene so
    // any resulting onChange (whenever it fires) can be recognized as an echo.
    lastRemoteSceneRef.current = JSON.stringify(elements);
    // Anti-flicker: applying a scene identical to the live one is a no-op
    // (skips a pointless full re-render of unchanged elements).
    if (lastRemoteSceneRef.current === JSON.stringify(api.getSceneElements())) {
      return;
    }
    applyingRemoteRef.current = true;
    api.updateScene(
      {
        elements: elements as ExcalidrawElement[],
        collaborators: collaboratorsRef.current,
        captureUpdate: CaptureUpdateAction.NEVER, // ADR/049 §5: no undo entries
      },
    );
    queueMicrotask(() => {
      applyingRemoteRef.current = false;
    });
  }, []);

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
      applyingRemoteRef.current = true;
      api.updateScene({
        collaborators: map,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      queueMicrotask(() => {
        applyingRemoteRef.current = false;
      });
    },
    [],
  );

  const rebuildCollaborators = useCallback(
    (roster: RosterMember[]) => {
      const map = new Map<SocketId, Collaborator>();
      for (const m of roster) {
        if (m.self) continue; // 055: the local cursor is never a collaborator
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
    let disposed = false;
    void (async () => {
      const cached = await loadSession(shareId).catch(() => undefined);
      if (disposed) return;

      const bootElements = [...(apiRef.current?.getSceneElements() ?? [])];
      localBaselineRef.current = { elements: bootElements, appState: {} };
      localSceneRef.current = { elements: bootElements, appState: {} };
      localDirtyRef.current = false;
      pendingLocalSceneRef.current = null;

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
        onReconnect: (info) => setReconnect(info),
        onError: (err) => setLastError(err),
        onWelcome: (welcome) => {
          setSnapshotAvailable(welcome.snapshotAvailable);
          const roster: RosterMember[] = [
            {
              profileId: identity.profileId,
              name: identity.name,
              color: deriveColor(identity.profileId),
              connId: welcome.connId,
              self: true,
            },
            ...welcome.peers
              .filter((m) => m.profileId !== identity.profileId)
              .map((m) => toRosterMember(m, false)),
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
            const next = current.some(
              (m) => m.profileId === peer.member!.profileId,
            )
              ? current
              : [...current, toRosterMember(peer.member, false)];
            peersRef.current = next;
            setPeers(next);
            rebuildCollaborators(next);
            return;
          }
          if (peer.kind === "leave") {
            const next = current.filter(
              (m) => m.profileId !== peer.member?.profileId,
            );
            if (next.length !== current.length) {
              peersRef.current = next;
              setPeers(next);
              rebuildCollaborators(next);
            }
          }
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
          // A reconnect/decrypt race can deliver an older scene after a
          // newer one from the same relay source. Never let it replace the
          // newer canvas state. `seq` is per sender, so the gate is scoped
          // by `from` rather than comparing unrelated peers' counters.
          if (previousSeq !== undefined && scene.seq <= previousSeq) return;
          lastAppliedSeqRef.current.set(source, scene.seq);
          setSnapshotAvailable(true);
          // 058 §1.3: seed and scene are the SAME resync path for the
          // receiver — normalize the union.
          const elements = scene.t === "seed" ? scene.scene : scene.elements;
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
      lastAppliedSeqRef.current.clear();
      localBaselineRef.current = null;
      localSceneRef.current = null;
      localDirtyRef.current = false;
      pendingLocalSceneRef.current = null;
      pendingMergeRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admission, room, identity, excalidrawAPI, shareId]);

  const handleFirstScene = useCallback(
    (scene: IncomingScene, elements: readonly unknown[]) => {
      const pending = pendingMergeRef.current;
      const pendingLocal = pendingLocalSceneRef.current;
      // A local edit may land before the relay's first snapshot. Use the
      // cached edited scene (or the boot scene) as the merge base so the
      // snapshot cannot erase a newly-created first stroke. Existing
      // reconnect/offline edits keep their established 061 merge path.
      const shouldMergeLocal = pendingLocal !== null;
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
        // 061 §3: offline/local edits → three-way merge, online wins on
        // conflicts; local-only creates (including a first Pencil stroke)
        // survive the snapshot.
        const merged = mergeScene({
          base: mergeBase as MergeElement[],
          ours: mergeOurs as MergeElement[],
          theirs: elements as MergeElement[],
        });
        // 052: the merged scene may keep image refs unique to ours —
        // register them so the first-apply prefetch can hydrate them.
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
        const mergedScene: CollabScene = {
          elements: merged.scene,
          appState: pendingLocal?.appState ?? pending?.edited.appState ?? {},
        };
        const synced: CollabScene = { elements: [...elements], appState: {} };
        baseSceneRef.current = synced;
        localSceneRef.current = mergedScene;
        localDirtyRef.current = !elementsEqual(merged.scene, elements);
        pendingLocalSceneRef.current = null;
        pendingMergeRef.current = null;
        persistSession(mergedScene);
        // Reconnect/offline merges are rebroadcast even when the online
        // version won. A pending first-stroke merge is sent only when it
        // adds content that survived the online-wins conflict rule.
        if ((pending !== null && !shouldMergeLocal) || localDirtyRef.current) {
          seqRef.current += 1;
          clientRef.current?.sendScene([...merged.scene], seqRef.current);
        }
        return;
      }
      // Pure cache / no cache → relay snapshot wins (053 rule A).
      applyScene(elements);
      const synced: CollabScene = { elements: [...elements], appState: {} };
      baseSceneRef.current = synced;
      localSceneRef.current = synced;
      localDirtyRef.current = false;
      pendingLocalSceneRef.current = null;
      pendingMergeRef.current = null;
      persistSession(synced);
    },
    [applyScene, persistSession],
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
    lastAppliedSeqRef.current.clear();
    localBaselineRef.current = null;
    localSceneRef.current = null;
    localDirtyRef.current = false;
    pendingLocalSceneRef.current = null;
    pendingMergeRef.current = null;
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
      const label = roomRef.current?.label ?? shortId;
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
      // Echo guard: remote applies (updateScene, captureUpdate NEVER) also
      // fire onChange — never rebroadcast or re-cache them here. Timing guard
      // first (synchronous applies), then the timing-proof content guard:
      // onChange from a remote apply may fire after the flag clears (React
      // render commit) — recognize the echo by content instead.
      if (applyingRemoteRef.current) return;
      if (JSON.stringify(elements) === lastRemoteSceneRef.current) return;
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
    name: identity.name,
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
    name: identity.name,
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
  });
}
