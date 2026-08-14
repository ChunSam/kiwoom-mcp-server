import { describe, expect, it } from "vitest";

import { programArbitrageBalanceItemSchema, stockProgramIntradayItemSchema } from "../src/kiwoom/types.js";
import { formatProgramArbitrageBalance, formatStockProgramIntraday } from "../src/tools/program-trading.js";

const MODE = "실전투자";

// ── ka90008 종목시간별프로그램매매추이 — REAL 실측 그대로 (2026-08-09, 최근 거래일 20260807) ──
// 통합(_AL) 응답이라 시간외까지 와서 tm이 19시대다. 값은 당일 누적.
describe("formatStockProgramIntraday", () => {
  // 005930(삼성전자): 최근 거래일 200행이 **전부 순매도**였다.
  const negativeRows = [
    {
      tm: "195959",
      cur_prc: "+235000",
      pre_sig: "2",
      pred_pre: "+4500",
      flu_rt: "+1.95",
      trde_qty: "34134724",
      prm_sell_amt: "2134888",
      prm_buy_amt: "2070379",
      prm_netprps_amt: "--64509", // 이중부호 — parseKiwoomNumber가 흡수한다
      prm_netprps_amt_irds: "0",
      prm_sell_qty: "9175980",
      prm_buy_qty: "8867152",
      prm_netprps_qty: "--308828",
      prm_netprps_qty_irds: "0",
      base_pric_tm: "",
      dbrt_trde_rpy_sum: "",
      remn_rcvord_sum: "",
      stex_tp: "통합",
    },
    {
      tm: "195953",
      cur_prc: "+234500",
      pre_sig: "2",
      pred_pre: "+4000",
      flu_rt: "+1.74",
      trde_qty: "34131080",
      prm_sell_amt: "2134888",
      prm_buy_amt: "2070379",
      prm_netprps_amt: "--64509",
      prm_netprps_amt_irds: "--210",
      prm_sell_qty: "9175980",
      prm_buy_qty: "8867152",
      prm_netprps_qty: "--308828",
      prm_netprps_qty_irds: "--893",
      base_pric_tm: "",
      dbrt_trde_rpy_sum: "",
      remn_rcvord_sum: "",
      stex_tp: "통합",
    },
  ].map((r) => stockProgramIntradayItemSchema.parse(r));

  // 000270(기아): 같은 날 같은 TR인데 200행이 **전부 순매수**다. 부호로 갈리는 표라
  // 한쪽 방향만 넣으면 반대 방향이 계속 초록으로 남는다 (v0.47.2 각주 사고와 같은 자리).
  const positiveRows = [
    {
      tm: "185159",
      cur_prc: "+134900",
      pre_sig: "2",
      pred_pre: "+1300",
      flu_rt: "+0.97",
      trde_qty: "994856",
      prm_sell_amt: "52484",
      prm_buy_amt: "69403",
      prm_netprps_amt: "+16919",
      prm_netprps_amt_irds: "+40",
      prm_sell_qty: "391576",
      prm_buy_qty: "517610",
      prm_netprps_qty: "+126034",
      prm_netprps_qty_irds: "+300",
      base_pric_tm: "",
      dbrt_trde_rpy_sum: "",
      remn_rcvord_sum: "",
      stex_tp: "통합",
    },
    {
      tm: "195601",
      cur_prc: "+134500",
      pre_sig: "2",
      pred_pre: "+900",
      flu_rt: "+0.67",
      trde_qty: "998694",
      prm_sell_amt: "52550",
      prm_buy_amt: "69403",
      prm_netprps_amt: "+16853",
      prm_netprps_amt_irds: "--44", // 순매수인데 증감은 음수 — 두 축이 따로 논다
      prm_sell_qty: "392069",
      prm_buy_qty: "517610",
      prm_netprps_qty: "+125541",
      prm_netprps_qty_irds: "--330",
      base_pric_tm: "",
      dbrt_trde_rpy_sum: "",
      remn_rcvord_sum: "",
      stex_tp: "통합",
    },
  ].map((r) => stockProgramIntradayItemSchema.parse(r));

  it("순매도 방향은 음수로 렌더한다 (초 단위 시각 유지)", () => {
    const text = formatStockProgramIntraday(negativeRows, "005930", undefined, 20, false, MODE);
    expect(text).toContain("[실전투자]");
    expect(text).toContain("19:59:59"); // 초를 버리면 195959/195953이 한 행으로 뭉갠다
    expect(text).toContain("19:59:53");
    expect(text).toContain("-64,509");
    expect(text).toContain("-308,828");
    expect(text).not.toContain("+64,509");
    expect(text).toContain("최근 거래일");
  });

  it("순매수 방향은 +로 렌더하고, 순매수가 +여도 증감은 -로 간다", () => {
    const text = formatStockProgramIntraday(positiveRows, "000270", undefined, 20, false, MODE);
    expect(text).toContain("+16,919");
    expect(text).toContain("+126,034");
    // 같은 행에서 순매수 +16,853 / 증감 -44 — 부호가 축마다 따로 결정된다
    expect(text).toContain("+16,853");
    expect(text).toContain("-44");
  });

  it("현재가는 절대값으로 — 하락 종목에서 음수 가격이 나오면 안 된다", () => {
    const falling = stockProgramIntradayItemSchema.parse({
      // 000660(SK하이닉스) 같은 날 실측 — cur_prc의 "-"는 값의 부호가 아니라 전일대비 방향
      tm: "195812",
      cur_prc: "-1467000",
      pre_sig: "5",
      pred_pre: "-28000",
      flu_rt: "-1.87",
      trde_qty: "8775710",
      prm_sell_amt: "3396295",
      prm_buy_amt: "3207369",
      prm_netprps_amt: "--188926",
      prm_netprps_amt_irds: "0",
      prm_sell_qty: "2350878",
      prm_buy_qty: "2210790",
      prm_netprps_qty: "--140088",
      prm_netprps_qty_irds: "0",
      base_pric_tm: "",
      dbrt_trde_rpy_sum: "",
      remn_rcvord_sum: "",
      stex_tp: "통합",
    });
    const text = formatStockProgramIntraday([falling], "000660", undefined, 20, false, MODE);
    expect(text).toContain("1,467,000");
    expect(text).not.toContain("-1,467,000");
    expect(text).toContain("-1.87%");
  });

  it("base_date를 주면 무시했다고 밝힌다", () => {
    // ka90008은 date를 필수로 받고도 무시한다 — 조용히 버리면 사용자는 그 날짜 데이터로 읽는다
    const text = formatStockProgramIntraday(negativeRows, "005930", "20260805", 20, false, MODE);
    expect(text).toContain("2026-08-05");
    expect(text).toContain("적용되지 않았습니다");
    expect(text).toContain("view=stock_daily");
  });

  it("잘림은 '이른 시각이 빠졌다'로 알린다", () => {
    const text = formatStockProgramIntraday(negativeRows, "005930", undefined, 1, true, MODE);
    expect(text).toContain("최신 구간만");
    expect(text).toContain("최근 1행");
  });

  it("빈 결과는 에러가 아니라 안내다", () => {
    const text = formatStockProgramIntraday([], "999999", undefined, 20, false, MODE);
    expect(text).toContain("데이터가 없습니다");
  });

  /**
   * 이 view는 date를 아예 보내지 않으므로(fetch가 todayInKst를 고정) 기준일을 바꿔 재시도해도
   * 결과가 달라질 수 없다. "기준일을 확인해 주세요"는 사용자를 성과 없는 재시도로 보낸다.
   */
  it("빈 결과 힌트가 무시되는 기준일을 가리키지 않는다", () => {
    const text = formatStockProgramIntraday([], "999999", "20260805", 20, false, MODE);
    expect(text).not.toContain("종목코드 또는 기준일을 확인");
    expect(text).toContain("기준일을 고를 수 없어");
    expect(text).toContain("view=stock_daily");
  });
});

