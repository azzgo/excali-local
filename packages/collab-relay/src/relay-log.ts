/**
 * collab-relay unified logger.
 *
 * The relay runs on Cloudflare workerd (PartyKit DOs), where Node's
 * process/stream internals and libraries like pino are unavailable or
 * unreliable. Cloudflare + PartyKit recommend plain `console` with
 * structured (object) args, which Workers Logs indexes natively.
 *
 * This module gives every relay module one logging entry point:
 *   - one `[relay]` namespace prefix (mirrors client's `[collab]`)
 *   - leveled `debug` / `info` / `warn` / `error`
 *   - `debug` is opt-in behind a module-level gate — NOT permanent noise
 *
 * The gate is set by the composition host once it can read the relay env
 * (workerd has no global `process.env`; vars arrive per-room via `room.env`).
 * Default is OFF so behavior is silent in normal runs; flip it on only while
 * debugging a specific issue (e.g. ghost-connection diagnosis).
 */

export type RelayLogLevel = "debug" | "info" | "warn" | "error";

/** Module-level debug gate — default off (workerd has no global process.env). */
let debugEnabled = false;

/**
 * Turn relay `debug` output on/off. Called once by the party.config host
 * after reading the room env (or via a test setup / env override). Idempotent,
 * safe to call multiple times.
 */
export function configureRelayLog(opts: { debug?: boolean }): void {
  if (typeof opts.debug === "boolean") debugEnabled = opts.debug;
}

/** Read the current debug-gate state (test/observability aid). */
export function relayDebugEnabled(): boolean {
  return debugEnabled;
}

function emit(level: RelayLogLevel, namespace: string, message: string, ...args: unknown[]): void {
  const rest = args.length > 0 ? [`[ctx]`, namespace, ...args] : [`[ctx]`, namespace];
  switch (level) {
    case "debug":
      if (debugEnabled) console.log("[relay]", `[${level}]`, ...rest, message);
      break;
    case "info":
      console.log("[relay]", `[${level}]`, ...rest, message);
      break;
    case "warn":
      console.warn("[relay]", `[${level}]`, ...rest, message);
      break;
    case "error":
      console.error("[relay]", `[${level}]`, ...rest, message);
      break;
  }
}

/** A namespaced logger bound to a module/component label (e.g. "server", "room"). */
export interface RelayLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Create a logger bound to a namespace label. Cheap — call at module scope once. */
export function createRelayLog(namespace: string): RelayLogger {
  return {
    debug: (m, ...a) => emit("debug", namespace, m, ...a),
    info: (m, ...a) => emit("info", namespace, m, ...a),
    warn: (m, ...a) => emit("warn", namespace, m, ...a),
    error: (m, ...a) => emit("error", namespace, m, ...a),
  };
}
