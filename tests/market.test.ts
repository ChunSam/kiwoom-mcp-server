import { describe, expect, it } from "vitest";

import {
  dailyChartItemSchema,
  etfInfoResponseSchema,
  indexItemSchema,
  investorDailyItemSchema,
  investorTotalItemSchema,
  minuteChartItemSchema,
  orderbookResponseSchema,
  priceChangeRankItemSchema,
  stockInfoResponseSchema,
  stockListItemSchema,
  valueRankItemSchema,
  volumeRankItemSchema,
} from "../src/kiwoom/types.js";
import { formatEtfInfo } from "../src/tools/etf-info.js";
import { formatInvestorTrend } from "../src/tools/investor-trend.js";
import { formatIndices } from "../src/tools/market-index.js";
import { formatOrderbook } from "../src/tools/orderbook.js";
import { formatRanking } from "../src/tools/ranking.js";
import { formatDailyChart, formatMinuteChart } from "../src/tools/stock-chart.js";
import { formatSearchResults, searchStockItems } from "../src/tools/stock-search.js";

const MODE = "모의투자";

// Fixtures mirror live ka10099/ka10081/... responses captured 2026-07-05.

const masterItems = [
  { code: "005930", name: "삼성전자", lastPrice: "00286000", marketName: "거래소", upName: "전기/전자", upSizeName: "대형주", state: "증거금30%", auditInfo: "정상", orderWarning: "0" },
  { code: "069500", name: "KODEX 200", lastPrice: "00123530", marketName: "ETF", upName: "", upSizeName: "", state: "증거금20%", auditInfo: "정상", orderWarning: "0" },
  { code: "379800", name: "KODEX 미국S&P500", lastPrice: "00026320", marketName: "ETF", upName: "", upSizeName: "", state: "증거금20%", auditInfo: "정상", orderWarning: "0" },
  { code: "005935", name: "삼성전자우", lastPrice: "00230000", marketName: "거래소", upName: "전기/전자", upSizeName: "대형주", state: "증거금30%", auditInfo: "정상", orderWarning: "0" },
].map((i) => stockListItemSchema.parse(i));

describe("searchStockItems", () => {
  it("matches by exact 6-digit code first", () => {
    const results = searchStockItems(masterItems, "005930");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("삼성전자");
  });

  it("ranks exact name over prefix over partial, ignoring spaces/case", () => {
    const results = searchStockItems(masterItems, "삼성전자");
    expect(results.map((r) => r.code)).toEqual(["005930", "005935"]);

    const kodex = searchStockItems(masterItems, "kodex 미국");
    expect(kodex[0]?.code).toBe("379800");
  });

  it("returns empty for no match and renders a friendly message", () => {
    expect(searchStockItems(masterItems, "없는종목")).toHaveLength(0);
    expect(formatSearchResults([], "없는종목", MODE)).toContain("찾지 못했습니다");
  });

  it("renders a result table with parsed prices", () => {
    const text = formatSearchResults(searchStockItems(masterItems, "kodex"), "kodex", MODE);
    expect(text).toContain("| 069500 | KODEX 200 | ETF | 123,530원 | - |");
  });
});

describe("formatDailyChart", () => {
  const items = [
    { dt: "20260703", open_pric: "288500", high_pric: "313000", low_pric: "283500", cur_prc: "309500", trde_qty: "31520538", trde_prica: "9454829", pred_pre: "+23500", pred_pre_sig: "2" },
    { dt: "20260702", open_pric: "290000", high_pric: "295000", low_pric: "285000", cur_prc: "286000", trde_qty: "38905074", trde_prica: "11362882", pred_pre: "-28500", pred_pre_sig: "5" },
  ].map((i) => dailyChartItemSchema.parse(i));

  it("renders candles oldest→newest with parsed prices", () => {
    const text = formatDailyChart(items, "005930", "day", 30, MODE);
    const lines = text.split("\n");
    expect(text).toContain("005930 일봉 차트 (최근 2개");
    expect(lines.indexOf("| 2026-07-02 | 290,000 | 295,000 | 285,000 | 286,000 | 38,905,074 |")).toBeLessThan(
      lines.indexOf("| 2026-07-03 | 288,500 | 313,000 | 283,500 | 309,500 | 31,520,538 |"),
    );
  });

  it("respects count and handles empty data", () => {
    expect(formatDailyChart(items, "005930", "day", 1, MODE)).toContain("최근 1개");
    expect(formatDailyChart([], "999999", "week", 30, MODE)).toContain("데이터가 없습니다");
  });
});

