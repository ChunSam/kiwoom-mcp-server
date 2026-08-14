import { describe, expect, it } from "vitest";

import { nextDaySettlementResponseSchema } from "../src/kiwoom/types.js";
import { formatNextDaySettlement } from "../src/tools/account-balance.js";

// 모의투자 실측 2026-08-14 (kt00008). 8/13에 005930 1주를 시장가로 매수→매도한 뒤
// 다음 영업일에 조회한 응답 그대로. 체결 당일(8/13)에는 같은 조회가 0행이었다.
// setl_dt가 20260817이 아니라 20260818인 것은 8/15 광복절이 토요일이라
// 8/17이 대체공휴일이기 때문이다 — 결제일을 자체 계산하면 안 되는 근거다.
const SETTLEMENT_FIXTURE = nextDaySettlementResponseSchema.parse({
  trde_dt: "20260813",
  setl_dt: "20260818",
  sell_amt_sum: "000000266534",
  buy_amt_sum: "000000268680",
  acnt_nxdy_setl_frcs_prps_array: [
    {
      seq: "0000001",
      stk_cd: "A005930",
      loan_dt: "",
      qty: "000000000001",
      engg_amt: "000000268000",
      cmsn: "000000000930",
      incm_tax: "000000000000",
      rstx: "000000000402",
      stk_nm: "삼성전자",
      sell_tp: "매도",
      unp: "000000268000",
      exct_amt: "000000266534",
      trde_tax: "000000000134",
      resi_tax: "000000000000",
      crd_tp: "보통매매",
    },
    {
      seq: "0000002",
      stk_cd: "A005930",
      loan_dt: "",
      qty: "000000000001",
      engg_amt: "000000267750",
      cmsn: "000000000930",
      incm_tax: "000000000000",
      rstx: "000000000000",
      stk_nm: "삼성전자",
      sell_tp: "매수",
      unp: "000000267750",
      exct_amt: "000000268680",
      trde_tax: "000000000000",
      resi_tax: "000000000000",
      crd_tp: "보통매매",
    },
  ],
  return_code: 0,
  return_msg: "모의투자 조회완료",
});

const EMPTY_FIXTURE = nextDaySettlementResponseSchema.parse({
  trde_dt: "",
  setl_dt: "",
  sell_amt_sum: "",
  buy_amt_sum: "",
  acnt_nxdy_setl_frcs_prps_array: [],
  return_code: 0,
  return_msg: "모의투자 해당조회내역이 없습니다.",
});

describe("formatNextDaySettlement", () => {
  it("체결일과 결제일을 키움이 준 값 그대로 렌더한다", () => {
    const out = formatNextDaySettlement(SETTLEMENT_FIXTURE, "모의투자");

    expect(out).toContain("[모의투자]");
    // 체결일 +2영업일을 자체 계산하면 8/17이 되지만 실제 결제일은 8/18이다.
    expect(out).toContain("2026-08-13 → 결제일: 2026-08-18");
  });

  it("매도·매수 합계와 순증감을 낸다", () => {
    const out = formatNextDaySettlement(SETTLEMENT_FIXTURE, "모의투자");

    expect(out).toContain("매도 정산 합계: 266,534원");
    expect(out).toContain("매수 정산 합계: 268,680원");
    // 266,534 − 268,680 = −2,146 (왕복 수수료·제세금)
    expect(out).toContain("순증감: -2,146원");
  });

  it("A 접두사를 뗀 종목코드와 제세금 합계를 렌더한다", () => {
    const out = formatNextDaySettlement(SETTLEMENT_FIXTURE, "모의투자");

    expect(out).toContain("삼성전자 (005930)");
    expect(out).not.toContain("A005930");
    // 매도행 제세금 = rstx 402 + trde_tax 134 = 536
    expect(out).toContain("| 536원 |");
  });

  it("정산금액의 방향은 부호가 아니라 구분 열로 읽게 한다", () => {
    const out = formatNextDaySettlement(SETTLEMENT_FIXTURE, "모의투자");

    // 매수 정산금액도 양수로 온다 — 음수로 뒤집지 않는다.
    expect(out).toContain("268,680원 |");
    expect(out).not.toContain("-268,680원");
    expect(out).toContain("방향은 구분 열로 읽으세요");
  });

  it("빈 결과는 에러가 아니라 조회 시점 힌트를 준다", () => {
    const out = formatNextDaySettlement(EMPTY_FIXTURE, "모의투자");

    expect(out).toContain("결제될 체결이 없습니다");
    expect(out).toContain("체결 당일에는 아직 잡히지 않습니다");
  });

  it("잘림 표시는 truncated일 때만 붙는다", () => {
    expect(formatNextDaySettlement(SETTLEMENT_FIXTURE, "모의투자")).not.toContain("빠졌을 수 있습니다");
    expect(
      formatNextDaySettlement({ ...SETTLEMENT_FIXTURE, truncated: true }, "모의투자"),
    ).toContain("빠졌을 수 있습니다");
  });
});
