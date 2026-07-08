import { describe, expect, it } from "vitest";

import { sectorPriceResponseSchema, sectorStockItemSchema } from "../src/kiwoom/types.js";
import { formatSectorPrice, formatSectorStocks } from "../src/tools/sector.js";

const MODE = "모의투자";

// Fixtures mirror mockapi ka20001/ka20002 responses captured 2026-07-09.

const priceResponse = sectorPriceResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  cur_prc: "-7246.79",
  pred_pre_sig: "5",
  pred_pre: "-409.52",
  flu_rt: "-5.35",
  trde_qty: "501071",
  trde_prica: "42465431",
  trde_frmatn_stk_num: "912",
  trde_frmatn_rt: "+96.51",
  open_pric: "-7452.48",
  high_pric: "+7791.66",
  low_pric: "-7186.21",
  upl: "3",
  rising: "125",
  stdns: "22",
  fall: "765",
  lst: "0",
  "52wk_hgst_pric": "+9385.59",
  "52wk_hgst_pric_dt": "20260619",
  "52wk_hgst_pric_pre_rt": "-22.79",
  "52wk_lwst_pric": "-3032.47",
  "52wk_lwst_pric_dt": "20250702",
  "52wk_lwst_pric_pre_rt": "+138.97",
  inds_cur_prc_tm: [
    { tm_n: "999999", cur_prc_n: "-7246.79", pred_pre_sig_n: "5", pred_pre_n: "-409.52", flu_rt_n: "-5.35", trde_qty_n: "5320", acc_trde_qty_n: "501071" },
    { tm_n: "888888", cur_prc_n: "-7246.79", pred_pre_sig_n: "5", pred_pre_n: "-409.52", flu_rt_n: "-5.35", trde_qty_n: "14", acc_trde_qty_n: "495751" },
    { tm_n: "153220", cur_prc_n: "-7246.78", pred_pre_sig_n: "5", pred_pre_n: "-409.53", flu_rt_n: "-5.35", trde_qty_n: "2", acc_trde_qty_n: "495737" },
  ],
});

const stockItems = [
  { stk_cd: "000020", stk_nm: "동화약품", cur_prc: "-5020", pred_pre_sig: "5", pred_pre: "-100", flu_rt: "-1.95", now_trde_qty: "44331", sel_bid: "-5020", buy_bid: "-5010", open_pric: "-5080", high_pric: "+5170", low_pric: "-4960" },
  { stk_cd: "000040", stk_nm: "KR모터스", cur_prc: "267", pred_pre_sig: "3", pred_pre: "0", flu_rt: "0.00", now_trde_qty: "0", sel_bid: "0", buy_bid: "0", open_pric: "0", high_pric: "0", low_pric: "0" },
  { stk_cd: "000050", stk_nm: "경방", cur_prc: "-8180", pred_pre_sig: "5", pred_pre: "-120", flu_rt: "-1.45", now_trde_qty: "34020", sel_bid: "-8180", buy_bid: "-8160", open_pric: "8300", high_pric: "+8400", low_pric: "-8110" },
].map((i) => sectorStockItemSchema.parse(i));

describe("formatSectorPrice", () => {
  it("renders the index snapshot with units and breadth counts", () => {
    const text = formatSectorPrice(priceResponse, "001", MODE);
    expect(text).toContain("[모의투자] 업종 현재가 — 코스피 종합 (001)");
    expect(text).toContain("지수 7,246.79 (전일대비 -409.52, -5.35%)");
    expect(text).toContain("시가 7,452.48 · 고가 7,791.66 · 저가 7,186.21");
    expect(text).toContain("거래량 501,071천주 · 거래대금 42,465,431백만원");
    expect(text).toContain("상한 3 · 상승 125 · 보합 22 · 하락 765 · 하한 0");
    expect(text).toContain("(거래형성 912종목, 96.51%)");
  });

  it("renders the 52-week range with dashed dates", () => {
    const text = formatSectorPrice(priceResponse, "001", MODE);
    expect(text).toContain("52주 최고 9,385.59 (2026-06-19, 현재 대비 -22.79%)");
    expect(text).toContain("최저 3,032.47 (2025-07-02, 현재 대비 +138.97%)");
  });

  it("filters close-of-day sentinel rows out of the time series", () => {
    const text = formatSectorPrice(priceResponse, "001", MODE);
    expect(text).toContain("| 15:32:20 | 7,246.78 | -409.53 | -5.35% | 495,737 |");
    expect(text).not.toContain("999999");
    expect(text).not.toContain("888888");
    expect(text).toContain("시간대별 추이 (최근 1건)");
  });

  it("points to get_sector_stocks for the member-stock drill-down", () => {
    const text = formatSectorPrice(priceResponse, "001", MODE);
    expect(text).toContain("get_sector_stocks");
  });

  it("reports missing data (blank response) instead of rendering zeros", () => {
    const text = formatSectorPrice(sectorPriceResponseSchema.parse({}), "013", MODE);
    expect(text).toContain("업종 013의 시세 데이터가 없습니다");
    expect(text).toContain("get_market_index");
  });
});

describe("formatSectorStocks", () => {
  it("renders member-stock rows with abs prices and signed change", () => {
    const text = formatSectorStocks(stockItems, false, "001", 30, MODE);
    expect(text).toContain("[모의투자] 업종별 주가 — 코스피 종합 (001), 3종목 (종목코드순)");
    expect(text).toContain("| 동화약품 | 000020 | 5,020 | -100 | -1.95% | 44,331 | 5,170 | 4,960 |");
    expect(text).toContain("| KR모터스 | 000040 | 267 | 0 | 0.00% | 0 | 0 | 0 |");
  });

  it("labels an unknown sector code with the raw code", () => {
    const text = formatSectorStocks(stockItems, false, "013", 30, MODE);
    expect(text).toContain("업종 013 (013)");
  });

  it("notes the limit cut and the page-1 truncation separately", () => {
    const text = formatSectorStocks(stockItems, true, "001", 2, MODE);
    expect(text).toContain("2종목 (종목코드순)");
    expect(text).not.toContain("경방");
    expect(text).toContain("※ 첫 2종목만 표시했습니다");
    expect(text).toContain("첫 페이지(종목코드순 100종목)만 가져옵니다");
  });

  it("reports an empty sector with guidance", () => {
    const text = formatSectorStocks([], false, "999", 30, MODE);
    expect(text).toContain("구성 종목이 없습니다");
    expect(text).toContain("get_market_index");
  });
});
