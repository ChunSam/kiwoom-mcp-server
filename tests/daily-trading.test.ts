import { describe, expect, it } from "vitest";

import { dailyFlowItemSchema, dailySessionItemSchema } from "../src/kiwoom/types.js";
import { formatDailyFlow, formatDailySession } from "../src/tools/daily-trading.js";

const MODE = "모의투자";

// Fixtures captured verbatim from mockapi 2026-08-03 (ka10086/ka10015, 005930,
// qry_dt/strt_dt=20260701). The same shapes were confirmed on the REAL domain the
// same day. Doubled signs ("--1855765") are exactly what the TR returns.
const flowQuantityRows = [
  {
    date: "20260701", open_pric: "+334500", high_pric: "+339000", low_pric: "-311500",
    close_pric: "-314500", flu_rt: "-5.84", trde_qty: "24968382", amt_mn: "8016068",
    crd_rt: "0.42", ind_netprps: "+5183205", orgn_netprps: "--1855765",
    for_netprps: "--4821937", prm: "--4429313",
  },
  {
    date: "20260630", open_pric: "+323500", high_pric: "+343000", low_pric: "-321000",
    close_pric: "+334000", flu_rt: "+3.41", trde_qty: "29237216", amt_mn: "9724402",
    crd_rt: "0.41", ind_netprps: "--97602", orgn_netprps: "+2731943",
    for_netprps: "--2882720", prm: "--1194479",
  },
  {
    date: "20260629", open_pric: "-331000", high_pric: "-335500", low_pric: "-316000",
    close_pric: "-323000", flu_rt: "-4.86", trde_qty: "35436521", amt_mn: "11470651",
    crd_rt: "0.40", ind_netprps: "+9127270", orgn_netprps: "+2446957",
    for_netprps: "--13487892", prm: "--8446480",
  },
].map((r) => dailyFlowItemSchema.parse(r));

// Same two days at indc_tp=1 (금액). 개인/기관/프로그램만 값이 바뀌고 for_netprps는
// 수량 모드와 **글자 그대로 동일**하다 — 이 tool의 가장 중요한 함정이다.
const flowAmountRows = [
  {
    date: "20260701", open_pric: "+334500", high_pric: "+339000", low_pric: "-311500",
    close_pric: "-314500", flu_rt: "-5.84", trde_qty: "24968382", amt_mn: "8016068",
    crd_rt: "0.42", ind_netprps: "+1652060", orgn_netprps: "--585369",
    for_netprps: "--4821937", prm: "--1419864",
  },
  {
    date: "20260630", open_pric: "+323500", high_pric: "+343000", low_pric: "-321000",
    close_pric: "+334000", flu_rt: "+3.41", trde_qty: "29237216", amt_mn: "9724402",
    crd_rt: "0.41", ind_netprps: "--38274", orgn_netprps: "+909288",
    for_netprps: "--2882720", prm: "--392058",
  },
].map((r) => dailyFlowItemSchema.parse(r));

// ka10015 rows carry nine all-blank 수급 필드 (cntr_str, for_*, orgn_netprps,
// ind_netprps, frgn, crd_remn_rt, prm) in both mock and REAL. They are kept here
// verbatim so the fixture proves the schema ignores them rather than hiding them.
const sessionRows = [
  {
    dt: "20260701", close_pric: "-314500", pred_pre_sig: "5", pred_pre: "-19500", flu_rt: "-5.84",
    trde_qty: "24968382", trde_prica: "8016068", bf_mkrt_trde_qty: "49", bf_mkrt_trde_wght: "0.00",
    opmr_trde_qty: "24696701", opmr_trde_wght: "+98.91", af_mkrt_trde_qty: "271632",
    af_mkrt_trde_wght: "+1.08", cntr_str: "", for_poss: "", for_wght: "", for_netprps: "",
    orgn_netprps: "", ind_netprps: "", frgn: "", crd_remn_rt: "", prm: "",
  },
  {
    dt: "20260630", close_pric: "+334000", pred_pre_sig: "2", pred_pre: "+11000", flu_rt: "+3.41",
    trde_qty: "29237216", trde_prica: "9724402", bf_mkrt_trde_qty: "10", bf_mkrt_trde_wght: "0.00",
    opmr_trde_qty: "28577896", opmr_trde_wght: "+97.74", af_mkrt_trde_qty: "659310",
    af_mkrt_trde_wght: "+2.25", cntr_str: "", for_poss: "", for_wght: "", for_netprps: "",
    orgn_netprps: "", ind_netprps: "", frgn: "", crd_remn_rt: "", prm: "",
  },
].map((r) => dailySessionItemSchema.parse(r));

