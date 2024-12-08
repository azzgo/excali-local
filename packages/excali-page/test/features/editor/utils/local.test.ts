import {
  getLocalStorageAsync,
  setLocalStorage,
} from "@/features/editor/utils/local";
import { describe, expect, test, vi } from "vitest";

describe("local utils it a localstorage enscapulation", () => {
  test("can set json data", () => {
    setLocalStorage("test", { a: 1 });
    expect(localStorage.getItem("test")).toEqual('{"a":1}');
  });

  test("can get json data", () => {
    localStorage.setItem("test", '{"a":1}');
    expect(localStorage.getItem("test")).toEqual('{"a":1}');
  });

  test("can get json data async", () => {
    vi.useFakeTimers({ toFake: ['requestIdleCallback'] })
    localStorage.setItem("test", '{"a":1}');
    getLocalStorageAsync("test", null)
      .then((data) => {
        expect(data).toEqual({ a: 1 });
      });
    vi.runAllTimers()
    vi.useRealTimers()
  });
});
