import { describe, expect, it } from "vitest";

import {
  limitStockItemSchema,
  newHighLowItemSchema,
  priceJumpItemSchema,
  volumeSurgeItemSchema,
} from "../src/kiwoom/types.js";
import { formatMarketMovers } from "../src/tools/market-movers.js";

const MODE = "모의투자";

// Fixtures mirror mockapi ka10016/ka10017/ka10019 responses captured 2026-07-08.

const newLowItems = [
  {
    stk_cd: "900310",
    stk_nm: "컬러레이",
    cur_prc: "-2025",
    pred_pre_sig: "5",
    pred_pre: "-20",
    flu_rt: "-0.98",
    trde_qty: "22145",
    pred_trde_qty_pre_rt: "-75.13",
    sel_bid: "-2030",
    buy_bid: "-2025",
    high_pric: "2200",
    low_pric: "1832",
  },
].map((i) => newHighLowItemSchema.parse(i));

const upperLimitItems = [
  {
    stk_cd: "058730",
    stk_infr: "28",
    stk_nm: "다스코",
    cur_prc: "+5200",
    pred_pre_sig: "1",
    pred_pre: "+1200",
    flu_rt: "+30.00",
    trde_qty: "30870073",
    pred_trde_qty: "16523059",
    sel_req: "0",
    sel_bid: "0",
    buy_bid: "+5200",
    buy_req: "785377",
    cnt: "1",
  },
  {
    stk_cd: "263800",
    stk_nm: "데이타솔루션",
    cur_prc: "+5940",
    pred_pre_sig: "1",
    pred_pre: "+1370",
    flu_rt: "+29.98",
    trde_qty: "629096",
    cnt: "3",
  },
].map((i) => limitStockItemSchema.parse(i));

const surgeItems = [
  {
    stk_cd: "214330",
    stk_cls: "25",
    stk_nm: "금호에이치티",
    pred_pre_sig: "1",
    pred_pre: "+2080",
    flu_rt: "+29.93",
    base_pric: "2555",
    cur_prc: "+9030",
    base_pre: "6475",
    trde_qty: "578745",
    jmp_rt: "+253.42",
  },
].map((i) => priceJumpItemSchema.parse(i));

// ka10023 fixtures captured verbatim from mockapi 2026-07-23 (sort_tp "1" 급증량순,
// trde_qty_tp "5", tm_tp "2"; first + last of the 200-row first page).
const volumeSurgeItems = [
  {
    stk_cd: "252670",
    stk_nm: "KODEX 200선물인버스2X",
    cur_prc: "-95",
    pred_pre_sig: "5",
    pred_pre: "-5",
    flu_rt: "-5.00",
    prev_trde_qty: "2255526794",
    now_trde_qty: "4048484876",
    sdnin_qty: "+1792958082",
    sdnin_rt: "+79.49",
  },
  {
    stk_cd: "480310",
    stk_nm: "TIGER 글로벌온디바이스AI",
    cur_prc: "-21105",
    pred_pre_sig: "5",
    pred_pre: "-35",
    flu_rt: "-0.17",
    prev_trde_qty: "17510",
    now_trde_qty: "47534",
    sdnin_qty: "+30024",
    sdnin_rt: "+171.47",
  },
].map((i) => volumeSurgeItemSchema.parse(i));

describe("formatMarketMovers", () => {
  it("renders new_low with period high/low columns and the days suffix", () => {
    const text = formatMarketMovers("new_low", "all", newLowItems, 20, MODE, "10");
    expect(text).toContain("[모의투자] 전체 신저가 종목 (10일 기준) (1종목)");
    expect(text).toContain("| 기간고가 | 기간저가 |");
    // price sign encodes direction, not value → abs via parseKiwoomPrice
    expect(text).toContain("| 1 | 컬러레이 | 900310 | 2,025 | -0.98% | 22,145 | 2,200 | 1,832 |");
  });

  it("renders upper_limit with the streak column", () => {
    const text = formatMarketMovers("upper_limit", "kosdaq", upperLimitItems, 20, MODE);
    expect(text).toContain("[모의투자] 코스닥 상한가 종목 (2종목)");
    expect(text).toContain("| 연속 |");
    expect(text).toContain("| 1 | 다스코 | 058730 | 5,200 | +30.00% | 30,870,073 | 1회 |");
    expect(text).toContain("| 2 | 데이타솔루션 | 263800 | 5,940 | +29.98% | 629,096 | 3회 |");
  });

  it("renders surge with jmp_rt vs base price and no days suffix", () => {
    const text = formatMarketMovers("surge", "all", surgeItems, 20, MODE);
    expect(text).toContain("[모의투자] 전체 급등 종목 (1종목)");
    expect(text).not.toContain("일 기준");
    expect(text).toContain("| 급등락률(기준가 대비) |");
    expect(text).toContain("| 1 | 금호에이치티 | 214330 | 9,030 | +29.93% | +253.42% | 578,745 |");
  });

  it("renders volume_surge with surge quantity/rate columns and no days suffix", () => {
    const text = formatMarketMovers("volume_surge", "all", volumeSurgeItems, 20, MODE);
    expect(text).toContain("[모의투자] 전체 거래량급증 종목 (2종목)");
    expect(text).not.toContain("일 기준");
    expect(text).toContain("| 현재거래량 | 급증량 | 급증률(전일 대비) |");
    expect(text).toContain(
      "| 1 | KODEX 200선물인버스2X | 252670 | 95 | -5.00% | 4,048,484,876 | +1,792,958,082 | +79.49% |",
    );
    expect(text).toContain(
      "| 2 | TIGER 글로벌온디바이스AI | 480310 | 21,105 | -0.17% | 47,534 | +30,024 | +171.47% |",
    );
  });

  it("renders a volume_surge empty-result message", () => {
    const text = formatMarketMovers("volume_surge", "kosdaq", [], 20, MODE);
    expect(text).toBe("[모의투자] 코스닥 거래량급증 종목 — 해당 종목이 없습니다.");
  });

  it("caps rows at top", () => {
    const text = formatMarketMovers("upper_limit", "all", upperLimitItems, 1, MODE);
    expect(text).toContain("(1종목)");
    expect(text).not.toContain("데이타솔루션");
  });

  it("renders an empty-result message", () => {
    const text = formatMarketMovers("lower_limit", "kospi", [], 20, MODE);
    expect(text).toBe("[모의투자] 코스피 하한가 종목 — 해당 종목이 없습니다.");
  });
});
