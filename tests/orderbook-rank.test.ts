import { describe, expect, it } from "vitest";

import {
  bidBalanceItemSchema,
  bidRatioSurgeItemSchema,
  bidSurgeItemSchema,
} from "../src/kiwoom/types.js";
import { formatBidBalance, formatBidRatioSurge, formatBidSurge } from "../src/tools/orderbook-rank.js";

const MODE = "모의투자";

// Fixture captured verbatim from the REAL domain 2026-08-03 07:45 KST — 개장 전이다.
// ka10020은 이때도 rc=0에 200행을 주지만 **잔량·거래량이 전 행 0**이고, 정렬이 무의미해져
// 종목코드순으로 온다. mock도 바이트 단위로 같았다. 이 상태를 그냥 표로 그리면
// "순매수잔량 1위 동화약품 0주"라는 그럴듯한 거짓말이 되므로 안내 문구가 붙어야 한다.
const preOpenRows = [
  {
    stk_cd: "000020", stk_nm: "동화약품", cur_prc: "4680", pred_pre_sig: "3", pred_pre: "0",
    trde_qty: "0", tot_sel_req: "0", tot_buy_req: "0", netprps_req: "0", buy_rt: "0.00",
  },
  {
    stk_cd: "000040", stk_nm: "KR모터스", cur_prc: "1235", pred_pre_sig: "3", pred_pre: "0",
    trde_qty: "0", tot_sel_req: "0", tot_buy_req: "0", netprps_req: "0", buy_rt: "0.00",
  },
  {
    stk_cd: "000050", stk_nm: "경방", cur_prc: "8230", pred_pre_sig: "3", pred_pre: "0",
    trde_qty: "0", tot_sel_req: "0", tot_buy_req: "0", netprps_req: "0", buy_rt: "0.00",
  },
].map((r) => bidBalanceItemSchema.parse(r));

describe("formatBidBalance — 개장 전", () => {
  it("warns that an all-zero table means the session has not started", () => {
    const out = formatBidBalance(preOpenRows, "kospi", "net_buy", 15, MODE);

    expect(out).toContain("잔량이 전부 0입니다");
    expect(out).toContain("정규장(09:00~15:30)");
    expect(out).toContain("get_expected_execution");
  });

  it("still renders the rows it was given", () => {
    const out = formatBidBalance(preOpenRows, "kospi", "net_buy", 15, MODE);

    expect(out).toContain("[모의투자] 코스피 호가잔량 순매수잔량 상위 (3종목)");
    expect(out).toContain("| 1 | 동화약품 | 000020 | 4,680원 |");
  });
});

describe("formatBidBalance — 빈 결과", () => {
  it("explains the session window instead of reporting a failure", () => {
    const out = formatBidBalance([], "kosdaq", "sell_ratio", 15, MODE);

    expect(out).toContain("코스닥 호가잔량 매도비율 상위 결과가 없습니다");
    expect(out).toContain("정규장(09:00~15:30) 중에만 산출됩니다");
    expect(out).not.toContain("|");
  });
});

describe("formatBidSurge / formatBidRatioSurge — 빈 결과", () => {
  it("names the window and the minutes it was asked about", () => {
    const surge = formatBidSurge([], "kospi", "buy", 30, 15, MODE);
    const ratio = formatBidRatioSurge([], "kospi", "sell", 60, 15, MODE);

    expect(surge).toContain("코스피 매수잔량 급증 (최근 30분) 결과가 없습니다");
    expect(ratio).toContain("코스피 매도/매수 잔량비율 급증 (최근 60분) 결과가 없습니다");
    expect(surge).toContain("정규장(09:00~15:30)");
  });
});

// ── 라이브 fixture: REAL 도메인 2026-08-03 10:43 KST 정규장 중 실측.
// KODEX 200선물인버스2X 행에 **32비트 정수 포화값**이 그대로 들어 있다 —
// trde_qty 4294967295(2^32−1), tot_buy_qty 2147483647(2^31−1). 42억 주짜리 거래량은
// 존재하지 않으므로 집계 상한에서 잘린 값이고, 그대로 렌더하면 거짓말이 된다.
const liveBalanceRows = [
  {
    stk_cd: "252670", stk_nm: "KODEX 200선물인버스2X", cur_prc: "+97", pred_pre: "+15",
    trde_qty: "4294967295", tot_sel_req: "982301127", tot_buy_req: "1135634250",
    netprps_req: "153333123", buy_rt: "115.61",
  },
  {
    stk_cd: "530062", stk_nm: "삼성 인버스 2X 은 선물 ETN(H)", cur_prc: "-51", pred_pre: "-1",
    trde_qty: "143403", tot_sel_req: "1358093", tot_buy_req: "2146092",
    netprps_req: "787999", buy_rt: "158.02",
  },
  {
    stk_cd: "251340", stk_nm: "KODEX 코스닥150선물인버스", cur_prc: "-2725", pred_pre: "-155",
    trde_qty: "25772603", tot_sel_req: "238261", tot_buy_req: "1019747",
    netprps_req: "781486", buy_rt: "428.00",
  },
].map((r) => bidBalanceItemSchema.parse(r));

