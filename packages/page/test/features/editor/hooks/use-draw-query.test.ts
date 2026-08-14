import { useDrawQuery } from "@/features/editor/hooks/use-draw-query";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

describe("use-draw-query", () => {
  afterEach(() => {
    window.location.search = "";
  });

  test("get pageType and id from query", async () => {
    window.location.search = "?type=edit&id=1";
    const { result } = renderHook(() => useDrawQuery());
    expect(result.current).toEqual({ pageType: "edit", id: "1" });
  });
});
