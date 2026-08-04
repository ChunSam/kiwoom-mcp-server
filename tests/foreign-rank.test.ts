import { describe, expect, it } from "vitest";

import {
  foreignLimitSurgeResponseSchema,
  foreignPeriodTradeResponseSchema,
} from "../src/kiwoom/types.js";
import {
  formatForeignLimitSurge,
  formatForeignPeriodTrade,
} from "../src/tools/foreign-holding.js";

/**
 * ka10036 실측 (REAL 2026-08-04 17:0x, mrkt_tp=000 dt=1 stex_tp=3).
 * 2위 KODEX 200선물인버스2X의 `trde_qty`가 **4294967295**(32비트 포화값)로 실제로 온다 —
 * 이 fixture의 존재 이유다. 코드에는 `_AL` 접미사가 붙어 온다.
 */
const surgeFixture = foreignLimitSurgeResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  for_limit_exh_rt_incrs_upper: [
    {
      rank: "1",
      stk_cd: "099140_AL",
      stk_nm: "KODEX 차이나H",
      cur_prc: "-22390",
      pred_pre_sig: "5",
      pred_pre: "-70",
      trde_qty: "2313",
      poss_stkcnt: "837548",
      gain_pos_stkcnt: "662452",
      base_limit_exh_rt: "+50.76",
      limit_exh_rt: "+55.84",
      exh_rt_incrs: "+5.07",
    },
    {
      rank: "2",
      stk_cd: "252670_AL",
      stk_nm: "KODEX 200선물인버스2X",
      cur_prc: "-93",
      pred_pre_sig: "5",
      pred_pre: "-6",
      trde_qty: "4294967295",
      poss_stkcnt: "1992565933",
      gain_pos_stkcnt: "4708734067",
      base_limit_exh_rt: "+25.09",
      limit_exh_rt: "+29.73",
      exh_rt_incrs: "+4.64",
    },
  ],
});

/**
 * ka10034 실측 (REAL 2026-08-04, mrkt_tp=000 trde_tp=1 dt=1 stex_tp=3).
 * `netprps_qty`가 `--19229312`처럼 **이중부호**로 온다 — parseKiwoomNumber가 흡수해야 한다.
 */
const periodFixture = foreignPeriodTradeResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  for_dt_trde_upper: [
    {
      rank: "1",
      stk_cd: "0193T0_AL",
      stk_nm: "KODEX SK하이닉스단일종목레버리지",
      cur_prc: "+9350",
      pred_pre_sig: "2",
      pred_pre: "+80",
      sel_bid: "+9355",
      buy_bid: "+9350",
      trde_qty: "49819280",
      netprps_qty: "--19229312",
      gain_pos_stkcnt: "327455233",
    },
    {
      rank: "2",
      stk_cd: "005930_AL",
      stk_nm: "삼성전자",
      cur_prc: "+241000",
      pred_pre_sig: "2",
      pred_pre: "+1500",
      sel_bid: "+241000",
      buy_bid: "+240500",
      trde_qty: "49478158",
      netprps_qty: "--5322679",
      gain_pos_stkcnt: "3121194857",
    },
  ],
});

describe("formatForeignLimitSurge", () => {
  const out = formatForeignLimitSurge(
    surgeFixture.for_limit_exh_rt_incrs_upper,
    "all",
    "5",
    20,
    "실전투자",
  );

  it("제목에 시장과 기간을 낸다", () => {
    expect(out).toContain("[실전투자] 외국인 한도소진율 증가 상위 — 전체 (5일 대비)");
  });

  it("코드에서 _AL 접미사를 뗀다", () => {
    expect(out).toContain("099140");
    expect(out).not.toContain("099140_AL");
  });

  // 하락 종목 현재가 "-22390"의 부호는 전일대비 방향이다.
  it("하락 종목 현재가를 음수로 렌더하지 않는다", () => {
    expect(out).toContain("22,390");
    expect(out).not.toContain("-22,390");
  });

  // 32비트 포화값을 그대로 찍으면 42.9억주라는 거짓 숫자가 나간다.
  // 각주에는 상한값이 설명으로 등장하므로 **데이터 행**만 본다.
  it("32비트 포화 거래량을 상한 표기로 바꾼다", () => {
    const dataRow = out.split("\n").find((l) => l.includes("KODEX 200선물인버스2X")) ?? "";
    expect(dataRow).toContain("상한 초과");
    expect(dataRow).not.toContain("4,294,967,295");
  });

  it("보유 계열과 투자자 매매 계열을 섞지 말라고 각주로 밝힌다", () => {
    expect(out).toContain("보유(한도) 계열");
    expect(out).toContain("get_net_buy_rank");
  });

  // 조용히 바꾸면 사용자는 다른 기간을 본 줄 모른다.
  it("지원하지 않는 기간을 대체했으면 그 사실을 알린다", () => {
    const coerced = formatForeignLimitSurge(
      surgeFixture.for_limit_exh_rt_incrs_upper,
      "kospi",
      "5",
      20,
      "실전투자",
      "60",
    );
    expect(coerced).toContain("요청한 60일은 이 순위가 지원하지 않아");
    expect(coerced).toContain("5일로 조회했습니다");
  });

  it("대체가 없으면 경고를 붙이지 않는다", () => {
    expect(out).not.toContain("지원하지 않아");
  });

  it("빈 배열은 에러가 아니라 안내로 답한다", () => {
    expect(formatForeignLimitSurge([], "kosdaq", "1", 20, "모의투자")).toContain(
      "해당 종목이 없습니다",
    );
  });
});

describe("formatForeignPeriodTrade", () => {
  const out = formatForeignPeriodTrade(
    periodFixture.for_dt_trde_upper,
    "all",
    "20",
    "net_sell",
    20,
    "실전투자",
  );

  it("방향과 기간을 제목에 낸다", () => {
    expect(out).toContain("외국인 기간별 순매도 상위 — 전체 (최근 20일 누적)");
  });

  // `--19229312`를 그대로 파싱하면 NaN이거나 양수가 된다.
  it("이중부호 순매매 수량을 음수로 읽는다", () => {
    expect(out).toContain("-19,229,312주");
    expect(out).toContain("-5,322,679주");
  });

  it("순매수 방향은 제목이 바뀐다", () => {
    const buy = formatForeignPeriodTrade(
      periodFixture.for_dt_trde_upper,
      "kospi",
      "5",
      "net_buy",
      20,
      "실전투자",
    );
    expect(buy).toContain("외국인 기간별 순매수 상위 — 코스피 (최근 5일 누적)");
  });

  it("get_foreign_holding 종목 조회와 같은 소스임을 밝힌다", () => {
    expect(out).toContain("get_foreign_holding");
    expect(out).toContain("보유(한도) 계열");
  });

  it("빈 배열은 에러가 아니라 안내로 답한다", () => {
    expect(formatForeignPeriodTrade([], "all", "1", "net_buy", 20, "모의투자")).toContain(
      "해당 종목이 없습니다",
    );
  });
});
