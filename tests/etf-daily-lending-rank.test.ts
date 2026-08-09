import { describe, expect, it } from "vitest";

import { etfDailyTrendItemSchema, etfInvestorFlowItemSchema, lendingBalanceRankItemSchema } from "../src/kiwoom/types.js";
import { formatEtfDailyTrend, formatEtfInvestorFlow } from "../src/tools/etf-returns.js";
import { formatLendingBalanceRank } from "../src/tools/stock-lending.js";

const MODE = "실전투자";

// ── ka40003 ETF일별추이 — REAL 실측 그대로 (2026-08-09, 069500 KODEX 200) ──
describe("formatEtfDailyTrend", () => {
  const rows = [
    // 하락일 — cur_prc·nav의 "-"는 값의 부호가 아니라 전일대비 방향이다
    {
      cntr_dt: "20260807",
      cur_prc: "-98090",
      pre_sig: "5",
      pred_pre: "-810",
      pre_rt: "-0.82",
      trde_qty: "14130664",
      nav: "-97931.97",
      acc_trde_prica: "1389032",
      navidex_dispty_rt: "+0.47",
      navetfdispty_rt: "+0.16",
      trace_eor_rt: "39",
      trace_cur_prc: "-97473",
      trace_pred_pre: "-819",
      trace_pre_sig: "5",
    },
    // 상승일 + **ETF 괴리율이 음수**인 날 — 괴리율은 부호가 곧 값의 부호다
    {
      cntr_dt: "20260805",
      cur_prc: "+104300",
      pre_sig: "2",
      pred_pre: "+3970",
      pre_rt: "+3.96",
      trde_qty: "18191398",
      nav: "+104335.70",
      acc_trde_prica: "1905066",
      navidex_dispty_rt: "+0.46",
      navetfdispty_rt: "-0.03",
      trace_eor_rt: "39",
      trace_cur_prc: "+103859",
      trace_pred_pre: "+3856",
      trace_pre_sig: "2",
    },
  ].map((r) => etfDailyTrendItemSchema.parse(r));

  it("하락일에도 종가·NAV가 양수로 렌더된다", () => {
    const text = formatEtfDailyTrend(rows, "KODEX 200", "069500", 20, MODE);
    expect(text).toContain("98,090");
    expect(text).not.toContain("-98,090");
    expect(text).toContain("97,931.97");
    expect(text).not.toContain("-97,931.97");
    // 등락률은 반대로 부호가 값의 부호다
    expect(text).toContain("-0.82%");
  });

  it("괴리율은 부호를 유지한다 — 음수 괴리율이 +로 뒤집히면 안 된다", () => {
    const text = formatEtfDailyTrend(rows, "KODEX 200", "069500", 20, MODE);
    expect(text).toContain("-0.03");
    expect(text).toContain("+0.46");
    expect(text).toContain("+0.47");
  });

  it("추적오차율은 ×100 정수라 100으로 나눠 찍는다", () => {
    // 069500의 "39"는 0.39% — 같은 날 ka40006이 trace "0.39"를 준다(371460 "246"↔"2.46"으로도 확인).
    // 그대로 찍으면 추적오차율이 100배가 된다.
    const text = formatEtfDailyTrend(rows, "KODEX 200", "069500", 20, MODE);
    expect(text).toContain("0.39");
    expect(text).not.toMatch(/\|\s39\s\|/);
  });

  it("괴리율 두 종류의 뜻을 각주로 구분한다", () => {
    const text = formatEtfDailyTrend(rows, "KODEX 200", "069500", 20, MODE);
    expect(text).toContain("지수 괴리율");
    expect(text).toContain("ETF 괴리율");
    expect(text).toContain("추적오차율");
  });

  it("days로 자른다", () => {
    const text = formatEtfDailyTrend(rows, "KODEX 200", "069500", 1, MODE);
    expect(text).toContain("최근 1일");
    expect(text).not.toContain("2026-08-05");
  });

  it("빈 결과는 에러가 아니라 안내다", () => {
    const text = formatEtfDailyTrend([], null, "069500", 20, MODE);
    expect(text).toContain("데이터가 없습니다");
  });
});