describe("formatDailyFlow", () => {
  it("renders the 수급 table with 주 units by default", () => {
    const out = formatDailyFlow(flowQuantityRows, "005930", "quantity", 20, false, MODE);

    expect(out).toContain("[모의투자] 일별 거래·수급 — 종목 005930 (3거래일)");
    expect(out).toContain("| 개인(주) | 기관(주) | 외국인(주) | 프로그램(주) | 신용비율 |");
    expect(out).toContain("| 2026-07-01 |");
    expect(out).toContain("24,968,382주");
    expect(out).toContain("8,016,068"); // 거래대금은 백만원 단위 그대로
    expect(out).toContain("0.42%");
  });

  it("collapses Kiwoom's doubled sign into a single negative", () => {
    const out = formatDailyFlow(flowQuantityRows, "005930", "quantity", 20, false, MODE);

    expect(out).toContain("-1,855,765");
    expect(out).toContain("-4,821,937");
    // 마크다운 구분선(`|---|`)에도 하이픈이 있으니 데이터 행만 검사한다.
    const dataRows = out.split("\n").filter((line) => line.startsWith("| 2026-"));
    expect(dataRows).toHaveLength(3);
    expect(dataRows.some((line) => line.includes("--"))).toBe(false);
  });

  it("shows absolute prices and keeps the direction in 등락률", () => {
    const out = formatDailyFlow(flowQuantityRows, "005930", "quantity", 20, false, MODE);

    expect(out).toContain("314,500원");
    expect(out).toContain("-5.84%");
    expect(out).toContain("+3.41%");
    expect(out).not.toContain("-314,500원");
  });

  it("totals the period net-buy per investor group", () => {
    const out = formatDailyFlow(flowQuantityRows, "005930", "quantity", 20, false, MODE);

    // 5,183,205 − 97,602 + 9,127,270 = 14,212,873 / −1,855,765 + 2,731,943 + 2,446,957
    expect(out).toContain("개인 +14,212,873주");
    expect(out).toContain("기관 +3,323,135주");
    expect(out).toContain("외국인 -21,192,549주");
  });

  // 금액 모드에서도 외국인 열만 수량으로 남는 건 거래소가 금액을 안 주기 때문이고
  // (키움 스펙 주의사항), mock·REAL 양쪽에서 값이 글자 그대로 같은 걸 확인했다.
  it("labels 개인/기관/프로그램 as 백만원 in amount mode but keeps 외국인 in 주", () => {
    const out = formatDailyFlow(flowAmountRows, "005930", "amount", 20, false, MODE);

    expect(out).toContain("| 개인(백만원) | 기관(백만원) | 외국인(주) | 프로그램(백만원) | 신용비율 |");
    expect(out).toContain("외국인 -7,704,657주");
    expect(out).toContain("항상 수량(주)");
  });

  it("keeps the 외국인 column identical across both units", () => {
    const quantity = formatDailyFlow(flowQuantityRows.slice(0, 2), "005930", "quantity", 20, false, MODE);
    const amount = formatDailyFlow(flowAmountRows, "005930", "amount", 20, false, MODE);

    for (const value of ["-4,821,937", "-2,882,720"]) {
      expect(quantity).toContain(value);
      expect(amount).toContain(value);
    }
    // 반대로 개인 열은 단위에 따라 달라져야 한다.
    expect(quantity).toContain("+5,183,205");
    expect(amount).toContain("+1,652,060");
  });

  it("caps the table at count and says how many rows were held back", () => {
    const out = formatDailyFlow(flowQuantityRows, "005930", "quantity", 2, false, MODE);

    expect(out).toContain("(2거래일)");
    expect(out).toContain("조회된 3행 중 최근 2행만 표시했습니다");
    expect(out).not.toContain("2026-06-29");
  });

  it("warns when pagination stopped before the requested window was filled", () => {
    const out = formatDailyFlow(flowQuantityRows, "005930", "quantity", 20, true, MODE);

    expect(out).toContain("결과가 잘렸을 수 있습니다");
  });

  it("returns a plain notice when the TR returns no rows", () => {
    const out = formatDailyFlow([], "999999", "quantity", 20, false, MODE);

    expect(out).toContain("일별 수급 내역이 없습니다");
    expect(out).toContain("999999");
    expect(out).not.toContain("|");
  });
});

describe("formatDailySession", () => {
  it("renders the 장전/장중/장후 distribution table", () => {
    const out = formatDailySession(sessionRows, "005930", 20, MODE);

    expect(out).toContain("[모의투자] 일별 장전/장중/장후 거래 분포 — 종목 005930 (2거래일)");
    expect(out).toContain("| 장전비중 | 장중비중 | 장후비중 | 장후거래량 |");
    expect(out).toContain("| 2026-07-01 |");
    expect(out).toContain("271,632주");
  });

  // 비중의 +는 방향이 아니라 키움의 표기 습관이라 그대로 두면 "+98.91%"로 찍힌다.
  it("drops the cosmetic + prefix from the 비중 columns", () => {
    const out = formatDailySession(sessionRows, "005930", 20, MODE);

    expect(out).toContain("98.91%");
    expect(out).toContain("1.08%");
    expect(out).not.toContain("+98.91%");
  });

  it("shows absolute prices like the flow view", () => {
    const out = formatDailySession(sessionRows, "005930", 20, MODE);

    expect(out).toContain("314,500원");
    expect(out).not.toContain("-314,500원");
  });

  // 이 안내가 없으면 "체결강도 컬럼이 왜 없지?"가 반복 질문이 된다.
  it("explains why the blank 수급 columns of ka10015 are not rendered", () => {
    const out = formatDailySession(sessionRows, "005930", 20, MODE);

    expect(out).toContain("빈 값으로 주므로 표에서 제외");
    expect(out).toContain("view=flow");
  });

  it("returns a plain notice when the TR returns no rows", () => {
    const out = formatDailySession([], "999999", 20, MODE);

    expect(out).toContain("일별 거래 상세가 없습니다");
    expect(out).not.toContain("|");
  });
});
