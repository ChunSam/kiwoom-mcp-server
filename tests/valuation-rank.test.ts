import { describe, expect, it } from "vitest";

import { valuationRankResponseSchema } from "../src/kiwoom/types.js";
import { formatValuationRank } from "../src/tools/valuation-rank.js";

const MODE = "실전투자";

/**
 * ka10026 실측 (REAL 2026-08-03 16:2x KST, stex_tp=3 통합). 모의투자도 같은 종목·같은
 * 순서를 줬다 (지표값은 동일, 현재가만 갱신 시점 차이로 미세하게 달랐다).
 *
 * 살려둔 특이값:
 *  - `stk_cd`가 `900120_AL`로 접미사를 달고 온다 — 스키마의 code()가 떼는지 확인한다.
 *  - 값 컬럼 이름이 지표와 무관하게 **항상 `per`**다. 아래 low_roe 픽스처의 `per`에는
 *    PER이 아니라 ROE(-774.04%)가 들어 있다.
 *  - 거래가 없는 종목은 cur_prc에 부호가 없고 now_trde_qty가 "0"이다 (한창·EDGC).
 */
const lowPerRows = valuationRankResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  high_low_per: [
    {
      stk_cd: "900120_AL", stk_nm: "씨엑스아이", per: "0.40", cur_prc: "-851",
      pred_pre_sig: "5", pred_pre: "-18", flu_rt: "-2.07", now_trde_qty: "47824", sel_bid: "-858",
    },
    {
      stk_cd: "005110_AL", stk_nm: "한창", per: "0.41", cur_prc: "1254",
      pred_pre_sig: "3", pred_pre: "0", flu_rt: "0.00", now_trde_qty: "0", sel_bid: "0",
    },
    {
      stk_cd: "036000_AL", stk_nm: "예림당", per: "0.52", cur_prc: "-2830",
      pred_pre_sig: "5", pred_pre: "-40", flu_rt: "-1.39", now_trde_qty: "33914", sel_bid: "-2830",
    },
    {
      stk_cd: "245620_AL", stk_nm: "EDGC", per: "0.61", cur_prc: "741",
      pred_pre_sig: "3", pred_pre: "0", flu_rt: "0.00", now_trde_qty: "0", sel_bid: "0",
    },
  ],
}).high_low_per;

/** pertp=5(저ROE) — `per` 필드에 음수 ROE가 담겨 온다. */
const lowRoeRows = valuationRankResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  high_low_per: [
    {
      stk_cd: "377030_AL", stk_nm: "비트맥스", per: "-774.04", cur_prc: "-1451",
      pred_pre_sig: "5", pred_pre: "-35", flu_rt: "-2.36", now_trde_qty: "14163", sel_bid: "-1451",
    },
    {
      stk_cd: "439960_AL", stk_nm: "코스모로보틱스", per: "-659.24", cur_prc: "+17880",
      pred_pre_sig: "2", pred_pre: "+3140", flu_rt: "+21.30", now_trde_qty: "18269013", sel_bid: "+17880",
    },
    {
      stk_cd: "284620_AL", stk_nm: "카이노스메드", per: "-530.50", cur_prc: "1087",
      pred_pre_sig: "3", pred_pre: "0", flu_rt: "0.00", now_trde_qty: "0", sel_bid: "0",
    },
  ],
}).high_low_per;

describe("formatValuationRank", () => {
  it("저PER 순위를 배(倍) 단위로 렌더하고 접미사 없는 코드를 쓴다", () => {
    const out = formatValuationRank(lowPerRows, "low_per", 20, MODE);

    expect(out.startsWith(`[${MODE}] 저PER 상위 4종목`)).toBe(true);
    expect(out).toContain("| PER(배) |");
    expect(out).toContain("| 1 | 씨엑스아이 | 900120 | 0.4 |");
    expect(out).not.toContain("900120_AL");
    expect(out).toContain("가치함정");
  });

  it("ROE 순위는 같은 `per` 필드를 퍼센트로 읽는다", () => {
    const out = formatValuationRank(lowRoeRows, "low_roe", 20, MODE);

    expect(out.startsWith(`[${MODE}] 저ROE 상위 3종목`)).toBe(true);
    expect(out).toContain("| ROE(%) |");
    expect(out).toContain("| 1 | 비트맥스 | 377030 | -774.04% |");
    expect(out).toContain("**음수가 정상적으로 옵니다**");
    // PER 해설이 섞여 들어오면 안 된다
    expect(out).not.toContain("주가/주당순이익");
  });

  it("가격은 절대값, 등락률·전일대비는 부호를 살린다", () => {
    const out = formatValuationRank(lowRoeRows, "low_roe", 20, MODE);

    // cur_prc "-1451"의 마이너스는 전일대비 방향이지 가격의 부호가 아니다
    expect(out).toContain("| 1,451원 | -35원 | -2.36% |");
    expect(out).not.toContain("-1,451원");
    expect(out).toContain("| 17,880원 | +3,140원 | +21.30% | 18,269,013주 |");
  });

  it("거래가 없는 종목도 0주로 그대로 보여준다", () => {
    const out = formatValuationRank(lowPerRows, "low_per", 20, MODE);

    expect(out).toContain("| 2 | 한창 | 005110 | 0.41 | 1,254원 | 0원 | 0.00% | 0주 |");
  });

  it("top으로 자르면 잘랐다고 알린다", () => {
    const out = formatValuationRank(lowPerRows, "low_per", 2, MODE);

    expect(out).toContain("저PER 상위 2종목");
    expect(out).toContain("조회된 4종목 중 상위 2종목만 표시했습니다");
    expect(out).not.toContain("예림당");
  });

  it("빈 결과는 에러가 아니라 원인 힌트를 준다", () => {
    const out = formatValuationRank([], "high_pbr", 20, MODE);

    expect(out).toContain("고PBR 순위 결과가 없습니다");
    expect(out).toContain("재무 데이터가 갱신되는 중");
  });
});
