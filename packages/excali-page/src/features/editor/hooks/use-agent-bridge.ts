/**
 * Agent Bridge — page-side hook (activated Local editor tab).
 *
 * Owns the WS data path (Ticket 010: page = data path, SW = control plane):
 *  - reads the Layer 0 master + Gate 1 pairing consent from chrome.storage
 *  - talks to the background SW (READY / ACTIVATE / DEACTIVATE / HEARTBEAT)
 *  - reconciles a mirror of the SW's activation registry on every message
 *  - while active: mints a ≥128-bit token, dials ws://127.0.0.1:<port>, completes
 *    the token handshake, and exposes `window.excaliAPI`
 *  - teardown: close WS + drop window.excaliAPI on deactivate / master-off /
 *    unpair / SW-restart-offer (never silently re-activates)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  currentLoadedDrawingIdAtom,
  galleryRevisionAtom,
} from "@/features/gallery/store/gallery-atoms";

import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { nanoid } from "nanoid";
import {
	AB_READY,
	AB_STATE,
	AB_ACTIVATE,
	AB_DEACTIVATE,
	AB_DISPLACED,
	AB_HEARTBEAT,
	AB_CANVAS_NAME,
	AGENT_BRIDGE_STORAGE_KEY,
	AGENT_BRIDGE_DEFAULT_STORAGE,
	AGENT_BRIDGE_HEARTBEAT_MS,
	PROFILE_ID_STORAGE_KEY,
	WS_DISPLACED,
	WS_ROLE_CONTROL_PAGE,
	mintBridgeToken,
	type AgentBridgeStorage,
	type AgentBridgeStatePayload,
} from "excali-shared";
import { getBrowser } from "@/lib/utils";
import {
	AgentBridgeSession,
	type BridgeConnectionStatus,
} from "../lib/agent-bridge-client";
import {
	handleCanvasV1Request,
	type CanvasV1Helpers,
	type CanvasV1Request,
} from "../lib/canvas-v1";
import { buildCanvasV1Helpers } from "../lib/canvas-v1-helpers";
import {
	handleGalleryV1Request,
	type GalleryV1Deps,
	type GalleryV1Request,
} from "../lib/gallery-v1";
import {
	handleFontsV1Request,
	type FontsV1Deps,
	type FontsV1Request,
} from "@/lib/fonts-v1";
// excali-fonts FontConfig record access (goal 4 — fonts/v1 page methods).
import {
	clearFontSlot,
	getFontConfig as getFontConfigFromDB,
	updateFontSlot,
} from "excali-shared";
// the existing gallery hooks/paths, not a rewrite).
import {
	createCollection,
	deleteCollection as deleteCollectionDB,
	deleteDrawing,
	getCollections,
	getDrawingFullData,
	getDrawings,
	saveDrawing,
	updateCollection,
	updateDrawing,
} from "@/features/editor/utils/indexdb";
import { loadDrawingToScene } from "@/features/editor/utils/excalidraw-api.helper";
import { useThumbnail } from "@/features/gallery/hooks/use-thumbnail";
import { useGallery } from "@/features/gallery/hooks/use-gallery";

export interface ExcaliAPI {
  /** The live Excalidraw imperative API — reachable from the page console. */
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** Ping/echo round-trip over the bridge connection. */
  ping(): Promise<boolean>;
  status(): { connected: boolean; port: number | null };
}

declare global {
  interface Window {
    excaliAPI?: ExcaliAPI;
  }
}

