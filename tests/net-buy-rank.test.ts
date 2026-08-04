import { describe, expect, it } from "vitest";

import { afterMarketInvestorResponseSchema } from "../src/kiwoom/types.js";
import { formatNetBuyRank, type NetBuyRankOptions } from "../src/tools/net-buy-rank.js";

const MODE = "실전투자";

/**
 * ka10066 실측 (REAL 2026-08-04 09:50 KST, mrkt_tp=001 / amt_qty_tp=1(금액,백만원) /
 * trde_tp=0(순매수) / stex_tp=3). 코스피 1,318행 = 14페이지에서 골라낸 4행이다.
 *
 * 살려둔 특이값:
 *  - **삼성전자 `cur_prc: "-232250"`**: 부호가 값이 아니라 **전일대비 방향**이다. 실제
 *    가격은 232,250원이고, parseKiwoomNumber를 쓰면 −232,250원으로 샌다.
 *  - **동화약품**: 12주체 중 10개가 "0"인 소외 종목. 0을 "-"로 뭉개지 않는지 본다.
 *  - **SK스퀘어**: penfnd_etc(+17,971)와 samo_fund(−33,079)의 부호가 갈린다 — 기관계
 *    합계(−3,717)만 보면 안 보이는 세부 주체가 subject로 뽑히는지 확인하는 행이다.
 *  - 이 12필드는 조회 시점이 장중이어도 **직전 완료 세션(08-03)의 확정치**다. 같은 행의
 *    cur_prc/trde_qty만 당일 값이라 두 시점이 섞여 있다 (08:25·09:41·09:50 세 번 확인).
 */
const { opaf_invsr_trde: rows } = afterMarketInvestorResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  opaf_invsr_trde: [
    {
      stk_cd: "005930_AL", stk_nm: "삼성전자", cur_prc: "-232250", pre_sig: "5",
      pred_pre: "-7250", flu_rt: "-3.03", trde_qty: "16360116", ind_invsr: "3091558",
      frgnr_invsr: "-1420473", orgn: "-1633978", fnnc_invt: "-1245238", insrnc: "12527",
      invtrt: "-309348", etc_fnnc: "2130", bank: "1563", penfnd_etc: "-32557",
      samo_fund: "-63056", natn: "0", etc_corp: "-46314",
    },
    {
      stk_cd: "000020_AL", stk_nm: "동화약품", cur_prc: "+4880", pre_sig: "2",
      pred_pre: "+120", flu_rt: "+2.52", trde_qty: "42323", ind_invsr: "83",
      frgnr_invsr: "-92", orgn: "4", fnnc_invt: "4", insrnc: "0", invtrt: "0",
      etc_fnnc: "0", bank: "0", penfnd_etc: "0", samo_fund: "0", natn: "0", etc_corp: "5",
    },
    {
      stk_cd: "000660_AL", stk_nm: "SK하이닉스", cur_prc: "-1517000", pre_sig: "5",
      pred_pre: "-50000", flu_rt: "-3.19", trde_qty: "2748995", ind_invsr: "2775901",
      frgnr_invsr: "-2157816", orgn: "-628772", fnnc_invt: "-570310", insrnc: "23411",
      invtrt: "-190861", etc_fnnc: "2278", bank: "5815", penfnd_etc: "78505",
      samo_fund: "22390", natn: "0", etc_corp: "957",
    },
    {
      stk_cd: "402340_AL", stk_nm: "SK스퀘어", cur_prc: "-1019000", pre_sig: "5",
      pred_pre: "-6000", flu_rt: "-0.59", trde_qty: "424875", ind_invsr: "65022",
      frgnr_invsr: "-60043", orgn: "-3717", fnnc_invt: "71", insrnc: "-405",
      invtrt: "10753", etc_fnnc: "717", bank: "255", penfnd_etc: "17971",
      samo_fund: "-33079", natn: "0", etc_corp: "-1962",
    },
  ],
});

