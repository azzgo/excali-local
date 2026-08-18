/**
 * Options → Collaboration section (Wayfinder 056/054/060) — thin wrapper.
 *
 * Task 064: the full stage machine (empty/review/trust/switch/summary), masked
 * sk/ck reveal, forget-confirm modal, member-invite re-emit, and the live
 * reachability dial now all live in the SHARED `collab-config-section.tsx`
 * (collab-core, task 063) — the single implementation of this surface across
 * the webapp and Options. This file only:
 *
 *   - injects a chrome.i18n `ConfigT` translator adapter (the shared component
 *     calls t(key) / t(key, {x}) and never interpolates itself),
 *   - routes the shared component's onToast to sonner, so CollabCopied /
 *     CollabCopyFailed / destructive-save toasts surface exactly as before.
 *
 * There is NO "Manage in Options" back link here (this IS Options), so `onBack`
 * is omitted.
 *
 * Persistence is handled by the shared component via collab-core/src/storage.ts,
 * which routes to chrome.storage.local (key COLLAB_SERVER_CONFIG) on a real
 * extension page — identical storage + same instant-apply rule (no Save button).
 */
import { toast } from "sonner";
import { IconX } from "@tabler/icons-react";
import CollabConfigSection, { type ConfigT } from "collab-core/ui";

/** chrome.i18n placeholder style is `$name$`; leave any missing name untouched. */
const interpolate = (message: string, params: Record<string, unknown>): string =>
  message.replace(/\$(\w+)\$/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );

/**
 * chrome.i18n `ConfigT` adapter: static strings t(key), interpolated
 * t(key, {x}). Falls back to the raw key when the message is missing so a
 * missing locale never renders a blank line.
 */
const i18nT: ConfigT = (key, params) => {
  const msg = chrome.i18n.getMessage(key);
  if (msg === "" || msg === undefined) return key;
  return params === undefined ? msg : interpolate(msg, params);
};

const CollabSection = () => (
  <CollabConfigSection
    t={i18nT}
    onToast={({ title, variant }) => {
      if (title === undefined) return;
      if (variant === "destructive") {
        // Matches the previous write-failure toast (red icon, 3s).
        toast.error(title, {
          icon: <IconX className="text-red-500 size-4" />,
          duration: 3000,
        });
      } else {
        toast.success(title, { duration: 2000 });
      }
    }}
  />
);

export default CollabSection;
