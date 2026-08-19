/**
 * ConfigScreen (056 Q2/Q3/Q5/Q6/Q7/Q8) + ConfigPropagationBanner (056 Q6)
 * tests (task 042 shell → task 049 webapp mirror).
 *
 * getBrowser() is controlled through a hoisted harness (null = webapp form /
 * localStorage path; a fake browser object = extension form / onChanged
 * propagation). WebSocket is stubbed so the live reachability dial (054 Q9)
 * is deterministic: loopback relays skip the probe (060) and resolve
 * "skipped" without a socket; remote relays resolve via the stub's onopen /
 * onerror.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { encodeRoomInvite, encodeServerInvite, type ServerInvite } from "collab-core";
import ConfigScreen from "@/features/collab/config-screen";
import { ConfigPropagationBanner } from "@/features/collab/config-banner";
import {
  COLLAB_SERVER_CONFIG,
  type ServerConfig,
} from "@/features/collab/storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/** Hoisted harness: getBrowser() returns this (null → webapp/localStorage). */
const harness = vi.hoisted(() => ({
  browser: null as unknown as typeof chrome | null,
  listeners: [] as Array<
    (changes: Record<string, { newValue?: unknown }>, area: string) => void
  >,
}));

vi.mock("@/lib/utils", () => ({
  getBrowser: () => harness.browser,
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

const KEY43 = "A".repeat(43);
const SHARE_ID = "B".repeat(22);

const config: ServerConfig = {
  relay: "https://collab.example.com",
  org: "Northwind",
  sk: KEY43,
  ck: KEY43,
};

const serverInvite = (
  relay = "https://collab.example.com",
  org = "Northwind",
): ServerInvite => ({ relay, org, sk: KEY43, ck: KEY43 });

const setStoredConfig = (c: ServerConfig | null) => {
  if (c === null) localStorage.removeItem(COLLAB_SERVER_CONFIG);
  else localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(c));
};

/** Stub WebSocket — the dial probe (054 Q9) is driven by onopen/onerror. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.onclose?.();
  }
}

const lastSocket = () =>
  FakeWebSocket.instances[FakeWebSocket.instances.length - 1] ?? null;

/** Trigger a dial outcome on the most recent probe (if any). */
const settleDial = (ok: boolean) => {
  const ws = lastSocket();
  if (ws === null) return;
  if (ok) ws.onopen?.();
  else ws.onerror?.();
};

/** Fake browser object (extension form / onChanged propagation). */
const fakeBrowser = () => {
  const browser = {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
      onChanged: {
        addListener: (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => {
          harness.listeners.push(fn);
        },
        removeListener: (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => {
          harness.listeners = harness.listeners.filter((l) => l !== fn);
        },
      },
    },
  } as unknown as typeof chrome;
  return browser;
};

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances = [];
});

afterEach(() => {
  // settle any pending dial probes so no 8s timers outlive the file
  for (const ws of FakeWebSocket.instances) ws.onerror?.();
  cleanup();
  localStorage.clear();
  harness.browser = null;
  harness.listeners = [];
  vi.unstubAllGlobals();
});

describe("CollabEditor config screen (056 Q2/Q3)", () => {
  test("webapp empty config → 'no server' card + hint + webapp note + paste field", async () => {
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByText("CollabNoServer")).toBeTruthy();
    expect(screen.getByText("CollabNoServerHint")).toBeTruthy();
    expect(screen.getByTestId("collab-config-note")).toBeTruthy();
    expect(screen.getByTestId("collab-config-paste")).toBeTruthy();
    expect(screen.queryByTestId("collab-config-summary")).toBeNull();
  });

  test("stored config → org + relay summary with masked sk/ck (first4…last4)", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByText("Northwind")).toBeTruthy();
    expect(screen.getByText("https://collab.example.com")).toBeTruthy();
    expect(screen.getByTestId("collab-config-summary")).toBeTruthy();
    // 056 Q3: masked by default, never raw
    const masked = screen.getAllByText("AAAA…AAAA");
    expect(masked).toHaveLength(2);
    expect(screen.queryByText(KEY43)).toBeNull();
  });

  test("per-key reveal: click shows the full key, hide collapses (056 Q3 transient reveal)", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    await screen.findByText("Northwind");
    fireEvent.click(screen.getByTestId("collab-config-reveal-sk"));
    expect(screen.getAllByText(KEY43)).toHaveLength(1);
    fireEvent.click(screen.getByTestId("collab-config-reveal-sk"));
    expect(screen.queryByText(KEY43)).toBeNull();
  });

  test("loopback relay renders the neutral local-relay badge (060/056)", async () => {
    setStoredConfig({ ...config, relay: "http://127.0.0.1:1999" });
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByText("CollabLocalRelay")).toBeTruthy();
    // loopback is never probed — no dial socket is created
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  test("webapp note banner shows for the webapp form; no Manage-in-Options", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByTestId("collab-config-note")).toBeTruthy();
    expect(screen.queryByTestId("collab-config-manage-options")).toBeNull();
  });

  test("extension form (getBrowser() non-null): read-only summary + Manage in Options", async () => {
    const browser = fakeBrowser();
    browser.storage.local.get = vi.fn().mockResolvedValue({ [COLLAB_SERVER_CONFIG]: config });
    harness.browser = browser;
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByTestId("collab-config-manage-options")).toBeTruthy();
    expect(screen.getByText("Northwind")).toBeTruthy();
    // read-only: no paste field, no webapp note
    expect(screen.queryByTestId("collab-config-paste")).toBeNull();
    expect(screen.queryByTestId("collab-config-note")).toBeNull();
  });
});

