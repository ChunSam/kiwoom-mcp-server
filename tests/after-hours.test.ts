import { describe, expect, it } from "vitest";

import {
  afterHoursQuoteResponseSchema,
  afterHoursRankItemSchema,
  stockListItemSchema,
} from "../src/kiwoom/types.js";
import { formatAfterHoursQuote, formatAfterHoursRank } from "../src/tools/after-hours.js";

const MODE = "모의투자";

/**
 * ka10099 마스터 행 — nxtEnable만 케이스별로 바꾼다. 실제 스키마로 parse 하므로
 * nxtEnable이 스키마에서 빠지면(혹은 기본값이 바뀌면) 이 테스트가 먼저 깨진다.
 * `""`는 필드가 없는 구형/부분 응답을 나타낸다(str() 기본값).
 */
const masterItem = (nxtEnable: string) =>
  stockListItemSchema.parse({ code: "005930", name: "삼성전자", nxtEnable });

// Fixtures captured verbatim from mockapi ka10087/ka10098 on 2026-07-26.

/** 069500 KODEX 200 — 시간외 단일가 체결과 5단 호가가 모두 있는 종목. */
const quoteWithBook = afterHoursQuoteResponseSchema.parse({
  bid_req_base_tm: "160000",
  ovt_sigpric_sel_bid_jub_pre_5: "0",
  ovt_sigpric_sel_bid_jub_pre_4: "0",
  ovt_sigpric_sel_bid_jub_pre_3: "0",
  ovt_sigpric_sel_bid_jub_pre_2: "0",
  ovt_sigpric_sel_bid_jub_pre_1: "0",
  ovt_sigpric_sel_bid_qty_5: "20",
  ovt_sigpric_sel_bid_qty_4: "10",
  ovt_sigpric_sel_bid_qty_3: "208",
  ovt_sigpric_sel_bid_qty_2: "20",
  ovt_sigpric_sel_bid_qty_1: "3",
  ovt_sigpric_sel_bid_5: "+106860",
  ovt_sigpric_sel_bid_4: "+106805",
  ovt_sigpric_sel_bid_3: "+106800",
  ovt_sigpric_sel_bid_2: "+106785",
  ovt_sigpric_sel_bid_1: "+106780",
  ovt_sigpric_buy_bid_1: "+106755",
  ovt_sigpric_buy_bid_2: "+106750",
  ovt_sigpric_buy_bid_3: "+106710",
  ovt_sigpric_buy_bid_4: "+106700",
  ovt_sigpric_buy_bid_5: "+106695",
  ovt_sigpric_buy_bid_qty_1: "844",
  ovt_sigpric_buy_bid_qty_2: "2745",
  ovt_sigpric_buy_bid_qty_3: "50",
  ovt_sigpric_buy_bid_qty_4: "2815",
  ovt_sigpric_buy_bid_qty_5: "147",
  ovt_sigpric_buy_bid_jub_pre_1: "0",
  ovt_sigpric_buy_bid_jub_pre_2: "0",
  ovt_sigpric_buy_bid_jub_pre_3: "0",
  ovt_sigpric_buy_bid_jub_pre_4: "0",
  ovt_sigpric_buy_bid_jub_pre_5: "0",
  ovt_sigpric_sel_bid_tot_req: "574",
  ovt_sigpric_buy_bid_tot_req: "6775",
  sel_bid_tot_req_jub_pre: "0",
  sel_bid_tot_req: "15786",
  buy_bid_tot_req: "9751",
  buy_bid_tot_req_jub_pre: "0",
  ovt_sel_bid_tot_req_jub_pre: "0",
  ovt_sel_bid_tot_req: "0",
  ovt_buy_bid_tot_req: "10959",
  ovt_buy_bid_tot_req_jub_pre: "0",
  ovt_sigpric_cur_prc: "+106755",
  ovt_sigpric_pred_pre_sig: "2",
  ovt_sigpric_pred_pre: "+390",
  ovt_sigpric_flu_rt: "+0.37",
  ovt_sigpric_acc_trde_qty: "34069",
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
});

/** 005930 삼성전자 — 시간외 단일가 호가·체결이 전무한 종목 (현재가 자리엔 당일 종가). */
const quoteWithoutBook = afterHoursQuoteResponseSchema.parse({
  bid_req_base_tm: "160000",
  ovt_sigpric_sel_bid_qty_1: "0",
  ovt_sigpric_sel_bid_1: "-0",
  ovt_sigpric_buy_bid_1: "-0",
  ovt_sigpric_buy_bid_qty_1: "0",
  ovt_sigpric_sel_bid_tot_req: "0",
  ovt_sigpric_buy_bid_tot_req: "0",
  sel_bid_tot_req: "362425",
  buy_bid_tot_req: "2463919",
  ovt_sel_bid_tot_req: "0",
  ovt_buy_bid_tot_req: "22062",
  ovt_sigpric_cur_prc: "249500",
  ovt_sigpric_pred_pre_sig: "0",
  ovt_sigpric_pred_pre: "0",
  ovt_sigpric_flu_rt: "0.00",
  ovt_sigpric_acc_trde_qty: "0",
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
});

