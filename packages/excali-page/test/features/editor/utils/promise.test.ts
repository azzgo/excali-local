import { describe, expect, test } from "vitest";
import { PromsieWithResolve } from "@/features/editor/utils/promise";

describe("promise utils", () => {
  test("PromiseWithResolve provide promise with resolve function", async () => {
    const { promise, resolve } = PromsieWithResolve<number>();
    setTimeout(() => {
      resolve(42);
    }, 100);
    expect(await promise).toBe(42);
  });

  test("PromiseWithResolve provide promise with reject function", async () => {
    const { promise, reject } = PromsieWithResolve<number>();
    setTimeout(() => {
      reject(new Error("error"));
    }, 100);
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});
