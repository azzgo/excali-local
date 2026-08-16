import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getBrowser } from "@/lib/utils";
import { isLoopbackRelay, maskKey } from "./storage";
import { useServerConfig } from "./hooks/use-server-config";
import { ROUTES } from "./routes";

interface ConfigScreenProps {
  lang: string;
}

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

/**
 * Server admission config — READ-ONLY summary shell (056 Q2).
 *
 * Extension form: summary + "Manage in Options" (runtime.openOptionsPage);
 * paste/trust/switch happen at first-run landing and in Options only.
 * Webapp form: the FULL mirror lives here — task 049 owns it; this screen
 * stays a read-only shell until then (seam below).
 */
export default function ConfigScreen({ lang }: ConfigScreenProps) {
  const [t] = useTranslation();
  const { config, loaded } = useServerConfig();
  const isExtension = getBrowser() !== null;
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
          {isExtension ? (
            <Button
              data-testid="collab-config-manage-options"
              className="w-full"
              onClick={() => getBrowser()?.runtime?.openOptionsPage?.()}
            >
              {t("CollabManageInOptions")}
            </Button>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {/* TODO(049): webapp mirror — the full paste/trust/edit surface
                  replaces this note once the mirror lands here. */}
              {t("CollabConfigWebappNote")}
            </p>
          )}
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
