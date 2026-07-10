import { describe, expect, it } from "vitest";

import { lendingTrendItemSchema, programTradeItemSchema } from "../src/kiwoom/types.js";
import { formatProgramTrades } from "../src/tools/program-trading.js";
import { formatLendingTrend } from "../src/tools/stock-lending.js";

const MODE = "모의투자";

// ── ka10068/ka20068 대차거래추이 — verbatim from the mock probe (2026-07-10) ──
describe("formatLendingTrend", () => {
  const marketRows = [
    // 당일 행은 집계 전 — 전부 "0"으로 온다 (실측).
    { dt: "20260710", dbrt_trde_cntrcnt: "0", dbrt_trde_rpy: "0", rmnd: "0", dbrt_trde_irds: "0", remn_amt: "0" },
    {
      dt: "20260709",
      dbrt_trde_cntrcnt: "42259532",
      dbrt_trde_rpy: "31358924",
      rmnd: "2945947410",
      dbrt_trde_irds: "10900608",
      remn_amt: "161880803",
    },
  ].map((r) => lendingTrendItemSchema.parse(r));

  const stockRows = [
    {
      dt: "20260709",
      dbrt_trde_cntrcnt: "1299959",
      dbrt_trde_rpy: "3025622",
      dbrt_trde_irds: "-1725663",
      rmnd: "83045770",
      remn_amt: "23086724",
    },
  ].map((r) => lendingTrendItemSchema.parse(r));

  it("renders the market-wide trend (ka10068) with signed 증감", () => {
    const text = formatLendingTrend(marketRows, { fromDate: "20260610", toDate: "20260710" }, MODE);
    expect(text).toContain("대차거래 추이 — 시장 전체 (2026-06-10 ~ 2026-07-10, 2일)");
    expect(text).toContain("| 2026-07-09 | 42,259,532 | 31,358,924 | +10,900,608 | 2,945,947,410 | 161,880,803 |");
    expect(text).toContain("당일 행은 집계 확정 전");
  });

  it("renders a per-stock trend (ka20068) with negative 증감", () => {
    const text = formatLendingTrend(
      stockRows,
      { stockCode: "005930", fromDate: "20260610", toDate: "20260710" },
      MODE,
    );
    expect(text).toContain("대차거래 추이 — 종목 005930");
    expect(text).toContain("| 2026-07-09 | 1,299,959 | 3,025,622 | -1,725,663 | 83,045,770 | 23,086,724 |");
  });

  it("reports an empty range with the queried scope", () => {
    const text = formatLendingTrend([], { stockCode: "005930", fromDate: "20260601", toDate: "20260607" }, MODE);
    expect(text).toContain("대차거래 추이가 없습니다 (종목 005930, 2026-06-01 ~ 2026-06-07)");
  });
});

// ── ka90003 프로그램순매수상위50 — verbatim from the mock probe (2026-07-10 09:01 KST, 장중) ──
describe("formatProgramTrades", () => {
  const items = [
    {
      rank: "1",
      stk_cd: "005930",
      stk_nm: "삼성전자",
      cur_prc: "+288500",
      flu_sig: "2",
      pred_pre: "+10500",
      flu_rt: "+3.78",
      acc_trde_qty: "896099",
      prm_sell_amt: "69927",
      prm_buy_amt: "170163",
      prm_netprps_amt: "+100236",
    },
    {
      rank: "2",
      stk_cd: "006400",
      stk_nm: "삼성SDI",
      cur_prc: "+412000",
      flu_sig: "2",
      pred_pre: "+10500",
      flu_rt: "+2.62",
      acc_trde_qty: "27626",
      prm_sell_amt: "2365",
      prm_buy_amt: "5976",
      prm_netprps_amt: "+3610",
    },
  ].map((r) => programTradeItemSchema.parse(r));

  // kosdaq/quantity variant row — same keys, prm_* 값이 주 단위 (verbatim).
  const quantityItems = [
    {
      rank: "1",
      stk_cd: "109610",
      stk_nm: "에스와이",
      cur_prc: "+2375",
      flu_sig: "2",
      pred_pre: "+105",
      flu_rt: "+4.63",
      acc_trde_qty: "458552",
      prm_sell_amt: "53243",
      prm_buy_amt: "184503",
      prm_netprps_amt: "+131260",
    },
  ].map((r) => programTradeItemSchema.parse(r));

  it("renders net-buy rows with abs price and signed 순매수 (amount unit)", () => {
    const text = formatProgramTrades(items, "net_buy", "amount", "kospi", 20, MODE);
    expect(text).toContain("코스피 프로그램 순매수 상위 (상위 2종목, 단위: 백만원)");
    expect(text).toContain("| 1 | 삼성전자 | 005930 | 288,500 | +3.78% | 170,163 | 69,927 | +100,236 |");
    expect(text).toContain("| 2 | 삼성SDI | 006400 | 412,000 | +2.62% | 5,976 | 2,365 | +3,610 |");
  });

  it("labels the quantity unit and slices to top", () => {
    const text = formatProgramTrades([...quantityItems, ...items], "net_sell", "quantity", "kosdaq", 1, MODE);
    expect(text).toContain("코스닥 프로그램 순매도 상위 (상위 1종목, 단위: 주)");
    expect(text).toContain("| 1 | 에스와이 | 109610 | 2,375 | +4.63% | 184,503 | 53,243 | +131,260 |");
    expect(text).not.toContain("삼성전자");
  });

  it("explains the pre-market empty state", () => {
    const text = formatProgramTrades([], "net_buy", "amount", "kospi", 20, MODE);
    expect(text).toContain("코스피 프로그램 순매수 상위 데이터가 없습니다");
    expect(text).toContain("장 시작 전");
  });
});