const base: NetBuyRankOptions = {
  subject: "pension",
  market: "kospi",
  unit: "amount",
  side: "net",
  direction: "top",
};

const rowsOf = (text: string): string[] =>
  text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 순위") && !l.startsWith("|---"));

describe("formatNetBuyRank", () => {
  it("고른 주체 기준으로 정렬한다 — 기관계 합계와 순서가 다르다", () => {
    const text = formatNetBuyRank(rows, base, 20, false, MODE);
    const names = rowsOf(text).map((l) => l.split(" | ")[1]);
    // 연기금: SK하이닉스 78,505 > SK스퀘어 17,971 > 동화약품 0 > 삼성전자 −32,557
    expect(names).toEqual(["SK하이닉스", "SK스퀘어", "동화약품", "삼성전자"]);

    // 같은 데이터를 기관계로 정렬하면 SK스퀘어(−3,717)가 SK하이닉스(−628,772)를 앞선다.
    const byOrgn = formatNetBuyRank(rows, { ...base, subject: "institution" }, 20, false, MODE);
    expect(rowsOf(byOrgn).map((l) => l.split(" | ")[1])).toEqual([
      "동화약품",
      "SK스퀘어",
      "SK하이닉스",
      "삼성전자",
    ]);
  });

  it("가격의 +/- 는 전일대비 방향이라 절대값으로 렌더한다", () => {
    const text = formatNetBuyRank(rows, base, 20, false, MODE);
    expect(text).toContain("232,250원");
    expect(text).not.toContain("-232,250원");
  });

  it("direction=bottom은 순매도 상위를 준다", () => {
    const text = formatNetBuyRank(rows, { ...base, direction: "bottom" }, 20, false, MODE);
    const names = rowsOf(text).map((l) => l.split(" | ")[1]);
    expect(names[0]).toBe("삼성전자");
    expect(names.at(-1)).toBe("SK하이닉스");
    expect(text).toContain("연기금등 순매수 하위");
  });

  it("0인 주체를 '-'로 뭉개지 않는다", () => {
    const text = formatNetBuyRank(rows, { ...base, subject: "nation" }, 20, false, MODE);
    // 국가는 4종목 전부 0 — 값이 없는 게 아니라 0이다.
    expect(rowsOf(text).every((l) => l.split(" | ")[5] === "0")).toBe(true);
  });

  it("두 시점이 섞여 있다는 점과 기관계 구성을 각주로 밝힌다", () => {
    const text = formatNetBuyRank(rows, base, 20, false, MODE);
    expect(text).toContain("직전 완료 거래일");
    expect(text).toContain("get_foreign_intraday");
    expect(text).toContain("기관계는 금융투자·보험·투신·은행·연기금등·사모펀드·기타금융의 합");
  });

  it("top으로 자르면 잘랐다고 알린다", () => {
    const text = formatNetBuyRank(rows, base, 2, false, MODE);
    expect(rowsOf(text)).toHaveLength(2);
    expect(text).toContain("4종목 중 2종목만 표시");
  });

  it("페이지 상한에 걸리면 순위가 아니라 코드순이라 누락된다고 경고한다", () => {
    const text = formatNetBuyRank(rows, base, 20, true, MODE);
    expect(text).toContain("종목코드 순으로 오기 때문에");
  });

  it("빈 결과는 오류가 아니라 안내다", () => {
    const text = formatNetBuyRank([], base, 20, false, MODE);
    expect(text).toContain("데이터가 없습니다");
    expect(text).toContain(`[${MODE}]`);
  });

  it("모드 라벨과 조회 범위를 첫 줄에 밝힌다", () => {
    const text = formatNetBuyRank(rows, base, 20, false, MODE);
    const [first] = text.split("\n");
    expect(first).toContain(`[${MODE}]`);
    expect(first).toContain("코스피 · 연기금등 순매수 상위 · 단위 백만원");
  });
});
