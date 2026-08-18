import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLAB_PROFILE_ID_KEY,
  COLLAB_SERVER_CONFIG,
  isServerConfig,
  maskKey,
  mintMemberKeypair,
  parseStoredConfig,
  readServerConfig,
  resolveIdentity,
  storageGet,
  storageSet,
  updateDisplayName,
  writeServerConfig,
} from "./storage";
import type { CollabIdentity } from "./storage";

/** In-memory fake of the chrome.storage.local surface (chrome.storage.get
 * returns { [key]: value }). */
function fakeChromeStorage() {
  const map = new Map<string, unknown>();
  return {
    map,
    chrome: {
      storage: {
        local: {
          get: vi.fn(async (key: string) =>
            map.has(key) ? { [key]: map.get(key) } : {},
          ),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) map.set(k, v);
          }),
          remove: vi.fn(async (key: string) => {
            map.delete(key);
          }),
        },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** In-memory fake of the localStorage surface (JSON string values). */
function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => map.set(key, value)),
    removeItem: vi.fn((key: string) => void map.delete(key)),
    clear: vi.fn(() => map.clear()),
  };
}

describe("dual-form routing", () => {
  it("uses chrome.storage.local when present", async () => {
    const { chrome, map } = fakeChromeStorage();
    map.set("k", { hello: "world" });
    vi.stubGlobal("chrome", chrome);

    await expect(storageGet("k")).resolves.toEqual({ hello: "world" });
    expect(chrome.storage.local.get).toHaveBeenCalledWith("k");

    await storageSet("k", { a: 1 });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ k: { a: 1 } });
  });

  it("falls back to localStorage JSON round-trip without chrome", async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal("chrome", undefined);
    vi.stubGlobal("localStorage", ls);
    const value = { relay: "https://relay.example", org: "acme" };

    await storageSet("k", value);
    // stored as JSON under the key, matching the webapp form
    expect(ls.getItem("k")).toBe(JSON.stringify(value));

    await expect(storageGet("k")).resolves.toEqual(value);
  });
});

describe("server-config helpers", () => {
  it("maskKey truncates to first4…last4", () => {
    expect(maskKey("1234567890abcdef")).toBe("1234…cdef");
    expect(maskKey("short")).toBe("••••");
  });

  it("parseStoredConfig accepts object and JSON string forms", () => {
    const cfg = { relay: "https://r.example", org: "o", sk: "s", ck: "c" };
    expect(parseStoredConfig(cfg)).toEqual(cfg);
    expect(parseStoredConfig(JSON.stringify(cfg))).toEqual(cfg);
    expect(parseStoredConfig(null)).toBeNull();
    expect(parseStoredConfig("not-json")).toBeNull();
    expect(parseStoredConfig({ relay: "" })).toBeNull();
  });

  it("readServerConfig / writeServerConfig round-trip via chrome.storage", async () => {
    const { chrome } = fakeChromeStorage();
    vi.stubGlobal("chrome", chrome);
    const cfg = { relay: "https://r.example", org: "acme", sk: "s", ck: "c" };

    await expect(readServerConfig()).resolves.toBeNull();
    await writeServerConfig(cfg);
    await expect(readServerConfig()).resolves.toEqual(cfg);
    await writeServerConfig(null);
    await expect(readServerConfig()).resolves.toBeNull();
  });

  it("isServerConfig validates required fields", () => {
    expect(
      isServerConfig({ relay: "r", org: "o", sk: "s", ck: "c" }),
    ).toBe(true);
    expect(isServerConfig({ relay: "r", org: "o", sk: "s", ck: "" })).toBe(false);
  });
});

describe("resolveIdentity (mint-once + member reuse)", () => {
  it("mints once and persists the same record on repeat calls", async () => {
    const { chrome, map } = fakeChromeStorage();
    vi.stubGlobal("chrome", chrome);

    const first = await resolveIdentity();
    expect(first).not.toBeNull();
    expect(map.get(COLLAB_PROFILE_ID_KEY)).toBeDefined();

    const second = await resolveIdentity();
    expect(second?.profileId).toBe(first?.profileId);
    expect(second?.seed).toBe(first?.seed);
    expect(second?.pub).toBe(first?.pub);
  });

  it("fresh profile name is the short handle (profileId.slice(0,4))", async () => {
    vi.stubGlobal("chrome", fakeChromeStorage().chrome);
    const identity = await resolveIdentity();
    expect(identity).not.toBeNull();
    expect(identity!.name).toBe(identity!.profileId.slice(0, 4));
    expect(identity!.name).not.toBe("");
  });

  it("reuses the stored server-config member keypair when present", async () => {
    const { chrome, map } = fakeChromeStorage();
    vi.stubGlobal("chrome", chrome);
    map.set(COLLAB_SERVER_CONFIG, {
      relay: "https://r.example",
      org: "acme",
      sk: "s",
      ck: "c",
      member: { seed: "member-seed", pub: "member-pub" },
    });

    const identity = await resolveIdentity();
    expect(identity?.seed).toBe("member-seed");
    expect(identity?.pub).toBe("member-pub");
  });

  it("returns override without touching storage", async () => {
    vi.stubGlobal("chrome", fakeChromeStorage().chrome);
    const override: CollabIdentity = {
      profileId: "ovr",
      name: "Ada",
      seed: "s",
      pub: "p",
    };
    await expect(resolveIdentity(override)).resolves.toBe(override);
  });

  it("mints a valid Ed25519 keypair via crypto.subtle", async () => {
    const kp = await mintMemberKeypair();
    expect(kp.seed).toBeTruthy();
    expect(kp.pub).toBeTruthy();
    expect(kp.seed).not.toBe(kp.pub);
  });
});

describe("updateDisplayName", () => {
  const identity: CollabIdentity = {
    profileId: "abcd-efgh",
    name: "abcd",
    seed: "seed",
    pub: "pub",
  };

  it("accepts a valid trimmed name", () => {
    const next = updateDisplayName(identity, "  Ada  ");
    expect(next).not.toBeNull();
    expect(next!.name).toBe("Ada");
    expect(next!.profileId).toBe(identity.profileId);
    expect(next!.seed).toBe(identity.seed);
    expect(next!.pub).toBe(identity.pub);
  });

  it("accepts a 40-char name", () => {
    expect(updateDisplayName(identity, "a".repeat(40))?.name).toBe("a".repeat(40));
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["41-char name", "a".repeat(41)],
  ])("rejects %s", (_label, name) => {
    expect(updateDisplayName(identity, name)).toBeNull();
  });

  it("returns a NEW object and does not mutate the input", () => {
    const before = { ...identity };
    const next = updateDisplayName(identity, "Ada");
    expect(next).not.toBe(identity);
    expect(identity).toEqual(before);
  });
});
