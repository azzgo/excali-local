/**
 * Server admission config storage (Wayfinder 056 Q2).
 *
 * The Options section (packages/local) and the webapp mirror (task 049) are
 * the WRITERS of this key; the CollabEditor screens are READ-ONLY consumers
 * (056 Q2: extension `#config` = read-only summary + "Manage in Options";
 * landing shows a "not configured" hint). The key literal lives here for the
 * page side — the Options-side writer must use the identical string:
 *
 *   chrome.storage.local["COLLAB_SERVER_CONFIG"]  — extension form
 *   localStorage["COLLAB_SERVER_CONFIG"]          — webapp form (getBrowser() null)
 *
 * Stored shape (057 §2): the server invite payload {relay, org, sk, ck}.
 * sk/ck are never shown raw — masked first4…last4 + transient reveal (056 Q3).
 */
import { getBrowser } from "@/lib/utils";

export const COLLAB_SERVER_CONFIG = "COLLAB_SERVER_CONFIG";

export interface ServerConfig {
  /** relay base URL — https:/wss: any host; http:/ws: loopback IPs only (060) */
  relay: string;
  /** org label shown beside the relay URL (057 §2) */
  org: string;
  /** org Ed25519 seed, 43-char b64url (32 bytes) — never rendered raw */
  sk: string;
  /** org content key, 43-char b64url (32 bytes) — never rendered raw */
  ck: string;
  /** optional server fingerprint from the invite (warn-only, 048) */
  fp?: string;
  /** epoch ms of the last adoption (056 configured summary). */
  configuredAt?: number;
  /** member Ed25519 keypair (057 §3) — minted by Options at adoption,
   * preserved on rewrite so the session reuses it (mint-once). */
  member?: { seed: string; pub: string };
  /** last-known admission rejection (epoch ms) — 056 Q8 rotation line. */
  rejectedAt?: number;
}

export function isServerConfig(value: unknown): value is ServerConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.relay === "string" &&
    v.relay !== "" &&
    typeof v.org === "string" &&
    v.org !== "" &&
    typeof v.sk === "string" &&
    v.sk !== "" &&
    typeof v.ck === "string" &&
    v.ck !== ""
  );
}

/** Accepts a stored object or a JSON-encoded string (localStorage form). */
export function parseStoredConfig(raw: unknown): ServerConfig | null {
  if (isServerConfig(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return isServerConfig(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function readServerConfig(): Promise<ServerConfig | null> {
  const browser = getBrowser();
  if (browser?.storage?.local) {
    try {
      const result = await browser.storage.local.get(COLLAB_SERVER_CONFIG);
      return parseStoredConfig(result[COLLAB_SERVER_CONFIG]);
    } catch {
      return null;
    }
  }
  try {
    return parseStoredConfig(
      globalThis.localStorage?.getItem(COLLAB_SERVER_CONFIG) ?? null,
    );
  } catch {
    return null;
  }
}

/** Masked secret display convention (056 Q3): first4…last4. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Loopback relay carve-out (060 §1): http:/ws: accepted only for the IP
 * literals 127.0.0.1 / [::1] — renders with a neutral "local relay" badge,
 * never as an error state (056).
 */
export function isLoopbackRelay(relay: string): boolean {
  try {
    const host = new URL(relay).hostname;
    return host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Write (or clear) the server admission config — the WRITER both forms use
 * (the Options section writes chrome.storage directly; the webapp mirror,
 * task 049, calls this). Routes by getBrowser(): chrome.storage.local in the
 * extension, localStorage in the webapp form (getBrowser() null) — SAME key
 * literal + SAME stored shape, so every reader (use-server-config,
 * use-collab-session's readRawServerConfig) works unchanged on both.
 *
 * `null` clears the key (Forget this server, 056 Q7). Throws on storage
 * failure — callers surface the CollabWriteFailed toast.
 */
export async function writeServerConfig(config: ServerConfig | null): Promise<void> {
  const browser = getBrowser();
  if (browser?.storage?.local) {
    if (config === null) {
      await browser.storage.local.remove(COLLAB_SERVER_CONFIG);
    } else {
      await browser.storage.local.set({ [COLLAB_SERVER_CONFIG]: config });
    }
    return;
  }
  try {
    if (config === null) {
      globalThis.localStorage?.removeItem(COLLAB_SERVER_CONFIG);
    } else {
      globalThis.localStorage?.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(config));
    }
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}
