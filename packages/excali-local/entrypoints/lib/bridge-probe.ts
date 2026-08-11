import {
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_PORTS,
  LEG_A_PROTOCOL_VERSION,
  WS_HANDSHAKE,
  WS_HANDSHAKE_ERROR,
  WS_HANDSHAKE_OK,
  WS_ROLE_AGENT,
  mintBridgeToken,
} from "excali-shared";

/**
 * Shared daemon probes for the shell (popup + options).
 *
 * The popup needs the WS-level probe (an authenticated agent-role handshake —
 * proves the daemon accepts our auth stack), while the options daemon-stop
 * pill needs the cheap HTTP /health probe to render running/stopped.
 */

/** True when a daemon accepts an agent-role handshake on the fixed port range. */
export async function probeDaemon(): Promise<boolean> {
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

/** HTTP /health probe across the fixed bridge port range (options daemon pill). */
export async function probeDaemonHealth(): Promise<{
  ok: boolean;
  port: number | null;
}> {
  for (const port of BRIDGE_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (!res.ok) continue;
      const body = (await res.json()) as { ok?: unknown };
      if (body?.ok === true) return { ok: true, port };
    } catch {
      // connection refused / non-JSON body — try the next port
    }
  }
  return { ok: false, port: null };
}
