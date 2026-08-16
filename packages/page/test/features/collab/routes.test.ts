import { describe, expect, test } from "vitest";
import { parseHash, roomRoute, ROUTES } from "@/features/collab/routes";

describe("collab routes (053 round 3 URL scheme)", () => {
  test("no hash / empty hash / bare # → landing", () => {
    expect(parseHash("")).toEqual({ name: "landing" });
    expect(parseHash("#")).toEqual({ name: "landing" });
    expect(parseHash("#/")).toEqual({ name: "landing" });
    expect(parseHash(undefined)).toEqual({ name: "landing" });
    expect(parseHash(null)).toEqual({ name: "landing" });
  });

  test("named screens map to their hashes", () => {
    expect(parseHash("#config")).toEqual({ name: "config" });
    expect(parseHash("#create")).toEqual({ name: "create" });
    expect(parseHash("#join")).toEqual({ name: "join" });
    expect(parseHash("#rooms")).toEqual({ name: "rooms" });
    // hash without the leading # also parses (defensive)
    expect(parseHash("config")).toEqual({ name: "config" });
  });

  test("#room/<shareId> parses the shareId (bookmarkable room URL)", () => {
    expect(parseHash("#room/c3d9f8")).toEqual({ name: "room", shareId: "c3d9f8" });
    expect(parseHash("#room/c3d9f8/")).toEqual({ name: "room", shareId: "c3d9f8" });
    expect(
      parseHash("#room/AbC123_xyZ-9_0QweRtYuIoPl"),
    ).toEqual({ name: "room", shareId: "AbC123_xyZ-9_0QweRtYuIoPl" });
  });

  test("unknown hash → landing (053: no hash / unknown → landing)", () => {
    expect(parseHash("#garbage")).toEqual({ name: "landing" });
    expect(parseHash("#room")).toEqual({ name: "landing" });
    expect(parseHash("#room/")).toEqual({ name: "landing" });
    expect(parseHash("#room/a/b")).toEqual({ name: "landing" });
  });

  test("roomRoute builds the bookmarkable URL and ROUTES constants are stable", () => {
    expect(roomRoute("c3d9f8")).toBe("#room/c3d9f8");
    expect(roomRoute("a b")).toBe("#room/a%20b");
    expect(ROUTES.landing).toBe("");
    expect(ROUTES.config).toBe("#config");
    expect(ROUTES.create).toBe("#create");
    expect(ROUTES.join).toBe("#join");
    expect(ROUTES.rooms).toBe("#rooms");
  });
});
