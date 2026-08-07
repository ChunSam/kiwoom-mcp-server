import { describe, expect, it } from "vitest";

import { classifyInstrument, type TaxType } from "../src/isa/classify.js";
import { reconstructRealizedPnl, type TradeEvent } from "../src/isa/realized.js";
import { computeIsaTaxStatus, ISA_LIMITS } from "../src/isa/tax.js";

describe("classifyInstrument", () => {
  it("classifies overseas index ETFs as taxable", () => {
    expect(classifyInstrument("360750", "TIGER 미국S&P500").taxType).toBe("TAXABLE");
    expect(classifyInstrument("379800", "KODEX 미국S&P500").taxType).toBe("TAXABLE");
  });

  it("classifies bond ETFs as taxable", () => {
    const c = classifyInstrument("439870", "KODEX 국고채30년액티브");
    expect(c.taxType).toBe("TAXABLE");
    expect(c.confident).toBe(true);
  });

  it("classifies domestic-index ETFs as domestic equity", () => {
    expect(classifyInstrument("069500", "KODEX 코스피200").taxType).toBe("DOMESTIC_EQUITY");
    expect(classifyInstrument("069500", "KODEX 200").taxType).toBe("DOMESTIC_EQUITY");
  });

  it("taxable keywords win over domestic keywords", () => {
    // "200" (domestic) + "레버리지" (derivative → taxable)
    expect(classifyInstrument("122630", "KODEX 레버리지").taxType).toBe("TAXABLE");
    expect(classifyInstrument("371460", "TIGER 차이나전기차SOLACTIVE").taxType).toBe("TAXABLE");
  });

  it("treats non-ETF names as individual domestic stocks", () => {
    const c = classifyInstrument("005930", "삼성전자");
    expect(c.taxType).toBe("DOMESTIC_EQUITY");
    expect(c.confident).toBe(true);
  });

  it("falls back to taxable with confident=false for unknown ETFs", () => {
    const c = classifyInstrument("999999", "KODEX 신재생에너지테마");
    expect(c.taxType).toBe("TAXABLE");
    expect(c.confident).toBe(false);
  });

  it("honors manual overrides", () => {
    const overrides = new Map<string, TaxType>([["999999", "DOMESTIC_EQUITY"]]);
    const c = classifyInstrument("999999", "KODEX 신재생에너지테마", overrides);
    expect(c.taxType).toBe("DOMESTIC_EQUITY");
    expect(c.confident).toBe(true);
  });
});

