import { describe, expect, it } from "vitest";

import { dailyChartItemSchema, minuteChartItemSchema } from "../src/kiwoom/types.js";
import { formatSectorDailyChart, formatSectorMinuteChart } from "../src/tools/sector-chart.js";

const MODE = "모의투자";

// Fixtures mirror mockapi ka20006/ka20005/ka20019 responses captured 2026-07-21.
// Index values arrive ×100 as integers ("674795" = 6747.95, cross-checked
// against ka20001/ka20003 on the same mock session).

const dayItems = [
  { cur_prc: "674795", trde_qty: "391092", dt: "20260721", open_pric: "655388", high_pric: "683686", low_pric: "642903", trde_prica: "24810735" },
  { cur_prc: "651627", trde_qty: "345825", dt: "20260720", open_pric: "664358", high_pric: "681486", low_pric: "647280", trde_prica: "29690576" },
  { cur_prc: "682060", trde_qty: "424280", dt: "20260716", open_pric: "696050", high_pric: "699593", low_pric: "673087", trde_prica: "29820663" },
].map((i) => dailyChartItemSchema.parse(i));

const yearItems = [
  { cur_prc: "674795", trde_qty: "102807302", dt: "20260102", open_pric: "422453", high_pric: "938559", low_pric: "421668", trde_prica: "4887788837" },
  { cur_prc: "421417", trde_qty: "107698587", dt: "20250102", open_pric: "240087", high_pric: "422675", low_pric: "228472", trde_prica: "3000843166" },
].map((i) => dailyChartItemSchema.parse(i));

// 분봉 rows carry sign-prefixed values (+674795) like stock prices.
const minuteItems = [
  { cur_prc: "+674795", trde_qty: "11730", cntr_tm: "20260721153000", open_pric: "+676183", high_pric: "+676217", low_pric: "+674773", acc_trde_qty: "391092" },
  { cur_prc: "+676183", trde_qty: "186", cntr_tm: "20260721152000", open_pric: "+676183", high_pric: "+676183", low_pric: "+676183", acc_trde_qty: "379362" },
].map((i) => minuteChartItemSchema.parse(i));

describe("formatSectorDailyChart", () => {
  it("divides the ×100 index values by 100 for display", () => {
    const text = formatSectorDailyChart(dayItems, "001", "day", 30, MODE);
    expect(text).toContain("[모의투자] 코스피 종합 (001) 일봉 차트 (최근 3개)");
    expect(text).toContain("| 2026-07-21 | 6,553.88 | 6,836.86 | 6,429.03 | 6,747.95 | 391,092 |");
  });

  it("renders oldest→newest for trend reading", () => {
    const text = formatSectorDailyChart(dayItems, "001", "day", 30, MODE);
    const first = text.indexOf("2026-07-16");
    const last = text.indexOf("2026-07-21");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(last);
  });

  it("caps rows at count (newest kept)", () => {
    const text = formatSectorDailyChart(dayItems, "001", "day", 2, MODE);
    expect(text).toContain("(최근 2개)");
    expect(text).not.toContain("2026-07-16");
    expect(text).toContain("2026-07-21");
  });

  it("renders year candles with the 년봉 label", () => {
    const text = formatSectorDailyChart(yearItems, "001", "year", 30, MODE);
    expect(text).toContain("년봉 차트 (최근 2개)");
    expect(text).toContain("| 2025-01-02 | 2,400.87 | 4,226.75 | 2,284.72 | 4,214.17 | 107,698,587 |");
  });

  it("points to the sector drill-down tools", () => {
    const text = formatSectorDailyChart(dayItems, "001", "day", 30, MODE);
    expect(text).toContain("get_sector_price");
    expect(text).toContain("get_sector_stocks");
  });

  it("reports missing data with a sector-code hint", () => {
    const text = formatSectorDailyChart([], "013", "day", 30, MODE);
    expect(text).toContain("업종 013 (013) 일봉 데이터가 없습니다");
    expect(text).toContain("get_market_index");
  });
});

describe("formatSectorMinuteChart", () => {
  it("strips the direction sign and divides by 100", () => {
    const text = formatSectorMinuteChart(minuteItems, "001", "5분", 30, MODE);
    expect(text).toContain("[모의투자] 코스피 종합 (001) 5분봉 차트 (최근 2개)");
    expect(text).toContain("| 2026-07-21 15:30 | 6,761.83 | 6,762.17 | 6,747.73 | 6,747.95 | 11,730 |");
  });

  it("reports missing data for the tick label", () => {
    const text = formatSectorMinuteChart([], "101", "30틱", 30, MODE);
    expect(text).toContain("코스닥 종합 (101) 30틱봉 데이터가 없습니다");
  });
});