export type AgentBridgeConnection =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface UseAgentBridgeResult {
  /** Layer 0 — Options master switch (persisted). */
  masterOn: boolean;
  /** Gate 1 — paired connection (persisted, written by the canvas button). */
  paired: boolean;
  /** Options hide-button toggle (persisted; adjustable only while master OFF). */
  hideButton: boolean;
  /** Gate 2 — this canvas is the SW-registered activated canvas. */
  isActive: boolean;
  /**
   * true when the SW registry points at ANOTHER canvas (single-active-canvas
   * invariant, same profile): paired + idle here, but control is elsewhere.
   */
  otherActive: boolean;
  connection: AgentBridgeConnection;
  connectedPort: number | null;
  /** Per-profile identity uuid (minted once, persisted in chrome.storage.local). */
  profileId: string | null;
  /**
   * Goal 3 (Option A): status of the CONTROL connection — dialed when paired
   * (Gate 1) WITHOUT activation; serves paired-only gallery ops when no canvas
   * is active. Independent of the active-slot connection. Also the daemon
   * detection signal for the redesigned canvas button (Wayfinder 034).
   */
  controlConnection: AgentBridgeConnection;
  /** true when the SW restarted while this canvas was active → offer re-activate. */
  swRestartOffer: boolean;
  /**
   * true (transient) when the daemon displaced this canvas — a newer
   * activation from another profile took the cross-profile single-active slot
   * (Tickets 016/017). Cleared on the next activation request.
   */
  displaced: boolean;
  /**
   * BLOCKING gallery confirm (013/014): a global destructive op is waiting on
   * the user. null = no pending confirm. key bumps per request.
   */
  galleryConfirm: GalleryConfirmInfo | null;
  /** Approve the pending gallery confirm → the op executes. */
  confirmGallery(): void;
  /** Reject the pending gallery confirm → the op returns -32005. */
  cancelGallery(): void;
  showConfirm: boolean;
  /** The activation toggle may be shown (master ON + paired + Local editor). */
  canActivate: boolean;
  /** Quick-enable (Wayfinder 034): master ON from the canvas button, no nav. */
  quickEnableAgent(): void;
  /** Pair (Wayfinder 034): persist `pairing` from the canvas button. */
  pairAgent(): void;
  toggleActivation(): void;
  confirmActivation(): void;
  /** Cold-start: activate THIS canvas directly — the enable confirm counts as its per-canvas consent, so no second modal. */
  activateCurrentCanvas(): void;
  cancelConfirm(): void;
  acceptReconnect(): void;
  dismissReconnect(): void;
}

/** A gallery op awaiting the user's blocking confirm (013/014). */
export interface GalleryConfirmInfo {
  method: string;
  params: Record<string, unknown>;
  key: number;
}

/** Why an activation request failed — surfaced via `onActivateError`. */
export type AgentBridgeActivateError =
  | "transport"
  | "consent-off"
  | "not-activatable";

interface UseAgentBridgeOptions {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  editorType: "local" | "quick";
  /**
   * Fired when an activation request is denied or can't reach the SW — lets
   * the UI surface a transient error (e.g. toast) instead of failing silently.
   */
  onActivateError?: (reason: AgentBridgeActivateError) => void;
}