// ── ka40008 ETF일자별순매수 — REAL 실측 그대로 (2026-08-09, 069500) ──
describe("formatEtfInvestorFlow", () => {
  const rows = [
    // 외국인 +, 기관 − (이중부호 "--78762"가 실제로 온다)
    {
      dt: "20260807",
      cur_prc_n: "-98090",
      pre_sig_n: "5",
      pred_pre_n: "-810",
      acc_trde_qty: "14130664",
      for_netprps_qty: "+24897",
      orgn_netprps_qty: "--78762",
    },
    // 둘 다 −
    {
      dt: "20260806",
      cur_prc_n: "-98900",
      pre_sig_n: "5",
      pred_pre_n: "-5400",
      acc_trde_qty: "14845527",
      for_netprps_qty: "--5630",
      orgn_netprps_qty: "--1708100",
    },
    // 외국인 −, 기관 + — 한 행에서 두 주체의 부호가 갈린다
    {
      dt: "20260805",
      cur_prc_n: "+104300",
      pre_sig_n: "2",
      pred_pre_n: "+3970",
      acc_trde_qty: "18191398",
      for_netprps_qty: "--68313",
      orgn_netprps_qty: "+451555",
    },
  ].map((r) => etfInvestorFlowItemSchema.parse(r));

  it("이중부호를 흡수하고 방향을 유지한다", () => {
    const text = formatEtfInvestorFlow(rows, "KODEX 200", "069500", 20, MODE);
    expect(text).toContain("+24,897");
    expect(text).toContain("-78,762"); // "--78762" → -78,762
    expect(text).not.toContain("--78,762");
    expect(text).toContain("-1,708,100");
  });

  it("같은 행에서 외국인 −와 기관 +가 함께 나온다", () => {
    const text = formatEtfInvestorFlow(rows, "KODEX 200", "069500", 20, MODE);
    const row = text.split("\n").find((l) => l.startsWith("| 2026-08-05"));
    expect(row).toBeDefined();
    expect(row).toContain("-68,313");
    expect(row).toContain("+451,555");
  });

  it("종가는 하락일에도 절대값이다", () => {
    const text = formatEtfInvestorFlow(rows, "KODEX 200", "069500", 20, MODE);
    expect(text).toContain("98,090");
    expect(text).not.toContain("| -98,090");
  });

  it("기간 합계가 필요하면 period로 안내한다", () => {
    const text = formatEtfInvestorFlow(rows, "KODEX 200", "069500", 20, MODE);
    expect(text).toContain("view=period");
  });
});

// ── ka90012 대차거래잔고상위 — REAL 실측 그대로 (2026-08-09, dt=20260807) ──
describe("formatLendingBalanceRank", () => {
  const rows = [
    { stk_nm: "삼성전자", stk_cd: "005930", dbrt_trde_cntrcnt: "3320820", dbrt_trde_rpy: "738944", rmnd: "90385395", remn_amt: "20879026" },
    // 2위는 잔고 주수는 크지만 **잔고금액은 1위보다 훨씬 작다** — 정렬 기준이 금액이 아님을 보여주는 행
    { stk_nm: "LG디스플레이", stk_cd: "034220", dbrt_trde_cntrcnt: "92394", dbrt_trde_rpy: "209807", rmnd: "65557921", remn_amt: "640501" },
    { stk_nm: "삼성중공업", stk_cd: "010140", dbrt_trde_cntrcnt: "154740", dbrt_trde_rpy: "41214", rmnd: "41566600", remn_amt: "916544" },
  ].map((r) => lendingBalanceRankItemSchema.parse(r));

  it("순위와 잔고를 렌더한다", () => {
    const text = formatLendingBalanceRank(rows, "20260807", 20, false, MODE);
    expect(text).toContain("[실전투자]");
    expect(text).toContain("2026-08-07");
    expect(text).toContain("| 1 | 삼성전자 | 005930 | 90,385,395 | 20,879,026 |");
    expect(text).toContain("| 2 | LG디스플레이");
  });

  it("정렬 기준이 잔고 주수임을 각주로 못박는다", () => {
    // 2위의 잔고금액(640,501)이 3위(916,544)보다 작다 — 금액 순으로 읽으면 틀린다
    const text = formatLendingBalanceRank(rows, "20260807", 20, false, MODE);
    expect(text).toContain("대차잔고(주) 내림차순");
    expect(text).toContain("잔고금액이나 체결 주수 순이 아닙니다");
  });

  it("공매도 대기 물량으로 단정하지 않도록 경고한다", () => {
    const text = formatLendingBalanceRank(rows, "20260807", 20, false, MODE);
    expect(text).toContain("차익거래·헤지");
  });

  it("상한을 알린다", () => {
    const text = formatLendingBalanceRank(rows, "20260807", 2, true, MODE);
    expect(text).toContain("상위 50종목까지만");
    expect(text).toContain("상위 2종목");
  });

  it("빈 결과는 에러가 아니라 안내다", () => {
    const text = formatLendingBalanceRank([], "20260101", 20, false, MODE);
    expect(text).toContain("데이터가 없습니다");
  });
});
