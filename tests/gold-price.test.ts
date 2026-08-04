import { describe, expect, it } from "vitest";

import { goldContractResponseSchema, goldDailyResponseSchema } from "../src/kiwoom/types.js";
import { formatGoldDaily, formatGoldTicks } from "../src/tools/gold-price.js";

/**
 * ka50010 실측 (REAL 2026-08-04 19:00, M04020000 금 99.99_1Kg).
 * `cntr_trde_qty`의 부호가 행마다 다른 것(463 / +1 / -2)이 이 fixture의 요점 —
 * 부호는 체결 방향이고 수량은 절대값이다.
 */
const ticksFixture = goldContractResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  gold_cntr: [
    {
      cntr_pric: "+186720",
      pred_pre: "+290",
      flu_rt: "+0.16",
      trde_qty: "97579",
      acc_trde_prica: "18154047200",
      cntr_trde_qty: "463",
      tm: "153000",
      pre_sig: "2",
      pri_sel_bid_unit: "+186720",
      pri_buy_bid_unit: "+186710",
      trde_pre: "+119.58",
      trde_tern_rt: "+0.56",
      cntr_str: "140.32",
    },
    {
      cntr_pric: "+186730",
      pred_pre: "+300",
      flu_rt: "+0.16",
      trde_qty: "90969",
      acc_trde_prica: "16919739890",
      cntr_trde_qty: "+1",
      tm: "151323",
      pre_sig: "2",
      pri_sel_bid_unit: "+186730",
      pri_buy_bid_unit: "+186710",
      trde_pre: "+111.48",
      trde_tern_rt: "0.00",
      cntr_str: "134.02",
    },
    {
      cntr_pric: "+186380",
      pred_pre: "+130",
      flu_rt: "+0.07",
      trde_qty: "6046",
      acc_trde_prica: "1123574080",
      cntr_trde_qty: "-2",
      tm: "140823",
      pre_sig: "2",
      pri_sel_bid_unit: "+186380",
      pri_buy_bid_unit: "+186370",
      trde_pre: "+50.32",
      trde_tern_rt: "+0.01",
      cntr_str: "105.89",
    },
  ],
});

/**
 * ka50012 실측 (REAL 2026-08-04, M04020000, base_dt=20260804).
 * 마지막 행(20260623)은 하락일이라 `cur_prc`·`low_pric`에 `-`가 붙어 있다 —
 * 이 부호는 전일대비 방향이지 값의 부호가 아니다.
 */
const dailyFixture = goldDailyResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  gold_daly_trnsn: [
    {
      cur_prc: "+186720",
      pred_pre: "+290",
      flu_rt: "+0.16",
      trde_qty: "97579",
      acc_trde_prica: "18154",
      open_pric: "+186450",
      high_pric: "+187560",
      low_pric: "-184690",
      dt: "20260804",
      pre_sig: "2",
      orgn_netprps: "-16",
      for_netprps: "0",
      ind_netprps: "20",
    },
    {
      cur_prc: "-202730",
      pred_pre: "-3320",
      flu_rt: "-1.61",
      trde_qty: "568427",
      acc_trde_prica: "116003",
      open_pric: "206050",
      high_pric: "+206400",
      low_pric: "-201890",
      dt: "20260623",
      pre_sig: "5",
      orgn_netprps: "-114",
      for_netprps: "0",
      ind_netprps: "-115",
    },
  ],
});

describe("formatGoldTicks", () => {
  const out = formatGoldTicks(ticksFixture.gold_cntr, "1kg", 20, "실전투자");

  it("헤더에 현재가와 체결강도를 낸다", () => {
    expect(out).toContain("[실전투자] KRX 금현물 체결 — 금 99.99_1Kg");
    expect(out).toContain("186,720");
    expect(out).toContain("140.32");
  });

  it("시각을 HH:MM:SS로 편다", () => {
    expect(out).toContain("15:30:00");
    expect(out).toContain("14:08:23");
  });

  // 부호는 방향, 크기는 절대값 — `-2`가 수량 -2로 렌더되면 안 된다.
  it("체결량 부호를 매수/매도로 옮기고 수량은 절대값으로 낸다", () => {
    expect(out).toContain("| 매수 |");
    expect(out).toContain("| 매도 |");
    expect(out).not.toContain("| -2 |");
  });

  it("KRX 단독 기준임을 밝힌다", () => {
    expect(out).toContain("KRX 단독");
  });

  it("빈 배열은 에러가 아니라 안내로 답한다", () => {
    const empty = formatGoldTicks([], "100g", 20, "모의투자");
    expect(empty).toContain("체결 내역이 없습니다");
    expect(empty).toContain("09:00~15:30");
  });
});

describe("formatGoldDaily", () => {
  const out = formatGoldDaily(dailyFixture.gold_daly_trnsn, "1kg", 20, "실전투자");

  it("최근 종가와 일자를 헤더에 낸다", () => {
    expect(out).toContain("[실전투자] KRX 금현물 일별추이 — 금 99.99_1Kg");
    expect(out).toContain("2026-08-04");
  });

  // 하락일 가격의 `-`는 전일대비 방향이다. parseKiwoomNumber를 쓰면 -202,730이 된다.
  it("하락일 가격을 음수로 렌더하지 않는다", () => {
    expect(out).toContain("202,730");
    expect(out).not.toContain("-202,730");
    expect(out).toContain("201,890");
    expect(out).not.toContain("-201,890");
  });

  it("등락률 부호는 그대로 둔다", () => {
    expect(out).toContain("-1.61%");
  });

  it("기관·개인 순매수를 부호와 함께 낸다", () => {
    expect(out).toContain("-114");
    expect(out).toContain("-115");
  });

  // 외국인 컬럼은 전 구간 0이라 의미를 확정하지 못했다 — 표에 넣지 않고 각주로 밝힌다.
  it("외국인 순매수를 표에 넣지 않고 각주로 설명한다", () => {
    expect(out).not.toContain("| 외국인 |");
    expect(out).toContain("for_netprps");
  });

  it("거래대금 단위 차이를 각주로 밝힌다", () => {
    expect(out).toContain("백만원");
    expect(out).toContain("원 단위라 자릿수가 다릅니다");
  });

  it("빈 배열은 휴장일 힌트를 준다", () => {
    const empty = formatGoldDaily([], "1kg", 20, "실전투자");
    expect(empty).toContain("데이터가 없습니다");
    expect(empty).toContain("휴장일");
  });
});
