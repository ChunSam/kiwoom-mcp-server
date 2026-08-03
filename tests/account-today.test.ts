import { describe, expect, it } from "vitest";

import { accountTodayStatusSchema } from "../src/kiwoom/types.js";
import { formatAccountToday } from "../src/tools/account-today.js";

const MODE = "실전투자";

/**
 * kt00017 실측 (REAL 2026-08-03 17:0x KST, 빈 body). 모의투자는 RC9000으로 미제공이라
 * 실계좌 응답만 있다.
 *
 * 살려둔 특이값:
 *  - 금액이 전부 "000000525569"처럼 12자리 zero-pad로 온다 (원 단위).
 *  - 매도만 있고 매수는 0인 하루 — 세금이 0인데 수수료만 70원 잡혔다.
 *  - 신용·대출·기타 자산 15필드가 전부 0이다. 그대로 찍으면 소음이라 포맷터가 생략한다.
 */
const status = accountTodayStatusSchema.parse({
  d2_entra: "000000525569",
  crd_int_npay_gold: "000000000000",
  etc_loana: "000000000000",
  gnrl_stk_evlt_amt_d2: "000000433105",
  dpst_grnt_use_amt_d2: "000000000000",
  crd_stk_evlt_amt_d2: "000000000000",
  crd_loan_d2: "000000000000",
  crd_loan_evlta_d2: "000000000000",
  crd_ls_grnt_d2: "000000000000",
  crd_ls_evlta_d2: "000000000000",
  ina_amt: "000000000000",
  outa: "000000000000",
  inq_amt: "000000000000",
  outq_amt: "000000000000",
  sell_amt: "000000520515",
  buy_amt: "000000000000",
  cmsn: "000000000070",
  tax: "000000000000",
  stk_pur_cptal_loan_amt: "000000000000",
  rp_evlt_amt: "000000000000",
  bd_evlt_amt: "000000000000",
  elsevlt_amt: "000000000000",
  crd_int_amt: "000000000000",
  sel_prica_grnt_loan_int_amt_amt: "000000000000",
  dvida_amt: "000000000000",
  return_code: 0,
  return_msg: "조회가 완료되었습니다..",
});

/** 신용융자·배당이 있는 계좌를 가정한 변형 — 조건부 블록이 살아나는지 본다. */
const withCredit = accountTodayStatusSchema.parse({
  ...status,
  ina_amt: "000001000000",
  outa: "000000300000",
  buy_amt: "000000480000",
  tax: "000000000900",
  crd_loan_d2: "000002000000",
  crd_int_amt: "000000001500",
  dvida_amt: "000000012000",
});

describe("formatAccountToday", () => {
  it("당일 매매·입출금·D+2 추정을 렌더한다", () => {
    const out = formatAccountToday(status, MODE);

    expect(out.startsWith(`[${MODE}] 계좌 당일 현황`)).toBe(true);
    expect(out).toContain("매도금액: 520,515원 / 매수금액: 0원");
    expect(out).toContain("수수료: 70원 / 세금: 0원 (합계 70원)");
    expect(out).toContain("매도−매수: +520,515원");
    expect(out).toContain("추정예수금: 525,569원");
    expect(out).toContain("일반주식 평가금액: 433,105원");
  });

  it("값이 0뿐인 신용·기타 블록은 생략하고 그 사실을 밝힌다", () => {
    const out = formatAccountToday(status, MODE);

    expect(out).not.toContain("■ 신용·대출");
    expect(out).not.toContain("■ 기타 자산");
    expect(out).toContain("전부 0이라 생략했습니다");
  });

  it("값이 있는 신용·기타 항목만 살려 보여준다", () => {
    const out = formatAccountToday(withCredit, MODE);

    expect(out).toContain("■ 신용·대출");
    expect(out).toContain("- 신용융자금: 2,000,000원");
    expect(out).toContain("- 신용이자: 1,500원");
    // 0인 신용 항목은 여전히 빠진다
    expect(out).not.toContain("신용대주 담보금");
    expect(out).toContain("■ 기타 자산");
    expect(out).toContain("- 배당금액: 12,000원");
    expect(out).not.toContain("RP 평가금액");
    expect(out).not.toContain("전부 0이라 생략했습니다");
  });

  it("순입금과 인접 tool 안내를 붙인다", () => {
    const out = formatAccountToday(withCredit, MODE);

    expect(out).toContain("입금: 1,000,000원 / 출금: 300,000원 (순입금 +700,000원)");
    expect(out).toContain("get_trading_journal");
    expect(out).toContain("get_account_holdings");
    expect(out).toContain("D+2 추정은 결제(T+2)까지 반영한 예상치");
  });
});
