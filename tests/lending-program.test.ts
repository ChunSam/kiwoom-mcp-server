import { describe, expect, it } from "vitest";

import {
  lendingTrendItemSchema,
  programTradeItemSchema,
  programTrendItemSchema,
  stockProgramTrendItemSchema,
} from "../src/kiwoom/types.js";
import { formatProgramTrades, formatProgramTrend, formatStockProgramTrend } from "../src/tools/program-trading.js";
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

// ── ka90010/ka90005 프로그램매매추이 — verbatim from the mock probe (2026-07-24 10:01 KST, 장중) ──
describe("formatProgramTrend", () => {
  // ka90010 일자별: 단일부호, 양수 all_netprps는 무부호, kospi200은 소수 그대로.
  const dailyRows = [
    {
      cntr_tm: "20260724000000",
      dfrt_trde_sel: "83765",
      dfrt_trde_buy: "28309",
      dfrt_trde_netprps: "-55456",
      ndiffpro_trde_sel: "2750114",
      ndiffpro_trde_buy: "1859256",
      ndiffpro_trde_netprps: "-890858",
      all_sel: "2833879",
      all_buy: "1887565",
      all_netprps: "-946314",
      kospi200: "+1089.70",
      basis: "5.20",
    },
    {
      cntr_tm: "20260723000000",
      dfrt_trde_sel: "447085",
      dfrt_trde_buy: "404333",
      dfrt_trde_netprps: "-42751",
      ndiffpro_trde_sel: "7850176",
      ndiffpro_trde_buy: "9650306",
      ndiffpro_trde_netprps: "+1800131",
      all_sel: "8297260",
      all_buy: "10054640",
      all_netprps: "1757380",
      kospi200: "+1126.33",
      basis: "6.17",
    },
  ].map((r) => programTrendItemSchema.parse(r));

  // ka90005 시간대별: 이중부호(--), kospi200 ×100 정수; 첫 집계 행은 basis가 빈 값.
  const intradayRows = [
    {
      cntr_tm: "100100",
      dfrt_trde_sel: "83765",
      dfrt_trde_buy: "28309",
      dfrt_trde_netprps: "--55456",
      ndiffpro_trde_sel: "2750114",
      ndiffpro_trde_buy: "1859256",
      ndiffpro_trde_netprps: "--890858",
      all_sel: "2833879",
      all_buy: "1887565",
      all_netprps: "--946314",
      kospi200: "+108970",
      basis: "5.20",
    },
    {
      cntr_tm: "085100",
      dfrt_trde_sel: "0",
      dfrt_trde_buy: "0",
      dfrt_trde_netprps: "0",
      ndiffpro_trde_sel: "123",
      ndiffpro_trde_buy: "12",
      ndiffpro_trde_netprps: "--111",
      all_sel: "123",
      all_buy: "12",
      all_netprps: "--111",
      kospi200: "0",
      basis: "",
    },
  ].map((r) => programTrendItemSchema.parse(r));

  it("renders daily rows with dashed dates, normalized signs, and a truncated note", () => {
    const text = formatProgramTrend(dailyRows, "daily", "kospi", "20260724", 20, true, MODE);
    expect(text).toContain("코스피 프로그램 매매 일자별 추이 — 기준일 2026-07-24 (최근 2행, 단위: 백만원)");
    expect(text).toContain("| 2026-07-24 | 1,887,565 | 2,833,879 | -946,314 | -55,456 | -890,858 | 1,089.7 | 5.2 |");
    // 양수 all_netprps는 무부호로 오지만 +로 정규화해 표시한다.
    expect(text).toContain("| 2026-07-23 | 10,054,640 | 8,297,260 | +1,757,380 | -42,751 | +1,800,131 | 1,126.33 | 6.17 |");
    expect(text).toContain("표시된 범위 이전의 데이터는 생략됐습니다");
    expect(text).not.toContain("당일 누적값");
  });

  it("renders intraday rows with HH:MM, ÷100 index, and the cumulative note", () => {
    const text = formatProgramTrend(intradayRows, "intraday", "kospi", "20260724", 20, false, MODE);
    expect(text).toContain("코스피 프로그램 매매 시간대별 추이 — 기준일 2026-07-24");
    expect(text).toContain("| 10:01 | 1,887,565 | 2,833,879 | -946,314 | -55,456 | -890,858 | 1,089.7 | 5.2 |");
    // 빈 basis는 "-", 이중부호는 단일 부호로.
    expect(text).toContain("| 08:51 | 12 | 123 | -111 | 0 | -111 | 0 | - |");
    expect(text).toContain("당일 누적값입니다");
    expect(text).not.toContain("생략됐습니다");
  });

  it("explains the empty state (pre-market or holiday)", () => {
    const text = formatProgramTrend([], "daily", "kosdaq", "20260724", 20, false, MODE);
    expect(text).toContain("코스닥 프로그램 매매 일자별 추이 — 기준일 2026-07-24: 데이터가 없습니다");
  });
});

