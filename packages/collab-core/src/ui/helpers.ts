/**
 * Shared collab-config UI helpers — the ONE implementation of the reachability
 * dial (054 Q9 / 060 §1) and clipboard copy that both the webapp config section
 * (collab-config-section.tsx) and the page's collab invite module consume.
 *
 * Previously these lived in the page (`packages/page/.../collab/invite.ts`);
 * moving them here lets the shared config component stay dependency-free
 * (no i18next, no @/ alias) and de-duplicates the config-screen mirror.
 *
 * collab-core owns the wire format (`invites.ts`); these helpers only wrap it
 * for reachability + clipboard needs.
 */
import { validateRelayUrl } from "../invites";
import { isLoopbackRelay } from "../storage";

/** 054 Q9: prototype shows "checking… ⏱ timeout 8s". */
export const DIAL_TIMEOUT_MS = 8000;

export type DialResult = "ok" | "unreachable" | "skipped";

/**
 * Write `text` to the clipboard. Primary path: `navigator.clipboard.writeText`
 * (requires user activation — call from a click handler). If the API is missing
 * or rejects (some contexts, iframes, older engines), fall back to a
 * hidden-textarea `execCommand("copy")`. Returns true when the write succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  let clipboard: Clipboard | undefined;
  try {
    clipboard = navigator.clipboard;
  } catch {
    clipboard = undefined; // access denied (rare) — fall through to legacy
  }
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Live reachability dial before trust/adoption (054 Q9 — the trust-confirm does
 * this before storing; admins generate invites before deploying, hence the
 * Save-anyway escape hatch). Loopback relays (`127.0.0.1` / `[::1]`) skip the
 * probe entirely (060 §1) — `"skipped"` renders as the neutral local-relay
 * badge. Remote relays are probed with a WebSocket handshake; success = the
 * server answered, failure/timeout = `"unreachable"`.
 */
export async function dialServer(
  relayUrl: string,
  timeoutMs: number = DIAL_TIMEOUT_MS,
): Promise<DialResult> {
  if (validateRelayUrl(relayUrl) !== null) return "unreachable";
  if (isLoopbackRelay(relayUrl)) return "skipped"; // 060: never probed, neutral badge
  return (await probeWs(relayUrl, timeoutMs)) ? "ok" : "unreachable";
}

function probeWs(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      finish(false);
    }, timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      finish(true);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish(false);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      finish(false);
    };
  });
}
