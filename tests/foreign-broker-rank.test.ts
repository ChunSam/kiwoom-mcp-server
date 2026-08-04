import { describe, expect, it } from "vitest";

import { foreignBrokerRankResponseSchema } from "../src/kiwoom/types.js";
import { formatForeignBrokerRank } from "../src/tools/broker-activity.js";

/**
 * ka10037 실측 (REAL 2026-08-04, mrkt_tp=000 dt=1 sort_tp=1 stex_tp=3).
 *
 * 앞 2행은 trde_tp=1(순매수), 뒤 2행은 trde_tp=2(순매도) 응답에서 가져와 한 fixture에 담았다 —
 * 순매도 쪽 `netprps_trde_qty`가 `--1073702`처럼 **이중부호**로 오는 걸 같이 검증하려는 것이다.
 */
const fixture = foreignBrokerRankResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  frgn_wicket_trde_upper: [
    {
      rank: "1",
      stk_cd: "005380_AL",
      stk_nm: "현대차",
      cur_prc: "-392500",
      pred_pre_sig: "5",
      pred_pre: "-500",
      flu_rt: "-0.13",
      sel_trde_qty: "-132849",
      buy_trde_qty: "+284559",
      netprps_trde_qty: "+151710",
      netprps_prica: "+59569",
      trde_qty: "1103095",
      trde_prica: "426134",
    },
    {
      rank: "2",
      stk_cd: "402340_AL",
      stk_nm: "SK스퀘어",
      cur_prc: "+1069000",
      pred_pre_sig: "2",
      pred_pre: "+44000",
      flu_rt: "+4.29",
      sel_trde_qty: "-338623",
      buy_trde_qty: "+371950",
      netprps_trde_qty: "+33327",
      netprps_prica: "+34437",
      trde_qty: "1302655",
      trde_prica: "1353007",
    },
    {
      rank: "3",
      stk_cd: "000660_AL",
      stk_nm: "SK하이닉스",
      cur_prc: "+1596000",
      pred_pre_sig: "2",
      pred_pre: "+21000",
      flu_rt: "+1.33",
      sel_trde_qty: "-2569218",
      buy_trde_qty: "+1495516",
      netprps_trde_qty: "--1073702",
      netprps_prica: "--1704399",
      trde_qty: "4271088",
      trde_prica: "6800000",
    },
  ],
});

describe("formatForeignBrokerRank", () => {
  const rows = fixture.frgn_wicket_trde_upper;

  it("당일은 기간 라벨을 '당일'로 낸다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 20, "실전투자");
    expect(out).toContain("[실전투자] 외국계 창구 순매수 상위 — 전체 (당일)");
  });

  it("누적 기간은 일수를 밝힌다", () => {
    const out = formatForeignBrokerRank(rows, "kospi", "10", "net_sell", "amount", 20, "실전투자");
    expect(out).toContain("외국계 창구 순매도 상위 — 코스피 (최근 10일 누적)");
  });

  it("코드에서 _AL 접미사를 뗀다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 20, "실전투자");
    expect(out).toContain("005380");
    expect(out).not.toContain("005380_AL");
  });

  // 하락 종목 현재가 "-392500"의 부호는 전일대비 방향이다.
  it("하락 종목 현재가를 음수로 렌더하지 않는다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 20, "실전투자");
    expect(out).toContain("392,500");
    expect(out).not.toContain("-392,500");
  });

  // 매수/매도량의 +/-는 방향 중복이라 절대값으로 보여야 한다.
  it("창구 매수·매도량을 절대값으로 낸다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 20, "실전투자");
    const row = out.split("\n").find((l) => l.includes("현대차")) ?? "";
    expect(row).toContain("284,559");
    expect(row).toContain("132,849");
    expect(row).not.toContain("-132,849");
  });

  // `--1073702`를 그대로 파싱하면 양수가 되거나 NaN이 된다.
  it("이중부호 순매매를 음수로 읽는다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "net_sell", "amount", 20, "실전투자");
    expect(out).toContain("-1,073,702주");
    expect(out).toContain("-1,704,399");
  });

  it("정렬 기준을 각주로 밝힌다", () => {
    const byQty = formatForeignBrokerRank(rows, "all", "1", "net_buy", "quantity", 20, "실전투자");
    expect(byQty).toContain("순매매 **수량**");
    const byAmt = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 20, "실전투자");
    expect(byAmt).toContain("순매매 **금액**");
  });

  // direction=all은 trde_tp=0이라 순위가 아니라 종목코드 순이다 — 순위표로 오해하면 안 된다.
  it("direction=all일 때 순위가 아님을 밝힌다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "all", "amount", 20, "실전투자");
    expect(out).toContain("종목코드 순");
    const buy = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 20, "실전투자");
    expect(buy).not.toContain("종목코드 순");
  });

  it("창구 기준임을 못박는다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 20, "실전투자");
    expect(out).toContain("투자자 국적이 아닙니다");
    expect(out).toContain("get_foreign_intraday");
  });

  it("top으로 행을 자른다", () => {
    const out = formatForeignBrokerRank(rows, "all", "1", "net_buy", "amount", 1, "실전투자");
    expect(out).toContain("(1종목)");
    expect(out).not.toContain("SK스퀘어");
  });

  it("빈 배열은 에러가 아니라 안내로 답한다", () => {
    expect(formatForeignBrokerRank([], "kosdaq", "5", "net_buy", "amount", 20, "모의투자")).toContain(
      "해당 종목이 없습니다",
    );
  });
});
