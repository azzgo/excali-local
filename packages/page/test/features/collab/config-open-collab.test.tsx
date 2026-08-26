/**
 * Post-pairing "Open collaboration page" pill — the summary-header entry on
 * the SHARED CollabConfigSection, gated on the optional `onOpenCollab` prop
 * (Options injects browser.tabs.create; the webapp #config form omits it).
 *
 * Renders the shared component directly with an identity `t` (the
 * stub-i18next pattern from config-screen.test.tsx) and a loopback relay so
 * the reachability dial skips probing (060) — no WebSocket stub needed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import CollabConfigSection, { type ConfigT } from "collab-core/ui";
import { COLLAB_SERVER_CONFIG, type ServerConfig } from "collab-core";

const t: ConfigT = (key) => key;

const config: ServerConfig = {
  relay: "http://127.0.0.1:1999", // loopback — dial is skipped (060)
  org: "Dev Local",
  sk: "A".repeat(43),
  ck: "B".repeat(43),
};

const setStored = (c: ServerConfig | null) => {
  if (c === null) localStorage.removeItem(COLLAB_SERVER_CONFIG);
  else localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(c));
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CollabConfigSection onOpenCollab (post-pairing entry)", () => {
  test("provided → summary header renders the pill; click fires the callback", async () => {
    setStored(config);
    const onOpenCollab = vi.fn();

    render(<CollabConfigSection t={t} onOpenCollab={onOpenCollab} />);

    await screen.findByTestId("collab-config-summary");

    const pill = screen.getByTestId("collab-config-open-collab");
    // identity t — the label is the i18n key both i18n systems already carry
    // (page locales.ts CollabOpenPage; chrome.i18n mirror added alongside).
    expect(pill.textContent).toContain("CollabOpenPage");
    expect(pill.textContent).toContain("↗");

    fireEvent.click(pill);
    expect(onOpenCollab).toHaveBeenCalledTimes(1);
  });

  test("omitted (webapp #config form) → no pill, zero regression", async () => {
    setStored(config);

    render(<CollabConfigSection t={t} />);

    await screen.findByTestId("collab-config-summary");
    expect(screen.queryByTestId("collab-config-open-collab")).toBeNull();
  });
});
