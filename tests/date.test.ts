import { describe, expect, it } from "vitest";

import { assertDateRange, formatDateDashed } from "../src/utils/date.js";

describe("assertDateRange", () => {
  it("accepts from < to and from == to", () => {
    expect(() => assertDateRange("20260101", "20260630")).not.toThrow();
    expect(() => assertDateRange("20260630", "20260630")).not.toThrow();
  });

  it("rejects an inverted range with a readable Korean error", () => {
    expect(() => assertDateRange("20260701", "20260630")).toThrow(
      /시작일\(2026-07-01\)이 종료일\(2026-06-30\)보다 늦습니다/,
    );
  });
});

describe("formatDateDashed", () => {
  it("formats yyyyMMdd with dashes", () => {
    expect(formatDateDashed("20260708")).toBe("2026-07-08");
  });
});