const rankItems = [
  {
    rank: "1",
    stk_cd: "002690",
    stk_nm: "동일제강",
    cur_prc: "+1688",
    pred_pre_sig: "2",
    pred_pre: "+153",
    flu_rt: "+9.97",
    sel_tot_req: "2055",
    buy_tot_req: "102",
    acc_trde_qty: "1",
    acc_trde_prica: "0",
    tdy_close_pric: "1535",
    tdy_close_pric_flu_rt: "-0.65",
  },
  {
    rank: "2",
    stk_cd: "199730",
    stk_nm: "바이오인프라",
    cur_prc: "+1725",
    pred_pre_sig: "2",
    pred_pre: "+156",
    flu_rt: "+9.94",
    sel_tot_req: "0",
    buy_tot_req: "42543",
    acc_trde_qty: "4197",
    acc_trde_prica: "7",
    tdy_close_pric: "1569",
    tdy_close_pric_flu_rt: "-16.10",
  },
  {
    rank: "3",
    stk_cd: "0156T0",
    stk_nm: "에이치엘지노믹스",
    cur_prc: "+15350",
    pred_pre_sig: "2",
    pred_pre: "+560",
    flu_rt: "+3.79",
    sel_tot_req: "8723",
    buy_tot_req: "9137",
    acc_trde_qty: "213038",
    acc_trde_prica: "3242",
    tdy_close_pric: "14790",
    tdy_close_pric_flu_rt: "-31.21",
  },
].map((i) => afterHoursRankItemSchema.parse(i));

/** 하락 행은 시간외가가 "-3420"처럼 부호 접두로 방향을 표시한다 (값 자체는 양수). */
const decliningItem = afterHoursRankItemSchema.parse({
  rank: "1",
  stk_cd: "002787",
  stk_nm: "진흥기업2우B",
  cur_prc: "-3420",
  pred_pre_sig: "5",
  pred_pre: "-375",
  flu_rt: "-9.88",
  sel_tot_req: "8735",
  buy_tot_req: "0",
  acc_trde_qty: "7985",
  acc_trde_prica: "28",
  tdy_close_pric: "3795",
  tdy_close_pric_flu_rt: "+29.97",
});

