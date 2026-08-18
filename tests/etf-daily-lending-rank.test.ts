import { describe, expect, it, vi } from "vitest";

// 전날로 물러설 때 레이트리밋 간격(1.1초)을 실제로 태우지 않는다
vi.mock("../src/utils/sleep.js", () => ({ sleep: vi.fn(() => Promise.resolve()) }));

import { fetchLendingBalanceRank } from "../src/kiwoom/api.js";
import type { KiwoomClient } from "../src/kiwoom/client.js";
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

  it("상한을 알리되 '조회되지 않는다'고 하지 않는다", () => {
    // ka90012는 cont-yn=Y다 — 51위 아래는 못 받는 게 아니라 안 받는 것이라,
    // "제공되지 않는다"고 적으면 API 사실과 어긋난다.
    const text = formatLendingBalanceRank(rows, "20260807", 2, true, MODE);
    expect(text).toContain("첫 50종목만 받아 옵니다");
    expect(text).not.toContain("조회되지 않습니다");
    expect(text).toContain("상위 2종목");
  });

  it("사용자가 top으로 줄인 것만으로는 상한 각주를 띄우지 않는다", () => {
    // 기본 호출이 top 20 · 50행 응답이라, 조건에 rows.length > shown.length가 있으면
    // 잘린 게 없는데도 매 호출마다 각주가 떴다.
    const text = formatLendingBalanceRank(rows, "20260807", 2, false, MODE);
    expect(text).toContain("상위 2종목");
    // 새 문구만 막으면 옛 문구("상위 50종목까지만 제공됩니다")가 뜨는 상태를 통과시킨다 —
    // 문구가 아니라 "상한 각주가 아예 없을 것"을 검사한다.
    expect(text).not.toContain("50종목");
  });

  it("무시되는 stock_code·from_date를 조용히 버리지 않는다", () => {
    const text = formatLendingBalanceRank(rows, "20260807", 20, false, MODE, {
      stockCode: "005930",
      fromDate: "20260701",
    });
    expect(text).toContain("요청하신 종목코드(005930)는 적용되지 않았습니다");
    expect(text).toContain("view=trend");
    expect(text).toContain("요청하신 조회 시작일(2026-07-01)은 적용되지 않았습니다");
  });

  it("빈 결과에서도 종목코드가 무시됐음을 알린다", () => {
    // 종목을 지정해 부른 사용자가 "휴장일일 수 있다"만 보면 무시된 걸 끝내 모른다
    const text = formatLendingBalanceRank([], "20260101", 20, false, MODE, { stockCode: "005930" });
    expect(text).toContain("데이터가 없습니다");
    expect(text).toContain("요청하신 종목코드(005930)는 적용되지 않았습니다");
  });

  it("빈 결과는 에러가 아니라 안내다", () => {
    const text = formatLendingBalanceRank([], "20260101", 20, false, MODE);
    expect(text).toContain("데이터가 없습니다");
  });

  /**
   * 원인을 휴장일부터 대면 안 된다 — 훨씬 흔한 원인은 당일 미집계다.
   * 2026-08-14(금, 거래일)에 8/14는 rc=0에 0행, 8/13은 50행이었다.
   */
  it("빈 결과의 원인을 당일 미집계부터 댄다", () => {
    const text = formatLendingBalanceRank([], "20260814", 20, false, MODE);
    expect(text).toContain("당일 집계를 장중에 주지 않아");
    expect(text).toContain("to_date");
    expect(text).not.toMatch(/데이터가 없습니다 \(기준일이 휴장일/);
  });

  it("기준일이 전 거래일로 물러섰으면 밝힌다", () => {
    const text = formatLendingBalanceRank(rows, "20260813", 20, false, MODE, { fellBackFrom: "20260814" });
    expect(text).toContain("요청일(2026-08-14)은 아직 집계 전이라");
    expect(text).toContain("전 거래일(2026-08-13) 기준");
  });

  /**
   * 후퇴 예산을 다 쓰고도 빈손이면 "전 거래일 기준으로 보여 드립니다"는 **보여 준 게 없으므로
   * 거짓**이고, 마지막 시도일 하루만 비어 있는 것처럼 읽힌다. 훑은 범위를 밝혀야 한다.
   * (2026-08-18 스윕에서 8/17 대체공휴일 때문에 실제로 이 경로가 나갔다.)
   */
  it("후퇴하고도 빈손이면 '보여 드립니다'가 아니라 훑은 범위를 밝힌다", () => {
    const text = formatLendingBalanceRank([], "20260815", 20, false, MODE, { fellBackFrom: "20260818" });
    expect(text).toContain("요청일(2026-08-18)부터 2026-08-15까지");
    expect(text).toContain("하루씩 물러서며 찾았지만 행이 없습니다");
    // 두 문구의 공통 조각으로 막는다 — 새 문구만 부정하면 옛 문구가 되살아나도 초록이다.
    expect(text).not.toContain("기준으로 보여 드립니다");
  });
});

