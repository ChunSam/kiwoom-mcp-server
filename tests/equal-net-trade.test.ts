import { describe, expect, it } from "vitest";

import {
  creditRatioRankResponseSchema,
  equalNetTradeRankResponseSchema,
} from "../src/kiwoom/types.js";
import { formatEqualNetTrade } from "../src/tools/equal-net-trade.js";
import { formatRanking } from "../src/tools/ranking.js";

/**
 * ka10062 실측 (REAL 2026-08-04, mrkt_tp=000 strt_dt=20260728 trde_tp=1 sort_cnd=1).
 *
 * 3행은 효성중공업 — `orgn_nettrde_avg_pric`이 **−2147483**(=−2³¹/1000, 32비트 포화값)으로
 * 실제로 온다. 이 fixture의 존재 이유다.
 */
const fixture = equalNetTradeRankResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  eql_nettrde_rank: [
    {
      stk_cd: "214450_AL",
      rank: "1",
      stk_nm: "파마리서치",
      cur_prc: "+382000",
      pre_sig: "2",
      pred_pre: "+10000",
      flu_rt: "+2.69",
      acc_trde_qty: "251618",
      orgn_nettrde_qty: "+45",
      orgn_nettrde_amt: "+17015",
      orgn_nettrde_avg_pric: "374730",
      for_nettrde_qty: "+22",
      for_nettrde_amt: "+8350",
      for_nettrde_avg_pric: "379192",
      nettrde_qty: "+67",
      nettrde_amt: "+25365",
    },
    {
      stk_cd: "010120_AL",
      rank: "2",
      stk_nm: "LS ELECTRIC",
      cur_prc: "+196900",
      pre_sig: "2",
      pred_pre: "+8500",
      flu_rt: "+4.51",
      acc_trde_qty: "1572020",
      orgn_nettrde_qty: "+21",
      orgn_nettrde_amt: "+4035",
      orgn_nettrde_avg_pric: "189662",
      for_nettrde_qty: "+46",
      for_nettrde_amt: "+8779",
      for_nettrde_avg_pric: "190929",
      nettrde_qty: "+67",
      nettrde_amt: "+12814",
    },
    {
      stk_cd: "298040_AL",
      rank: "3",
      stk_nm: "효성중공업",
      cur_prc: "-1234000",
      pre_sig: "5",
      pred_pre: "-11000",
      flu_rt: "-0.88",
      acc_trde_qty: "86378",
      orgn_nettrde_qty: "+2",
      orgn_nettrde_amt: "+4158",
      orgn_nettrde_avg_pric: "-2147483",
      for_nettrde_qty: "+3",
      for_nettrde_amt: "+3702",
      for_nettrde_avg_pric: "1234000",
      nettrde_qty: "+5",
      nettrde_amt: "+7860",
    },
  ],
});

/** ka10033 실측 (REAL 2026-08-04, mrkt_tp=000 trde_qty_tp=0000 stex_tp=3). */
const creditFixture = creditRatioRankResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  crd_rt_upper: [
    {
      stk_infr: "28",
      stk_cd: "003610_AL",
      stk_nm: "방림",
      cur_prc: "+5420",
      pred_pre_sig: "2",
      pred_pre: "+130",
      flu_rt: "+2.46",
      crd_rt: "+6.19",
      sel_req: "9934",
      buy_req: "26700",
      now_trde_qty: "109044",
    },
    {
      stk_infr: "28",
      stk_cd: "071280_AL",
      stk_nm: "로체시스템즈",
      cur_prc: "+6440",
      pred_pre_sig: "2",
      pred_pre: "+200",
      flu_rt: "+3.21",
      crd_rt: "+6.07",
      sel_req: "3931",
      buy_req: "5954",
      now_trde_qty: "44786",
    },
  ],
});

describe("formatEqualNetTrade", () => {
  const rows = fixture.eql_nettrde_rank;
  const out = formatEqualNetTrade(rows, "all", "20260728", "net_buy", "amount", 20, "실전투자");

  it("방향과 시작일을 제목에 낸다", () => {
    expect(out).toContain("[실전투자] 기관·외국인 동시 순매수 상위 — 전체 (2026-07-28~)");
  });

  it("순매도 방향은 제목이 바뀐다", () => {
    const sell = formatEqualNetTrade(rows, "kospi", "20260728", "net_sell", "amount", 20, "실전투자");
    expect(sell).toContain("기관·외국인 동시 순매도 상위 — 코스피");
  });

  it("코드에서 _AL 접미사를 뗀다", () => {
    expect(out).toContain("214450");
    expect(out).not.toContain("214450_AL");
  });

  // 하락 종목 현재가 "-1234000"의 부호는 전일대비 방향이다.
  it("하락 종목 현재가를 음수로 렌더하지 않는다", () => {
    expect(out).toContain("1,234,000");
    expect(out).not.toContain("-1,234,000");
  });

  // 32비트 포화 평균단가를 그대로 찍으면 "-2,147,483원"이 나간다.
  it("포화된 평균단가를 산출 불가로 바꾼다", () => {
    const dataRow = out.split("\n").find((l) => l.includes("효성중공업")) ?? "";
    expect(dataRow).toContain("산출 불가");
    expect(dataRow).not.toContain("-2,147,483");
  });

  it("정상 평균단가는 그대로 낸다", () => {
    expect(out).toContain("374,730");
    expect(out).toContain("379,192");
  });

  it("한 행 안의 단위 혼재를 각주로 밝힌다", () => {
    expect(out).toContain("한 행 안에서 단위가 갈립니다");
    expect(out).toContain("천주");
    expect(out).toContain("백만원");
  });

  it("보유 계열과 다른 소스임을 밝힌다", () => {
    expect(out).toContain("get_foreign_holding");
  });

  it("빈 배열은 기간을 늘려 보라고 안내한다", () => {
    const empty = formatEqualNetTrade([], "all", "20260803", "net_buy", "amount", 20, "모의투자");
    expect(empty).toContain("해당 종목이 없습니다");
    expect(empty).toContain("기간을 늘려");
  });
});

describe("formatRanking — credit_ratio", () => {
  const out = formatRanking("credit_ratio", "all", creditFixture.crd_rt_upper, 20, "실전투자");

  it("신용비율 순위 제목을 낸다", () => {
    expect(out).toContain("[실전투자] 전체 신용비율 상위 (상위 2종목)");
  });

  it("신용비율과 잔량을 표에 낸다", () => {
    expect(out).toContain("6.19%");
    expect(out).toContain("26,700");
    expect(out).toContain("9,934");
  });

  it("신용비율의 뜻과 인접 tool을 각주로 밝힌다", () => {
    expect(out).toContain("반대매매");
    expect(out).toContain("get_credit_trend");
  });

  it("빈 배열은 에러가 아니라 안내로 답한다", () => {
    expect(formatRanking("credit_ratio", "kosdaq", [], 20, "모의투자")).toContain(
      "데이터가 없습니다",
    );
  });
});