const liveSurgeRows = [
  {
    stk_cd: "252670", stk_nm: "KODEX 200선물인버스2X", cur_prc: "+96", pred_pre: "+14",
    int: "1097435534", now: "1136311219", sdnin_qty: "38875685", sdnin_rt: "+3.54",
    tot_buy_qty: "2147483647",
  },
  {
    stk_cd: "114800", stk_nm: "KODEX 인버스", cur_prc: "+1138", pred_pre: "+92",
    int: "14738072", now: "15141017", sdnin_qty: "402945", sdnin_rt: "+2.73",
    tot_buy_qty: "279126874",
  },
  {
    stk_cd: "252420", stk_nm: "RISE 200선물인버스2X", cur_prc: "+101", pred_pre: "+10",
    int: "953423", now: "1278304", sdnin_qty: "324881", sdnin_rt: "+34.08",
    tot_buy_qty: "867914",
  },
].map((r) => bidSurgeItemSchema.parse(r));

// ka10022의 int/now_rt/sdnin_rt는 '수량'이 아니라 매수/매도 비율(%)이고, 100%를 훌쩍
// 넘는다 (한화갤러리아우 2980.23%). ka10021의 int/now와 키 이름은 비슷한데 의미가 다르다.
const liveRatioRows = [
  {
    stk_cd: "45226K", stk_nm: "한화갤러리아우", cur_prc: "+4700", pred_pre: "+265",
    int: "+306.86", now_rt: "+2980.23", sdnin_rt: "+2673.37", tot_sel_req: "86", tot_buy_req: "2563",
  },
  {
    stk_cd: "465770", stk_nm: "STX그린로지스", cur_prc: "-2930", pred_pre: "-170",
    int: "+164.40", now_rt: "+2368.06", sdnin_rt: "+2203.66", tot_sel_req: "811", tot_buy_req: "19205",
  },
].map((r) => bidRatioSurgeItemSchema.parse(r));

describe("formatBidBalance — 라이브 데이터", () => {
  it("renders the ranking table with both sides of the book", () => {
    const out = formatBidBalance(liveBalanceRows, "kospi", "net_buy", 15, MODE);

    expect(out).toContain("[모의투자] 코스피 호가잔량 순매수잔량 상위 (3종목)");
    expect(out).toContain("| 1 | KODEX 200선물인버스2X | 252670 | 97원 | +15원 |");
    expect(out).toContain("+153,333,123");
    expect(out).toContain("115.61%");
    expect(out).not.toContain("잔량이 전부 0입니다");
  });

  it("replaces the 32-bit saturation value with a cap marker and explains it", () => {
    const out = formatBidBalance(liveBalanceRows, "kospi", "net_buy", 15, MODE);

    expect(out).toContain("집계상한");
    expect(out).toContain("32비트 정수 상한");
    // 각주에는 상한값이 숫자로 적혀 있으니 데이터 행만 검사한다.
    const dataRows = out.split("\n").filter((line) => /^\| \d+ \|/.test(line));
    expect(dataRows).toHaveLength(3);
    expect(dataRows.some((line) => line.includes("4,294,967,295"))).toBe(false);
    // 상한이 아닌 값은 그대로 나와야 한다.
    expect(out).toContain("25,772,603주");
  });

  it("shows absolute prices for falling stocks", () => {
    const out = formatBidBalance(liveBalanceRows, "kospi", "net_buy", 15, MODE);

    expect(out).toContain("2,725원");
    expect(out).toContain("-155원");
    expect(out).not.toContain("-2,725원");
  });
});

describe("formatBidSurge — 라이브 데이터", () => {
  it("labels the comparison window in the header row", () => {
    const out = formatBidSurge(liveSurgeRows, "kospi", "buy", 30, 15, MODE);

    expect(out).toContain("코스피 매수잔량 급증 (최근 30분) — 급증률 상위 3종목");
    expect(out).toContain("| 30분 전 잔량 | 현재 잔량 | 급증량 | 급증률 |");
    expect(out).toContain("34.08%");
  });

  it("caps the saturated 잔량 here too", () => {
    // int/now는 잔량이라 상한을 탈 수 있다. 이 fixture에서는 tot_buy_qty만 2^31−1인데
    // 그 열은 표에 없으므로 상한 표기가 나오면 안 된다.
    const out = formatBidSurge(liveSurgeRows, "kospi", "buy", 30, 15, MODE);

    expect(out).toContain("1,136,311,219주");
    expect(out).not.toContain("집계상한");
  });
});

describe("formatBidRatioSurge — 라이브 데이터", () => {
  it("renders ratios that go far above 100%", () => {
    const out = formatBidRatioSurge(liveRatioRows, "kospi", "buy", 30, 15, MODE);

    expect(out).toContain("코스피 매수/매도 잔량비율 급증 (최근 30분)");
    expect(out).toContain("2,980.23%");
    expect(out).toContain("2,673.37%");
    expect(out).toContain("306.86%");
  });

  it("says the ranking is about the ratio, not the size", () => {
    const out = formatBidRatioSurge(liveRatioRows, "kospi", "sell", 30, 15, MODE);

    expect(out).toContain("매도/매수");
    expect(out).toContain("수량 급증은 view=surge");
  });
});
