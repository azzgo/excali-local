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
 *    unpair / SW-restart-offer (task 005: a consented canvas re-claims its
 *    slot SILENTLY after a SW restart — the WS data session survives; only
 *    an un-consented canvas gets the offer, never silent activation)
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
	AB_BRIDGE_STOP_REQUEST,
	BRIDGE_STOP_METHOD,
	AB_MODE_CHANGED,
	AGENT_BRIDGE_MODE_WS,
	AGENT_BRIDGE_MODE_WEBMCP,
	CANVAS_V1_METHODS,
	mintBridgeToken,
	isWebmcpUsable,
	type AgentBridgeStorage,
	type AgentBridgeStatePayload,
	type AgentBridgeMode,
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


// ---------------------------------------------------------------------------
// WebMCP exposure (Wayfinder 043/044) — Chrome's built-in AI can call the
// canvas/v1 commands via document.modelContext.registerTool. ONE tool with a
// method enum (MCP tool names forbid dots, so per-method names like
// `scene.get` are impossible); the agent picks the method + params.
// ---------------------------------------------------------------------------
const WEBMCP_TOOL_NAME = "excali_canvas";

/** canvas/v1 methods the page can actually serve. commands.list and
 * protocol.version are daemon-local META methods (resolved daemon-side in
 * ws+daemon); WebMCP has no daemon, so they are excluded. */
const WEBMCP_METHODS = CANVAS_V1_METHODS.filter(
  (m) => m !== "commands.list" && m !== "protocol.version",
);

const WEBMCP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    method: {
      type: "string",
      enum: [...WEBMCP_METHODS],
      description: "canvas/v1 method to execute",
    },
    params: {
      type: "object",
      description: "method params (default {})",
    },
  },
  required: ["method"],
} as const;

/** Minimal shape of the WebMCP imperative API (Chrome 157+). */
interface WebMCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface WebMCPModelContext {
  registerTool?: (def: WebMCPToolDefinition) => Promise<void>;
  unregisterTool?: (name: string) => Promise<void>;
}

function getModelContext(): WebMCPModelContext | null {
  try {
    const doc = (document ?? undefined) as unknown as {
      modelContext?: WebMCPModelContext;
    } | undefined;
    const nav = (navigator ?? undefined) as unknown as {
      modelContext?: WebMCPModelContext;
    } | undefined;
    return doc?.modelContext ?? nav?.modelContext ?? null;
  } catch {
    return null;
  }
}

/**
 * True when the message sender is the background service worker (045 relay
 * gate). Chrome reports sender.url as the SW script URL for messages the SW
 * sends via tabs.sendMessage — WXT builds it as <ext>/background.js in both
 * dev and prod. Any other sender (e.g. the Options page's runtime.sendMessage
 * fan-out) is NOT the relay and must be ignored (see the STOP gate above).
 */