// ── ka90006 프로그램매매차익잔고추이 — REAL 실측 그대로 (2026-08-09, date=20260807) ──
describe("formatProgramArbitrageBalance", () => {
  const rows = [
    // 매수·매도 증감이 둘 다 음수인 날
    {
      dt: "20260807",
      buy_dfrt_trde_qty: "2735",
      buy_dfrt_trde_amt: "488644",
      buy_dfrt_trde_irds_amt: "-107958",
      sel_dfrt_trde_qty: "1750",
      sel_dfrt_trde_amt: "304169",
      sel_dfrt_trde_irds_amt: "-125899",
    },
    // 둘 다 양수인 날
    {
      dt: "20260806",
      buy_dfrt_trde_qty: "3422",
      buy_dfrt_trde_amt: "596602",
      buy_dfrt_trde_irds_amt: "38238",
      sel_dfrt_trde_qty: "2431",
      sel_dfrt_trde_amt: "430068",
      sel_dfrt_trde_irds_amt: "4632",
    },
    // 매수는 +인데 매도는 - — 한 행에서 두 축의 부호가 갈린다
    {
      dt: "20260805",
      buy_dfrt_trde_qty: "2952",
      buy_dfrt_trde_amt: "558364",
      buy_dfrt_trde_irds_amt: "219975",
      sel_dfrt_trde_qty: "2380",
      sel_dfrt_trde_amt: "425435",
      sel_dfrt_trde_irds_amt: "-234574",
    },
  ].map((r) => programArbitrageBalanceItemSchema.parse(r));

  it("잔고는 무부호로, 증감만 부호를 붙인다", () => {
    const text = formatProgramArbitrageBalance(rows, "20260807", 20, false, MODE);
    expect(text).toContain("2026-08-07");
    expect(text).toContain("488,644"); // 잔고 — +를 붙이면 증감처럼 읽힌다
    expect(text).not.toContain("+488,644");
    expect(text).toContain("-107,958");
    expect(text).toContain("+38,238");
  });

  it("같은 행에서 매수 증감 +와 매도 증감 -가 함께 나온다", () => {
    const text = formatProgramArbitrageBalance(rows, "20260807", 20, false, MODE);
    const row = text.split("\n").find((l) => l.startsWith("| 2026-08-05"));
    expect(row).toBeDefined();
    expect(row).toContain("+219,975");
    expect(row).toContain("-234,574");
  });

  it("매매가 아니라 잔고임을 각주로 밝히고 단위를 적는다", () => {
    const text = formatProgramArbitrageBalance(rows, "20260807", 20, false, MODE);
    expect(text).toContain("잔고");
    expect(text).toContain("천주");
    expect(text).toContain("백만원");
    // mrkt_tp가 안 듣는 TR이라 market 인자가 안 먹는다는 걸 밝혀야 한다
    expect(text).toContain("market 인자는 이 view에 적용되지 않습니다");
  });

  it("빈 결과는 에러가 아니라 안내다", () => {
    const text = formatProgramArbitrageBalance([], "20260101", 20, false, MODE);
    expect(text).toContain("데이터가 없습니다");
  });
});