describe("reconstructRealizedPnl", () => {
  const buy = (code: string, name: string, date: string, quantity: number, netAmount: number): TradeEvent => ({
    code,
    name,
    side: "BUY",
    quantity,
    netAmount,
    date,
    seq: 1,
  });
  const sell = (code: string, name: string, date: string, quantity: number, netAmount: number): TradeEvent => ({
    code,
    name,
    side: "SELL",
    quantity,
    netAmount,
    date,
    seq: 1,
  });

  it("reconstructs realized P&L for DCA buys then a full liquidation", () => {
    // Synthetic DCA sequence: five partial buys, then a single full sell.
    const events = [
      buy("900100", "샘플지수ETF", "20250102", 10, 100000),
      buy("900100", "샘플지수ETF", "20250203", 10, 110000),
      buy("900100", "샘플지수ETF", "20250303", 10, 120000),
      buy("900100", "샘플지수ETF", "20250401", 10, 130000),
      buy("900100", "샘플지수ETF", "20250502", 10, 140000),
      sell("900100", "샘플지수ETF", "20250602", 50, 630000),
    ];
    const result = reconstructRealizedPnl(events);
    expect(result.perStock).toHaveLength(1);
    expect(result.perStock[0]!.realized).toBeCloseTo(630000 - 600000, 5); // 30,000
    expect(result.perStock[0]!.incompleteHistory).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("uses moving-average cost for partial sells", () => {
    const events = [
      buy("000001", "테스트", "20260101", 10, 100000), // avg 10,000
      buy("000001", "테스트", "20260201", 10, 140000), // avg 12,000
      sell("000001", "테스트", "20260301", 5, 70000), // 70,000 - 5*12,000 = +10,000
    ];
    const result = reconstructRealizedPnl(events);
    expect(result.perStock[0]!.realized).toBeCloseTo(10000, 5);
    expect(result.total).toBeCloseTo(10000, 5);
  });

  it("flags sells that exceed the tracked position", () => {
    const events = [
      buy("000001", "테스트", "20260201", 5, 50000),
      sell("000001", "테스트", "20260301", 10, 120000), // 5주는 기간 밖 취득분
    ];
    const result = reconstructRealizedPnl(events);
    expect(result.perStock[0]!.incompleteHistory).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    // covered 5주만 실현: 120000*(5/10) - 10000*5 = 10,000
    expect(result.perStock[0]!.realized).toBeCloseTo(10000, 5);
  });

  it("orders events by date regardless of input order", () => {
    const events = [
      sell("000001", "테스트", "20260301", 10, 130000),
      buy("000001", "테스트", "20260101", 10, 100000),
    ];
    const result = reconstructRealizedPnl(events);
    expect(result.perStock[0]!.realized).toBeCloseTo(30000, 5);
    expect(result.perStock[0]!.incompleteHistory).toBe(false);
  });
});

describe("computeIsaTaxStatus", () => {
  const entry = (amount: number, taxType: TaxType) => ({
    code: "000000",
    name: "테스트",
    amount,
    taxType,
    confident: true,
  });

  it("excludes domestic-equity gains but includes taxable gains", () => {
    const status = computeIsaTaxStatus({
      limit: ISA_LIMITS.SEOMIN,
      dividends: 0,
      realized: [entry(30000, "TAXABLE"), entry(50000, "DOMESTIC_EQUITY")],
      unrealized: [entry(-8000, "TAXABLE"), entry(2000, "TAXABLE")],
    });

    expect(status.taxableRealized).toBe(30000);
    expect(status.domesticLossDeduction).toBe(0); // 국내주식형 이익은 통산 제외
    expect(status.confirmedNet).toBe(30000);
    expect(status.remainingAllowance).toBe(4_000_000 - 30000);
    expect(status.estimatedTaxNow).toBe(0);
    expect(status.scenarioNet).toBe(30000 - 8000 + 2000);
  });

  it("deducts net domestic-equity realized losses", () => {
    const status = computeIsaTaxStatus({
      limit: ISA_LIMITS.GENERAL,
      dividends: 500_000,
      realized: [entry(300_000, "TAXABLE"), entry(-100_000, "DOMESTIC_EQUITY")],
      unrealized: [],
    });
    expect(status.confirmedNet).toBe(500_000 + 300_000 - 100_000);
  });

  /**
   * 전량 매도 시나리오에서는 미실현분도 실현되므로 국내주식형은 **클래스 전체**를 합산한
   * 뒤에 min(0,·)을 한 번만 걸어야 한다. 실현분·미실현분에 따로 걸면 실현 손실이 미실현
   * 이익으로 상쇄되지 않아 이중 차감된다 — 아래 케이스가 scenarioNet 200만(세금 0원)으로
   * 나왔고, 옳은 값은 300만(세금 99,000원)이다.
   */
  it("nets the domestic-equity class as a whole in the sell-everything scenario", () => {
    const status = computeIsaTaxStatus({
      limit: ISA_LIMITS.GENERAL,
      dividends: 3_000_000,
      realized: [entry(-1_000_000, "DOMESTIC_EQUITY")],
      unrealized: [entry(1_500_000, "DOMESTIC_EQUITY")],
    });

    // 확정분은 실현 기준이므로 손실 차감이 그대로 살아 있다.
    expect(status.domesticLossDeduction).toBe(-1_000_000);
    expect(status.confirmedNet).toBe(2_000_000);

    // 시나리오는 클래스 합산이 +50만(순이익)이라 차감이 사라진다.
    expect(status.scenarioNet).toBe(3_000_000);
    expect(status.scenarioEstimatedTax).toBeCloseTo(1_000_000 * 0.099, 5);
  });

  it("still deducts the domestic-equity loss when the class nets negative overall", () => {
    const status = computeIsaTaxStatus({
      limit: ISA_LIMITS.GENERAL,
      dividends: 3_000_000,
      realized: [entry(-1_000_000, "DOMESTIC_EQUITY")],
      unrealized: [entry(400_000, "DOMESTIC_EQUITY")],
    });

    // 합산 −60만 → 그만큼만 차감된다 (실현분 −100만을 통째로 쓰지 않는다).
    expect(status.scenarioNet).toBe(2_400_000);
  });

  it("computes 9.9% tax on the over-limit portion", () => {
    const status = computeIsaTaxStatus({
      limit: ISA_LIMITS.GENERAL,
      dividends: 0,
      realized: [entry(3_000_000, "TAXABLE")],
      unrealized: [],
    });
    expect(status.remainingAllowance).toBe(0);
    expect(status.estimatedTaxNow).toBeCloseTo(1_000_000 * 0.099, 5);
  });

  it("keeps the full limit when the confirmed net is a loss", () => {
    const status = computeIsaTaxStatus({
      limit: ISA_LIMITS.SEOMIN,
      dividends: 0,
      realized: [entry(-200_000, "TAXABLE")],
      unrealized: [],
    });
    expect(status.confirmedNet).toBe(-200_000);
    expect(status.remainingAllowance).toBe(ISA_LIMITS.SEOMIN);
    expect(status.estimatedTaxNow).toBe(0);
  });

  it("counts unrealized domestic-equity losses only in the scenario", () => {
    const status = computeIsaTaxStatus({
      limit: ISA_LIMITS.GENERAL,
      dividends: 0,
      realized: [],
      unrealized: [entry(100_000, "DOMESTIC_EQUITY"), entry(50_000, "TAXABLE")],
    });
    // 국내주식형 미실현 이익은 시나리오에도 미포함
    expect(status.scenarioNet).toBe(50_000);
  });
});
