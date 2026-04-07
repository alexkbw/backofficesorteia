import { describe, expect, it } from "vitest";

import { getPromotionContestCode, normalizePackageSize } from "./raffle";

describe("normalizePackageSize", () => {
  it("preserves valid dynamic package sizes", () => {
    expect(normalizePackageSize(15)).toBe(15);
    expect(normalizePackageSize(137)).toBe(137);
  });

  it("falls back for invalid values", () => {
    expect(normalizePackageSize(undefined)).toBe(10);
    expect(normalizePackageSize(0)).toBe(10);
    expect(normalizePackageSize(-5)).toBe(10);
  });

  it("caps values at the ticket pool limit", () => {
    expect(normalizePackageSize(10000)).toBe(9999);
  });
});

describe("getPromotionContestCode", () => {
  it("prefers the explicit contest code", () => {
    expect(getPromotionContestCode({ contest_code: "FED-6054", id: "promo-1", title: "Poster" })).toBe("FED-6054");
  });

  it("falls back to the promotion id when needed", () => {
    expect(getPromotionContestCode({ contest_code: "", id: "promo-2", title: "Poster" })).toBe("promo-2");
  });
});