// ── ka90013 종목일별프로그램매매추이 — verbatim from the mock probe (2026-07-24, 005930) ──
describe("formatStockProgramTrend", () => {
  const rows = [
    {
      dt: "20260724",
      cur_prc: "-259500",
      pre_sig: "5",
      pred_pre: "-10500",
      flu_rt: "-3.89",
      trde_qty: "4821554",
      prm_sell_amt: "452674",
      prm_buy_amt: "253203",
      prm_netprps_amt: "--199471",
      prm_netprps_amt_irds: "--381473",
      prm_sell_qty: "1731277",
      prm_buy_qty: "968686",
      prm_netprps_qty: "--762591",
      prm_netprps_qty_irds: "--1434275",
      base_pric_tm: "",
      dbrt_trde_rpy_sum: "",
      remn_rcvord_sum: "",
      stex_tp: "KRX",
    },
    {
      dt: "20260723",
      cur_prc: "+270000",
      pre_sig: "2",
      pred_pre: "+9500",
      flu_rt: "+3.65",
      trde_qty: "16011816",
      prm_sell_amt: "1411798",
      prm_buy_amt: "1593800",
      prm_netprps_amt: "+182002",
      prm_netprps_amt_irds: "+184098",
      prm_sell_qty: "5248524",
      prm_buy_qty: "5920208",
      prm_netprps_qty: "+671684",
      prm_netprps_qty_irds: "+711814",
      base_pric_tm: "",
      dbrt_trde_rpy_sum: "",
      remn_rcvord_sum: "",
      stex_tp: "KRX",
    },
  ].map((r) => stockProgramTrendItemSchema.parse(r));

  it("renders per-stock daily rows with abs 종가 and collapsed double signs", () => {
    const text = formatStockProgramTrend(rows, "005930", undefined, 20, true, MODE);
    expect(text).toContain("종목 일별 프로그램 매매 추이 — 005930 (최근일 기준) (최근 2일, 금액 단위: 백만원)");
    expect(text).toContain("| 2026-07-24 | 259,500 | -3.89% | 253,203 | 452,674 | -199,471 | -381,473 |");
    expect(text).toContain("| 2026-07-23 | 270,000 | +3.65% | 1,593,800 | 1,411,798 | +182,002 | +184,098 |");
    expect(text).toContain("표시된 범위 이전의 데이터는 생략됐습니다");
  });

  it("labels an explicit base_date and slices to top", () => {
    const text = formatStockProgramTrend(rows, "005930", "20260724", 1, false, MODE);
    expect(text).toContain("(기준일 2026-07-24)");
    expect(text).toContain("2026-07-24");
    expect(text).not.toContain("| 2026-07-23 |");
    // page-1(20행)보다 적게 표시하면 생략 안내가 붙는다.
    expect(text).toContain("생략됐습니다");
  });

  it("explains the empty state", () => {
    const text = formatStockProgramTrend([], "999999", undefined, 20, false, MODE);
    expect(text).toContain("종목 일별 프로그램 매매 추이 — 999999");
    expect(text).toContain("데이터가 없습니다");
  });
});
