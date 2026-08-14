import { BRIDGE_PORTS } from "excali-shared";

/**
 * Shared daemon probe for the shell (options daemon-stop pill).
 *
 * The cheap HTTP /health probe renders running/stopped on the Options page;
 * the popup no longer carries an agent-status indicator.
 */
/** HTTP /health probe across the fixed bridge port range (options daemon pill). */
export async function probeDaemonHealth(): Promise<{
  ok: boolean;
  port: number | null;
}> {
  for (const port of BRIDGE_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (!res.ok) continue;
      const body = (await res.json()) as { ok?: unknown };
      if (body?.ok === true) return { ok: true, port };
    } catch {
      // connection refused / non-JSON body — try the next port
    }
  }
  return { ok: false, port: null };
}
