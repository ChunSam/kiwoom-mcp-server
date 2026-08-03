import { describe, expect, it } from "vitest";

import { institutionTrendResponseSchema } from "../src/kiwoom/types.js";
import { formatInstitutionTrend } from "../src/tools/institution-trend.js";

const MODE = "실전투자";

/**
 * ka10045 실측 (REAL 2026-08-03 14:35 KST, 005930_AL 통합 조회, 20260701~20260803).
 * 모의투자가 같은 날 바이트 단위로 같은 응답을 줬다.
 *
 * 살려둔 특이값 두 가지:
 *  - 누적 컬럼이 "5312819.000000"처럼 소수 표기로 온다
 *  - 당일(20260803) 행은 장중이라 일별 순매수가 0이고, 그래서 누적이 전일과 같다
 */
const response = institutionTrendResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  orgn_prsm_avg_pric: "264002",
  for_prsm_avg_pric: "258366",
  stk_orgn_trde_trnsn: [
    {
      dt: "20260803", close_pric: "-239000", pre_sig: "5", pred_pre: "-23500", flu_rt: "-8.95",
      trde_qty: "42626510", orgn_dt_acc: "5312819.000000", orgn_daly_nettrde_qty: "0",
      for_dt_acc: "-15250209.000000", for_daly_nettrde_qty: "0", limit_exh_rt: "+46.70",
    },
    {
      dt: "20260731", close_pric: "+259000", pre_sig: "2", pred_pre: "+55500", flu_rt: "+26.81",
      trde_qty: "115963226", orgn_dt_acc: "5312819.000000", orgn_daly_nettrde_qty: "2726228",
      for_dt_acc: "-15250209.000000", for_daly_nettrde_qty: "9897241", limit_exh_rt: "+46.70",
    },
    {
      dt: "20260730", close_pric: "+213500", pre_sig: "2", pred_pre: "+1000", flu_rt: "+0.47",
      trde_qty: "81409543", orgn_dt_acc: "2586591.000000", orgn_daly_nettrde_qty: "-170311",
      for_dt_acc: "-25147450.000000", for_daly_nettrde_qty: "1598396", limit_exh_rt: "+46.53",
    },
    {
      dt: "20260701", close_pric: "-316000", pre_sig: "5", pred_pre: "-9000", flu_rt: "-2.77",
      trde_qty: "42763064", orgn_dt_acc: "-2134364.000000", orgn_daly_nettrde_qty: "-2134364",
      for_dt_acc: "-4821937.000000", for_daly_nettrde_qty: "-4821937", limit_exh_rt: "+46.88",
    },
  ],
});

describe("formatInstitutionTrend", () => {
  it("leads with the estimated average cost — the only thing this TR gives", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);

    expect(out).toContain("■ 추정평균단가");
    expect(out).toContain("기관: 264,002원 / 외국인: 258,366원");
  });

  it("renders the daily rows newest-first with signed net-buy quantities", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);
    const rows = out.split("\n").filter((l) => l.startsWith("| 2026-"));

    expect(rows[0]).toContain("2026-08-03");
    expect(rows.at(-1)).toContain("2026-07-01");
    // 기관 순매도 -170,311주 (부호 유지) / 외국인 순매수 +1,598,396주
    expect(rows[2]).toContain("-170,311");
    expect(rows[2]).toContain("+1,598,396");
  });

  it("parses the six-decimal accumulation strings as plain integers", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);

    expect(out).toContain("+5,312,819");
    expect(out).toContain("-15,250,209");
    expect(out).not.toContain(".000000");
  });

  it("renders the close price as an absolute value (부호는 방향)", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);

    // close_pric "-239000"은 하락을 뜻하지 음수 가격이 아니다.
    expect(out).toContain("239,000원");
    expect(out).not.toContain("-239,000원");
  });

  it("says the accumulation is period-scoped, not all-time", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);

    expect(out).toContain("조회 기간 시작일부터의 합계");
  });

  it("points at get_investor_trend for a finer investor breakdown", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);

    expect(out).toContain("get_investor_trend");
  });

  it("caps at count and says how many rows were held back", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 2, MODE);
    const rows = out.split("\n").filter((l) => l.startsWith("| 2026-"));

    expect(out).toContain("조회된 4행 중 최근 2행만 표시했습니다");
    // 헤더의 기간 표기("2026-07-01 ~ 2026-08-03")와 섞이지 않도록 표 행만 본다.
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.includes("2026-07-01"))).toBe(false);
  });

  it("renders 거래량 without a sign (방향성 없는 수량)", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);

    expect(out).toContain("42,626,510");
    expect(out).not.toContain("+42,626,510");
  });

  it("returns a plain notice when the period has no trading days", () => {
    const empty = institutionTrendResponseSchema.parse({
      return_code: 0,
      orgn_prsm_avg_pric: "",
      for_prsm_avg_pric: "",
      stk_orgn_trde_trnsn: [],
    });
    const out = formatInstitutionTrend(empty, "999999", "20260701", "20260803", 15, MODE);

    expect(out).toContain("기관·외국인 매매 추이가 없습니다");
    expect(out).not.toContain("|");
  });

  it("labels the numbers as unified (KRX + NXT)", () => {
    const out = formatInstitutionTrend(response, "005930", "20260701", "20260803", 15, MODE);

    expect(out).toContain("통합 기준");
  });
});
