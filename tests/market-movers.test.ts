import { describe, expect, it } from "vitest";

import {
  limitStockItemSchema,
  newHighLowItemSchema,
  priceJumpItemSchema,
  volumeRenewItemSchema,
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

/**
 * ka10024 실측 (REAL 2026-08-04 15:2x KST 정규장, mrkt_tp=001 코스피 / cycle_tp=20 /
 * trde_qty_tp=0000 / stex_tp=3). 전체 80행 중 증가량 상위 4행.
 *
 * 살려둔 것:
 *  - **응답 순서가 아니라 증가량 순으로 정렬되는지**를 본다. 원본은 종목코드 순이라
 *    004870(티웨이홀딩스)이 251340보다 앞에 온다 — 서버가 정렬하지 않으면 이 순서가 샌다.
 *  - `prev_trde_qty`는 직전 20거래일 **최대** 거래량이다. 251340의 63,165,636은 같은 날
 *    일봉(ka10081)의 8/3 거래량과 정확히 일치했다.
 *  - 하락 종목의 `cur_prc`가 `-2580`처럼 부호를 달고 온다 — parseKiwoomPrice 자리.
 */
const volumeRenewItems = [
  {
    stk_cd: "251340_AL", stk_nm: "KODEX 코스닥150선물인버스", cur_prc: "-2580", pred_pre_sig: "5",
    pred_pre: "-190", flu_rt: "-6.86", prev_trde_qty: "63165636", now_trde_qty: "80721054",
    sel_bid: "-2575", buy_bid: "-2570",
  },
  {
    stk_cd: "530107_AL", stk_nm: "삼성 인버스 2X 코스닥150 선물 ETN", cur_prc: "-2075",
    pred_pre_sig: "5", pred_pre: "-320", flu_rt: "-13.36", prev_trde_qty: "22318100",
    now_trde_qty: "28639742", sel_bid: "-2080", buy_bid: "-2075",
  },
  {
    stk_cd: "004870_AL", stk_nm: "티웨이홀딩스", cur_prc: "+1399", pred_pre_sig: "2",
    pred_pre: "+151", flu_rt: "+12.10", prev_trde_qty: "2155799", now_trde_qty: "5043444",
    sel_bid: "+1455", buy_bid: "+1367",
  },
].map((i) => volumeRenewItemSchema.parse(i));

describe("formatMarketMovers — volume_renew (ka10024)", () => {
  it("증가량 내림차순으로 정렬하고 배수를 함께 보여준다", () => {
    const text = formatMarketMovers("volume_renew", "kospi", volumeRenewItems, 20, MODE, undefined, {
      cycle: "20",
    });

    expect(text).toContain("코스피 거래량갱신 종목 (직전 20거래일 대비)");
    // 251340 증가량 17,555,418 > 530107 6,321,642 > 004870 2,887,645
    expect(text).toContain("| 1 | KODEX 코스닥150선물인버스 | 251340 | 2,580 | -6.86% | 63,165,636 | 80,721,054 | +17,555,418 | 1.28배 |");
    expect(text.indexOf("삼성 인버스 2X")).toBeLessThan(text.indexOf("티웨이홀딩스"));
    expect(text).toContain("volume_surge(거래량급증)와는 기준이 다릅니다");
  });

  it("응답의 _AL 접미사를 떼고 하락 종목 가격을 음수로 쓰지 않는다", () => {
    const text = formatMarketMovers("volume_renew", "kospi", volumeRenewItems, 20, MODE);

    expect(text).not.toContain("_AL");
    expect(text).not.toContain("| -2,580 |");
  });

  it("직전 최대가 0이면 배수를 계산하지 않는다", () => {
    const zeroPrev = [
      volumeRenewItemSchema.parse({
        stk_cd: "000000", stk_nm: "신규상장", cur_prc: "+1000", pred_pre_sig: "2",
        pred_pre: "+100", flu_rt: "+11.11", prev_trde_qty: "0", now_trde_qty: "5000",
        sel_bid: "+1005", buy_bid: "+1000",
      }),
    ];
    const text = formatMarketMovers("volume_renew", "all", zeroPrev, 20, MODE);

    expect(text).toContain("| 0 | 5,000 | +5,000 | - |");
  });

  it("페이지 상한에 걸리면 잘렸을 수 있다고 알린다", () => {
    const text = formatMarketMovers("volume_renew", "all", volumeRenewItems, 20, MODE, undefined, {
      truncated: true,
    });

    expect(text).toContain("결과가 잘렸을 수 있습니다");
  });
});
