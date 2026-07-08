import { describe, expect, it } from "vitest";

import {
  formatKRW,
  formatPercent,
  formatSignedKRW,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../src/utils/num.js";

describe("parseKiwoomNumber", () => {
  it("parses zero-padded integers", () => {
    expect(parseKiwoomNumber("000000061300")).toBe(61300);
  });

  it("parses sign-prefixed values preserving sign", () => {
    expect(parseKiwoomNumber("+61300")).toBe(61300);
    expect(parseKiwoomNumber("-00013000")).toBe(-13000);
  });

  it("parses decimal rates", () => {
    expect(parseKiwoomNumber("2.16")).toBe(2.16);
    expect(parseKiwoomNumber("-0.55")).toBe(-0.55);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseKiwoomNumber("")).toBeNull();
    expect(parseKiwoomNumber("   ")).toBeNull();
    expect(parseKiwoomNumber("-")).toBeNull();
    expect(parseKiwoomNumber("abc")).toBeNull();
    expect(parseKiwoomNumber(null)).toBeNull();
    expect(parseKiwoomNumber(undefined)).toBeNull();
  });

  it("parses zero", () => {
    expect(parseKiwoomNumber("0")).toBe(0);
    expect(parseKiwoomNumber("0.00")).toBe(0);
  });

  it("collapses doubled signs (ka10061 live quirk)", () => {
    expect(parseKiwoomNumber("--23722054")).toBe(-23722054);
    expect(parseKiwoomNumber("++440.25")).toBe(440.25);
  });

  it("strips comma grouping (kt00015 trde_unit)", () => {
    expect(parseKiwoomNumber("20,190")).toBe(20190);
    expect(parseKiwoomNumber("1,234,567")).toBe(1234567);
  });
});

describe("parseKiwoomPrice", () => {
  it("strips the direction sign from prices", () => {
    expect(parseKiwoomPrice("-61300")).toBe(61300);
    expect(parseKiwoomPrice("+61300")).toBe(61300);
  });
});

describe("formatters", () => {
  it("formats KRW with thousands separators", () => {
    expect(formatKRW(1234567)).toBe("1,234,567원");
    expect(formatKRW(null)).toBe("-");
  });

  it("formats signed KRW", () => {
    expect(formatSignedKRW(13000)).toBe("+13,000원");
    expect(formatSignedKRW(-13000)).toBe("-13,000원");
    expect(formatSignedKRW(0)).toBe("0원");
  });

  it("formats percent with sign", () => {
    expect(formatPercent(2.16)).toBe("+2.16%");
    expect(formatPercent(-0.5)).toBe("-0.50%");
    expect(formatPercent(null)).toBe("-");
  });
});
