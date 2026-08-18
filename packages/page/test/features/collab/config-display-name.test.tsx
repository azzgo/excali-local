/**
 * Display-name row in the shared collab config section (story 059 / decision
 * 6+9, task 065) — rendered in ALL stages of the shared component via the
 * webapp wrapper (ConfigScreen, getBrowser() null → WebappConfigForm →
 * CollabConfigSection). The row reads-or-mints the collab identity on mount,
 * pre-fills the minted short handle, and instant-applies on blur/Enter via
 * updateDisplayName + storageSet — never saving an empty name.
 *
 * Storage is the webapp localStorage path (no chrome global in happy-dom),
 * so we seed COLLAB_PROFILE_ID_KEY as JSON the way resolveIdentity reads it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CollabIdentity } from "collab-core";
import ConfigScreen from "@/features/collab/config-screen";
import {
  COLLAB_PROFILE_ID_KEY,
  COLLAB_SERVER_CONFIG,
  type ServerConfig,
} from "@/features/collab/storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/** Hoisted harness: getBrowser() returns null → webapp form / localStorage. */
const harness = vi.hoisted(() => ({
  browser: null as unknown as typeof chrome | null,
}));

vi.mock("@/lib/utils", () => ({
  getBrowser: () => harness.browser,
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

/** Loopback relay → dial is skipped (060), no WebSocket / timers in tests. */
const config: ServerConfig = {
  relay: "http://127.0.0.1:1999",
  org: "Northwind",
  sk: "A".repeat(43),
  ck: "A".repeat(43),
};

const identity = (name: string): CollabIdentity => ({
  profileId: "abcd-efgh-ijkl-mnop",
  name,
  seed: "seed",
  pub: "pub",
});

const setStoredConfig = (c: ServerConfig | null) => {
  if (c === null) localStorage.removeItem(COLLAB_SERVER_CONFIG);
  else localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(c));
};

const setStoredIdentity = (id: CollabIdentity) => {
  localStorage.setItem(COLLAB_PROFILE_ID_KEY, JSON.stringify(id));
};

const storedIdentityName = (): string | null => {
  const raw = localStorage.getItem(COLLAB_PROFILE_ID_KEY);
  if (raw === null) return null;
  return (JSON.parse(raw) as CollabIdentity).name;
};

const input = () =>
  screen.getByTestId("collab-config-display-name") as HTMLInputElement;

const row = () => screen.getByTestId("collab-config-display-name-row");

afterEach(() => {
  cleanup();
  localStorage.clear();
  harness.browser = null;
  vi.restoreAllMocks();
});

describe("shared config section — display-name row (059 d6/d9)", () => {
  test("row is visible in the empty stage (no server config yet)", async () => {
    render(<ConfigScreen lang="en" />);
    await screen.findByText("CollabNoServer");
    expect(row()).toBeTruthy();
    expect(input()).toBeTruthy();
  });

  test("row is visible in the summary stage (server configured)", async () => {
    setStoredConfig(config);
    setStoredIdentity(identity("Alice"));
    render(<ConfigScreen lang="en" />);
    await screen.findByTestId("collab-config-summary");
    expect(row()).toBeTruthy();
    expect(input().value).toBe("Alice");
  });

  test("typing a valid name + Enter persists identity.name (storageSet round-trip)", async () => {
    setStoredConfig(config);
    setStoredIdentity(identity("Alice"));
    render(<ConfigScreen lang="en" />);
    await screen.findByTestId("collab-config-summary");

    fireEvent.change(input(), { target: { value: "  Ada Lovelace  " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(storedIdentityName()).toBe("Ada Lovelace"));
    // trimmed value is reflected back into the field
    expect(input().value).toBe("Ada Lovelace");
    expect(screen.queryByTestId("collab-config-name-error")).toBeNull();
  });

  test("typing a valid name + blur persists identity.name", async () => {
    setStoredConfig(config);
    setStoredIdentity(identity("Alice"));
    render(<ConfigScreen lang="en" />);
    await screen.findByTestId("collab-config-summary");

    fireEvent.change(input(), { target: { value: "Grace Hopper" } });
    fireEvent.blur(input());

    await waitFor(() => expect(storedIdentityName()).toBe("Grace Hopper"));
    expect(input().value).toBe("Grace Hopper");
  });

  test("empty input rejects: inline error + keeps previous name + never persists", async () => {
    setStoredConfig(config);
    setStoredIdentity(identity("Alice"));
    render(<ConfigScreen lang="en" />);
    await screen.findByTestId("collab-config-summary");

    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.blur(input());

    // inline error shown, previous name restored, nothing saved
    expect(screen.getByTestId("collab-config-name-error")).toBeTruthy();
    expect(input().value).toBe("Alice");
    expect(storedIdentityName()).toBe("Alice");
  });

  test("41-char input rejects: inline error + keeps previous name + never persists", async () => {
    setStoredConfig(config);
    setStoredIdentity(identity("Alice"));
    render(<ConfigScreen lang="en" />);
    await screen.findByTestId("collab-config-summary");

    fireEvent.change(input(), { target: { value: "a".repeat(41) } });
    fireEvent.blur(input());

    expect(screen.getByTestId("collab-config-name-error")).toBeTruthy();
    expect(input().value).toBe("Alice");
    expect(storedIdentityName()).toBe("Alice");
  });

  test("fresh profile (no stored identity) shows the minted short handle pre-filled", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    await screen.findByTestId("collab-config-summary");

    // resolveIdentity mints a profileId (uuid hex); name = first 4 hex chars
    const value = input().value;
    expect(value).toMatch(/^[0-9a-f]{4}$/i);
    // the minted identity is persisted under the profile key
    expect(storedIdentityName()).toBe(value);
  });
});
