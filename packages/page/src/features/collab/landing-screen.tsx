import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  parsePreview,
  type InvitePreview,
  type ServerInvite,
} from "collab-core";
import { Button } from "@/components/ui/button";
import { getBrowser } from "@/lib/utils";
import { ROUTES } from "./routes";
import { isLoopbackRelay, maskKey, type ServerConfig } from "./storage";
import { parsePastedInvite, pasteSeverity } from "./invite";
import { useServerConfig } from "./hooks/use-server-config";
interface LandingScreenProps {
  lang: string;
}

/**
 * Landing paste outcome (054 severity grammar — parsing + severity via task 050's
 * invite module: parsePastedInvite accepts sentence+code or bare code (054 Q1) and
 * pasteSeverity classifies no-key / fp-mismatch / unreachable / error (054 Q4/Q5/Q9).
 * The trust → storage write belongs to 049's mirror; this screen only previews).
 */
type PasteOutcome =
  | {
      kind: "server";
      invite: ServerInvite;
      preview: Extract<InvitePreview, { kind: "server" }>;
      /** true when the pasted invite matches the currently stored server */
      sameServer: boolean;
      /** true when a different server is already configured (056 switch card) */
      replaces: boolean;
    }
  | { kind: "room"; tier: "team" | "private"; hasKey: boolean }
  | { kind: "error"; titleKey: "CollabNoInviteFound" | "CollabInvalidInvite"; detail?: string };

function parsePaste(text: string, current: ServerConfig | null): PasteOutcome {
  const result = parsePastedInvite(text);
  const severity = pasteSeverity(result, { server: current });
  if (result.kind === "server") {
    const preview = parsePreview(result);
    if (preview.kind !== "server") return { kind: "error", titleKey: "CollabInvalidInvite" };
    const sameServer =
      current !== null && current.relay === result.relay && current.org === result.org;
    return {
      kind: "server",
      invite: result,
      preview,
      sameServer,
      replaces: current !== null && !sameServer,
    };
  }
  // 054 Q4: no-key = red + Join disabled (parse succeeded; the key is genuinely missing)
  if (severity.kind === "no-key") return { kind: "room", tier: "private", hasKey: false };
  // Room invites here render the amber join-instead hint; the fp-mismatch and
  // unreachable cards belong to the join flow (043) — this landing is server-invite
  // first and never dials (054 Q9 dial happens at trust/adoption in 049).
  if (result.kind === "room") {
    return { kind: "room", tier: result.tier, hasKey: Boolean(result.roomSecret) };
  }
  if (severity.kind === "error") {
    const reason = severity.reason === "none" ? undefined : severity.reason;
    return {
      kind: "error",
      titleKey: severity.reason === "none" ? "CollabNoInviteFound" : "CollabInvalidInvite",
      detail: reason,
    };
  }
  return { kind: "error", titleKey: "CollabNoInviteFound" };
}

/**
 * Landing — inline server-invite paste + trust line + entry links (053).
 *
 * Unconfigured: paste a server invite inline (parse + preview only — no
 * storage write, 049 owns the mirror), or jump to Options / Join. Configured:
 * org + relay summary, "change server" → #config, entry links to
 * create/join/rooms.
 */
