/**
 * Server admission config — #config route (Wayfinder 056 Q2/Q3/Q5/Q6/Q7/Q8).
 *
 * Two forms, branched on getBrowser() (use-agent-bridge storage pattern):
 *
 * - EXTENSION form (getBrowser() non-null): READ-ONLY summary shell —
 *   org/URL + masked sk/ck + "Manage in Options" (runtime.openOptionsPage);
 *   paste/trust/switch happen at first-run landing and in Options only.
 * - WEBAPP form (getBrowser() null, task 049): the FULL mirror of the Options
 *   Collaboration section on localStorage (key COLLAB_SERVER_CONFIG — same
 *   literal + shape as the extension's chrome.storage key, storage.ts is the
 *   single reader/writer): empty paste card → parsed preview (org + relay +
 *   key presence, 054 Q6) → trust card with a LIVE reachability dial (054 Q9,
 *   dialServer; loopback relays 060 render a neutral badge, never an error) →
 *   configured summary: masked sk/ck first4…last4 + per-key transient reveal
 *   (056 Q3), Check again (on-demand, 056 Q5), switch-server inline red card
 *   (054 Q8), "Forget this server" confirm modal (056 Q7 — rooms stay grayed,
 *   nothing deleted), rotation red status line + paste-fresh-invite CTA
 *   (056 Q8 / 054 stale.admit copy), member-invite re-emit with one amber
 *   caution line (054 Q1/Q4).
 *
 * Live-session propagation (a config change under a live session → amber
 * banner + manual Reload, NEVER auto-reconnect) lives in config-banner.tsx
 * (mounted on the room screen); this screen's own writes just update in
 * place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  encodeServerInvite,
  parsePreview,
  type InvitePreview,
  type ServerInvite,
} from "collab-core";
import { Button } from "@/components/ui/button";
import { getBrowser } from "@/lib/utils";
import {
  isLoopbackRelay,
  maskKey,
  readServerConfig,
  writeServerConfig,
  type ServerConfig,
} from "./storage";
import { dialServer, parsePastedInvite, copyText } from "./invite";
import { useServerConfig } from "./hooks/use-server-config";
import { ROUTES } from "./routes";

interface ConfigScreenProps {
  lang: string;
}

export default function ConfigScreen({ lang }: ConfigScreenProps) {
  // 056 Q2: extension form = read-only summary; webapp form = full mirror
  // (getBrowser()-null pattern from use-agent-bridge.ts).
  return getBrowser() !== null ? <ExtensionConfigForm /> : <WebappConfigForm />;
}

/* ------------------------------------------------------------------ */
/* extension form (042 shell — read-only summary + Manage in Options)  */
/* ------------------------------------------------------------------ */

function MaskedKeyRow({
  labelKey,
  testId,
  value,
  revealed,
  onReveal,
  onHide,
}: {
  labelKey: string;
  testId: string;
  value: string;
  revealed: boolean;
  onReveal: () => void;
  onHide: () => void;
}) {
  const [t] = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs break-all">
          {revealed ? value : maskKey(value)}
        </span>
        <button
          data-testid={testId}
          onClick={revealed ? onHide : onReveal}
          onBlur={onHide}
          className="shrink-0 cursor-pointer rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {revealed ? t("CollabConfigHide") : t("CollabConfigReveal")}
        </button>
      </span>
    </div>
  );
}