describe("webapp config mirror — paste → trust → save (049, 056/054/060)", () => {
  test("full flow: loopback invite paste → parsed preview → trust (dial skipped, neutral) → save → localStorage round-trip shows masked on reload", async () => {
    render(<ConfigScreen lang="en" />);
    await screen.findByText("CollabNoServer");

    // paste a loopback server invite (sentence + code, 054 Q1)
    const inv = serverInvite("http://127.0.0.1:1999", "Dev Local");
    fireEvent.change(screen.getByTestId("collab-config-paste"), {
      target: { value: `Connect to「${inv.org}」\n${encodeServerInvite(inv)}` },
    });
    fireEvent.click(screen.getByTestId("collab-config-review"));

    // parsed preview (054 Q6): org + relay + key presence + neutral badge
    expect(screen.getByText("CollabPreviewTitle")).toBeTruthy();
    expect(screen.getByText("Dev Local")).toBeTruthy();
    expect(screen.getByText("CollabParsedKeys")).toBeTruthy();
    expect(screen.getByText("CollabLocalRelay")).toBeTruthy();

    // trust card: 060 loopback dial is skipped — no probe, never an error
    fireEvent.click(screen.getByTestId("collab-config-continue"));
    expect(await screen.findByText("CollabTrustTitle")).toBeTruthy();
    expect(screen.getByText(/CollabTrustWill/)).toBeTruthy();
    expect(FakeWebSocket.instances).toHaveLength(0);
    await waitFor(() =>
      expect(
        (screen.getByTestId("collab-config-trust-connect") as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    // trust & connect → saved to localStorage (same shape as Options)
    fireEvent.click(screen.getByTestId("collab-config-trust-connect"));
    expect(await screen.findByTestId("collab-config-summary")).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(COLLAB_SERVER_CONFIG)!) as ServerConfig;
    expect(stored.relay).toBe("http://127.0.0.1:1999");
    expect(stored.org).toBe("Dev Local");
    expect(stored.sk).toBe(KEY43);
    expect(stored.ck).toBe(KEY43);

    // reload (fresh mount) shows the configured summary with masked keys
    cleanup();
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByText("Dev Local")).toBeTruthy();
    expect(screen.getAllByText("AAAA…AAAA")).toHaveLength(2);
    expect(screen.queryByText(KEY43)).toBeNull();
  });

  test("severity: no-invite → red error; malformed → invalid with reason; room invite → paste-it-in-editor", async () => {
    render(<ConfigScreen lang="en" />);
    await screen.findByText("CollabNoServer");
    const paste = screen.getByTestId("collab-config-paste");
    const review = screen.getByTestId("collab-config-review");

    // no invite token in the text
    fireEvent.change(paste, { target: { value: "hello world" } });
    fireEvent.click(review);
    expect(screen.getByText("CollabConfigInviteNotFound")).toBeTruthy();

    // malformed server token
    fireEvent.change(paste, { target: { value: "excali-collab:v1:srv:AAAA" } });
    fireEvent.click(review);
    expect(screen.getByText("CollabConfigInviteInvalid")).toBeTruthy();

    // a room invite belongs to the join flow, not the admission mirror
    fireEvent.change(paste, {
      target: {
        value: encodeRoomInvite({ shareId: SHARE_ID, tier: "private", roomSecret: KEY43 }),
      },
    });
    fireEvent.click(review);
    expect(screen.getByText("CollabRoomInviteHere")).toBeTruthy();
  });

  test("unreachable: remote invite → trust dial fails → red card + Retry + Save-anyway (054 Q9)", async () => {
    render(<ConfigScreen lang="en" />);
    await screen.findByText("CollabNoServer");
    const inv = serverInvite("https://relay.example.com", "Acme");
    fireEvent.change(screen.getByTestId("collab-config-paste"), {
      target: { value: encodeServerInvite(inv) },
    });
    fireEvent.click(screen.getByTestId("collab-config-review"));
    fireEvent.click(screen.getByTestId("collab-config-continue"));

    // the live dial probes (054 Q9); nobody answers → unreachable
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    await act(async () => {
      settleDial(false);
    });
    // 054 srv.unreach copy (word-identical) + Retry / Save-anyway escape hatch
    expect(await screen.findByText("CollabSrvUnreachTitle")).toBeTruthy();
    expect(screen.getByText("CollabSrvUnreachBody")).toBeTruthy();
    expect(screen.getByTestId("collab-config-retry")).toBeTruthy();
    expect(screen.getByTestId("collab-config-save-anyway")).toBeTruthy();

    // Save-anyway adopts the config (admins generate invites before deploying)
    fireEvent.click(screen.getByTestId("collab-config-save-anyway"));
    expect(await screen.findByTestId("collab-config-summary")).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(COLLAB_SERVER_CONFIG)!) as ServerConfig;
    expect(stored.org).toBe("Acme");
  });

  test("switch server: inline red card (054 Q8) → live dial ok → replaces the stored config", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    await screen.findByText("Northwind");

    // start the switch flow from the summary
    fireEvent.click(screen.getByTestId("collab-config-paste-new"));
    const next = serverInvite("https://new.example.com", "Other");
    fireEvent.change(screen.getByTestId("collab-config-paste"), {
      target: { value: encodeServerInvite(next) },
    });
    fireEvent.click(screen.getByTestId("collab-config-review"));

    // 054 srv.replace.t red card — replacing Northwind with Other
    expect(screen.getByText("CollabSwitchTitle")).toBeTruthy();
    expect(screen.getByText("CollabSwitchBodyB")).toBeTruthy();
    const socketsBefore = FakeWebSocket.instances.length;

    // Switch server → live dial → ok → adopted immediately
    fireEvent.click(screen.getByTestId("collab-config-switch-action"));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(socketsBefore + 1));
    await act(async () => {
      settleDial(true);
    });
    expect(await screen.findByText("Other")).toBeTruthy();
    expect(screen.queryByText("Northwind")).toBeNull();
    const stored = JSON.parse(localStorage.getItem(COLLAB_SERVER_CONFIG)!) as ServerConfig;
    expect(stored.relay).toBe("https://new.example.com");
  });

  test("switch server with a loopback relay: dial skipped (060) → new config adopted (no hang)", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    await screen.findByText("Northwind");

    // start the switch flow from the summary
    fireEvent.click(screen.getByTestId("collab-config-paste-new"));
    const loopback = serverInvite("http://127.0.0.1:1999", "Dev Local");
    fireEvent.change(screen.getByTestId("collab-config-paste"), {
      target: { value: encodeServerInvite(loopback) },
    });
    fireEvent.click(screen.getByTestId("collab-config-review"));

    // Switch server → 060 loopback dial returns "skipped" (never probed).
    // Before the fix this left the flow stuck on the red switch card (webapp
    // bug: the adoption effect only checked dial.state === "ok").
    fireEvent.click(screen.getByTestId("collab-config-switch-action"));

    // adopted: stored config now points at the loopback relay, red card gone
    await waitFor(() => {
      const s = JSON.parse(localStorage.getItem(COLLAB_SERVER_CONFIG)!) as ServerConfig;
      expect(s.relay).toBe("http://127.0.0.1:1999");
      expect(s.org).toBe("Dev Local");
    });
    expect(await screen.findByTestId("collab-config-summary")).toBeTruthy();
    expect(screen.queryByText("CollabSwitchTitle")).toBeNull();
  });

  test("forget modal (056 Q7): rooms-stay-grayed copy, confirm clears the config", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    await screen.findByText("Northwind");
    fireEvent.click(screen.getByTestId("collab-config-forget"));
    // 056 Q7: rooms stay grayed, nothing deleted, restorable by re-paste
    expect(screen.getByText("CollabForgetTitle")).toBeTruthy();
    expect(screen.getByText("CollabForgetBody")).toBeTruthy();
    fireEvent.click(screen.getByTestId("collab-config-forget-confirm"));
    expect(await screen.findByText("CollabNoServer")).toBeTruthy();
    expect(localStorage.getItem(COLLAB_SERVER_CONFIG)).toBeNull();
  });

  test("rotation: rejectedAt → red status line + paste-fresh-invite CTA (056 Q8 / 054 stale.admit)", async () => {
    setStoredConfig({ ...config, rejectedAt: 1700000000000 });
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByTestId("collab-config-rotation")).toBeTruthy();
    expect(screen.getByText("CollabStatusStale")).toBeTruthy();
    expect(screen.getByText("CollabStaleBody")).toBeTruthy();
    // CTA opens the switch (paste-fresh) flow
    fireEvent.click(screen.getByTestId("collab-config-paste-fresh"));
    expect(screen.getByTestId("collab-config-paste")).toBeTruthy();
  });

  test("Check again re-dials on demand (056 Q5 — no background poll)", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    await screen.findByText("Northwind");
    // dial-on-open created one probe; settle it
    await act(async () => {
      settleDial(true);
    });
    const socketsBefore = FakeWebSocket.instances.length;
    fireEvent.click(screen.getByTestId("collab-config-check-again"));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(socketsBefore + 1));
    await act(async () => {
      settleDial(true);
    });
    expect(screen.getByText("CollabStatusOk")).toBeTruthy();
  });
});