function isFromBackground(sender: unknown): boolean {
  const url = (sender as { url?: string } | undefined)?.url ?? "";
  return url.endsWith("background.js");
}

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
  /**
   * true when the SW restarted while this canvas was active AND it cannot be
   * re-claimed silently (different / un-consented canvas) → offer one-click
   * re-activate. A consented canvas re-claims silently instead (task 005).
   */
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
  /**
   * Active control route (043/044): "ws+daemon" (default) or "webmcp".
   * WebMCP mode has no daemon — the canvas button becomes the 2-state
   * Register/Unregister machine and no WS session is dialed.
   */
  mode: AgentBridgeMode;
  /** true when this canvas's WebMCP tool is registered (per-page exposure). */
  webmcpRegistered: boolean;
  /** Register the WebMCP tool (click IS the per-page exposure consent — no modal). */
  registerWebmcp(): Promise<boolean>;
  /** Withdraw the WebMCP tool (immediate; kill-switch does this automatically). */
  unregisterWebmcp(): Promise<void>;
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
  // --- active control route (043/044): ws+daemon (default) | webmcp --------
  const [mode, setMode] = useState<AgentBridgeMode>("ws+daemon");
  // true when this canvas's WebMCP tools are registered (per-page exposure).
  const [webmcpRegistered, setWebmcpRegistered] = useState(false);
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
  // WebMCP registration mirror (read from the async register/unregister
  // callbacks — avoids stale closures in the kill-switch effect).
  const webmcpRegRef = useRef(false);
  // The LIVE active-slot session (created inside the WS effect) — the SW
  // relay for bridge.stop (045) needs it from the runtime-message listener.
  const activeSessionRef = useRef<AgentBridgeSession | null>(null);
  // Per-canvas first-time consent (034 R1): keyed by drawing id ("unsaved"
  // for a blank canvas); cleared on unpair/re-pair so a NEW connection asks again.
  const confirmShownRef = useRef<Record<string, boolean>>({});
  const prevPairingRef = useRef(false);
  const consentKeyRef = useRef<string>(drawingId ?? "unsaved");
  consentKeyRef.current = drawingId ?? "unsaved";
  const onActivateErrorRef = useRef(onActivateError);
  onActivateErrorRef.current = onActivateError;
  // requestActivation is declared below reconcile — route through a ref so
  // reconcile can silently re-claim after a SW restart (task 005) while both
  // useCallbacks keep stable, minimal deps.
  const requestActivationRef = useRef<(() => void) | null>(null);
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
        setMode(consent.mode ?? AGENT_BRIDGE_MODE_WS);
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
        setMode(consent.mode ?? AGENT_BRIDGE_MODE_WS);
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
        if (confirmShownRef.current[consentKeyRef.current]) {
          // SW restarted → its ephemeral registry was wiped, but THIS canvas
          // was already consented this pairing (034 R1). Re-claim the slot
          // SILENTLY so the healthy page<->daemon WS data session survives
          // (task 005): no offer banner, no teardown — isActive stays true
          // (session ownership lives in sessionActiveRef + WS health).
          requestActivationRef.current?.();
          return;
        }
        // SW restarted and the active canvas is NOT consented (a new canvas,
        // or never confirmed) → offer one-click re-activate, never silent.
        // Falls through to the generic teardown below (session stops,
        // isActive flips false).
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
      sender: unknown,
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
      } else if (m?.type === AB_MODE_CHANGED) {
        // SW relay (043/044): the Active control route changed. The storage
        // onChange already mirrors `mode`; this is the same signal without
        // polling — the unregister/drop effects react to the mode state.
        const nextMode = (m as { mode?: AgentBridgeMode }).mode;
        if (nextMode === AGENT_BRIDGE_MODE_WS || nextMode === AGENT_BRIDGE_MODE_WEBMCP) {
          setMode(nextMode);
        }
      } else if (m?.type === AB_BRIDGE_STOP_REQUEST && isFromBackground(sender)) {
        // Options → SW → this page (045): relay the daemon-local `bridge.stop`
        // over the LIVE active-slot WS. The daemon replies {stopped:true} and
        // then shuts itself down (flush window) — we answer the SW as soon as
        // the JSON-RPC response lands. (async reply → return true.)
        //
        // SENDER GATE (E2E finding): runtime.sendMessage from the Options page
        // fans out to the SW AND every extension page — without this gate the
        // page relays the request directly AND via the SW's tabs.sendMessage
        // (two responders, two bridge.stop calls), and Chrome keeps only the
        // first sendResponse → the Options ack is lost. Only the SW-relayed
        // copy (sender.url = <ext>/background.js) is acted on here.
        void (async () => {
          const session = activeSessionRef.current;
          if (!session) {
            sendResponse({ ok: false, reason: "no-active-session" });
            return;
          }
          const resp = await session.request(BRIDGE_STOP_METHOD, {});
          sendResponse(
            resp.ok ? { ok: true } : { ok: false, reason: resp.reason ?? "daemon-error" },
          );
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
  requestActivationRef.current = requestActivation;

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
    // WebMCP mode (043/044) has NO daemon: no WS dials at all. Switching the
    // route tears the sessions down via this effect's cleanup (mode in deps).
    const wsMode = mode === AGENT_BRIDGE_MODE_WS;
    const controlShouldDial = wsMode && masterOn && paired; // Gate 1 only
    const activeShouldDial = wsMode && masterOn && paired && isActive && !!api; // Gate 2
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
      // The live active-slot session for the SW's bridge.stop relay (045).
      activeSessionRef.current = activeSession;
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
      if (activeSessionRef.current === activeSession) {
        activeSessionRef.current = null;
      }
      controlSession?.stop();
      activeSession?.stop();
      if (window.excaliAPI?.excalidrawAPI === api) {
        delete window.excaliAPI;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocal, masterOn, paired, isActive, profileId, excalidrawAPI, mode]);

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

  // --- WebMCP exposure (043/044): per-page register/unregister -------------
  // The canvas button's click IS the consent — this hook never auto-registers.
  // It only AUTO-WITHDRAWS (kill-switch / unpair / route switch away).
  const registerWebmcp = useCallback(async (): Promise<boolean> => {
    // Honest detect (E2E finding): on chrome-extension:// pages before Chrome
    // 157 the API is present but blocked (SecurityError, document.domain).
    // Probe first — a blocked page reports unavailable without a failed
    // register attempt.
    if (!isWebmcpUsable()) return false;
    const mc = getModelContext();
    if (!mc?.registerTool || webmcpRegRef.current) return false;
    const api = excalidrawAPIRef.current;
    if (!api) return false;
    try {
      await mc.registerTool({
        name: WEBMCP_TOOL_NAME,
        description: t("AgentWebmcpToolDescription"),
        inputSchema: WEBMCP_INPUT_SCHEMA as unknown as Record<string, unknown>,
        execute: async (input) => {
          // Resolve api/helpers at CALL time (never stale), same dispatch as
          // the ws+daemon inbound path (canvas-v1.ts).
          const method = (input as { method?: string })?.method;
          const params = (input as { params?: Record<string, unknown> })?.params ?? {};
          if (!method || !WEBMCP_METHODS.includes(method as never)) {
            throw new Error(`unknown canvas method: ${method ?? "(none)"}`);
          }
          const liveApi = excalidrawAPIRef.current;
          if (!liveApi) throw new Error("canvas not ready");
          const resp = await handleCanvasV1Request(
            { jsonrpc: "2.0", id: 1, method, params } as CanvasV1Request,
            {
              api: liveApi as never,
              helpers: canvasV1HelpersRef.current!,
              onDestructive: (m) =>
                toast.warning(t("AgentDestructiveOp", { method: m })),
            },
          );
          if (resp.error) {
            throw new Error(`${resp.error.code}: ${resp.error.message}`);
          }
          return resp.result;
        },
      });
      webmcpRegRef.current = true;
      setWebmcpRegistered(true);
      return true;
    } catch {
      return false;
    }
  }, [t]);

  const unregisterWebmcp = useCallback(async (): Promise<void> => {
    const mc = getModelContext();
    webmcpRegRef.current = false;
    setWebmcpRegistered(false);
    try {
      await mc?.unregisterTool?.(WEBMCP_TOOL_NAME);
    } catch {
      /* best-effort withdrawal */
    }
  }, []);

  // Kill-switch / route switch: the moment WebMCP exposure is no longer
  // allowed (master OFF, unpair, or mode switched away), withdraw immediately.
  // No exceptions (043: master-OFF unregisters at once).
  useEffect(() => {
    if (!isLocal) return;
    const allowed =
      mode === AGENT_BRIDGE_MODE_WEBMCP && masterOn && paired;
    if (!allowed && webmcpRegRef.current) {
      void unregisterWebmcp();
    }
  }, [isLocal, mode, masterOn, paired, unregisterWebmcp]);

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
    mode,
    webmcpRegistered,
    registerWebmcp,
    unregisterWebmcp,
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
