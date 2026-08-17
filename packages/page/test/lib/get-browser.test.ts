/**
 * getBrowser() extension-host detection regression test.
 *
 * Chromium exposes a `window.chrome` stub object on EVERY plain http(s) page
 * (dev-server webapp form included). Before the fix, that stub made
 * getBrowser() return non-null on http pages, so the collab #config screen
 * rendered the read-only EXTENSION form in a plain Chrome tab — with a dead
 * "manage in options" button and no way to paste a server invite.
 *
 * Only a real extension API surface (runtime.id on extension pages,
 * storage.local in content-script worlds) may read as an extension host.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

// use-agent-bridge / use-server-config import getBrowser via this re-export —
// import the real shared implementation, not a mock.
import { getBrowser } from "@/lib/utils";

const chromeHolder = globalThis as unknown as { chrome?: unknown };

afterEach(() => {
  vi.unstubAllGlobals();
  delete chromeHolder.chrome;
});

describe("getBrowser()", () => {
  test("null when only the plain-page window.chrome stub is present", () => {
    // Shape of the stub Chrome leaves on http(s) pages: an object with no
    // extension API surface (runtime.id / storage.local absent).
    vi.stubGlobal("chrome", { app: {}, loadTimes: () => ({}), runtime: {} });
    expect(getBrowser()).toBeNull();
  });

  test("null when no chrome/browser global exists at all", () => {
    delete chromeHolder.chrome;
    expect(getBrowser()).toBeNull();
  });

  test("detects extension host via runtime.id (Chrome extension page)", () => {
    vi.stubGlobal("chrome", {
      runtime: { id: "abcdefghijklmnopabcdefghijklmnop" },
    });
    expect(getBrowser()).not.toBeNull();
  });

  test("detects extension host via storage.local (content-script world)", () => {
    vi.stubGlobal("chrome", { storage: { local: {} } });
    expect(getBrowser()).not.toBeNull();
  });

  test("detects Firefox-style browser global with runtime.id", () => {
    vi.stubGlobal("browser", { runtime: { id: "firefox-extension-id" } });
    expect(getBrowser()).not.toBeNull();
  });

  test("prefers the browser global when both exist", () => {
    vi.stubGlobal("chrome", { app: {} }); // plain-page stub
    const firefoxLike = { runtime: { id: "firefox-extension-id" } };
    vi.stubGlobal("browser", firefoxLike);
    expect(getBrowser()).toBe(firefoxLike);
  });
});