describe("config propagation banner (056 Q6)", () => {
  test("storage.onChanged under a LIVE session → amber banner + Reload, no auto-reconnect", async () => {
    const browser = fakeBrowser();
    harness.browser = browser;
    const { unmount } = render(<ConfigPropagationBanner live={true} />);
    expect(screen.queryByTestId("collab-config-propagation")).toBeNull();

    // Options writes COLLAB_SERVER_CONFIG → onChanged fires
    await act(async () => {
      for (const fn of harness.listeners) {
        fn({ [COLLAB_SERVER_CONFIG]: { newValue: { ...config, org: "Other" } } }, "local");
      }
    });
    expect(screen.getByTestId("collab-config-propagation")).toBeTruthy();
    expect(screen.getByText("CollabConfigChangeTitle")).toBeTruthy();
    expect(screen.getByText("CollabConfigChangeBody")).toBeTruthy();

    // Q6: the banner never touches the session — Reload is the only path
    // (the session-side admission freeze is covered in use-collab-session.test.ts).
    const reload = vi.fn();
    (window.location as unknown as { reload: unknown }).reload = reload;
    fireEvent.click(screen.getByTestId("collab-config-propagation-reload"));
    expect(reload).toHaveBeenCalledTimes(1);
    unmount();
  });

  test("no live session → config change updates in place, no banner", async () => {
    const browser = fakeBrowser();
    harness.browser = browser;
    const { unmount } = render(<ConfigPropagationBanner live={false} />);
    await act(async () => {
      for (const fn of harness.listeners) {
        fn({ [COLLAB_SERVER_CONFIG]: { newValue: { ...config, org: "Other" } } }, "local");
      }
    });
    expect(screen.queryByTestId("collab-config-propagation")).toBeNull();
    unmount();
  });

  test("webapp mode (getBrowser() null): no onChanged to listen to — nothing renders", async () => {
    harness.browser = null;
    const { unmount } = render(<ConfigPropagationBanner live={true} />);
    expect(screen.queryByTestId("collab-config-propagation")).toBeNull();
    unmount();
  });
});
