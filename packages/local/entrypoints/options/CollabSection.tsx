import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconX } from "@tabler/icons-react";
import { t } from "../lib/utils";
import {
  encodeServerInvite,
  parseInvite,
  parsePreview,
  type ServerInvite,
} from "../../../collab-core/src/invites";

/**
 * Options → Collaboration section (Wayfinder 056/054/060).
 *
 * Server-admission configuration surface, rendered after the Font section:
 *   empty (paste field + hint)
 *   → paste → parsed preview (org + relay + key presence, 054 Q6)
 *   → trust confirmation with a LIVE reachability dial (054 Q9) — loopback
 *     relays (060) render a neutral "local relay" badge, never an error
 *   → configured summary: masked sk/ck first4…last4 + per-key transient
 *     reveal (no copy-raw-key, no Regenerate — 054 Q3), member-invite
 *     re-emit with one amber caution line (054 Q4), switch-server inline red
 *     card (054 Q8), "Forget this server" confirm modal (056 Q7, rooms stay
 *     grayed / zero deletion — 048), and the rotation status line
 *     (054 stale.admit copy) driven by a last-known rejection marker.
 *
 * Persistence: chrome.storage.local, key COLLAB_SERVER_CONFIG — every action
 * writes immediately (Options instant-apply rule, CONTEXT.md); no Save
 * button. Reachability is on-demand only (056 Q5): on open, after any save,
 * and on "Check again" — no background poll.
 *
 * NOTE on imports: the parser/encoder come from collab-core/src/invites.ts
 * (the single source of truth — no reimplementation). collab-core's own
 * tsconfig is laxer than this package's (noUncheckedIndexedAccess), so
 * envelope.ts/wire.ts cannot be pulled into this program; the tiny base64url
 * helper below exists only because of that.
 */

/** chrome.storage.local key for the admission config (single-server, 057). */
export const COLLAB_SERVER_CONFIG_KEY = "COLLAB_SERVER_CONFIG";

/** Persisted server-admission config (057 §2 payload + bookkeeping). */
export interface CollabServerConfig {
  /** relay base URL — https:/wss: any host; http:/ws: loopback IPs only (060) */
  relay: string;
  /** org label shown beside the relay URL in trust confirmation (057 §2) */
  org: string;
  /** org Ed25519 seed, 43-char b64url (32 bytes) — client-config only (057 §1) */
  sk: string;
  /** org content key, 43-char b64url (32 bytes) — client-config only (057 §1) */
  ck: string;
  /** optional server fingerprint from the invite (warn-only, 048) */
  fp?: string;
  /** epoch ms of the last adoption (056 configured summary). */
  configuredAt: number;
  /**
   * Member Ed25519 keypair — minted once per profile (057 §3 hello `key`),
   * stored with the config; lazily minted on first adoption and reused on
   * every subsequent switch (PROFILE_ID_STORAGE_KEY mint-once pattern).
   */
  member?: { seed: string; pub: string };
  /**
   * Last-known admission rejection (epoch ms) — written by the collab
   * session (page side) on ADMISSION_INVALID / GCM failure (057 §5), read
   * here to surface the 054 stale.admit status line. Cleared by a fresh
   * invite (056 Q8: "last-known rejection remembered").
   */
  rejectedAt?: number;
}

type Stage = "empty" | "review" | "trust" | "switch" | "summary";
type DialState = "idle" | "checking" | "ok" | "fail";

/** A successfully parsed server invite — keeps the kind discriminator so
 * collab-core's parsePreview can consume it directly (054 Q6). */
type ParsedServerInvite = { kind: "server" } & ServerInvite;

/** 054 Q9 dial timeout (prototype: "timeout 8s"). */
const DIAL_TIMEOUT_MS = 8000;

/** Docs link for the empty state ("How to deploy a relay") — repo README
 *  until the bilingual COLLAB doc lands. */
const COLLAB_DOCS_URL = "https://github.com/azzgo/excali-local";

/** First4…last4 masking convention (054 Q3 — first masking display in Options). */
const maskKey = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

