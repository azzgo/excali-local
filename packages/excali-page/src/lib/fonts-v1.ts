/**
 * fonts/v1 — page-side JSON-RPC dispatcher (Wayfinder Ticket 015, goal 4).
 *
 * PURE module: no React, no browser globals beyond the platform base64/atob,
 * no excalidraw imports. The excali-fonts IndexedDB access (db) is INJECTED,
 * so this exact code runs in the page hook (browser), in vitest, and in the
 * Bun e2e driver.
 *
 * Method inventory (EXACT names per Ticket 015, refined):
 *   PAIRED (routed to the page via the goal-3 control connection):
 *     fonts.get / fonts.assign / fonts.install / fonts.clear
 *   DAEMON-LOCAL (never reaches the page — resolved by the Go daemon):
 *     fonts.system.list (OS font enumeration)
 *
 * Semantics:
 *   - slot ∈ {handwriting, normal, code} = Excalidraw fontFamily 5/6/8 (csp.14).
 *   - fonts.get returns the TRIMMED FontConfig: custom slots serialize as
 *     {type:'custom', family} — NO bytes; system/null as-is.
 *   - fonts.assign (non-blocking): {slot, postscriptName} → system source.
 *   - fonts.install (BLOCKING): {slot, family, data:base64} — validates the
 *     format (magic bytes .ttf/.otf/.woff/.woff2) + size (≤30 MiB) BEFORE the
 *     confirm gate; reject → -32005 on cancel.
 *   - fonts.clear (BLOCKING): {slot} → null.
 *   - Every page-side write returns { config, requiresReload: true } — fonts
 *     inject once at boot (injectCustomFonts → initFontConfig), so a slot
 *     change won't render until the page reloads (hot-swap = fog, out of v1).
 */

/** Reuse gallery/canvas error codes (mirror excali-shared / Go contract). */
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
/** Blocking fonts op rejected by the user on the page's confirm modal. */
export const JSON_RPC_ERROR_USER_CANCELLED = -32005;

/** Mirrors options/CustomFontUpload: 30 MiB custom-font cap. */
export const FONT_SIZE_LIMIT = 30 * 1024 * 1024;

export const FONT_SLOTS = ["handwriting", "normal", "code"] as const;
export type FontSlot = (typeof FONT_SLOTS)[number];

/** Trimmed custom source — NO bytes on the wire (015 wire trimming). */
export type TrimmedFontSource =
  | { type: "system"; postscriptName: string }
  | { type: "custom"; family: string }
  | null;

export interface TrimmedFontConfig {
  handwriting: TrimmedFontSource;
  normal: TrimmedFontSource;
  code: TrimmedFontSource;
}

export interface FontsV1Request {
  jsonrpc: "2.0";
  id: unknown;
  method: string;
  params?: unknown;
}

