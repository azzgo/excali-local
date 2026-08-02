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
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import {
  AB_READY,
  AB_STATE,
  AB_ACTIVATE,
  AB_DEACTIVATE,
  AB_HEARTBEAT,
  AGENT_BRIDGE_STORAGE_KEY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  AGENT_BRIDGE_HEARTBEAT_MS,
  mintBridgeToken,
  type AgentBridgeStorage,
  type AgentBridgeStatePayload,
} from "excali-shared";
import { getBrowser } from "@/lib/utils";
import {
  AgentBridgeSession,
  type BridgeConnectionStatus,
} from "../lib/agent-bridge-client";

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
  /** Gate 1 — paired connection (persisted). */
  paired: boolean;
  /** Gate 2 — this canvas is the SW-registered activated canvas. */
  isActive: boolean;
  connection: AgentBridgeConnection;
  connectedPort: number | null;
  /** true when the SW restarted while this canvas was active → offer re-activate. */
  swRestartOffer: boolean;
  /** first-time-per-connection confirm modal. */
  showConfirm: boolean;
  /** The activation toggle may be shown (master ON + paired + Local editor). */
  canActivate: boolean;
  toggleActivation(): void;
  confirmActivation(): void;
  cancelConfirm(): void;
  acceptReconnect(): void;
  dismissReconnect(): void;
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
  const isLocal = editorType === "local";

  // --- consent (chrome.storage, persisted) ---------------------------------
  const [masterOn, setMasterOn] = useState(false);
  const [paired, setPaired] = useState(false);

  // --- activation state (mirror of SW registry) -----------------------------
  const [isActive, setIsActive] = useState(false);
  const [connection, setConnection] =
    useState<AgentBridgeConnection>("idle");
  const [connectedPort, setConnectedPort] = useState<number | null>(null);
  const [swRestartOffer, setSwRestartOffer] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // refs (avoid stale closures in listeners/timers)
  const sessionActiveRef = useRef(false);
  const lastSwIdRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  const confirmShownRef = useRef(false);
  const onActivateErrorRef = useRef(onActivateError);
  onActivateErrorRef.current = onActivateError;
  const excalidrawAPIRef = useRef(excalidrawAPI);
  excalidrawAPIRef.current = excalidrawAPI;

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
        // a new paired connection resets the first-time confirm
        if (consent.pairing) confirmShownRef.current = false;
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [isLocal, browser]);

  // reset confirm when pairing flips off (new connection next time)
  useEffect(() => {
    if (!paired) confirmShownRef.current = false;
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

    const onMessage = (message: unknown) => {
      const m = message as Partial<AgentBridgeStatePayload> & {
        type?: string;
        granted?: boolean;
      };
      if (m?.type === AB_STATE) {
        reconcile(m as AgentBridgeStatePayload);
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
    void sendToSW({ type: AB_ACTIVATE }).then((reply) => {
      const r = reply as { granted?: boolean; reason?: string } | undefined;
      if (r?.granted) {
        sessionActiveRef.current = true;
        // isActive flips true when the SW broadcast STATE arrives
        return;
      }
      // Grant denied or the SW was unreachable — surface it instead of
      // failing silently (review P2: silent activation failure).
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
    if (!confirmShownRef.current) {
      setShowConfirm(true);
      return;
    }
    requestActivation();
  }, [isLocal, isActive, requestActivation, sendToSW]);

  const confirmActivation = useCallback(() => {
    setShowConfirm(false);
    confirmShownRef.current = true;
    requestActivation();
  }, [requestActivation]);

  const cancelConfirm = useCallback(() => setShowConfirm(false), []);

  const acceptReconnect = useCallback(() => {
    setSwRestartOffer(false);
    requestActivation();
  }, [requestActivation]);

  const dismissReconnect = useCallback(() => setSwRestartOffer(false), []);

  // --- WS data path + window.excaliAPI ---------------------------------------
  const origin = typeof location !== "undefined" ? location.origin : "";

  useEffect(() => {
    const shouldDial =
      isLocal && masterOn && paired && isActive && !!excalidrawAPIRef.current;
    if (!shouldDial) {
      // teardown: nothing to do here — the session is cleaned up in the return
      // path below only when the deps change; guard via explicit cleanup below
      return;
    }

    const api = excalidrawAPIRef.current;
    let portRef: number | null = null;
    const token = mintBridgeToken(); // ≥128-bit, per activation session
    const session = new AgentBridgeSession({
      origin,
      token,
      onStatus: (status, info) => {
        setConnection(toConnectionStatus(status));
        if (status === "connected") {
          setConnectedPort(info?.port ?? null);
          portRef = info?.port ?? null;
        }
      },
    });
    session.start();

    window.excaliAPI = {
      excalidrawAPI: api,
      ping: () => session.ping(),
      status: () => ({
        connected: session.currentStatus === "connected",
        port: portRef,
      }),
    };

    return () => {
      session.stop();
      if (window.excaliAPI?.excalidrawAPI === api) {
        delete window.excaliAPI;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocal, masterOn, paired, isActive, excalidrawAPI]);

  // keep connection state sane when not dialing
  useEffect(() => {
    if (!isLocal || !masterOn || !paired || !isActive) {
      setConnection("idle");
      setConnectedPort(null);
    }
  }, [isLocal, masterOn, paired, isActive]);

  return {
    masterOn,
    paired,
    isActive,
    connection,
    connectedPort,
    swRestartOffer,
    showConfirm,
    canActivate: isLocal && masterOn && paired,
    toggleActivation,
    confirmActivation,
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
