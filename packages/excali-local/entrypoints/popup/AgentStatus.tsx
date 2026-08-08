import { useCallback, useEffect, useRef, useState } from "react";
import { cn, t } from "../lib/utils";
import {
  AB_STATE,
  AB_STATE_QUERY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  AGENT_BRIDGE_STORAGE_KEY,
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_PORTS,
  LEG_A_PROTOCOL_VERSION,
  WS_HANDSHAKE,
  WS_HANDSHAKE_ERROR,
  WS_HANDSHAKE_OK,
  WS_ROLE_AGENT,
  mintBridgeToken,
  type AgentBridgeStatePayload,
  type AgentBridgeStorage,
} from "excali-shared";

/**
 * Agent status indicator (popup) — Wayfinder 033/034 redesign.
 *
 * The pair button is GONE: pairing + per-canvas activation now happen from the
 * always-visible canvas button. The popup is a glanceable indicator only:
 *
 *   grey  "Agent control off"
 *   amber "Waiting for bridge"   (master on, daemon not detected / not paired yet)
 *   green "Paired"                (idle — activate from canvas / another canvas
 *                                  is controlling)
 *   blue  "Controlling: <name>"   (an active canvas is being driven)
 *
 * Daemon detection is a lightweight probe: the popup dials the fixed port range
 * with an "agent"-role handshake (authenticated, never claims the active slot).
 * The active-canvas name comes from the SW (AB_STATE_QUERY), which relays an
 * AB_CANVAS_NAME ask to the active editor tab.
 */

type PopupStatus = "off" | "setup" | "paired" | "active";

/** True when a daemon accepts a handshake on the fixed port range. */
async function probeDaemon(): Promise<boolean> {
  const token = mintBridgeToken();
  for (const port of BRIDGE_PORTS) {
    const ok = await new Promise<boolean>((resolve) => {
      let ws: WebSocket | null = null;
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws?.close();
        } catch {
          /* already closed */
        }
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), BRIDGE_HANDSHAKE_TIMEOUT_MS);
      try {
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
      } catch {
        finish(false);
        return;
      }
      ws.addEventListener("open", () => {
        ws?.send(
          JSON.stringify({
            type: WS_HANDSHAKE,
            token,
            origin: location.origin,
            role: WS_ROLE_AGENT,
            version: LEG_A_PROTOCOL_VERSION,
          }),
        );
      });
      ws.addEventListener("message", (event) => {
        try {
          const m = JSON.parse((event as MessageEvent).data as string) as {
            type?: string;
          };
          if (m.type === WS_HANDSHAKE_OK) finish(true);
          else if (m.type === WS_HANDSHAKE_ERROR) finish(false);
        } catch {
          /* non-JSON frame — keep waiting */
        }
      });
      ws.addEventListener("error", () => finish(false));
      ws.addEventListener("close", () => finish(false));
    });
    if (ok) return true;
  }
  return false;
}

const AgentStatus = () => {
  const [storage, setStorage] = useState<AgentBridgeStorage>(
    AGENT_BRIDGE_DEFAULT_STORAGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [daemonUp, setDaemonUp] = useState(false);
  const [activeCanvas, setActiveCanvas] = useState<{
    activeTabId: number | null;
    canvasName: string | null;
  }>({ activeTabId: null, canvasName: null });
  // Guards against stale async probes after unmount / re-run.
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++generationRef.current;
    const daemon = await probeDaemon();
    if (gen !== generationRef.current) return;
    setDaemonUp(daemon);
    try {
      const reply = (await browser.runtime.sendMessage({
        type: AB_STATE_QUERY,
      })) as Partial<AgentBridgeStatePayload> | undefined;
      if (gen !== generationRef.current) return;
      if (reply?.type === AB_STATE) {
        setActiveCanvas({
          activeTabId: reply.activeTabId ?? null,
          canvasName: reply.canvasName ?? null,
        });
      }
    } catch {
      /* SW busy/restarting — keep the last known state */
    }
  }, []);

  useEffect(() => {
    refresh();
    // The popup is glanceable — re-probe so "Controlling"/"Paired" stays live.
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  // Storage (master / pairing) + live update while the popup is open.
  useEffect(() => {
    browser.storage.local
      .get(AGENT_BRIDGE_STORAGE_KEY)
      .then((result) => {
        const stored = result[AGENT_BRIDGE_STORAGE_KEY] as
          | AgentBridgeStorage
          | undefined;
        setStorage(stored ?? AGENT_BRIDGE_DEFAULT_STORAGE);
      })
      .finally(() => setIsLoading(false));

    const onChange = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => {
      if (area === "local" && changes[AGENT_BRIDGE_STORAGE_KEY]) {
        setStorage(
          (changes[AGENT_BRIDGE_STORAGE_KEY].newValue as AgentBridgeStorage) ??
            AGENT_BRIDGE_DEFAULT_STORAGE,
        );
        void refresh();
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [refresh]);

  if (isLoading) return null;

  const { master, pairing } = storage;
  const controlling = activeCanvas.activeTabId != null;

  // Derive the indicator (controlling takes precedence over daemon-down so a
  // live canvas is never mislabeled "Waiting for bridge" by a flaky probe).
  let status: PopupStatus = "off";
  let text = t("AgentControlOff");
  let meta = "—";
  if (master && !pairing) {
    status = "setup";
    text = t("AgentSetupNeeded");
    meta = t("AgentNoDaemonMeta");
  } else if (master && pairing && controlling && activeCanvas.canvasName) {
    status = "active";
    text = t("AgentControlling");
    meta = activeCanvas.canvasName;
  } else if (master && pairing && controlling) {
    status = "paired";
    text = t("AgentPaired");
    meta = t("AgentOtherCanvasControlling");
  } else if (master && pairing && daemonUp) {
    status = "paired";
    text = t("AgentPaired");
    meta = t("AgentPairedIdleMeta");
  } else if (master && pairing) {
    status = "setup";
    text = t("AgentSetupNeeded");
    meta = t("AgentNoDaemonMeta");
  }

  const ledClass = {
    off: "bg-gray-300 dark:bg-gray-600",
    setup: "bg-amber-500",
    paired: "bg-green-500",
    active: "bg-blue-500 ring-4 ring-blue-500/20",
  }[status];

  return (
    <div className="mb-2">
      <div
        data-testid="agent-status"
        data-status={status}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
      >
        <span className={cn("size-2.5 shrink-0 rounded-full", ledClass)} />
        <span className="text-sm font-medium">{text}</span>
        <span className="ml-auto truncate text-[11px] text-gray-500">
          {meta}
        </span>
      </div>
    </div>
  );
};

export default AgentStatus;