/**
 * ka90012는 **당일 집계를 장중에 주지 않는다**(2026-08-14 거래일 실측: 8/14 0행 · 8/13 50행).
 * 기본 기준일이 오늘이라, 물러서지 않으면 날짜를 지정하지 않은 호출이 장중 내내 빈손이었다.
 */
describe("fetchLendingBalanceRank 기준일 후퇴", () => {
  function clientReturning(rowsByDate: Record<string, unknown[]>) {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      call: vi.fn(async (req: { body: Record<string, unknown> }) => {
        calls.push(req.body);
        return {
          json: { return_code: 0, dbrt_trde_prps: rowsByDate[String(req.body.dt)] ?? [] },
          hasNext: false,
        };
      }),
    } as unknown as KiwoomClient;
    return { client, calls };
  }

  const row = { stk_nm: "삼성전자", stk_cd: "005930", dbrt_trde_cntrcnt: "1", dbrt_trde_rpy: "1", rmnd: "86340378", remn_amt: "1" };

  it("당일이 비면 전날로 한 번 물러서고 그 날짜를 돌려준다", async () => {
    const { client, calls } = clientReturning({ "20260813": [row] });
    const res = await fetchLendingBalanceRank(client, "20260814", true);
    expect(calls).toHaveLength(2);
    expect(res.items).toHaveLength(1);
    // 물러선 날짜를 **글자로** 못 박는다. 예전엔 `not.toBe("20260814")` + `dt: res.baseDate`라
    // 구현이 무슨 날짜를 부르든 통과했고, 실제로 오늘이 기준이라 2026-08-15에 깨졌다.
    expect(res.baseDate).toBe("20260813");
    // 요청 body는 포맷터 테스트가 원리상 못 잡는다 — 두 호출 다 직접 단언한다.
    // mrkt_tp는 효과가 없어도 필수라, 빠지면 rc=2가 된다.
    expect(calls[0]).toEqual({ dt: "20260814", mrkt_tp: "0" });
    expect(calls[1]).toEqual({ dt: "20260813", mrkt_tp: "0" });
  });

  it("사용자가 날짜를 지정했으면 물러서지 않는다", async () => {
    const { client, calls } = clientReturning({ "20260813": [row] });
    const res = await fetchLendingBalanceRank(client, "20260814", false);
    expect(calls).toHaveLength(1);
    expect(res.items).toHaveLength(0);
    expect(res.baseDate).toBe("20260814");
  });

  it("당일에 행이 있으면 추가 호출을 하지 않는다", async () => {
    const { client, calls } = clientReturning({ "20260814": [row] });
    const res = await fetchLendingBalanceRank(client, "20260814", true);
    expect(calls).toHaveLength(1);
    expect(res.baseDate).toBe("20260814");
  });

  /**
   * 한 칸만 물러서던 시절엔 **월요일과 연휴 다음 날 장중이 항상 빈손**이었다.
   * 2026-08-18(화)의 전날 8/17은 대체공휴일(8/15 광복절이 토요일) — 8/16 일·8/15 토를 지나
   * 8/14 금에야 행이 있다. 스윕에서 실제로 0행이 나갔다.
   */
  it("연휴를 넘어 직전 거래일까지 물러선다", async () => {
    const { client, calls } = clientReturning({ "20260814": [row] });
    const res = await fetchLendingBalanceRank(client, "20260818", true);
    expect(res.items).toHaveLength(1);
    expect(res.baseDate).toBe("20260814");
    // 부른 날짜를 **글자로** 못 박는다 — 개수만 세면 어떤 날짜를 불러도 통과한다.
    expect(calls.map((b) => b.dt)).toEqual(["20260818", "20260817", "20260816", "20260815", "20260814"]);
  });

  it("예산(5칸)을 다 쓰고도 비면 마지막 시도일을 돌려준다", async () => {
    const { client, calls } = clientReturning({});
    const res = await fetchLendingBalanceRank(client, "20260818", true);
    expect(res.items).toHaveLength(0);
    // 요청일 + 5칸 = 6콜에서 멈춘다. 무한히 물러서면 레이트리밋을 밀어붙인다.
    expect(calls.map((b) => b.dt)).toEqual([
      "20260818",
      "20260817",
      "20260816",
      "20260815",
      "20260814",
      "20260813",
    ]);
    // 포맷터가 "요청일부터 여기까지 훑었다"를 쓰려면 착지한 날짜가 필요하다.
    expect(res.baseDate).toBe("20260813");
  });
});