/** 060 §1 loopback carve-out: IP literals 127.0.0.1 / [::1] with a port. */
const isLoopbackRelay = (relay: string): boolean => {
  try {
    const host = new URL(relay).hostname;
    return host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
};

/** Unpadded base64url (049 §4) — local copy of collab-core's bytesToB64url,
 *  which cannot be imported here (see the NOTE on imports above). */
const b64urlEncode = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] ?? 0 : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] ?? 0 : 0;
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
};
const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Mint a member Ed25519 keypair (057 §3) — seed + public key, b64url.
 * WebCrypto Ed25519 is available on Chrome 113+/Edge 113+/Firefox 129+ (057
 * runtime verification); the options page is a secure context.
 */
async function mintMemberKeypair(): Promise<{ seed: string; pub: string }> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  // PKCS#8 for Ed25519 = fixed 16-byte DER prefix || seed (057 §1).
  return {
    seed: b64urlEncode(new Uint8Array(pkcs8).slice(16)),
    pub: b64urlEncode(new Uint8Array(raw)),
  };
}

/**
 * 054 Q9 live reachability dial: converts the relay URL to its WS scheme and
 * opens a WebSocket; resolves with the measured latency, rejects on error /
 * close-before-open / timeout. This is a dial at adoption, not health
 * monitoring (mid-session health stays in Ticket 061).
 */
function dialRelay(relay: string, timeoutMs = DIAL_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws?.close();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("timeout"))),
      timeoutMs,
    );
    try {
      const u = new URL(relay);
      u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
      const started = performance.now();
      ws = new WebSocket(u.toString());
      ws.onopen = () =>
        finish(() => resolve(Math.max(1, Math.round(performance.now() - started))));
      ws.onerror = () => finish(() => reject(new Error("connection error")));
      ws.onclose = () => finish(() => reject(new Error("closed before open")));
    } catch (e) {
      finish(() =>
        reject(e instanceof Error ? e : new Error(String(e))),
      );
    }
  });
}