export interface FontsV1Response {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Injected excali-fonts access — 1:1 with excali-shared db exports. */
export interface FontsV1Db {
  getFontConfig(): Promise<{ handwriting: unknown; normal: unknown; code: unknown } | null>;
  updateFontSlot(slot: FontSlot, source: unknown): Promise<void>;
  clearFontSlot(slot: FontSlot): Promise<void>;
}

export interface FontsV1Deps {
  db: FontsV1Db;
  /** Page-side UX gate for BLOCKING ops (install/clear). Resolve true = proceed. */
  onConfirm?: (info: { method: string; params: Record<string, unknown> }) => Promise<boolean>;
}

class FontsV1Error extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

const invalidParams = (message: string): never => {
  throw new FontsV1Error(JSON_RPC_INVALID_PARAMS, message);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function asRecord(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (isRecord(params)) return params;
  invalidParams("params must be an object");
  throw new Error("unreachable");
}

function asSlot(slot: unknown): FontSlot {
  if (typeof slot === "string" && (FONT_SLOTS as readonly string[]).includes(slot)) {
    return slot as FontSlot;
  }
  invalidParams(`slot must be one of ${FONT_SLOTS.join("|")}`);
  throw new Error("unreachable");
}

/** Detect the font format from MAGIC BYTES (base64 payloads carry no filename). */
function fontFormat(data: Uint8Array): string | null {
  if (data.length < 4) return null;
  const b = (i: number) => data[i];
  if (b(0) === 0x00 && b(1) === 0x01 && b(2) === 0x00 && b(3) === 0x00) return "ttf";
  const tag = String.fromCharCode(b(0), b(1), b(2), b(3));
  if (tag === "OTTO") return "otf";
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  return null;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Trim a raw FontConfig record to the wire shape (custom → family only). */
function trimConfig(config: { handwriting: unknown; normal: unknown; code: unknown } | null): TrimmedFontConfig {
  const empty = (): TrimmedFontConfig => ({ handwriting: null, normal: null, code: null });
  if (!config) return empty();
  const trim = (src: unknown): TrimmedFontSource => {
    if (!src || typeof src !== "object") return null;
    const s = src as { type?: unknown; family?: unknown; postscriptName?: unknown };
    if (s.type === "custom") {
      // Drop data bytes; keep family. (family is agent-supplied on install.)
      return typeof s.family === "string" ? { type: "custom", family: s.family } : null;
    }
    if (s.type === "system" && typeof s.postscriptName === "string") {
      return { type: "system", postscriptName: s.postscriptName };
    }
    return null;
  };
  return {
    handwriting: trim(config.handwriting),
    normal: trim(config.normal),
    code: trim(config.code),
  };
}

async function confirmGate(
  deps: FontsV1Deps,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (!deps.onConfirm) {
    throw new FontsV1Error(JSON_RPC_ERROR_USER_CANCELLED, "cancelled by user (no confirm gate)");
  }
  const ok = await deps.onConfirm({ method, params });
  if (!ok) throw new FontsV1Error(JSON_RPC_ERROR_USER_CANCELLED, "cancelled by user");
}

/** Dispatch one fonts/v1 page request; never throws (errors → error response). */
export async function handleFontsV1Request(
  req: FontsV1Request,
  deps: FontsV1Deps,
): Promise<FontsV1Response> {
  if (req.jsonrpc !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: JSON_RPC_INVALID_REQUEST, message: "invalid request" },
    };
  }
  try {
    const result = await dispatch(req.method, req.params, deps);
    return { jsonrpc: "2.0", id: req.id, result };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: typeof err.code === "number" ? err.code : JSON_RPC_INTERNAL_ERROR,
        message: err.message ?? "internal error",
      },
    };
  }
}

async function dispatch(method: string, params: unknown, deps: FontsV1Deps): Promise<unknown> {
  switch (method) {
    case "fonts.get": {
      const config = await deps.db.getFontConfig();
      return trimConfig(config);
    }

    case "fonts.assign": {
      const p = asRecord(params);
      const slot = asSlot(p.slot);
      if (typeof p.postscriptName !== "string" || p.postscriptName === "") {
        invalidParams("fonts.assign: postscriptName is required");
      }
      // Non-blocking (reversible system-font swap, no bytes — 013/015).
      await deps.db.updateFontSlot(slot, { type: "system", postscriptName: p.postscriptName });
      const config = await deps.db.getFontConfig();
      return { config: trimConfig(config), requiresReload: true };
    }

    case "fonts.install": {
      const p = asRecord(params);
      const slot = asSlot(p.slot);
      if (typeof p.family !== "string" || p.family === "") {
        invalidParams("fonts.install: family is required");
      }
      const family = p.family as string;
      if (typeof p.data !== "string" || p.data === "") {
        invalidParams("fonts.install: data (base64) is required");
      }
      const encodedData = p.data as string;
      // Validate BEFORE the blocking modal — never prompt for an invalid file.
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64(encodedData);
      } catch {
        invalidParams("fonts.install: data is not valid base64");
        throw new Error("unreachable");
      }
      if (fontFormat(bytes) === null) {
        invalidParams("fonts.install: unsupported font format (must be .ttf/.otf/.woff/.woff2)");
      }
      if (bytes.length > FONT_SIZE_LIMIT) {
        invalidParams(`fonts.install: font exceeds the ${FONT_SIZE_LIMIT / (1024 * 1024)} MiB limit`);
      }
      await confirmGate(deps, method, p);
      await deps.db.updateFontSlot(slot, { type: "custom", family, data: bytes });
      const config = await deps.db.getFontConfig();
      return { config: trimConfig(config), requiresReload: true };
    }

    case "fonts.clear": {
      const p = asRecord(params);
      const slot = asSlot(p.slot);
      await confirmGate(deps, method, p);
      await deps.db.clearFontSlot(slot);
      const config = await deps.db.getFontConfig();
      return { config: trimConfig(config), requiresReload: true };
    }

    default:
      // fonts.system.list is daemon-local — the page never sees it.
      throw new FontsV1Error(JSON_RPC_METHOD_NOT_FOUND, "method not found");
  }
}