describe("formatMinuteChart", () => {
  const items = [
    { cntr_tm: "20260703153000", open_pric: "+309500", high_pric: "+309500", low_pric: "+309500", cur_prc: "+309500", trde_qty: "2283317", acc_trde_qty: "31498027" },
  ].map((i) => minuteChartItemSchema.parse(i));

  it("renders minute timestamps and abs prices", () => {
    const text = formatMinuteChart(items, "005930", "5", 30, MODE);
    expect(text).toContain("5분봉");
    expect(text).toContain("| 2026-07-03 15:30 | 309,500 | 309,500 | 309,500 | 309,500 | 2,283,317 |");
  });
});

describe("formatOrderbook", () => {
  const book = orderbookResponseSchema.parse({
    return_code: 0,
    bid_req_base_tm: "160000",
    sel_fpr_bid: "+310000",
    sel_fpr_req: "307803",
    buy_fpr_bid: "+309500",
    buy_fpr_req: "16836",
    tot_sel_req: "1219054",
    tot_buy_req: "372132",
    sel_2th_pre_bid: "+310500",
    sel_2th_pre_req: "210957",
    buy_2th_pre_bid: "+309000",
    buy_2th_pre_req: "51476",
  });

  it("renders level-1 fpr keys and passthrough level-2 keys", () => {
    const text = formatOrderbook(book, "005930", MODE);
    expect(text).toContain("기준시각 16:00:00");
    expect(text).toContain("| 매도1 | 310,000 | 307,803 |");
    expect(text).toContain("| 매수1 | 309,500 | 16,836 |");
    expect(text).toContain("| 매도2 | 310,500 | 210,957 |");
    expect(text).toContain("| 매수2 | 309,000 | 51,476 |");
    expect(text).toContain("총잔량 — 매도 1,219,054 / 매수 372,132");
    // Missing deeper levels degrade to "-", never throw.
    expect(text).toContain("| 매도10 | - | - |");
  });
});

describe("formatIndices", () => {
  const items = [
    { stk_cd: "001", stk_nm: "종합(KOSPI)", cur_prc: "+8088.34", pre_sig: "2", pred_pre: "+440.25", flu_rt: "+5.76", trde_qty: "465821", trde_prica: "45492055", rising: "589", stdns: "27", fall: "297" },
  ].map((i) => indexItemSchema.parse(i));

  it("renders index points with two decimals, the sector code, and breadth counts", () => {
    const text = formatIndices(items, "kospi", MODE);
    expect(text).toContain("코스피 업종 지수");
    expect(text).toContain("| 종합(KOSPI) | 001 | 8,088.34 | +440.25 | +5.76% | 589/27/297 |");
    expect(text).toContain("get_sector_price / get_sector_stocks");
  });
});