export function useAgentBridge({
  excalidrawAPI,
  editorType,
  onActivateError,
}: UseAgentBridgeOptions): UseAgentBridgeResult {
  const [t] = useTranslation();
  const isLocal = editorType === "local";
  // current drawing (per-canvas consent key, 034 R1) — null = unsaved canvas.
  const drawingId = useAtomValue(currentLoadedDrawingIdAtom);

  // --- consent (chrome.storage, persisted) ---------------------------------
  const [masterOn, setMasterOn] = useState(false);
  const [paired, setPaired] = useState(false);
  const [hideButton, setHideButton] = useState(false);
  // --- per-profile identity (goal 3): minted once, persisted ----------------
  const [profileId, setProfileId] = useState<string | null>(null);

  // --- activation state (mirror of SW registry) -----------------------------
  const [isActive, setIsActive] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [connection, setConnection] =
    useState<AgentBridgeConnection>("idle");
  const [connectedPort, setConnectedPort] = useState<number | null>(null);
  const [controlConnection, setControlConnection] =
    useState<AgentBridgeConnection>("idle");
  const [swRestartOffer, setSwRestartOffer] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [displacedNotice, setDisplacedNotice] = useState(false);
  // --- gallery BLOCKING confirm (013/014) ----------------------------------
  const [galleryConfirm, setGalleryConfirm] = useState<GalleryConfirmInfo | null>(null);

  // refs (avoid stale closures in listeners/timers)
  const sessionActiveRef = useRef(false);
  const lastSwIdRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  // Per-canvas first-time consent (034 R1): keyed by drawing id ("unsaved"
  // for a blank canvas); cleared on unpair/re-pair so a NEW connection asks again.
  const confirmShownRef = useRef<Record<string, boolean>>({});
  const prevPairingRef = useRef(false);
  const consentKeyRef = useRef<string>(drawingId ?? "unsaved");
  consentKeyRef.current = drawingId ?? "unsaved";
  const onActivateErrorRef = useRef(onActivateError);
  onActivateErrorRef.current = onActivateError;
  const excalidrawAPIRef = useRef(excalidrawAPI);
  excalidrawAPIRef.current = excalidrawAPI;
  // canvas/v1 real helpers — built once per page session (tgz exports).
  const canvasV1HelpersRef = useRef<CanvasV1Helpers | null>(null);
  if (canvasV1HelpersRef.current === null) {
    canvasV1HelpersRef.current = buildCanvasV1Helpers();
  }
  // Gallery hooks (REUSED per 014): thumbnail generation + currentLoadedDrawingId.
  const { generateThumbnail } = useThumbnail();
  const { setCurrentLoadedDrawingId } = useGallery();

  // One pending BLOCKING confirm at a time; the rest queue (never deadlock).
  const confirmQueueRef = useRef<
    Array<{
      method: string;
      params: Record<string, unknown>;
      resolve: (ok: boolean) => void;
    }>
  >([]);

  const browser = getBrowser();

  // --- storage read + watch (kill-switch reacts here) -----------------------
  useEffect(() => {
    if (!isLocal || !browser?.storage?.local) return;
    browser.storage.local
      .get(AGENT_BRIDGE_STORAGE_KEY)
      .then((result: Record<string, unknown>) => {
        const stored = result[AGENT_BRIDGE_STORAGE_KEY] as
          | AgentBridgeStorage
          | undefined;
        const consent = stored ?? AGENT_BRIDGE_DEFAULT_STORAGE;
        setMasterOn(consent.master);
        setPaired(consent.pairing);
        setHideButton(!!consent.hideButton);
        prevPairingRef.current = consent.pairing;
      })
      .catch(() => {});

    const onChange = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => {
      if (area === "local" && changes[AGENT_BRIDGE_STORAGE_KEY]) {
        const consent = (changes[AGENT_BRIDGE_STORAGE_KEY].newValue ??
          AGENT_BRIDGE_DEFAULT_STORAGE) as AgentBridgeStorage;
        setMasterOn(consent.master);
        setPaired(consent.pairing);
        setHideButton(!!consent.hideButton);
        // a NEW paired connection (false→true) resets the per-canvas confirms
        // (034 R1: ask once per canvas until unpair/re-pair).
        if (consent.pairing && !prevPairingRef.current) {
          confirmShownRef.current = {};
        }
        prevPairingRef.current = consent.pairing;
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [isLocal, browser]);

  // unpair (Gate 1 OFF) → clear the per-canvas consent map; the next pair
  // asks again on every canvas (034 R1).
  useEffect(() => {
    if (!paired) confirmShownRef.current = {};
  }, [paired]);

  // --- SW messaging + reconciliation ----------------------------------------
  const sendToSW = useCallback(
    (message: unknown): Promise<unknown> => {
      if (!browser?.runtime?.sendMessage) return Promise.resolve(undefined);
      return browser.runtime.sendMessage(message).catch(() => undefined);
    },
    [browser],
  );

  const reconcile = useCallback(
    (state: AgentBridgeStatePayload) => {
      const instanceChanged =
        lastSwIdRef.current !== null && lastSwIdRef.current !== state.swInstanceId;
      lastSwIdRef.current = state.swInstanceId;
      setActiveTabId(state.activeTabId);

      if (instanceChanged && wasActiveRef.current && !state.isActive) {
        // SW restarted → ephemeral registry wiped → offer one-click re-activate
        // (never silent). WS data path is unaffected (page owns it).
        setSwRestartOffer(true);
      }

      if (state.isActive) {
        if (sessionActiveRef.current) {
          // we hold the session → activate
          wasActiveRef.current = true;
          setIsActive(true);
        } else {
          // SW registry points at us but we have no session (page reload /
          // SW-restart ghost) → activation is LOST, tell the SW to clear it
          void sendToSW({ type: AB_DEACTIVATE });
        }
      } else {
        sessionActiveRef.current = false;
        wasActiveRef.current = false;
        setIsActive(false);
      }
    },
    [sendToSW],
  );

  useEffect(() => {
    if (!isLocal || !browser?.runtime) return;

    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response?: unknown) => void,
    ) => {
      const m = message as Partial<AgentBridgeStatePayload> & {
        type?: string;
        granted?: boolean;
      };
      if (m?.type === AB_STATE) {
        reconcile(m as AgentBridgeStatePayload);
      } else if (m?.type === AB_CANVAS_NAME) {
        // Popup indicator (034): report this canvas's drawing name so the
        // popup can show "Controlling: <name>". Resolved from the gallery DB;
        // an unsaved canvas reports the localized "New Drawing" label.
        // (async reply → return true keeps the channel open, Chrome+Firefox)
        void (async () => {
          const id = consentKeyRef.current === "unsaved" ? null : consentKeyRef.current;
          let name: string | null = null;
          if (id) {
            try {
              const list = await getDrawings();
              name = list.find((d) => d.id === id)?.name ?? null;
            } catch {
              /* db unavailable — leave name null */
            }
          }
          sendResponse({ name: name ?? t("New Drawing") });
        })();
        return true;
      }
    };
    browser.runtime.onMessage.addListener(onMessage);

    // register with the SW and learn our tabId/state
    void sendToSW({ type: AB_READY }).then((reply) => {
      if (reply && (reply as { type?: string }).type === AB_STATE) {
        reconcile(reply as AgentBridgeStatePayload);
      }
    });

    // heartbeat while a canvas is active: keeps the SW alive (registry survives
    // idle eviction) AND detects a restarted SW via the new swInstanceId.
    const heartbeat = setInterval(() => {
      if (!sessionActiveRef.current) return;
      void sendToSW({ type: AB_HEARTBEAT }).then((reply) => {
        if (reply && (reply as { type?: string }).type === AB_STATE) {
          reconcile(reply as AgentBridgeStatePayload);
        }
      });
    }, AGENT_BRIDGE_HEARTBEAT_MS);

    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
      clearInterval(heartbeat);
    };
  }, [isLocal, browser, reconcile, sendToSW]);

  // --- activation actions ----------------------------------------------------
  const requestActivation = useCallback(() => {
	if (!isLocal) return;
	setDisplacedNotice(false);
	// Claim the session BEFORE the SW's STATE broadcast can arrive. The SW
	// broadcasts isActive:true (broadcastState) BEFORE it replies granted to
	// ACTIVATE, so the broadcast can land while this request is still in
	// flight. Without the early claim, reconcile()'s self-heal ("SW registry
	// points at us but we have no session") fires on the broadcast and sends
	// DEACTIVATE — killing the activation we just requested (observed live:
	// ACTIVATE → STATE(active) → DEACTIVATE in the same millisecond).
	sessionActiveRef.current = true;
	void sendToSW({ type: AB_ACTIVATE }).then((reply) => {
	  const r = reply as { granted?: boolean; reason?: string } | undefined;
	  if (r?.granted) {
	    // Session confirmed — isActive flips true when the SW broadcast STATE
	    // arrives (already claimed above, so reconcile recognizes the session).
	    return;
	  }
	  // Grant denied or the SW was unreachable — revert the optimistic claim
	  // and surface it instead of failing silently (review P2).
	  sessionActiveRef.current = false;
	  const reason: AgentBridgeActivateError =
	    r?.reason === "consent-off"
	      ? "consent-off"
	      : r?.reason === "not-activatable"
	        ? "not-activatable"
	        : "transport";
	  onActivateErrorRef.current?.(reason);
	});
  }, [isLocal, sendToSW]);

  const toggleActivation = useCallback(() => {
    if (!isLocal) return;
    if (sessionActiveRef.current || isActive) {
      sessionActiveRef.current = false;
      wasActiveRef.current = false;
      setIsActive(false);
      void sendToSW({ type: AB_DEACTIVATE });
      return;
    }
    // Per-canvas first-time consent (034 R1): ask once per canvas, then
    // auto-confirm activations of the SAME canvas until unpair/re-pair.
    const key = consentKeyRef.current;
    if (!confirmShownRef.current[key]) {
      setShowConfirm(true);
      return;
    }
    requestActivation();
  }, [isLocal, isActive, requestActivation, sendToSW]);

  const confirmActivation = useCallback(() => {
    setShowConfirm(false);
    confirmShownRef.current[consentKeyRef.current] = true;
    requestActivation();
  }, [requestActivation]);

  // Cold-start direct activation: the canvas-button enable modal's confirm IS
  // this canvas's per-canvas consent (Gate 2), so the cold-start path skips the
  // separate consent modal. Pre-mark the canvas consented, then request
  // activation directly. Called by the component's auto-activate effect after
  // Turn On (once the bridge is detected) — one confirm → straight to Controlling.
  const activateCurrentCanvas = useCallback(() => {
    confirmShownRef.current[consentKeyRef.current] = true;
    requestActivation();
  }, [requestActivation]);

  // --- canvas-button storage writes (Wayfinder 034) ---------------------------
  // The canvas button owns pairing now: quick-enable (master ON) and pair
  // (Gate 1 open) both MERGE into the persisted chrome.storage blob so the
  // Options hideButton field (and anything else) is never clobbered.
  const updateAgentStorage = useCallback(
    async (patch: Partial<AgentBridgeStorage>) => {
      if (!browser?.storage?.local) return;
      try {
        const result = await browser.storage.local.get(AGENT_BRIDGE_STORAGE_KEY);
        const stored = (result[AGENT_BRIDGE_STORAGE_KEY] as
          | AgentBridgeStorage
          | undefined) ?? AGENT_BRIDGE_DEFAULT_STORAGE;
        await browser.storage.local.set({
          [AGENT_BRIDGE_STORAGE_KEY]: { ...stored, ...patch },
        });
      } catch {
        /* storage unavailable */
      }
    },
    [browser],
  );

  const quickEnableAgent = useCallback(() => {
    // One consent action from the canvas button: open master + pairing together.
    // The two flags stay in the storage model (master = kill-switch, pairing =
    // transport dial gate) but are a single user-facing toggle — the "enabled but
    // not paired" intermediate state forced a redundant second click and served no
    // purpose. The Options page still sets them independently (master ON there
    // resets pairing to false), so pairAgent() below stays valid for that path.
    void updateAgentStorage({ master: true, pairing: true });
  }, [updateAgentStorage]);

  const pairAgent = useCallback(() => {
    void updateAgentStorage({ pairing: true });
  }, [updateAgentStorage]);

  const cancelConfirm = useCallback(() => setShowConfirm(false), []);
  const acceptReconnect = useCallback(() => {
    setSwRestartOffer(false);
    requestActivation();
  }, [requestActivation]);

  const dismissReconnect = useCallback(() => setSwRestartOffer(false), []);

  // --- profile id: mint once per profile, persist (goal 3 identity) -------
  useEffect(() => {
    if (!isLocal || !browser?.storage?.local) return;
    let cancelled = false;
    void browser.storage.local
      .get(PROFILE_ID_STORAGE_KEY)
      .then((result: Record<string, unknown>) => {
        if (cancelled) return;
        const existing = result[PROFILE_ID_STORAGE_KEY];
        if (typeof existing === "string" && existing !== "") {
          setProfileId(existing);
          return;
        }
        // Mint lazily on first need; persists across reloads.
        const minted = crypto.randomUUID();
        void browser.storage.local
          .set({ [PROFILE_ID_STORAGE_KEY]: minted })
          .catch(() => {});
        if (!cancelled) setProfileId(minted);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLocal, browser]);

  // --- gallery BLOCKING confirm gate (013/014) ------------------------------
  // The protocol layer is non-blocking: the dispatcher awaits this gate and the
  // daemon's RPCTimeout still bounds the worst case — routing can never deadlock.
  const onConfirm = useCallback(
    (info: { method: string; params: Record<string, unknown> }): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        confirmQueueRef.current.push({ ...info, resolve });
        setGalleryConfirm((cur) =>
          cur ?? { method: info.method, params: info.params, key: Date.now() },
        );
      }),
    [],
  );

  const confirmGallery = useCallback(() => {
    const item = confirmQueueRef.current.shift();
    item?.resolve(true);
    const next = confirmQueueRef.current[0];
    setGalleryConfirm(
      next ? { method: next.method, params: next.params, key: Date.now() } : null,
    );
  }, []);

  const cancelGallery = useCallback(() => {
    const item = confirmQueueRef.current.shift();
    item?.resolve(false);
    const next = confirmQueueRef.current[0];
    setGalleryConfirm(
      next ? { method: next.method, params: next.params, key: Date.now() } : null,
    );
  }, []);

  // deleteCollection + member rewrite — reuses the useDrawingCrud loop (014:
  // collections.delete MUST strip the id from every member drawing).
  const deleteCollectionAndReport = useCallback(async (id: string): Promise<number> => {
    await deleteCollectionDB(id);
    const drawings = await getDrawings();
    let affected = 0;
    for (const drawing of drawings) {
      if (drawing.collectionIds?.includes(id)) {
        await updateDrawing(drawing.id, {
          collectionIds: drawing.collectionIds.filter((cid) => cid !== id),
        });
        affected += 1;
      }
    }
    return affected;
  }, []);

  // gallery/v1 deps — refreshed every render so the dispatcher always reads
  // the live excalidrawAPI + thumbnail/currentLoaded hooks via the ref.
  const setGalleryRevision = useSetAtom(galleryRevisionAtom);
  const galleryDepsRef = useRef<GalleryV1Deps | null>(null);
  galleryDepsRef.current = {
    db: {
      getDrawings,
      getDrawingFullData,
      getCollections,
      saveDrawing,
      updateDrawing,
      deleteDrawing,
      createCollection,
      updateCollection,
      deleteCollectionAndReport,
    },
    scene: excalidrawAPIRef.current
      ? {
          getSceneElements: () =>
            excalidrawAPIRef.current!.getSceneElements() as readonly unknown[],
          getAppState: () =>
            excalidrawAPIRef.current!.getAppState() as Record<string, unknown>,
          getFiles: () =>
            excalidrawAPIRef.current!.getFiles() as
              | Record<string, unknown>
              | null
              | undefined,
          loadDrawingToScene: (elements, appState, files) => {
            loadDrawingToScene(
              excalidrawAPIRef.current!,
              elements as never,
              appState as never,
              files as never,
            );
          },
          generateThumbnail: (elements, files) =>
            generateThumbnail(elements as never, files as never),
          generateId: () => nanoid(),
          onLoaded: (id) => setCurrentLoadedDrawingId(id),
        }
      : undefined,
    onConfirm,
    onGalleryMutated: () => setGalleryRevision((n) => n + 1),
  };

  // fonts/v1 deps — same confirm queue (goal-4 reuses goal-3 modal infra).
  const fontsDepsRef = useRef<FontsV1Deps | null>(null);
  fontsDepsRef.current = {
    db: {
      getFontConfig: () => getFontConfigFromDB(),
      updateFontSlot,
      clearFontSlot,
    },
    onConfirm,
  };

  // --- WS data path (goal 3, Option A): control + active sessions -----------
  const origin = typeof location !== "undefined" ? location.origin : "";

  useEffect(() => {
    if (!isLocal || !profileId) return;
    const api = excalidrawAPIRef.current;
    const controlShouldDial = masterOn && paired; // Gate 1 only — no activation
    const activeShouldDial = masterOn && paired && isActive && !!api; // Gate 2
    if (!controlShouldDial && !activeShouldDial) return;

    let controlSession: AgentBridgeSession | null = null;
    let activeSession: AgentBridgeSession | null = null;
    let portRef: number | null = null;

    const onInbound = (session: AgentBridgeSession, msg: Record<string, unknown>) => {
      if ((msg as { type?: string })?.type === WS_DISPLACED) {
        // The daemon displaced THIS connection (active-slot takeover, or a
        // newer same-profile control dial). Stop the session BEFORE the
        // reconnect backoff re-dials — a displaced page must never re-enter
        // the displacement loop (mirrors 003's "B deactivates A").
        if (session === activeSession) {
          sessionActiveRef.current = false;
          wasActiveRef.current = false;
          setIsActive(false);
          setDisplacedNotice(true);
          void sendToSW({ type: AB_DISPLACED });
        }
        session.stop();
        return;
      }
      // Inbound JSON-RPC (agent → daemon → this page): fonts/v1, gallery/v1
      // or canvas/v1. (fonts.system.list is daemon-local — never routed here.)
      const m = msg as { jsonrpc?: string; method?: string } &
        Partial<CanvasV1Request> &
        Partial<GalleryV1Request> &
        Partial<FontsV1Request>;
      if (m?.jsonrpc === "2.0" && typeof m.method === "string") {
        if (m.method.startsWith("fonts.")) {
          void handleFontsV1Request(m as FontsV1Request, fontsDepsRef.current!).then(
            (resp) => session.sendJSON(resp),
          );
        } else if (m.method.startsWith("gallery.")) {
          void handleGalleryV1Request(m as GalleryV1Request, galleryDepsRef.current!).then(
            (resp) => session.sendJSON(resp),
          );
        } else {
          const api = excalidrawAPIRef.current;
          if (!api) {
            session.sendJSON({
              jsonrpc: "2.0",
              id: m.id,
              error: { code: -32001, message: "canvas not ready" },
            });
            return;
          }
          void handleCanvasV1Request(m as CanvasV1Request, {
            api: api as never,
            helpers: canvasV1HelpersRef.current!,
            onDestructive: (method) => {
              // Non-blocking indicator (003/011): destructive canvas/v1 ops
              // (elements.clear / scene.reset / history.clear / files.add-overwrite)
              // surface a sonner toast — never a blocking modal, never an on-page
              // warning (keep the toolbar clean; the user asked for toast-only alerts).
              toast.warning(t("AgentDestructiveOp", { method }));
            },
          }).then((resp) => session.sendJSON(resp));
        }
      }
    };

    if (controlShouldDial) {
      controlSession = new AgentBridgeSession({
        origin,
        token: mintBridgeToken(),
        role: WS_ROLE_CONTROL_PAGE,
        profileId,
        onStatus: (status) => setControlConnection(toConnectionStatus(status)),
        onInbound: (msg) => onInbound(controlSession!, msg),
      });
      controlSession.start();
    }

    if (activeShouldDial) {
      activeSession = new AgentBridgeSession({
        origin,
        token: mintBridgeToken(),
        profileId,
        onStatus: (status, info) => {
          setConnection(toConnectionStatus(status));
          if (status === "connected") {
            setConnectedPort(info?.port ?? null);
            portRef = info?.port ?? null;
          }
        },
        onInbound: (msg) => onInbound(activeSession!, msg),
      });
      activeSession.start();
      window.excaliAPI = {
        excalidrawAPI: api!,
        ping: () => activeSession!.ping(),
        status: () => ({
          connected: activeSession!.currentStatus === "connected",
          port: portRef,
        }),
      };
    }

    return () => {
      controlSession?.stop();
      activeSession?.stop();
      if (window.excaliAPI?.excalidrawAPI === api) {
        delete window.excaliAPI;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocal, masterOn, paired, isActive, profileId, excalidrawAPI]);

  // keep connection state sane when not dialing
  useEffect(() => {
    if (!isLocal || !masterOn || !paired || !isActive) {
      setConnection("idle");
      setConnectedPort(null);
    }
    if (!isLocal || !masterOn || !paired) {
      setControlConnection("idle");
    }
  }, [isLocal, masterOn, paired, isActive]);

  return {
    masterOn,
    paired,
    hideButton,
    isActive,
    otherActive: activeTabId != null && !isActive,
    connection,
    connectedPort,
    profileId,
    controlConnection,
    swRestartOffer,
    displaced: displacedNotice,
    galleryConfirm,
    confirmGallery,
    cancelGallery,
    showConfirm,
    canActivate: isLocal && masterOn && paired,
    quickEnableAgent,
    pairAgent,
    toggleActivation,
    confirmActivation,
    activateCurrentCanvas,
    cancelConfirm,
    acceptReconnect,
    dismissReconnect,
  };
}

function toConnectionStatus(status: BridgeConnectionStatus): AgentBridgeConnection {
  switch (status) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    default:
      return "idle";
  }
}
