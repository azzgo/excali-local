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
 *   literal + shape as the extension's chrome.storage key). This is now the
 *   SHARED component `collab-config-section.tsx` (collab-core, task 063) —
 *   the de-duplicated home of the stage machine / dial / masked rows / forget
 *   modal; this file's `WebappConfigForm` is only a thin adapter that injects
 *   the i18next `t` + routes sonner toasts + the back link.
 *
 * Live-session propagation (a config change under a live session → amber
 * banner + manual Reload, NEVER auto-reconnect) lives in config-banner.tsx
 * (mounted on the room screen); this screen's own writes just update in
 * place.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import CollabConfigSection, { type ConfigT } from "collab-core/ui";
import { Button } from "@/components/ui/button";
import { getBrowser } from "@/lib/utils";
import { isLoopbackRelay, maskKey } from "./storage";
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
/* webapp form (049 — full mirror) — thin adapter over the shared       */
/* collab-core config section (task 063).                               */
/* ------------------------------------------------------------------ */

function WebappConfigForm() {
  const [t] = useTranslation();
  // Adapter: the shared component calls t(key) / t(key, {x}) and leaves
  // interpolation to us (i18next `{{x}}`); the test mock returns the key.
  const i18nextT: ConfigT = (key, params) => t(key, params) as string;
  return (
    <CollabConfigSection
      t={i18nextT}
      onToast={({ title, variant }) => {
        if (title === undefined) return;
        if (variant === "destructive") toast.error(title);
        else toast.success(title);
      }}
      onBack={() => {
        window.location.hash = ROUTES.landing;
      }}
    />
  );
}