describe("formatRanking", () => {
  it("renders price-change ranking rows", () => {
    const items = [
      { stk_cls: "14", stk_cd: "222160", stk_nm: "NPX", cur_prc: "+140", pred_pre_sig: "2", pred_pre: "+46", flu_rt: "+48.94", now_trde_qty: "3789445" },
    ].map((i) => priceChangeRankItemSchema.parse(i));
    const text = formatRanking("rise", "all", items, 20, MODE);
    expect(text).toContain("전체 상승률 상위");
    expect(text).toContain("| 1 | NPX | 222160 | 140 | +48.94% | 3,789,445 |");
  });

  it("renders volume ranking incl. the uint32-capped quirk verbatim", () => {
    const items = [
      { stk_cd: "252670", stk_nm: "KODEX 200선물인버스2X", cur_prc: "-75", pred_pre_sig: "5", pred_pre: "-9", flu_rt: "-10.71", trde_qty: "4294967295", trde_amt: "1209973" },
    ].map((i) => volumeRankItemSchema.parse(i));
    const text = formatRanking("volume", "kospi", items, 20, MODE);
    expect(text).toContain("코스피 거래량 상위");
    expect(text).toContain("| 1 | KODEX 200선물인버스2X | 252670 | 75 | -10.71% | 4,294,967,295 | 1,209,973 |");
  });

  it("renders value ranking and truncates to top N", () => {
    const items = [
      { stk_cd: "000660", stk_nm: "SK하이닉스", cur_prc: "+2425000", pred_pre_sig: "2", pred_pre: "+238000", flu_rt: "+10.88", now_trde_qty: "7984914", trde_prica: "18076083" },
      { stk_cd: "005930", stk_nm: "삼성전자", cur_prc: "+309500", pred_pre_sig: "2", pred_pre: "+23500", flu_rt: "+8.22", now_trde_qty: "31520538", trde_prica: "9454829" },
    ].map((i) => valueRankItemSchema.parse(i));
    const text = formatRanking("value", "all", items, 1, MODE);
    expect(text).toContain("상위 1종목");
    expect(text).toContain("SK하이닉스");
    expect(text).not.toContain("삼성전자");
  });
});

describe("formatInvestorTrend", () => {
  const total = investorTotalItemSchema.parse({
    ind_invsr: "+19875822", frgnr_invsr: "--23722054", orgn: "+3378439",
    fnnc_invt: "+4428627", insrnc: "--209957", invtrt: "--334590", etc_fnnc: "--18058",
    bank: "--2661", penfnd_etc: "--84771", samo_fund: "--400150", natn: "0",
    etc_corp: "+406200", natfor: "+61593",
  });
  const daily = [
    investorDailyItemSchema.parse({
      dt: "20260703", cur_prc: "+309500", pre_sig: "2", pred_pre: "+23500", acc_trde_qty: "31520538",
      ind_invsr: "-918447", frgnr_invsr: "-387249", orgn: "1306315",
      fnnc_invt: "630551", insrnc: "45465", invtrt: "534454", etc_fnnc: "-2672",
      bank: "4487", penfnd_etc: "58691", samo_fund: "35339", natn: "0", etc_corp: "6929", natfor: "-7548",
    }),
  ];

  it("collapses double signs and renders totals + daily table", () => {
    const text = formatInvestorTrend(total, daily, "005930", "20260606", "20260706", "amount", MODE);
    expect(text).toContain("단위: 백만원");
    expect(text).toContain("외국인: -23,722,054");
    expect(text).toContain("개인: +19,875,822");
    expect(text).toContain("| 2026-07-03 | 309,500 | +23,500 | -918,447 | -387,249 | +1,306,315 |");
  });

  it("handles missing data", () => {
    const text = formatInvestorTrend(undefined, [], "999999", "20260606", "20260706", "quantity", MODE);
    expect(text).toContain("데이터가 없습니다");
  });
});

describe("formatEtfInfo", () => {
  it("renders tracking index, taxation type and quote", () => {
    const etf = etfInfoResponseSchema.parse({
      return_code: 0, stk_nm: "KODEX 200", etfobjt_idex_nm: "KOSPI200",
      etftxon_type: "비과세", etntxon_type: "비과세",
    });
    const quote = stockInfoResponseSchema.parse({
      return_code: 0, stk_cd: "069500", stk_nm: "KODEX 200",
      cur_prc: "+123530", flu_rt: "1.25", trde_qty: "5000000",
    });
    const text = formatEtfInfo(etf, quote, "069500", MODE);
    expect(text).toContain("KODEX 200 (069500) ETF 정보");
    expect(text).toContain("추적지수: KOSPI200");
    expect(text).toContain("과세유형: 비과세");
    expect(text).toContain("현재가: 123,530원 (+1.25%)");
  });

  it("reports non-ETF codes gracefully", () => {
    const etf = etfInfoResponseSchema.parse({ return_code: 0 });
    expect(formatEtfInfo(etf, null, "005930", MODE)).toContain("ETF 정보가 없습니다");
  });
});
