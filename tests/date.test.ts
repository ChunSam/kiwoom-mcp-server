import { describe, expect, it } from "vitest";

import { assertDateRange, formatDateDashed, previousDay } from "../src/utils/date.js";

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

describe("previousDay", () => {
  it("steps back one calendar day", () => {
    expect(previousDay("20260814")).toBe("20260813");
  });

  it("crosses month, year, and leap-day boundaries", () => {
    expect(previousDay("20260801")).toBe("20260731");
    expect(previousDay("20260301")).toBe("20260228");
    expect(previousDay("20240301")).toBe("20240229"); // 윤년
    expect(previousDay("20260101")).toBe("20251231");
  });

  it("does not depend on today — the same input always gives the same output", () => {
    // 이 함수가 생긴 이유다. `kstDaysAgo(1)`은 기준이 늘 오늘이라 하루가 지나면
    // 같은 인자에 다른 답을 준다(2026-08-15에 그 차이로 스위트가 깨졌다).
    expect(previousDay("20260814")).toBe(previousDay("20260814"));
    expect(previousDay("20260814")).not.toBe(previousDay("20260815"));
  });
});