function ExtensionConfigForm() {
  const [t] = useTranslation();
  const { config, loaded } = useServerConfig();
  const [revealed, setRevealed] = useState<"sk" | "ck" | null>(null);

  if (!loaded) return null;

  return (
    <div
      data-testid="collab-config"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">{t("CollabConfigTitle")}</h1>

        {config === null ? (
          <div className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs">
            <div className="font-medium">{t("CollabLandingNoServer")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("CollabConfigEmptyHint")}</p>
          </div>
        ) : (
          <div
            data-testid="collab-config-summary"
            className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs"
          >
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs text-muted-foreground">{t("CollabOrg")}</span>
              <span className="font-medium">{config.org}</span>
            </div>
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs text-muted-foreground">{t("CollabRelayUrl")}</span>
              <span className="flex items-center gap-2 font-mono text-xs break-all">
                {config.relay}
                {isLoopbackRelay(config.relay) && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t("CollabLocalRelay")}
                  </span>
                )}
              </span>
            </div>
            {/* 056 Q3: masked sk/ck (first4…last4) + per-key transient reveal;
                revealed state collapses on blur; no copy-raw-key (the invite
                text is the sanctioned format) */}
            <MaskedKeyRow
              labelKey="CollabConfigSk"
              testId="collab-config-reveal-sk"
              value={config.sk}
              revealed={revealed === "sk"}
              onReveal={() => setRevealed("sk")}
              onHide={() => setRevealed(null)}
            />
            <MaskedKeyRow
              labelKey="CollabConfigCk"
              testId="collab-config-reveal-ck"
              value={config.ck}
              revealed={revealed === "ck"}
              onReveal={() => setRevealed("ck")}
              onHide={() => setRevealed(null)}
            />
          </div>
        )}

        <div className="mt-3 space-y-2">
          <Button
            data-testid="collab-config-manage-options"
            className="w-full"
            onClick={() => getBrowser()?.runtime?.openOptionsPage?.()}
          >
            {t("CollabManageInOptions")}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              window.location.hash = ROUTES.landing;
            }}
          >
            {t("CollabBack")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* webapp form (049 — full mirror of the Options Collaboration section) */
/* ------------------------------------------------------------------ */

type Stage = "empty" | "review" | "trust" | "switch" | "summary";
type DialState = "idle" | "checking" | "ok" | "fail" | "skipped";

/** A successfully parsed server invite — keeps the kind discriminator so
 * collab-core's parsePreview can consume it directly (054 Q6). */
type ParsedServerInvite = { kind: "server" } & ServerInvite;

/** Docs link for the empty state ("How to deploy a relay"). */
const COLLAB_DOCS_URL = "https://github.com/azzgo/excali-local";

function WebappConfigForm() {
  const [t] = useTranslation();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState<Stage>("empty");
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState<ParsedServerInvite | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dial, setDial] = useState<{ state: DialState }>({ state: "idle" });
  const [revealKey, setRevealKey] = useState<"sk" | "ck" | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);

  const dialGenRef = useRef(0); // discard stale dial results
  const configRef = useRef<ServerConfig | null>(null); // rollback target
  configRef.current = config;

  // ------------------------------------------------------------------
  // load + reachability (056 Q5: on-demand — on open, after save, Check again)
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void readServerConfig().then((stored) => {
      if (cancelled) return;
      setConfig(stored);
      setLoaded(true);
      if (stored !== null) {
        setStage("summary");
        void runDial(stored.relay);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDial = useCallback(async (relay: string) => {
    const gen = ++dialGenRef.current;
    setDial({ state: "checking" });
    const result = await dialServer(relay); // 060: loopback → "skipped", never probed
    if (gen !== dialGenRef.current) return;
    setDial({
      state: result === "ok" ? "ok" : result === "skipped" ? "skipped" : "fail",
    });
  }, []);

  // ------------------------------------------------------------------
  // persistence (instant-apply — no Save button, mirrors Options)
  // ------------------------------------------------------------------
  const saveConfig = useCallback(
    async (invite: ServerInvite) => {
      const prev = configRef.current;
      const next: ServerConfig = {
        relay: invite.relay,
        org: invite.org,
        sk: invite.sk,
        ck: invite.ck,
        configuredAt: Date.now(),
        // 057 §3 mint-once: reuse the member keypair from the previous config
        // (a fresh invite CLEARS the last-known rejection, 056 Q8).
        ...(prev?.member !== undefined ? { member: prev.member } : {}),
      };
      try {
        await writeServerConfig(next);
      } catch (err) {
        toast.error(t("CollabWriteFailed"), {
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      configRef.current = next;
      setConfig(next);
      setStage("summary");
      setParsed(null);
      setPasteText("");
      setParseError(null);
      setRevealKey(null);
      setInviteCopied(false);
      setDial({ state: "idle" });
      // 056 Q5: re-check right after a save.
      void runDial(next.relay);
    },
    [runDial, t],
  );

  const handleForget = useCallback(async () => {
    setForgetOpen(false);
    try {
      await writeServerConfig(null);
    } catch (err) {
      toast.error(t("CollabWriteFailed"), {
        description: err instanceof Error ? err.message : String(err),
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
    setDial({ state: "idle" });
  }, [t]);

  // ------------------------------------------------------------------
  // paste → parse (054 Q1: sentence + code, or bare code)
  // ------------------------------------------------------------------
  const handleReview = useCallback(() => {
    const result = parsePastedInvite(pasteText);
    setDial({ state: "idle" });
    if (result.kind === "server") {
      setParsed(result);
      setParseError(null);
      setStage(configRef.current !== null ? "switch" : "review");
    } else if (result.kind === "room") {
      setParsed(null);
      setParseError(t("CollabRoomInviteHere"));
    } else if (result.kind === "error") {
      setParsed(null);
      setParseError(t("CollabConfigInviteInvalid", { reason: result.reason }));
    } else {
      setParsed(null);
      setParseError(t("CollabConfigInviteNotFound"));
    }
  }, [pasteText, t]);

  const handleStartSwitch = useCallback(() => {
    setStage("switch");
    setPasteText("");
    setParsed(null);
    setParseError(null);
    setRevealKey(null);
    setInviteCopied(false);
    setDial({ state: "idle" });
  }, []);

  const handleKeepCurrent = useCallback(() => {
    setStage("summary");
    setParsed(null);
    setPasteText("");
    setParseError(null);
    setDial({ state: "idle" });
  }, []);

  // 054 Q8 switch flow: the live dial (054 Q9) runs on "Switch server";
  // an OK result adopts the replacement immediately.
  const handleSwitchServer = useCallback(() => {
    if (parsed === null) return;
    void runDial(parsed.relay);
  }, [parsed, runDial]);

  useEffect(() => {
    if (stage === "switch" && parsed !== null && dial.state === "ok") {
      void saveConfig(parsed);
    }
  }, [stage, parsed, dial.state, saveConfig]);

  // ------------------------------------------------------------------
  // trust (first adoption) + member invite
  // ------------------------------------------------------------------
  const handleContinue = useCallback(() => {
    if (parsed === null) return;
    setStage("trust");
    void runDial(parsed.relay);
  }, [parsed, runDial]);

  const handleCancelTrust = useCallback(() => {
    setStage(configRef.current !== null ? "summary" : "review");
    setDial({ state: "idle" });
  }, []);

  const memberInviteText = useMemo<null | string>(() => {
    if (config === null) return null;
    try {
      const token = encodeServerInvite({
        relay: config.relay,
        org: config.org,
        sk: config.sk,
        ck: config.ck,
      });
      // 054 Q1: sentence + code; parser regex-extracts the token.
      return `${t("CollabServerClipboard", { org: config.org })}\n${token}`;
    } catch {
      return null;
    }
  }, [config, t]);

  const handleCopyInvite = useCallback(async () => {
    if (memberInviteText === null) return;
    const ok = await copyText(memberInviteText);
    if (ok) {
      setInviteCopied(true);
      toast.success(t("CollabCopied"), { duration: 2000 });
    } else {
      toast.error(t("CollabCopyFailed"));
    }
  }, [memberInviteText, t]);

  // ------------------------------------------------------------------
  // render helpers
  // ------------------------------------------------------------------
  const pasteField = (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{t("CollabPasteLabel")}</label>
      <textarea
        data-testid="collab-config-paste"
        value={pasteText}
        onChange={(e) => {
          setPasteText(e.target.value);
          setParseError(null);
        }}
        placeholder={t("CollabPastePlaceholder")}
        rows={3}
        className="mt-1 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      />
      {parseError !== null && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{parseError}</p>
      )}
      <Button
        data-testid="collab-config-review"
        className="mt-3 w-full"
        disabled={pasteText.trim() === ""}
        onClick={handleReview}
      >
        {t("CollabPasteAction")}
      </Button>
    </div>
  );

  const previewCard = (invite: ParsedServerInvite) => {
    const preview: Extract<InvitePreview, { kind: "server" }> | null =
      parsePreview(invite).kind === "server"
        ? (parsePreview(invite) as Extract<InvitePreview, { kind: "server" }>)
        : null;
    return (
      <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs">
        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-muted-foreground">{t("CollabParsedOrg")}</span>
          <span className="font-medium">{invite.org}</span>
        </div>
        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-muted-foreground">{t("CollabParsedRelay")}</span>
          <span className="flex items-center gap-2 font-mono break-all">
            {invite.relay}
            {isLoopbackRelay(invite.relay) && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("CollabLocalRelay")}
              </span>
            )}
          </span>
        </div>
        {preview !== null && preview.hasKeys && (
          <span className="mt-2 inline-block rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
            {t("CollabParsedKeys")}
          </span>
        )}
      </div>
    );
  };

  const unreachableCard = (invite: ParsedServerInvite, onCancel: () => void) => (
    <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono break-all text-red-700 dark:text-red-400">
          {invite.relay}
        </span>
        <span className="shrink-0 rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-400">
          {t("CollabStatusDown")}
        </span>
      </div>
      <div className="mt-1 text-muted-foreground">{invite.org}</div>
      {/* 054 srv.unreach.t/b — word-identical, locked copy */}
      <p className="mt-2 font-semibold text-red-700 dark:text-red-400">
        {t("CollabSrvUnreachTitle")}
      </p>
      <p className="mt-1 text-red-700/80 dark:text-red-400/80">{t("CollabSrvUnreachBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          data-testid="collab-config-retry"
          size="sm"
          variant="outline"
          onClick={() => void runDial(invite.relay)}
        >
          {t("CollabRetry")}
        </Button>
        <Button
          data-testid="collab-config-save-anyway"
          size="sm"
          onClick={() => void saveConfig(invite)}
        >
          {t("CollabSaveAnyway")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("CollabCancel")}
        </Button>
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
            : "border-gray-300 bg-muted text-muted-foreground dark:border-gray-600"
      }`}
    >
      {label}
    </span>
  );

  const noteBanner = (
    <div
      data-testid="collab-config-note"
      className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
    >
      🌐 {t("CollabConfigWebappNote")}
    </div>
  );

  // ------------------------------------------------------------------
  // views
  // ------------------------------------------------------------------
  const emptyView = (
    <div className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">{t("CollabNoServer")}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{t("CollabNoServerHint")}</div>
        </div>
        {badge("grey", t("CollabLandingNotConnected"))}
      </div>
      <div className="mt-3">{pasteField}</div>
      <div className="mt-2 text-center">
        <a
          href={COLLAB_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="cursor-pointer text-xs text-primary hover:underline"
        >
          {t("CollabLearnMore")} ↗
        </a>
      </div>
    </div>
  );

  const reviewView =
    parsed !== null && (
      <div className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs">
        <div className="font-semibold">{t("CollabPreviewTitle")}</div>
        <div className="mt-2 rounded-lg border border-dashed bg-muted/40 p-2 font-mono text-[11px] break-all text-muted-foreground">
          <div className="font-sans text-[10px] tracking-wide text-muted-foreground uppercase">
            {t("CollabPastedLabel")}
          </div>
          {pasteText}
        </div>
        {previewCard(parsed)}
        <div className="mt-3 flex gap-2">
          <Button data-testid="collab-config-continue" className="flex-1" onClick={handleContinue}>
            {t("CollabContinue")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setParsed(null);
              setParseError(null);
              setStage("empty");
            }}
          >
            {t("CollabCancel")}
          </Button>
        </div>
      </div>
    );

  const trustView =
    parsed !== null && (
      <div className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs">
        <div className="font-semibold">{t("CollabTrustTitle")}</div>
        {/* 057 §2: trust line shows <URL> · <org label> */}
        <p className="mt-1 text-xs text-muted-foreground break-all">
          {t("CollabTrustWill")} <span className="font-mono">{parsed.relay}</span> ·{" "}
          {parsed.org}
        </p>
        {dial.state === "checking" && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
            <span className="font-mono text-sm break-all">{parsed.relay}</span>
            {badge("grey", t("CollabDialing"))}
          </div>
        )}
        {(dial.state === "ok" || dial.state === "skipped") && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-sm break-all">{parsed.relay}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {parsed.org} · {t("CollabTrustAdmission")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {isLoopbackRelay(parsed.relay) && badge("grey", t("CollabLocalRelay"))}
                {dial.state === "ok" && badge("green", t("CollabTrustOk"))}
              </div>
            </div>
          </div>
        )}
        {dial.state === "fail" && unreachableCard(parsed, handleCancelTrust)}
        <p className="mt-3 text-xs text-muted-foreground">{t("CollabTrustBody")}</p>
        {dial.state !== "fail" && (
          <div className="mt-3 flex gap-2">
            <Button
              data-testid="collab-config-trust-connect"
              className="flex-1"
              disabled={dial.state !== "ok" && dial.state !== "skipped"}
              onClick={() => void saveConfig(parsed)}
            >
              {/* 054 srv.trust.accept — locked copy */}
              {t("CollabTrustConnect")}
            </Button>
            <Button variant="ghost" onClick={handleCancelTrust}>
              {t("CollabCancel")}
            </Button>
          </div>
        )}
      </div>
    );

  const switchView = (
    <div className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs">
      {pasteField}
      {parsed !== null &&
        (dial.state === "fail" ? (
          unreachableCard(parsed, handleKeepCurrent)
        ) : (
          <>
            {previewCard(parsed)}
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10">
              {/* 054 srv.replace.t — locked copy */}
              <div className="font-semibold text-red-700 dark:text-red-400">
                {t("CollabSwitchTitle")}
              </div>
              <p className="mt-1 text-red-700/80 dark:text-red-400/80">
                {t("CollabSwitchBodyA", {
                  old: `${config?.org ?? ""} · ${config?.relay ?? ""}`,
                  new: `${parsed.org} · ${parsed.relay}`,
                })}
              </p>
              <p className="mt-1 text-red-700/60 dark:text-red-400/60">
                {t("CollabSwitchBodyB")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  data-testid="collab-config-switch-action"
                  size="sm"
                  variant="destructive"
                  disabled={dial.state === "checking"}
                  onClick={handleSwitchServer}
                >
                  {dial.state === "checking" ? t("CollabDialing") : t("CollabSwitchAction")}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleKeepCurrent}>
                  {t("CollabKeepCurrent")}
                </Button>
              </div>
            </div>
          </>
        ))}
    </div>
  );

  const summaryView =
    config !== null && (
      <div>
        {/* Rotation status line (056 Q8): last-known rejection — 054 stale.admit
            copy, never blended with "nobody answered" (unreachable). */}
        {config.rejectedAt !== undefined && (
          <div
            data-testid="collab-config-rotation"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-red-700 dark:text-red-400">
                {t("CollabStatusStale")}
              </div>
              {badge("red", t("CollabRejected"))}
            </div>
            <p className="mt-1 text-muted-foreground">
              {config.org} · <span className="font-mono">{config.relay}</span> ·{" "}
              {t("CollabLastCheck")}{" "}
              {new Date(config.rejectedAt).toLocaleTimeString()}
            </p>
            <p className="mt-1 text-red-700/80 dark:text-red-400/80">{t("CollabStaleBody")}</p>
            <Button
              data-testid="collab-config-paste-fresh"
              size="sm"
              className="mt-3"
              onClick={handleStartSwitch}
            >
              {t("CollabPasteFreshInvite")}
            </Button>
          </div>
        )}

        <div
          data-testid="collab-config-summary"
          className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">{config.org}</div>
              <div className="font-mono text-xs break-all text-muted-foreground">
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

          {/* 056 Q5: reachability is on-demand — Check again, no background poll */}
          <div className="mt-1 text-right">
            <button
              data-testid="collab-config-check-again"
              onClick={() => void runDial(config.relay)}
              className="cursor-pointer text-[11px] text-primary hover:underline"
            >
              {t("CollabCheckAgain")}
            </button>
          </div>

          {/* Masked sk/ck (054 Q3): first4…last4 + per-key transient reveal,
              full value selectable, no copy-raw-key, no Regenerate. */}
          <div className="mt-2 space-y-2 border-t pt-3">
            <MaskedKeyRow
              labelKey="CollabKeySk"
              testId="collab-config-reveal-sk"
              value={config.sk}
              revealed={revealKey === "sk"}
              onReveal={() => setRevealKey("sk")}
              onHide={() => setRevealKey(null)}
            />
            <MaskedKeyRow
              labelKey="CollabKeyCk"
              testId="collab-config-reveal-ck"
              value={config.ck}
              revealed={revealKey === "ck"}
              onReveal={() => setRevealKey("ck")}
              onHide={() => setRevealKey(null)}
            />
          </div>

          {/* Member invite (054 Q1/Q4): sentence + code, one amber caution
              line. Re-emits the stored {relay, org, sk, ck} — the same invite
              received. */}
          <div className="mt-3 border-t pt-3">
            <Button
              data-testid="collab-config-copy-invite"
              size="sm"
              onClick={() => void handleCopyInvite()}
            >
              {t("CollabCopyMemberInvite")}
            </Button>
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              ⚠ {t("CollabCopyCaution")}
            </p>
            {inviteCopied && memberInviteText !== null && (
              <div className="mt-2 rounded-lg border border-dashed bg-muted/40 p-2 font-mono text-[11px] break-all select-all">
                <div className="font-sans text-[10px] tracking-wide text-muted-foreground uppercase">
                  {t("CollabCopied")}
                </div>
                {memberInviteText}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              data-testid="collab-config-paste-new"
              size="sm"
              variant="outline"
              onClick={handleStartSwitch}
            >
              {t("CollabPasteNew")}
            </Button>
            <Button
              data-testid="collab-config-forget"
              size="sm"
              variant="destructive"
              className="ml-auto"
              onClick={() => setForgetOpen(true)}
            >
              {t("CollabForget")}
            </Button>
          </div>
        </div>
      </div>
    );

  const forgetModal = forgetOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setForgetOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("CollabForgetTitle")}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-lg"
      >
        <h3 className="mb-2 text-base font-semibold">{t("CollabForgetTitle")}</h3>
        {/* 056 Q7: rooms stay grayed, nothing deleted, restorable by re-paste */}
        <p className="mb-4 text-sm text-muted-foreground">{t("CollabForgetBody")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setForgetOpen(false)}>
            {t("CollabCancel")}
          </Button>
          <Button
            data-testid="collab-config-forget-confirm"
            variant="destructive"
            onClick={() => void handleForget()}
          >
            {t("CollabForgetAction")}
          </Button>
        </div>
      </div>
    </div>
  );

  if (!loaded) return null;

  return (
    <div
      data-testid="collab-config"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">{t("CollabConfigTitle")}</h1>
        {/* 056 webapp banner (verbatim): the config lives in THIS browser */}
        {noteBanner}

        {stage === "empty" && emptyView}
        {stage === "review" && reviewView}
        {stage === "trust" && trustView}
        {stage === "switch" && switchView}
        {stage === "summary" && summaryView}

        <div className="mt-3 space-y-2">
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              window.location.hash = ROUTES.landing;
            }}
          >
            {t("CollabBack")}
          </Button>
        </div>
      </div>
      {forgetModal}
    </div>
  );
}
