import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import ConfigScreen from "@/features/collab/config-screen";
import {
  COLLAB_SERVER_CONFIG,
  type ServerConfig,
} from "@/features/collab/storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

const KEY43 = "A".repeat(43);

const config: ServerConfig = {
  relay: "https://collab.example.com",
  org: "Northwind",
  sk: KEY43,
  ck: KEY43,
};

const setStoredConfig = (c: ServerConfig) => {
  localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(c));
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CollabEditor config screen (056 Q2/Q3)", () => {
  test("empty config → 'not configured' state with hint", async () => {
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByText("CollabLandingNoServer")).toBeTruthy();
    expect(screen.getByText("CollabConfigEmptyHint")).toBeTruthy();
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
  });

  test("webapp form (getBrowser() null) shows the mirror note instead of Manage-in-Options", async () => {
    setStoredConfig(config);
    render(<ConfigScreen lang="en" />);
    expect(await screen.findByText("CollabConfigWebappNote")).toBeTruthy();
    expect(screen.queryByTestId("collab-config-manage-options")).toBeNull();
  });
});
