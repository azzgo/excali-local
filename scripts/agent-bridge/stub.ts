#!/usr/bin/env bun
/**
 * AGENT BRIDGE — throwaway STUB WS server (test harness).
 *
 * Stand-in for the future Go bridge daemon (Wayfinder Ticket 009 — out of scope
 * for this goal). Implements exactly the Leg-B contract this slice needs:
 *   - binds 127.0.0.1 only (loopback) on the FIRST FREE port in the fixed range
 *   - origin allow-list: rejects any WS upgrade whose Origin is not a
 *     chrome-extension://<id> page (Ticket 011 layer 2)
 *   - token handshake: validates the ≥128-bit hex token presented in the
 *     `handshake` command (011 layer 3) — never logs it
 *   - echoes ping → pong (no command set — canvas/gallery/fonts are out of scope)
 *
 * Run:  bun scripts/agent-bridge/stub.ts
 *      ORIGIN=chrome-extension://<id> bun scripts/agent-bridge/stub.ts  (strict)
 */

import {
  BRIDGE_PORTS,
  WS_HANDSHAKE,
  WS_HANDSHAKE_OK,
  WS_HANDSHAKE_ERROR,
  WS_PING,
  WS_PONG,
  isValidBridgeToken,
} from "excali-shared";

// Default allow-list: any extension page origin. Chrome ids are 32 chars [a-p].
const DEFAULT_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
const strictOrigin = process.env.ORIGIN;

const connections = new Set<unknown>();

const originAllowed = (origin: string | null): boolean => {
  if (!origin) return false;
  if (strictOrigin) return origin === strictOrigin;
  return DEFAULT_ORIGIN_RE.test(origin);
};

let server: ReturnType<typeof Bun.serve> | null = null;

for (const port of BRIDGE_PORTS) {
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req, srv) {
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return Response.json({
            ok: true,
            port,
            connections: connections.size,
          });
        }
        const origin = req.headers.get("origin");
        if (!originAllowed(origin)) {
          return new Response("forbidden: origin not allowed", { status: 403 });
        }
        if (srv.upgrade(req, { data: { origin } })) {
          return undefined;
        }
        return new Response("agent-bridge stub — WebSocket or GET /health\n", {
          status: 200,
        });
      },
      websocket: {
        open(ws) {
          connections.add(ws);
          console.log(`[stub] open (origin=${(ws.data as { origin?: string })?.origin})`);
        },
        message(ws, raw) {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          switch (msg.type) {
            case WS_HANDSHAKE: {
              if (isValidBridgeToken(msg.token)) {
                ws.send(JSON.stringify({ type: WS_HANDSHAKE_OK }));
                console.log("[stub] handshake ok");
              } else {
                ws.send(
                  JSON.stringify({
                    type: WS_HANDSHAKE_ERROR,
                    reason: "bad-token",
                  }),
                );
                console.log("[stub] handshake REJECTED (token not ≥128-bit)");
              }
              return;
            }
            case WS_PING:
              ws.send(JSON.stringify({ type: WS_PONG }));
              return;
            default:
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `unknown message type: ${String(msg.type)}`,
                }),
              );
          }
        },
        close(ws) {
          connections.delete(ws);
          console.log("[stub] close");
        },
      },
    });
    break;
  } catch {
    // port taken — try the next one in the range
  }
}

if (!server) {
  // range fully occupied: fall back to an ephemeral port so the harness still works
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("stub fallback", { status: 200 }),
  });
}

console.log(`[stub] listening ws://127.0.0.1:${server.port} (loopback only)`);
console.log(`[stub] health http://127.0.0.1:${server.port}/health`);
