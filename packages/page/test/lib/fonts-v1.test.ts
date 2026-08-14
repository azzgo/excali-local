import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  FONT_SIZE_LIMIT,
  handleFontsV1Request,
  type FontsV1Deps,
  type FontsV1Request,
} from "@/lib/fonts-v1";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type AnySource =
  | { type: "system"; postscriptName: string }
  | { type: "custom"; family: string; data?: Uint8Array }
  | null;

function makeDeps(initial: { handwriting?: AnySource; normal?: AnySource; code?: AnySource } = {}) {
  const config: { handwriting: AnySource; normal: AnySource; code: AnySource } = {
    handwriting: initial.handwriting ?? null,
    normal: initial.normal ?? null,
    code: initial.code ?? null,
  };
  const db = {
    getFontConfig: vi.fn(async () => ({
      handwriting: config.handwriting,
      normal: config.normal,
      code: config.code,
    })),
    updateFontSlot: vi.fn(async (slot: string, source: AnySource) => {
      (config as Record<string, AnySource>)[slot] = source;
    }),
    clearFontSlot: vi.fn(async (slot: string) => {
      (config as Record<string, AnySource>)[slot] = null;
    }),
  };
  const onConfirm = vi.fn(async () => true);
  const deps: FontsV1Deps = { db, onConfirm };
  return { deps, db, onConfirm, config };
}

const call = (deps: FontsV1Deps, method: string, params?: unknown, id = 1) =>
  handleFontsV1Request({ jsonrpc: "2.0", id, method, params } as FontsV1Request, deps);

const okResult = async (resp: Awaited<ReturnType<typeof handleFontsV1Request>>) => {
  expect(resp.error).toBeUndefined();
  return resp.result;
};

// A tiny real TTF header (magic 0x00010000) + a few bytes — passes the
// format validation; the dispatcher never inspects beyond the magic.
const TTF_BASE64 = btoa(String.fromCharCode(0x00, 0x01, 0x00, 0x00, 0x50, 0x41));
const WOFF2_BASE64 = btoa("wOF2xxxx");
const OTF_BASE64 = btoa("OTTOxxxx");

