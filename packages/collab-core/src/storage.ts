/**
 * Collab identity + server-admission config storage — the single home for the
 * dual-form (chrome.storage.local / localStorage) collab config keys, plus the
 * mint-once collab identity (install uuid + member Ed25519 keypair).
 *
 * Previously this logic lived in THREE copies (Options CollabSection,
 * page use-collab-session.ts, page storage.ts); collab-core is now the single
 * source of truth and the page re-exports it via a thin barrel (task 062).
 *
 * Storage routing mirrors the page's getBrowser() decision: on a real
 * extension page `globalThis.chrome?.storage?.local` exists and is used; on a
 * plain web page (Chromium's `window.chrome` stub has no storage.local) the
 * webapp falls back to localStorage with the SAME key literals.
 */
import { bytesToB64url } from "./envelope";

/** Chrome storage.local surface we rely on (get/set/remove by key). */
interface ChromeStorageLocal {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** @internal storage-area probe: true on real extension pages, false on plain
 * web pages (Chromium's `window.chrome` page stub has no storage.local). This
 * reproduces the page-side getBrowser()'s effective decision without importing
 * excali-shared (collab-core must stay alias/shared-free). */
function chromeStorageLocal(): ChromeStorageLocal | null {
  const chrome = (
    globalThis as {
      chrome?: { storage?: { local?: ChromeStorageLocal } };
    }
  ).chrome;
  return chrome?.storage?.local ?? null;
}

/** chrome.storage.local / localStorage key for the collab identity record. */
export const COLLAB_PROFILE_ID_KEY = "collabProfileId";

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
  const local = chromeStorageLocal();
  if (local) {
    try {
      const result = await local.get(COLLAB_SERVER_CONFIG);
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
 * Write (or clear) the server admission config — the WRITER both forms use.
 * Routes by chrome.storage.local in the extension, localStorage in the webapp
 * form — SAME key literal + SAME stored shape, so every reader
 * (use-server-config, resolveIdentity's raw-config read) works unchanged on
 * both.
 *
 * `null` clears the key (Forget this server, 056 Q7). Throws on storage
 * failure — callers surface the CollabWriteFailed toast.
 */
export async function writeServerConfig(config: ServerConfig | null): Promise<void> {
  const local = chromeStorageLocal();
  if (local) {
    if (config === null) {
      await local.remove(COLLAB_SERVER_CONFIG);
    } else {
      await local.set({ [COLLAB_SERVER_CONFIG]: config });
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

/** Dual-form key read: chrome.storage.local in the extension (raw object),
 * JSON-parsed localStorage on a plain web page. Returns null on absence or
 * storage failure. */
export async function storageGet(key: string): Promise<unknown> {
  const local = chromeStorageLocal();
  if (local) {
    try {
      const result = await local.get(key);
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

/** Dual-form key write: chrome.storage.local in the extension, JSON in
 * localStorage on a plain web page. Swallows storage errors (identity degrades
 * to per-session rather than throwing). */
export async function storageSet(key: string, value: unknown): Promise<void> {
  const local = chromeStorageLocal();
  if (local) {
    try {
      await local.set({ [key]: value });
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

export function isCollabIdentity(value: unknown): value is CollabIdentity {
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

/**
 * Mint a member Ed25519 keypair (057 §3) — seed + public key, b64url.
 * WebCrypto Ed25519 is available on Chrome 113+/Edge 113+/Firefox 129+ (057
 * runtime verification).
 */
export async function mintMemberKeypair(): Promise<{ seed: string; pub: string }> {
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

/**
 * Resolve (or mint-once + persist) the collab identity. Reuses the member
 * keypair already stored in the server config by Options when present, else
 * mints one. `name` defaults to a stable short handle (profileId.slice(0,4)).
 * Returns null on storage/identity failure.
 */
export async function resolveIdentity(
  override?: CollabIdentity,
): Promise<CollabIdentity | null> {
  if (override !== undefined) return override;
  try {
    const stored = await storageGet(COLLAB_PROFILE_ID_KEY);
    if (isCollabIdentity(stored)) return stored;

    // Reuse the Options-minted member keypair when present (mint-once).
    const rawConfig = (await storageGet(COLLAB_SERVER_CONFIG)) as
      | { member?: { seed?: unknown; pub?: unknown } }
      | null;
    const member = rawConfig?.member ?? null;
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

/**
 * Return a NEW CollabIdentity with `name` set to the trimmed value when the
 * trimmed name is non-empty and ≤ 40 chars; otherwise null. Immutable — the
 * input identity is never mutated.
 */
export function updateDisplayName(
  identity: CollabIdentity,
  name: string,
): CollabIdentity | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > 40) return null;
  return { ...identity, name: trimmed };
}