const CollabSection = () => {
  const [config, setConfig] = useState<CollabServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("empty");
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState<ParsedServerInvite | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dial, setDial] = useState<{ state: DialState; latencyMs: number | null }>({
    state: "idle",
    latencyMs: null,
  });
  const [revealKey, setRevealKey] = useState<"sk" | "ck" | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);

  const dialGenRef = useRef(0); // discard stale dial results
  const configRef = useRef<CollabServerConfig | null>(null); // rollback target

  // ------------------------------------------------------------------
  // load + reachability
  // ------------------------------------------------------------------
  const runDial = useCallback(async (relay: string) => {
    const gen = ++dialGenRef.current;
    setDial({ state: "checking", latencyMs: null });
    try {
      const latencyMs = await dialRelay(relay);
      if (gen === dialGenRef.current) setDial({ state: "ok", latencyMs });
    } catch {
      if (gen === dialGenRef.current) setDial({ state: "fail", latencyMs: null });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    browser.storage.local
      .get(COLLAB_SERVER_CONFIG_KEY)
      .then((result) => {
        if (cancelled) return;
        const stored = result[COLLAB_SERVER_CONFIG_KEY] as
          | CollabServerConfig
          | undefined;
        configRef.current = stored ?? null;
        setConfig(stored ?? null);
        if (stored) {
          // 056 Q5: on-demand check when Options opens.
          setStage("summary");
          void runDial(stored.relay);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runDial]);

  // ------------------------------------------------------------------
  // persistence
  // ------------------------------------------------------------------
  const saveConfig = useCallback(async (invite: ServerInvite) => {
    const prev = configRef.current;
    let next: CollabServerConfig;
    try {
      const member = prev?.member ?? (await mintMemberKeypair());
      next = {
        relay: invite.relay,
        org: invite.org,
        sk: invite.sk,
        ck: invite.ck,
        configuredAt: Date.now(),
        member,
      };
    } catch (err) {
      toast.error(t("CollabWriteFailed"), {
        icon: <IconX className="text-red-500 size-4" />,
        description: err instanceof Error ? err.message : String(err),
        duration: 3000,
      });
      return;
    }
    // Optimistic UI + immediate persistence (instant-apply, no Save button);
    // on failure roll back and toast, mirroring the Font slot pattern.
    configRef.current = next;
    setConfig(next);
    setStage("summary");
    setParsed(null);
    setPasteText("");
    setParseError(null);
    setRevealKey(null);
    setInviteCopied(false);
    setDial({ state: "idle", latencyMs: null });
    try {
      await browser.storage.local.set({ [COLLAB_SERVER_CONFIG_KEY]: next });
      // 056 Q5: re-check right after a save (uses the fresh dial result).
      void runDial(next.relay);
    } catch (err) {
      configRef.current = prev;
      setConfig(prev);
      if (prev === null) setStage("empty");
      toast.error(t("CollabWriteFailed"), {
        icon: <IconX className="text-red-500 size-4" />,
        description: err instanceof Error ? err.message : String(err),
        duration: 3000,
      });
    }
  }, [runDial]);

  const handleForget = useCallback(async () => {
    setForgetOpen(false);
    try {
      await browser.storage.local.remove(COLLAB_SERVER_CONFIG_KEY);
    } catch (err) {
      toast.error(t("CollabWriteFailed"), {
        icon: <IconX className="text-red-500 size-4" />,
        description: err instanceof Error ? err.message : String(err),
        duration: 3000,
      });
      return;
    }
    configRef.current = null;
    setConfig(null);
    setStage("empty");
    setPasteText("");
    setParsed(null);
    setParseError(null);
    setRevealKey(null);
    setInviteCopied(false);
    setDial({ state: "idle", latencyMs: null });
  }, []);

  // ------------------------------------------------------------------
  // paste → parse (054 Q1: sentence + code, or bare code)
  // ------------------------------------------------------------------
  const handleReview = useCallback(() => {
    const result = parseInvite(pasteText);
    setDial({ state: "idle", latencyMs: null });
    if (result.kind === "server") {
      setParsed(result);
      setParseError(null);
      setStage(configRef.current ? "switch" : "review");
    } else if (result.kind === "room") {
      setParsed(null);
      setParseError(t("CollabRoomInviteHere"));
    } else if (result.kind === "error") {
      setParsed(null);
      setParseError(t("CollabInvalidInvite", result.reason));
    } else {
      setParsed(null);
      setParseError(t("CollabInviteNotFound"));
    }
  }, [pasteText]);

  const handleStartSwitch = useCallback(() => {
    setStage("switch");
    setPasteText("");
    setParsed(null);
    setParseError(null);
    setRevealKey(null);
    setInviteCopied(false);
    setDial({ state: "idle", latencyMs: null });
  }, []);

  const handleKeepCurrent = useCallback(() => {
    setStage("summary");
    setParsed(null);
    setPasteText("");
    setParseError(null);
    setDial({ state: "idle", latencyMs: null });
  }, []);

  // 054 Q8 switch flow: the live dial (054 Q9) runs on "Switch server";
  // an OK result adopts the replacement immediately.
  const handleSwitchServer = useCallback(() => {
    if (!parsed) return;
    void runDial(parsed.relay);
  }, [parsed, runDial]);

  useEffect(() => {
    if (stage === "switch" && parsed && dial.state === "ok") {
      void saveConfig(parsed);
    }
  }, [stage, parsed, dial.state, saveConfig]);

  // ------------------------------------------------------------------
  // trust (first adoption) + member invite
  // ------------------------------------------------------------------
  const handleContinue = useCallback(() => {
    if (!parsed) return;
    setStage("trust");
    void runDial(parsed.relay);
  }, [parsed, runDial]);

  const handleCancelTrust = useCallback(() => {
    setStage(configRef.current ? "summary" : "review");
    setDial({ state: "idle", latencyMs: null });
  }, []);

  const memberInviteText = useMemo(() => {
    if (!config) return null;
    try {
      const token = encodeServerInvite({
        relay: config.relay,
        org: config.org,
        sk: config.sk,
        ck: config.ck,
      });
      // 054 Q1: sentence + code; parser regex-extracts the token.
      return `${t("CollabMemberInviteSentence", config.org)}\n${token}`;
    } catch {
      return null;
    }
  }, [config]);

  const handleCopyInvite = useCallback(async () => {
    if (!memberInviteText) return;
    try {
      // Clipboard writes ride user-activation (ADR 0003 — no clipboardWrite).
      await navigator.clipboard.writeText(memberInviteText);
      setInviteCopied(true);
      toast.success(t("CollabCopied"), { duration: 2000 });
    } catch {
      toast.error(t("CollabCopyFailed"));
    }
  }, [memberInviteText]);

  // ------------------------------------------------------------------
  // render helpers
  // ------------------------------------------------------------------
  const pasteField = (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {t("CollabPasteLabel")}
      </label>
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder={t("CollabPastePlaceholder")}
        rows={3}
        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 font-mono text-xs text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm"
      />
      {parseError && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{parseError}</p>
      )}
      <button
        type="button"
        disabled={!pasteText.trim()}
        onClick={handleReview}
        className="mt-3 w-full cursor-pointer rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("CollabPasteAction")}
      </button>
    </div>
  );

  const previewCard = (invite: ParsedServerInvite) => {
    const preview = parsePreview(invite);
    return (
      <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 p-3 dark:bg-gray-800/60">
        <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-xs">
          <span className="text-gray-500">{t("CollabParsedOrg")}</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {invite.org}
          </span>
          <span className="text-gray-500">{t("CollabParsedRelay")}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono break-all text-gray-900 dark:text-white">
              {invite.relay}
            </span>
            {isLoopbackRelay(invite.relay) && (
              <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {t("CollabLocalRelay")}
              </span>
            )}
          </span>
        </div>
        {preview.kind === "server" && preview.hasKeys && (
          <span className="mt-2 inline-block rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
            {t("CollabParsedKeys")}
          </span>
        )}
      </div>
    );
  };

  const unreachableCard = (invite: ServerInvite, onCancel: () => void) => (
    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono break-all text-sm text-red-700 dark:text-red-400">
          {invite.relay}
        </div>
        <span className="shrink-0 rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-400">
          {t("CollabStatusDown")}
        </span>
      </div>
      <div className="mt-1 text-xs text-gray-500">{invite.org}</div>
      {/* 054 srv.unreach.t/b — word-identical, locked copy */}
      <p className="mt-2 text-xs font-semibold text-gray-900 dark:text-white">
        {t("CollabUnreachableTitle")}
      </p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
        {t("CollabUnreachableBody")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runDial(invite.relay)}
          className="cursor-pointer rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
        >
          {t("CollabRetry")}
        </button>
        <button
          type="button"
          onClick={() => void saveConfig(invite)}
          className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {t("CollabSaveAnyway")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-lg border-0 px-3 py-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("Cancel")}
        </button>
      </div>
    </div>
  );

  const badge = (tone: "grey" | "green" | "red", label: string) => (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
        tone === "green"
          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
          : tone === "red"
            ? "border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-400"
            : "border-gray-300 bg-gray-100 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
      }`}
    >
      {label}
    </span>
  );

  // ------------------------------------------------------------------
  // views
  // ------------------------------------------------------------------
  const emptyView = (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">
            {t("CollabNoServer")}
          </div>
          <div className="text-xs text-gray-500">{t("CollabNoServerHint")}</div>
        </div>
        {badge("grey", t("CollabNotConnected"))}
      </div>
      {pasteField}
      <div className="mt-2 text-center">
        <a
          href={COLLAB_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("CollabLearnMore")} ↗
        </a>
      </div>
    </div>
  );

  const reviewView = parsed && (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
        {t("CollabPreviewTitle")}
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2 font-mono text-[11px] break-all text-gray-500 dark:border-gray-600 dark:bg-gray-800/60">
        <div className="font-sans text-[10px] tracking-wide text-gray-400 uppercase">
          {t("CollabPastedLabel")}
        </div>
        {pasteText}
      </div>
      {previewCard(parsed)}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleContinue}
          className="cursor-pointer rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
        >
          {t("CollabContinue")}
        </button>
        <button
          type="button"
          onClick={() => {
            setParsed(null);
            setParseError(null);
            setStage("empty");
          }}
          className="cursor-pointer rounded-lg border-0 px-3 py-1.5 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("Cancel")}
        </button>
      </div>
    </div>
  );

  const trustView = parsed && (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
        {t("CollabTrustTitle")}
      </div>
      {/* 057 §2: trust line shows <URL> · <org label> */}
      <p className="mb-3 text-xs text-gray-500">
        {t("CollabTrustWill")}{" "}
        <span className="font-mono">{parsed.relay}</span> · {parsed.org}
      </p>
      {dial.state === "checking" && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
          <div className="font-mono text-sm break-all text-gray-900 dark:text-white">
            {parsed.relay}
          </div>
          {badge("grey", t("CollabDialing"))}
        </div>
      )}
      {dial.state === "ok" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-sm break-all text-gray-900 dark:text-white">
                {parsed.relay}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {parsed.org} · {t("CollabTrustAdmission")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isLoopbackRelay(parsed.relay) &&
                badge("grey", t("CollabLocalRelay"))}
              {badge(
                "green",
                `${t("CollabTrustOk")} ✓ ${(dial.latencyMs ?? 0) / 1000}s`,
              )}
            </div>
          </div>
        </div>
      )}
      {dial.state === "fail" && unreachableCard(parsed, handleCancelTrust)}
      <p className="mt-3 text-xs text-gray-500">{t("CollabTrustBody")}</p>
      {dial.state !== "fail" && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={dial.state !== "ok"}
            onClick={() => void saveConfig(parsed)}
            className="cursor-pointer rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/* 054 srv.trust.accept — locked copy */}
            {t("CollabTrustConnect")}
          </button>
          <button
            type="button"
            onClick={handleCancelTrust}
            className="cursor-pointer rounded-lg border-0 px-3 py-1.5 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("Cancel")}
          </button>
        </div>
      )}
    </div>
  );

  const switchView = (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      {pasteField}
      {parsed && previewCard(parsed)}
      {parsed &&
        (dial.state === "fail" ? (
          unreachableCard(parsed, handleKeepCurrent)
        ) : (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            {/* 054 srv.replace.t — locked copy */}
            <div className="text-sm font-semibold text-red-700 dark:text-red-400">
              {t("CollabSwitchTitle")}
            </div>
            <p className="mt-1 text-xs text-gray-700 dark:text-gray-200">
              {t(
                "CollabSwitchBodyA",
                `${config?.org ?? ""} · ${config?.relay ?? ""}`,
                `${parsed.org} · ${parsed.relay}`,
              )}
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              {t("CollabSwitchBodyB")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={dial.state === "checking"}
                onClick={handleSwitchServer}
                className="cursor-pointer rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {dial.state === "checking"
                  ? t("CollabDialing")
                  : t("CollabSwitchAction")}
              </button>
              <button
                type="button"
                onClick={handleKeepCurrent}
                className="cursor-pointer rounded-lg border-0 px-3 py-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                {t("CollabKeepCurrent")}
              </button>
            </div>
          </div>
        ))}
    </div>
  );

  const summaryView = config && (
    <div>
      {/* Rotation status line (056 Q8): last-known rejection — 054 stale.admit,
          never blended with "nobody answered" (unreachable). */}
      {config.rejectedAt !== undefined && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-red-700 dark:text-red-400">
              {t("CollabStatusStale")}
            </div>
            {badge("red", t("CollabRejected"))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {config.org} · <span className="font-mono">{config.relay}</span> ·{" "}
            {t("CollabLastCheck")}{" "}
            {new Date(config.rejectedAt).toLocaleTimeString()}
          </p>
          {/* 054 stale.admit.b — locked copy */}
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            {t("CollabStaleBody")}
          </p>
          <button
            type="button"
            onClick={handleStartSwitch}
            className="mt-3 cursor-pointer rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
          >
            {t("CollabPasteFreshInvite")}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {config.org}
            </div>
            <div className="font-mono text-[11px] break-all text-gray-500">
              {config.relay}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isLoopbackRelay(config.relay) && badge("grey", t("CollabLocalRelay"))}
            {dial.state === "checking" && badge("grey", t("CollabDialing"))}
            {dial.state === "ok" && badge("green", t("CollabStatusOk"))}
            {dial.state === "fail" && badge("red", t("CollabStatusDown"))}
          </div>
        </div>

        <div className="mt-1 text-right">
          <button
            type="button"
            onClick={() => void runDial(config.relay)}
            className="cursor-pointer text-[11px] text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("CollabCheckAgain")}
          </button>
        </div>

        {/* Masked sk/ck (054 Q3): first4…last4 + per-key transient reveal,
            full value selectable, no copy-raw-key, no Regenerate. */}
        <div className="mt-2 space-y-2 border-t border-gray-200 pt-3 text-xs dark:border-gray-700">
          {(
            [
              ["sk", config.sk, t("CollabKeySk")],
              ["ck", config.ck, t("CollabKeyCk")],
            ] as const
          ).map(([id, value, label]) => (
            <div
              key={id}
              className="flex items-center justify-between gap-2"
            >
              <span className="shrink-0 text-gray-500">
                {label} <span className="font-mono">{id}</span>
              </span>
              {revealKey === id ? (
                <span
                  key={`${id}-revealed`}
                  tabIndex={-1}
                  autoFocus
                  onBlur={() => setRevealKey(null)}
                  className="flex min-w-0 items-center gap-2"
                >
                  <span className="font-mono break-all text-gray-900 select-all dark:text-white">
                    {value}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRevealKey(null)}
                    className="shrink-0 cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {t("CollabHide")}
                  </button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-gray-900 dark:text-white">
                    {maskKey(value)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRevealKey(id)}
                    className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {t("CollabReveal")}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Member invite (054 Q1/Q4): sentence + code, one amber caution line.
            Re-emits the stored {relay, org, sk, ck} — the same invite received. */}
        <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
          <button
            type="button"
            onClick={() => void handleCopyInvite()}
            className="cursor-pointer rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
          >
            {t("CollabCopyInvite")}
          </button>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            ⚠ {t("CollabCopyCaution")}
          </p>
          {inviteCopied && memberInviteText && (
            <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-white p-2 font-mono text-[11px] break-all text-gray-900 select-all dark:border-gray-600 dark:bg-gray-800 dark:text-white">
              <div className="font-sans text-[10px] tracking-wide text-gray-400 uppercase">
                {t("CollabCopied")}
              </div>
              {memberInviteText}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
          <button
            type="button"
            onClick={handleStartSwitch}
            className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t("CollabPasteNew")}
          </button>
          <button
            type="button"
            onClick={() => setForgetOpen(true)}
            className="ml-auto cursor-pointer rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
          >
            {t("CollabForget")}
          </button>
        </div>
      </div>
    </div>
  );

  const forgetModal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setForgetOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("CollabForgetTitle")}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
      >
        <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">
          {t("CollabForgetTitle")}
        </h3>
        {/* 056 Q7: rooms stay grayed, nothing deleted, restorable by re-paste */}
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
          {t("CollabForgetBody")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setForgetOpen(false)}
            className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleForget()}
            className="cursor-pointer rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            {t("CollabForgetAction")}
          </button>
        </div>
      </div>
    </div>
  );

  if (loading) return null;

  return (
    <div>
      <header className="mb-4">
        <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
          {t("CollabSection")}
        </h2>
        <p className="text-xs text-gray-500">{t("CollabSectionDescription")}</p>
      </header>
      {stage === "empty" && emptyView}
      {stage === "review" && reviewView}
      {stage === "trust" && trustView}
      {stage === "switch" && switchView}
      {stage === "summary" && summaryView}
      {forgetOpen && forgetModal}
    </div>
  );
};

export default CollabSection;