export default function LandingScreen({ lang }: LandingScreenProps) {
  const [t] = useTranslation();
  const { config, loaded } = useServerConfig();
  const [showPaste, setShowPaste] = useState(false);
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<PasteOutcome | null>(null);
  const isExtension = getBrowser() !== null;

  const handleReview = () => {
    setOutcome(parsePaste(text, config));
  };

  const handleAccept = () => {
    // TODO(049): persist via the shared admission-config module (mirror flow:
    // paste → trust → live reachability dial per 054 Q9 → storage write).
    // Until then the accept routes to the read-only summary shell.
    window.location.hash = ROUTES.config;
  };

  const navigate = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <div
      data-testid="collab-landing"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6"
    >
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold tracking-tight">
          {t("CollabLandingTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("CollabLandingIntro")}</p>

        {loaded &&
          (config === null ? (
            // -------- unconfigured -------------------------------------
            <div className="mt-4 rounded-lg border bg-card p-4 text-sm shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{t("CollabLandingNoServer")}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("CollabLandingNoServerHint")}
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
                  {t("CollabLandingNotConnected")}
                </span>
              </div>
            </div>
          ) : (
            // -------- configured ---------------------------------------
            <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm shadow-xs dark:border-emerald-500/40 dark:bg-emerald-500/10">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {t("CollabLandingConnected", { org: config.org })}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground break-all">
                    {config.relay}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("CollabLandingServerAccepted")}
                  </div>
                </div>
                <button
                  data-testid="collab-landing-change-server"
                  onClick={() => navigate(ROUTES.config)}
                  className="shrink-0 cursor-pointer rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
                >
                  {t("CollabLandingChangeServer")}
                </button>
              </div>
            </div>
          ))}

        {/* -------- inline server-invite paste (053 first-run landing) ---- */}
        {(!config || !loaded) && (
          <div className="mt-3">
            <Button
              data-testid="collab-landing-paste-toggle"
              className="w-full"
              onClick={() => {
                setShowPaste((v) => !v);
                setOutcome(null);
              }}
            >
              {t("CollabLandingPasteServerInvite")}
            </Button>
            {isExtension ? (
              <Button
                variant="outline"
                className="mt-2 w-full"
                onClick={() => getBrowser()?.runtime?.openOptionsPage?.()}
              >
                {t("CollabLandingOpenOptions")}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="mt-2 w-full"
                onClick={() => navigate(ROUTES.config)}
              >
                {t("CollabOpenConfig")}
              </Button>
            )}
          </div>
        )}

        {config !== null && (
          <div className="mt-3 space-y-2">
            <Button className="w-full" onClick={() => navigate(ROUTES.create)}>
              {t("CollabCreateRoom")}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => navigate(ROUTES.join)}>
              {t("CollabJoinInvite")}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => navigate(ROUTES.rooms)}>
              {t("CollabMyRooms")}
            </Button>
          </div>
        )}

        {config === null && (
          <>
            <div className="my-3 text-center text-xs text-muted-foreground">{t("CollabOr")}</div>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => navigate(ROUTES.join)}
            >
              {t("CollabLandingJoinAnyway")}
            </Button>
          </>
        )}

        {/* -------- paste panel + trust preview (054 severity) ------------ */}
        {showPaste && (
          <div
            data-testid="collab-landing-paste-panel"
            className="mt-4 rounded-lg border bg-card p-4 shadow-xs"
          >
            <h2 className="text-sm font-semibold">{t("CollabReviewServerInvite")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("CollabServerInvitePlaceholder")}
            </p>
            <textarea
              data-testid="collab-landing-invite-input"
              rows={3}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOutcome(null);
              }}
              placeholder="excali-collab:v1:srv:..."
              className="mt-2 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
            <div className="mt-2 flex gap-2">
              <Button
                data-testid="collab-landing-review"
                size="sm"
                className="flex-1"
                onClick={handleReview}
              >
                {t("CollabReviewServerInvite")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowPaste(false);
                  setOutcome(null);
                }}
              >
                {t("CollabBack")}
              </Button>
            </div>

            {outcome?.kind === "server" && (
              <div data-testid="collab-landing-trust-card" className="mt-3 space-y-2">
                {outcome.replaces && (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10">
                    <div className="font-semibold text-red-700 dark:text-red-400">
                      {t("CollabSwitchServer")}
                    </div>
                    <p className="mt-1 text-red-700/80 dark:text-red-400/80">
                      {t("CollabReplacesServer")}
                    </p>
                  </div>
                )}
                {outcome.sameServer && (
                  <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400">
                    {t("CollabAlreadyConnected")}
                  </div>
                )}
                <div className="rounded-md border p-3 text-xs">
                  <div className="flex items-center justify-between gap-2 py-0.5">
                    <span className="text-muted-foreground">{t("CollabRelayUrl")}</span>
                    <span className="flex items-center gap-2 font-mono break-all">
                      {outcome.preview.relay}
                      {isLoopbackRelay(outcome.preview.relay) && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t("CollabLocalRelay")}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-0.5">
                    <span className="text-muted-foreground">{t("CollabOrg")}</span>
                    <span className="font-medium">{outcome.preview.org}</span>
                  </div>
                  {/* 056 Q3 masking convention: first4…last4, never raw */}
                  <div className="flex items-center justify-between gap-2 py-0.5">
                    <span className="text-muted-foreground">sk</span>
                    <span className="font-mono">{maskKey(outcome.invite.sk)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-0.5">
                    <span className="text-muted-foreground">ck</span>
                    <span className="font-mono">{maskKey(outcome.invite.ck)}</span>
                  </div>
                </div>
                {/* Trust line (056/057): <URL> · <org label> */}
                <div className="rounded-md bg-muted px-3 py-2 text-xs font-medium break-all">
                  {outcome.preview.relay} · {outcome.preview.org}
                </div>
                <Button
                  data-testid="collab-trust-accept"
                  className="w-full"
                  onClick={handleAccept}
                >
                  {t("CollabTrustAndConnect")}
                </Button>
              </div>
            )}

            {outcome?.kind === "room" && outcome.tier === "private" && !outcome.hasKey && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10">
                <div className="font-semibold text-red-700 dark:text-red-400">
                  {t("CollabNoKeyTitle")}
                </div>
                <p className="mt-1 text-red-700/80 dark:text-red-400/80">{t("CollabNoKeyBody")}</p>
                {/* 054 Q4: no-key = red + Join disabled — no continue path exists */}
                <Button
                  data-testid="collab-landing-join-disabled"
                  disabled
                  className="mt-2 w-full"
                >
                  {t("CollabJoinInvite")}
                </Button>
              </div>
            )}

            {outcome?.kind === "room" && outcome.hasKey && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-500/40 dark:bg-amber-500/10">
                <p className="text-amber-700 dark:text-amber-400">
                  {t("CollabRoomInviteHint")}
                </p>
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => navigate(ROUTES.join)}
                >
                  {t("CollabJoinInvite")}
                </Button>
              </div>
            )}

            {outcome?.kind === "error" && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs dark:border-red-500/40 dark:bg-red-500/10">
                <div className="font-semibold text-red-700 dark:text-red-400">
                  {t(outcome.titleKey)}
                </div>
                {outcome.detail && (
                  <p className="mt-1 font-mono text-red-700/80 break-all dark:text-red-400/80">
                    {outcome.detail}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
