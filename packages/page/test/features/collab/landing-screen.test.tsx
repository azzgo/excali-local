import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { encodeRoomInvite, encodeServerInvite } from "collab-core";
import LandingScreen from "@/features/collab/landing-screen";
import {
  COLLAB_SERVER_CONFIG,
  type ServerConfig,
} from "@/features/collab/storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => [(key: string) => key],
}));

/** 32-byte base64url key (43 chars, no padding) — collab-core validates length. */
const KEY43 = "A".repeat(43);
/** 16-byte base64url shareId (22 chars) — collab-core validates length. */
const SHARE_ID = "B".repeat(22);

const serverInvite = (relay: string, org: string) =>
  encodeServerInvite({ relay, org, sk: KEY43, ck: KEY43 });

const setStoredConfig = (config: ServerConfig) => {
  localStorage.setItem(COLLAB_SERVER_CONFIG, JSON.stringify(config));
};

const paste = (text: string) => {
  fireEvent.click(screen.getByTestId("collab-landing-paste-toggle"));
  fireEvent.change(screen.getByTestId("collab-landing-invite-input"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId("collab-landing-review"));
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CollabEditor landing (053/054/060)", () => {
  test("unconfigured: no-server card + paste toggle + join-anyway link", async () => {
    render(<LandingScreen lang="en" />);
    expect(await screen.findByText("CollabLandingNoServer")).toBeTruthy();
    expect(screen.getByTestId("collab-landing-paste-toggle")).toBeTruthy();
    expect(screen.getByText("CollabLandingJoinAnyway")).toBeTruthy();
    expect(screen.queryByText("CollabCreateRoom")).toBeNull();
  });

  test("configured: org + relay summary, change-server link, entry links; paste hidden", async () => {
    setStoredConfig({
      relay: "https://collab.example.com",
      org: "Northwind",
      sk: KEY43,
      ck: KEY43,
    });
    render(<LandingScreen lang="en" />);
    // t() interpolation of {{org}} lives in the translation value; assert the
    // connected-state key + the raw relay (raw org rendering is covered by the
    // trust-card assertions and the config-screen tests).
    expect(await screen.findByText("CollabLandingConnected")).toBeTruthy();
    expect(screen.getByText("https://collab.example.com")).toBeTruthy();
    expect(screen.getByTestId("collab-landing-change-server")).toBeTruthy();
    expect(screen.getByText("CollabCreateRoom")).toBeTruthy();
    expect(screen.getByText("CollabJoinInvite")).toBeTruthy();
    expect(screen.getByText("CollabMyRooms")).toBeTruthy();
    // 053 round 1: once configured, later edits go through Options/#config
    expect(screen.queryByTestId("collab-landing-paste-toggle")).toBeNull();
  });

  test("valid server invite (sentence + code, 054 Q1) → preview shows org + URL + masked keys", async () => {
    render(<LandingScreen lang="en" />);
    await screen.findByText("CollabLandingNoServer");
    paste(
      `Join me in Excali Local: ${serverInvite("https://collab.example.com", "Northwind")}`,
    );
    const card = screen.getByTestId("collab-landing-trust-card");
    expect(card).toBeTruthy();
    expect(screen.getByText("Northwind")).toBeTruthy();
    expect(screen.getByText("https://collab.example.com")).toBeTruthy();
    // Trust line (056/057): <URL> · <org label>
    expect(screen.getByText("https://collab.example.com · Northwind")).toBeTruthy();
    // 056 Q3 masking: first4…last4, never raw (sk + ck rows)
    const masked = screen.getAllByText("AAAA…AAAA");
    expect(masked).toHaveLength(2);
    expect(screen.queryByText(KEY43)).toBeNull();
    // 054 srv.trust.accept — accept is a TODO(049) seam that routes to #config
    fireEvent.click(screen.getByTestId("collab-trust-accept"));
    expect((window.location as { hash?: string }).hash).toBe("#config");
  });

  test("garbage paste → 054-style red error copy", async () => {
    render(<LandingScreen lang="en" />);
    await screen.findByText("CollabLandingNoServer");
    paste("this is not an invite at all");
    expect(screen.getByText("CollabNoInviteFound")).toBeTruthy();
    expect(screen.queryByTestId("collab-landing-trust-card")).toBeNull();
  });

  test("malformed invite (truncated copy, 054) → error copy with payload detail", async () => {
    render(<LandingScreen lang="en" />);
    await screen.findByText("CollabLandingNoServer");
    paste(serverInvite("https://collab.example.com", "Northwind").slice(0, -20));
    expect(screen.getByText("CollabInvalidInvite")).toBeTruthy();
  });

  test("loopback relay URL → neutral 'local relay' badge (060/056)", async () => {
    render(<LandingScreen lang="en" />);
    await screen.findByText("CollabLandingNoServer");
    paste(serverInvite("http://127.0.0.1:1999", "dev"));
    expect(screen.getByText("CollabLocalRelay")).toBeTruthy();
  });

  test("private room invite without key → red no-key card + Join DISABLED (054 Q4)", async () => {
    render(<LandingScreen lang="en" />);
    await screen.findByText("CollabLandingNoServer");
    paste(encodeRoomInvite({ shareId: SHARE_ID, tier: "private" }));
    expect(screen.getByText("CollabNoKeyTitle")).toBeTruthy();
    const join = screen.getByTestId("collab-landing-join-disabled");
    expect((join as HTMLButtonElement).disabled).toBe(true);
  });

  test("room invite with key (or team tier) → amber join-instead hint, join enabled", async () => {
    render(<LandingScreen lang="en" />);
    await screen.findByText("CollabLandingNoServer");
    paste(
      encodeRoomInvite({ shareId: SHARE_ID, tier: "private", roomSecret: KEY43 }),
    );
    expect(screen.getByText("CollabRoomInviteHint")).toBeTruthy();
    expect(screen.queryByTestId("collab-landing-join-disabled")).toBeNull();
  });
});