describe("fonts/v1 dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fonts.get — trimmed wire config, NO bytes", () => {
    test("null config → all slots null", async () => {
      const { deps } = makeDeps();
      const result = (await okResult(await call(deps, "fonts.get", {}))) as Record<string, unknown>;
      expect(result).toEqual({ handwriting: null, normal: null, code: null });
      expect(deps.onConfirm).not.toHaveBeenCalled();
    });

    test("custom slot trimmed to {type,family} — data bytes dropped", async () => {
      const { deps } = makeDeps({
        code: { type: "custom", family: "My Code Font", data: new Uint8Array([1, 2, 3]) },
      });
      const result = (await okResult(await call(deps, "fonts.get", {}))) as {
        code: Record<string, unknown>;
      };
      expect(result.code).toEqual({ type: "custom", family: "My Code Font" });
      expect("data" in result.code).toBe(false); // NO bytes on the wire
      expect(JSON.stringify(result)).not.toContain("1,2,3");
    });

    test("system + null slots as-is", async () => {
      const { deps } = makeDeps({
        handwriting: { type: "system", postscriptName: "SFNS-Regular" },
      });
      const result = (await okResult(await call(deps, "fonts.get", {}))) as {
        handwriting: Record<string, unknown>;
        normal: null;
      };
      expect(result.handwriting).toEqual({ type: "system", postscriptName: "SFNS-Regular" });
      expect(result.normal).toBeNull();
    });
  });

  describe("fonts.assign — non-blocking system swap", () => {
    test("updateFontSlot with system source + requiresReload:true", async () => {
      const { deps, db } = makeDeps();
      const result = (await okResult(
        await call(deps, "fonts.assign", { slot: "normal", postscriptName: "SFNS-Regular" }),
      )) as { requiresReload: boolean; config: Record<string, unknown> };
      expect(db.updateFontSlot).toHaveBeenCalledWith("normal", {
        type: "system",
        postscriptName: "SFNS-Regular",
      });
      expect(result.requiresReload).toBe(true);
      expect(result.config).toMatchObject({ normal: { type: "system", postscriptName: "SFNS-Regular" } });
      expect(deps.onConfirm).not.toHaveBeenCalled(); // non-blocking
    });

    test("invalid slot → -32602", async () => {
      const { deps, db } = makeDeps();
      const resp = await call(deps, "fonts.assign", { slot: "bogus", postscriptName: "X" });
      expect(resp.error?.code).toBe(-32602);
      expect(db.updateFontSlot).not.toHaveBeenCalled();
    });

    test("missing postscriptName → -32602", async () => {
      const { deps, db } = makeDeps();
      const resp = await call(deps, "fonts.assign", { slot: "code" });
      expect(resp.error?.code).toBe(-32602);
      expect(db.updateFontSlot).not.toHaveBeenCalled();
    });
  });

  describe("fonts.install — BLOCKING, validated BEFORE the modal", () => {
    test("valid ttf → confirm → custom slot + requiresReload:true", async () => {
      const { deps, db, onConfirm } = makeDeps();
      const result = (await okResult(
        await call(deps, "fonts.install", { slot: "code", family: "My Font", data: TTF_BASE64 }),
      )) as { requiresReload: boolean };
      expect(onConfirm).toHaveBeenCalledWith({
        method: "fonts.install",
        params: { slot: "code", family: "My Font", data: TTF_BASE64 },
      });
      expect(db.updateFontSlot).toHaveBeenCalledWith(
        "code",
        expect.objectContaining({ type: "custom", family: "My Font" }),
      );
      // Decoded bytes = the raw TTF bytes.
      const callArgs = db.updateFontSlot.mock.calls[0][1] as { data: Uint8Array };
      expect(callArgs.data).toBeInstanceOf(Uint8Array);
      expect(Array.from(callArgs.data)).toEqual([0x00, 0x01, 0x00, 0x00, 0x50, 0x41]);
      expect(result.requiresReload).toBe(true);
    });

    test("otf + woff2 magic accepted", async () => {
      const { deps, db } = makeDeps();
      await okResult(await call(deps, "fonts.install", { slot: "handwriting", family: "F", data: OTF_BASE64 }, 2));
      await okResult(await call(deps, "fonts.install", { slot: "normal", family: "F", data: WOFF2_BASE64 }, 3));
      expect(db.updateFontSlot).toHaveBeenCalledTimes(2);
    });

    test("bad magic → -32602 and NO confirm prompt", async () => {
      const { deps, db, onConfirm } = makeDeps();
      const resp = await call(deps, "fonts.install", {
        slot: "code",
        family: "X",
        data: btoa("notafont"),
      });
      expect(resp.error?.code).toBe(-32602);
      expect(onConfirm).not.toHaveBeenCalled(); // validated BEFORE the modal
      expect(db.updateFontSlot).not.toHaveBeenCalled();
    });

    test("oversize (30 MiB limit) → -32602 and NO confirm prompt", async () => {
      const { deps, db, onConfirm } = makeDeps();
      // Build a base64 payload of FONT_SIZE_LIMIT+1 bytes (4-byte ttf magic + padding).
      const big = new Uint8Array(FONT_SIZE_LIMIT + 1);
      big.set([0x00, 0x01, 0x00, 0x00]);
      let bin = "";
      for (let i = 0; i < big.length; i += 0x8000) {
        bin += String.fromCharCode(...big.subarray(i, i + 0x8000));
      }
      const resp = await call(deps, "fonts.install", {
        slot: "code",
        family: "X",
        data: btoa(bin),
      });
      expect(resp.error?.code).toBe(-32602);
      expect(String(resp.error?.message)).toContain("MiB");
      expect(onConfirm).not.toHaveBeenCalled();
      expect(db.updateFontSlot).not.toHaveBeenCalled();
    });

    test("rejected on the confirm modal → -32005, no db write", async () => {
      const { deps, db } = makeDeps();
      (deps.onConfirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const resp = await call(deps, "fonts.install", { slot: "code", family: "X", data: TTF_BASE64 });
      expect(resp.error?.code).toBe(-32005);
      expect(db.updateFontSlot).not.toHaveBeenCalled();
    });
  });

  describe("fonts.clear — BLOCKING", () => {
    test("confirm → clearFontSlot + requiresReload:true", async () => {
      const { deps, db, onConfirm } = makeDeps({ code: { type: "system", postscriptName: "SFNS" } });
      const result = (await okResult(await call(deps, "fonts.clear", { slot: "code" }))) as {
        requiresReload: boolean;
        config: Record<string, unknown>;
      };
      expect(onConfirm).toHaveBeenCalledWith({ method: "fonts.clear", params: { slot: "code" } });
      expect(db.clearFontSlot).toHaveBeenCalledWith("code");
      expect(result.requiresReload).toBe(true);
      expect(result.config).toMatchObject({ code: null });
    });

    test("rejected → -32005", async () => {
      const { deps, db } = makeDeps();
      (deps.onConfirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const resp = await call(deps, "fonts.clear", { slot: "code" });
      expect(resp.error?.code).toBe(-32005);
      expect(db.clearFontSlot).not.toHaveBeenCalled();
    });
  });

  describe("routing guard + errors", () => {
    test("fonts.system.list is daemon-local — the page must NOT handle it", async () => {
      const { deps, db } = makeDeps();
      const resp = await call(deps, "fonts.system.list", {});
      expect(resp.error?.code).toBe(-32601);
      expect(db.getFontConfig).not.toHaveBeenCalled();
    });

    test("non-2.0 → -32600; unknown method → -32601; bad params → -32602", async () => {
      const { deps } = makeDeps();
      const bad = await handleFontsV1Request(
        { jsonrpc: "1.0", id: 1, method: "fonts.get" } as unknown as FontsV1Request,
        deps,
      );
      expect(bad.error?.code).toBe(-32600);
      expect((await call(deps, "fonts.bogus", {})).error?.code).toBe(-32601);
      expect((await call(deps, "fonts.clear", "nope")).error?.code).toBe(-32602);
    });
  });
});
