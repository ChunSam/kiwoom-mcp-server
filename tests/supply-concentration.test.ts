import { describe, expect, it } from "vitest";

import { supplyConcentrationResponseSchema } from "../src/kiwoom/types.js";
import { formatSupplyConcentration } from "../src/tools/supply-concentration.js";

const MODE = "실전투자";

/**
 * ka10025 실측 (REAL 2026-08-03 17:0x KST, mrkt_tp=000 / prps_cnctr_rt=70 /
 * cur_prc_entry=0 / prpscnt=10 / cycle_tp=50 / stex_tp=3). 모의투자도 같은 응답을 줬다.
 *
 * 살려둔 특이값:
 *  - **응답이 매물비율 순이 아니다.** 70.14 → 70.75 → 70.77 → 71.43…으로 하한 근처부터
 *    올라온다. 포맷터가 내림차순으로 다시 세우는지 확인하는 근거 픽스처다.
 *  - `prps_rt`가 "+70.14"처럼 부호를 달고 오지만 항상 양수다 (비율이라 방향이 없다).
 *  - 거래가 없는 종목도 그대로 온다 (now_trde_qty "0", KB 레버리지 ETN).
 */
const { prps_cnctr: rows } = supplyConcentrationResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  prps_cnctr: [
    {
      stk_cd: "012690_AL", stk_nm: "모나리자", cur_prc: "+1392", pred_pre_sig: "2", pred_pre: "+3",
      flu_rt: "+0.22", now_trde_qty: "433016", pric_strt: "1631", pric_end: "1748",
      prps_qty: "93842621", prps_rt: "+70.14",
    },
    {
      stk_cd: "580060_AL", stk_nm: "KB 레버리지 미국채 10년 ETN", cur_prc: "-20815", pred_pre_sig: "5",
      pred_pre: "-65", flu_rt: "-0.31", now_trde_qty: "4", pric_strt: "22683", pric_end: "22939",
      prps_qty: "75", prps_rt: "+70.75",
    },
    {
      stk_cd: "463480_AL", stk_nm: "모티브링크", cur_prc: "+3645", pred_pre_sig: "2", pred_pre: "+155",
      flu_rt: "+4.44", now_trde_qty: "13265", pric_strt: "3955", pric_end: "4409",
      prps_qty: "5733127", prps_rt: "+70.77",
    },
    {
      stk_cd: "610098_AL", stk_nm: "메리츠 미국채30년 풋라이트 ETN(H)", cur_prc: "-9930", pred_pre_sig: "5",
      pred_pre: "-10", flu_rt: "-0.10", now_trde_qty: "0", pric_strt: "10032", pric_end: "10050",
      prps_qty: "110", prps_rt: "+71.43",
    },
    {
      stk_cd: "264900_AL", stk_nm: "크라운제과", cur_prc: "+8040", pred_pre_sig: "2", pred_pre: "+30",
      flu_rt: "+0.37", now_trde_qty: "1862", pric_strt: "7560", pric_end: "7819",
      prps_qty: "2164940", prps_rt: "+71.54",
    },
    {
      stk_cd: "900250_AL", stk_nm: "크리스탈신소재", cur_prc: "+1018", pred_pre_sig: "2", pred_pre: "+59",
      flu_rt: "+6.15", now_trde_qty: "85072", pric_strt: "484", pric_end: "622",
      prps_qty: "55693316", prps_rt: "+71.59",
    },
  ],
});

describe("formatSupplyConcentration", () => {
  it("키움이 준 순서가 아니라 매물비율 내림차순으로 세운다", () => {
    const out = formatSupplyConcentration(rows, "all", 70, 50, false, 20, false, MODE);

    // 응답 첫 행은 모나리자(70.14)지만 표의 1위는 크리스탈신소재(71.59)여야 한다
    expect(out).toContain("| 1 | 크리스탈신소재 | 900250 | 71.59% |");
    expect(out).toContain("| 6 | 모나리자 | 012690 | 70.14% |");
    expect(out).toContain("서버가 매물비율 내림차순으로 정렬");
  });

  it("매물대 구간과 현재가를 함께 렌더한다", () => {
    const out = formatSupplyConcentration(rows, "all", 70, 50, false, 20, false, MODE);

    expect(out.startsWith(`[${MODE}] 매물대집중 종목 (전체 · 최근 50일 · 매물비율 70% 이상)`)).toBe(true);
    expect(out).toContain("6건 중 상위 6건");
    // 매물대 구간은 부호 없는 가격, 현재가는 절대값
    expect(out).toContain("| 484원 ~ 622원 | 55,693,316주 | 1,018원 | +6.15% |");
    // cur_prc "-20815"의 마이너스는 전일대비 방향이라 가격은 양수로 나와야 한다
    expect(out).toContain("| 20,815원 |");
    expect(out).not.toContain("-20,815원");
  });

  it("해석 각주와 행 단위 주의를 붙인다", () => {
    const out = formatSupplyConcentration(rows, "kospi", 50, 100, false, 20, false, MODE);

    expect(out).toContain("코스피 · 최근 100일 · 매물비율 50% 이상");
    expect(out).toContain("최근 100일 거래를 가격 구간으로");
    expect(out).toContain("반등 시 저항, 아래쪽 매물대는 하락 시 지지");
    expect(out).toContain("**종목 × 매물대 구간**");
  });

  it("current_price_only와 잘림·상한을 각각 알린다", () => {
    const entry = formatSupplyConcentration(rows, "all", 70, 50, true, 2, true, MODE);

    expect(entry).toContain("현재가 진입");
    expect(entry).toContain("현재가가 매물대 구간에 들어온 종목만");
    expect(entry).toContain("조회된 6건 중 상위 2건만 표시했습니다");
    expect(entry).toContain("결과가 잘렸을 수 있습니다");
  });

  it("빈 결과는 에러가 아니라 조건 완화를 안내한다", () => {
    const out = formatSupplyConcentration([], "kosdaq", 90, 50, false, 20, false, MODE);

    expect(out).toContain("매물대집중 종목이 없습니다");
    expect(out).toContain("코스닥 · 최근 50일 · 매물비율 90% 이상");
    expect(out).toContain("매물비율 기준을 낮추거나");
  });
});
