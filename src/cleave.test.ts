import { describe, expect, it } from "vitest";
import { cleaveThrough, sameShotThroughPlating } from "./cleave";

describe("cleaveThrough", () => {
  it("requires ap 4 on unarmored 80 percent durable and then subtracts 4", () => {
    expect(cleaveThrough(0, 0.8, 4)).toBe(0);
    expect(cleaveThrough(0, 0.8, 3)).toBeNull();
  });

  it("does not invent rows for light armor and above", () => {
    expect(cleaveThrough(2, 0, 10)).toBeNull();
    expect(cleaveThrough(3, 0, 10)).toBeNull();
    expect(cleaveThrough(4, 0, 10)).toBeNull();
    expect(cleaveThrough(5, 0, 10)).toBeNull();
  });

  it("uses the very-light row", () => {
    expect(cleaveThrough(1, 0.1, 4)).toBe(2);
    expect(cleaveThrough(1, 0.5, 4)).toBeNull();
    expect(cleaveThrough(1, 0.9, 5)).toBe(1);
  });

  it("lets a same shot pass plating only when both gates pass", () => {
    expect(sameShotThroughPlating(0, 0.1, 2)).toBe(true);
    expect(sameShotThroughPlating(1, 0.1, 3)).toBe(false);
    expect(sameShotThroughPlating(1, 0.1, 4)).toBe(true);
  });
});
