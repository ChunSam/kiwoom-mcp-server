import { describe, expect, it } from "vitest";

import { creditTrendResponseSchema } from "../src/kiwoom/types.js";
import { formatCreditTrend } from "../src/tools/credit-trend.js";

const MODE = "실전투자";

/**
 * ka10013 실측 (REAL 2026-08-03 16:2x KST, 005930_AL 통합 조회, dt=20260803, qry_tp=1).
 * 모의투자가 같은 날 같은 값을 줬다.
 *
 * 살려둔 특이값:
 *  - **기준일(20260803)이 응답에 없다.** 신용잔고는 하루 지연 집계라 최신 행이 직전
 *    거래일(20260731)이다 — 빈 결과가 아니라 정상이다.
 *  - `remn` 21,607,489주 ÷ 상장주식수 5,969,782,550 = 0.36%로 `remn_rt`와 일치한다.
 *    잔고가 '주' 단위라는 근거이자 단위를 바꾸면 깨지는 회귀 테스트.
 *  - `amt` 4,464,451 ÷ `remn` 21,607,489 = 206,616원/주 — 백만원 단위라는 근거.
 */
const loanResponse = creditTrendResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  crd_trde_trend: [
    {
      dt: "20260731", cur_prc: "+259000", pred_pre_sig: "2", pred_pre: "+52000",
      trde_qty: "115963226", new: "6625909", rpya: "8198061", remn: "21607489",
      amt: "4464451", pre: "-1572152", shr_rt: "10.09", remn_rt: "0.36",
    },
    {
      dt: "20260730", cur_prc: "+213500", pred_pre_sig: "2", pred_pre: "+5000",
      trde_qty: "81409543", new: "2874878", rpya: "3136670", remn: "23249181",
      amt: "4958767", pre: "-261792", shr_rt: "6.90", remn_rt: "0.39",
    },
    {
      dt: "20260729", cur_prc: "-214000", pred_pre_sig: "5", pred_pre: "-6000",
      trde_qty: "116380656", new: "1496507", rpya: "1420186", remn: "23530111",
      amt: "5077502", pre: "76321", shr_rt: "6.41", remn_rt: "0.40",
    },
    {
      dt: "20260728", cur_prc: "-218000", pred_pre_sig: "5", pred_pre: "-36000",
      trde_qty: "67667580", new: "2591543", rpya: "1952383", remn: "23473225",
      amt: "5069240", pre: "639160", shr_rt: "9.90", remn_rt: "0.39",
    },
  ],
});

/** 같은 종목·같은 날 qry_tp=2(대주). 융자의 1/3800 규모라 잔고율이 "0.00"으로 눌린다. */
const shortResponse = creditTrendResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  crd_trde_trend: [
    {
      dt: "20260731", cur_prc: "+259000", pred_pre_sig: "2", pred_pre: "+52000",
      trde_qty: "115963226", new: "15329", rpya: "14271", remn: "5665",
      amt: "994", pre: "1058", shr_rt: "0.02", remn_rt: "0.00",
    },
    {
      dt: "20260730", cur_prc: "+213500", pred_pre_sig: "2", pred_pre: "+5000",
      trde_qty: "81409543", new: "1567", rpya: "3912", remn: "4607",
      amt: "794", pre: "-2345", shr_rt: "0.00", remn_rt: "0.00",
    },
  ],
});

const emptyResponse = creditTrendResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  crd_trde_trend: [],
});

describe("formatCreditTrend", () => {
  it("최신 잔고 요약과 일자별 표를 렌더한다", () => {
    const out = formatCreditTrend(loanResponse, "005930", "20260803", "loan", 15, MODE);

    expect(out.startsWith(`[${MODE}] 005930 신용융자 매매동향`)).toBe(true);
    expect(out).toContain("2026-07-28 ~ 2026-07-31");
    expect(out).toContain("4거래일 중 4행");
    expect(out).toContain("잔고: 21,607,489주 (4,464,451백만원)");
    expect(out).toContain("전일대비 -1,572,152주");
    expect(out).toContain("잔고율: 0.36% / 공여율: 10.09%");
  });

  it("가격은 절대값으로, 전일대비·잔고증감은 부호를 살려 렌더한다", () => {
    const out = formatCreditTrend(loanResponse, "005930", "20260803", "loan", 15, MODE);

    // cur_prc "-214000"의 마이너스는 값의 부호가 아니라 전일대비 방향이다
    expect(out).toContain("| 2026-07-29 | 214,000원 | -6,000원 |");
    expect(out).not.toContain("-214,000원");
    // 잔고증감(pre)은 부호가 값의 일부
    expect(out).toContain("| -1,572,152 |");
    expect(out).toContain("| +639,160 |");
  });

  it("융자와 대주에 서로 다른 해석 각주를 붙인다", () => {
    const loan = formatCreditTrend(loanResponse, "005930", "20260803", "loan", 15, MODE);
    const short = formatCreditTrend(shortResponse, "005930", "20260803", "short", 15, MODE);

    expect(loan).toContain("빚을 낸 매수가 쌓였다는 뜻이고");
    expect(loan).toContain("반대매매");
    expect(loan).not.toContain("get_stock_lending");

    expect(short.startsWith(`[${MODE}] 005930 대주 매매동향`)).toBe(true);
    expect(short).toContain("하락에 베팅한 물량");
    expect(short).toContain("get_stock_lending");
  });

  it("신용 컬럼이 KRX 기준임을 통합 각주와 함께 밝힌다", () => {
    const out = formatCreditTrend(loanResponse, "005930", "20260803", "loan", 15, MODE);

    expect(out).toContain("신용 수치는 **KRX 기준**입니다");
    expect(out).toContain("통합 기준");
    expect(out).toContain("당일 행은 대개 비어 있습니다");
  });

  it("count로 행을 자르면 잘랐다고 알린다", () => {
    const out = formatCreditTrend(loanResponse, "005930", "20260803", "loan", 2, MODE);

    expect(out).toContain("4거래일 중 2행");
    expect(out).toContain("2026-07-30 ~ 2026-07-31");
    expect(out).toContain("조회된 4행 중 최근 2행만 표시했습니다");
    expect(out).not.toContain("2026-07-29");
  });

  it("빈 결과는 에러가 아니라 원인 힌트를 준다", () => {
    const out = formatCreditTrend(emptyResponse, "005930", "20260803", "loan", 15, MODE);

    expect(out).toContain("신용융자 매매동향이 없습니다");
    expect(out).toContain("기준일 2026-08-03");
    expect(out).toContain("신용거래가 제한된 종목");
  });
});
