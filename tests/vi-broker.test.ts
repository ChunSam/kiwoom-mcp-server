import { describe, expect, it } from "vitest";

import { brokerActivityResponseSchema, viStockItemSchema } from "../src/kiwoom/types.js";
import { formatBrokerActivity } from "../src/tools/broker-activity.js";
import { formatViStocks } from "../src/tools/vi-stocks.js";

const MODE = "모의투자";

// ── ka10054 VI발동종목 — verbatim from the mock probe (2026-07-10) ──
describe("formatViStocks", () => {
  const rows = [
    {
      stk_cd: "006200",
      stk_nm: "한국전자홀딩스",
      acc_trde_qty: "22092",
      motn_pric: "2525",
      dynm_dispty_rt: "0.00",
      trde_cntr_proc_time: "133301",
      virelis_time: "000000",
      viaplc_tp: "정적",
      dynm_stdpc: "0",
      static_stdpc: "2295",
      static_dispty_rt: "+10.02",
      open_pric_pre_flu_rt: "+10.02",
      vimotn_cnt: "1",
      stex_tp: "KRX",
    },
    {
      stk_cd: "000950",
      stk_nm: "전방",
      acc_trde_qty: "3971",
      motn_pric: "28300",
      dynm_dispty_rt: "0.00",
      trde_cntr_proc_time: "132810",
      virelis_time: "133028",
      viaplc_tp: "정적",
      dynm_stdpc: "0",
      static_stdpc: "25700",
      static_dispty_rt: "+10.12",
      open_pric_pre_flu_rt: "+10.12",
      vimotn_cnt: "2",
      stex_tp: "KRX",
    },
  ].map((r) => viStockItemSchema.parse(r));

  // Synthetic (no 동적 row observed on mock yet): covers the 괴리율-picker branch.
  const dynamicRow = viStockItemSchema.parse({
    stk_cd: "900100",
    stk_nm: "샘플종목",
    acc_trde_qty: "1000",
    motn_pric: "10000",
    dynm_dispty_rt: "-3.21",
    trde_cntr_proc_time: "101500",
    virelis_time: "101702",
    viaplc_tp: "동적",
    dynm_stdpc: "10330",
    static_stdpc: "0",
    static_dispty_rt: "0.00",
    open_pric_pre_flu_rt: "-2.90",
    vimotn_cnt: "1",
  });

  it("renders 정적 rows with the static 괴리율 and '-' for an unreleased VI", () => {
    const text = formatViStocks(rows, "all", "all", "all", undefined, 20, MODE);
    expect(text).toContain("전체 VI 발동 종목 (2건)");
    expect(text).toContain("| 한국전자홀딩스 | 006200 | 정적 | 2,525 | +10.02% | +10.02% | 13:33:01 | - | 1 |");
    expect(text).toContain("| 전방 | 000950 | 정적 | 28,300 | +10.12% | +10.12% | 13:28:10 | 13:30:28 | 2 |");
    expect(text).toContain("변동성완화장치");
  });

  it("picks the dynamic 괴리율 for a 동적 row and shows filter qualifiers in the title", () => {
    const text = formatViStocks([dynamicRow], "kospi", "up", "dynamic", undefined, 20, MODE);
    expect(text).toContain("코스피 상승 동적 VI 발동 종목 (1건)");
    expect(text).toContain("| 샘플종목 | 900100 | 동적 | 10,000 | -3.21% | -2.90% | 10:15:00 | 10:17:02 | 1 |");
  });

  it("reports an empty result with the stock scope", () => {
    const text = formatViStocks([], "all", "all", "all", "005930", 20, MODE);
    expect(text).toContain("종목 005930 VI 발동 내역이 없습니다");
  });
});

// ── ka10002 주식거래원 — verbatim from the mock probe (2026-07-10, 005930) ──
describe("formatBrokerActivity", () => {
  const data = brokerActivityResponseSchema.parse({
    stk_cd: "005930",
    stk_nm: "삼성전자",
    cur_prc: "+296000",
    flu_smbol: "2",
    base_pric: "278000",
    pred_pre: "+18000",
    flu_rt: "+6.47",
    sel_trde_ori_nm_1: "삼  성",
    sel_trde_qty_1: "-1725746",
    buy_trde_ori_nm_1: "KB증권",
    buy_trde_qty_1: "+1323258",
    sel_trde_ori_nm_2: "키움증권",
    sel_trde_qty_2: "-1317620",
    buy_trde_ori_nm_2: "BNK증권",
    buy_trde_qty_2: "+1278441",
    sel_trde_ori_nm_3: "BNK증권",
    sel_trde_qty_3: "-1219839",
    buy_trde_ori_nm_3: "JP모간서울",
    buy_trde_qty_3: "+1139224",
    sel_trde_ori_nm_4: "KB증권",
    sel_trde_qty_4: "-1105920",
    buy_trde_ori_nm_4: "삼  성",
    buy_trde_qty_4: "+925386",
    sel_trde_ori_nm_5: "JP모간서울",
    sel_trde_qty_5: "-915820",
    buy_trde_ori_nm_5: "한국투자증권",
    buy_trde_qty_5: "+919016",
  });

  it("renders top-5 buy/sell brokers with absolute quantities", () => {
    const text = formatBrokerActivity(data, "005930", MODE);
    expect(text).toContain("삼성전자 (005930) 거래원 상위 — 현재가 296,000원 (+6.47%)");
    expect(text).toContain("| 1 | KB증권 | 1,323,258 | 삼  성 | 1,725,746 |");
    expect(text).toContain("| 5 | 한국투자증권 | 919,016 | JP모간서울 | 915,820 |");
  });

  it("reports missing broker data when every name is blank", () => {
    const empty = brokerActivityResponseSchema.parse({ stk_cd: "999999" });
    expect(formatBrokerActivity(empty, "999999", MODE)).toContain("거래원 정보가 없습니다");
  });
});