describe("formatAfterHoursQuote", () => {
  it("renders the 5-level after-hours book and both reference totals", () => {
    const out = formatAfterHoursQuote(quoteWithBook, "069500", MODE);

    expect(out).toContain("[모의투자] 069500 시간외 단일가 (호가잔량기준시간 16:00:00)");
    expect(out).toContain("시간외 단일가 106,755원 (종가대비 +390, +0.37%) · 누적거래량 34,069주");
    expect(out).toContain("| 매도5 | 106,860 | 20 |");
    expect(out).toContain("| 매도1 | 106,780 | 3 |");
    expect(out).toContain("| 매수1 | 106,755 | 844 |");
    expect(out).toContain("| 매수5 | 106,695 | 147 |");
    expect(out).toContain("시간외 단일가 총잔량 — 매도 574 / 매수 6,775");
    expect(out).toContain("참고 총잔량 — 정규장 매도 15,786 / 매수 9,751, 시간외 매도 0 / 매수 10,959");
    expect(out).toContain("당일 종가** 기준입니다");
  });

  it("renders the 매도 ladder highest-first and 매수 ladder from the top of the book", () => {
    const out = formatAfterHoursQuote(quoteWithBook, "069500", MODE);
    const rows = out.split("\n").filter((l) => l.startsWith("| 매"));

    expect(rows.map((l) => l.split(" | ")[0])).toEqual([
      "| 매도5",
      "| 매도4",
      "| 매도3",
      "| 매도2",
      "| 매도1",
      "| 매수1",
      "| 매수2",
      "| 매수3",
      "| 매수4",
      "| 매수5",
    ]);
  });

  it("replaces the all-zero ladder with an explicit notice when no book exists", () => {
    const out = formatAfterHoursQuote(quoteWithoutBook, "005930", MODE);

    expect(out).toContain("시간외 단일가 호가가 없습니다");
    expect(out).toContain("현재가 자리에는 당일 종가가 표시됩니다");
    expect(out).not.toContain("| 매도1 |");
    // 정규장/시간외 총잔량은 호가가 없어도 그대로 보여준다.
    expect(out).toContain("참고 총잔량 — 정규장 매도 362,425 / 매수 2,463,919, 시간외 매도 0 / 매수 22,062");
  });

  // REAL 전수 실측 2026-07-29: nxtEnable="Y" 606종목은 ka10098 유니버스 2,026종목에
  // 0개 포함(완전 분리). 그래서 NXT 종목의 0값은 "거래 없음"이 아니라 TR 사각지대다.
  it("explains the NXT blind spot instead of claiming no trading, for an NXT-enabled stock", () => {
    const out = formatAfterHoursQuote(quoteWithoutBook, "005930", MODE, masterItem("Y"));

    expect(out).toContain("넥스트레이드(NXT) 거래가능 종목");
    expect(out).toContain("이 API로는 조회되지 않는다");
    // 거짓 안내가 사라져야 한다 — 이게 이 수정의 요점.
    expect(out).not.toContain("해당 세션에 접수된 호가 없음");
  });

  it("keeps the plain no-book notice for a non-NXT stock", () => {
    const out = formatAfterHoursQuote(quoteWithoutBook, "002990", MODE, masterItem("N"));

    expect(out).toContain("시간외 단일가 호가가 없습니다");
    expect(out).not.toContain("넥스트레이드");
  });

  it("falls back to the plain notice when the master lookup failed or lacks the field", () => {
    // loadMasterList 실패 시 master는 undefined; 구형 응답이면 nxtEnable이 ""로 기본값.
    expect(formatAfterHoursQuote(quoteWithoutBook, "005930", MODE)).toContain(
      "시간외 단일가 호가가 없습니다",
    );
    expect(formatAfterHoursQuote(quoteWithoutBook, "005930", MODE, masterItem(""))).toContain(
      "시간외 단일가 호가가 없습니다",
    );
  });

  it("does not show the NXT notice when the stock actually has an after-hours book", () => {
    const out = formatAfterHoursQuote(quoteWithBook, "069500", MODE, masterItem("Y"));

    expect(out).toContain("| 매도1 |");
    expect(out).not.toContain("넥스트레이드");
  });
});

describe("formatAfterHoursRank", () => {
  it("renders the ranking table with 당일 종가 columns", () => {
    const out = formatAfterHoursRank(rankItems, "all", "up_rate", "all", 20, MODE);

    expect(out).toContain("[모의투자] 전체 시간외 단일가 상승률 순위 (3종목)");
    expect(out).toContain("| 1 | 동일제강 | 002690 | 1,688 | +153 | +9.97% | 1 | 0 | 1,535 | -0.65% |");
    expect(out).toContain("| 3 | 에이치엘지노믹스 | 0156T0 | 15,350 | +560 | +3.79% | 213,038 | 3,242 | 14,790 | -31.21% |");
    expect(out).toContain("정규장등락률만 전일 대비");
  });

  it("shows absolute prices for declining rows (sign marks direction only)", () => {
    const out = formatAfterHoursRank([decliningItem], "all", "down_rate", "all", 20, MODE);

    expect(out).toContain("| 1 | 진흥기업2우B | 002787 | 3,420 | -375 | -9.88% | 7,985 | 28 | 3,795 | +29.97% |");
  });

  it("labels the volume filter and drops the 1-share caveat when one is set", () => {
    const filtered = formatAfterHoursRank(rankItems, "kosdaq", "up_rate", "10000", 20, MODE);

    expect(filtered).toContain("코스닥 시간외 단일가 상승률 순위, 거래량 1만주 이상");
    expect(filtered).not.toContain("min_volume으로 걸러낼 수 있습니다");
    expect(formatAfterHoursRank(rankItems, "all", "up_rate", "all", 20, MODE)).toContain(
      "min_volume으로 걸러낼 수 있습니다",
    );
  });

  it("caps the table at top and says how many rows were held back", () => {
    const out = formatAfterHoursRank(rankItems, "all", "up_rate", "all", 2, MODE);

    expect(out).toContain("(2종목)");
    expect(out).not.toContain("에이치엘지노믹스");
    expect(out).toContain("조회된 3종목 중 상위 2종목만 표시했습니다");
  });

  it("returns a plain notice when the ranking is empty", () => {
    const out = formatAfterHoursRank([], "kospi", "unchanged", "all", 20, MODE);

    expect(out).toBe("[모의투자] 코스피 시간외 단일가 보합 순위 — 해당 종목이 없습니다.");
  });
});
