import { describe, expect, it } from "vitest";

import {
  accountEvaluationResponseSchema,
  accountPeriodPlResponseSchema,
  depositResponseSchema,
  normalizeStockCode,
  pendingOrderItemSchema,
  stockInfoResponseSchema,
  stockListItemSchema,
  transactionRowSchema,
} from "../src/kiwoom/types.js";
import { formatBalance } from "../src/tools/account-balance.js";
import { formatHoldings } from "../src/tools/account-holdings.js";
import { formatPendingOrders } from "../src/tools/pending-orders.js";
import { formatStockInfo } from "../src/tools/stock-price.js";
import { formatTransactions } from "../src/tools/transactions.js";

const MODE = "모의투자";

const ka10001Fixture = {
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  stk_cd: "005930",
  stk_nm: "삼성전자",
  cur_prc: "+61300",
  pred_pre: "+800",
  pre_sig: "2",
  flu_rt: "1.32",
  trde_qty: "12345678",
  open_pric: "60800",
  high_pric: "-61500",
  low_pric: "60700",
  base_pric: "60500",
  "250hgst": "+88000",
  "250lwst": "49900",
  per: "12.3",
  eps: "4980",
  pbr: "1.1",
  mac: "3660000",
};

const kt00018Fixture = {
  return_code: 0,
  return_msg: "조회가 완료되었습니다.",
  tot_pur_amt: "000000005000000",
  tot_evlt_amt: "000000005500000",
  tot_evlt_pl: "000000000500000",
  tot_prft_rt: "10.00",
  prsm_dpst_aset_amt: "000000007500000",
  acnt_evlt_remn_indv_tot: [
    {
      stk_cd: "A005930",
      stk_nm: "삼성전자",
      rmnd_qty: "000000000010",
      trde_able_qty: "000000000010",
      pur_pric: "000000060000",
      cur_prc: "000000061300",
      pur_amt: "000000600000",
      evlt_amt: "000000613000",
      evltv_prft: "000000013000",
      prft_rt: "2.16",
      poss_rt: "11.14",
      pred_close_pric: "000000060500",
    },
    {
      stk_cd: "A069500",
      stk_nm: "KODEX 200",
      rmnd_qty: "000000000100",
      trde_able_qty: "000000000100",
      pur_pric: "000000035000",
      cur_prc: "000000034500",
      pur_amt: "000003500000",
      evlt_amt: "000003450000",
      evltv_prft: "-00000050000",
      prft_rt: "-1.43",
      poss_rt: "62.73",
      pred_close_pric: "000000034800",
    },
  ],
};

const kt00001Fixture = {
  return_code: 0,
  return_msg: "조회가 완료되었습니다.",
  entr: "000000001500000",
  d1_entra: "000000001500000",
  d2_entra: "000000001500000",
  ord_alow_amt: "000000001500000",
  pymn_alow_amt: "000000001450000",
};

// Shape captured verbatim from mockapi 2026-07-13 (18 scalars + empty list);
// values synthetic — the fresh mock account returns all zeros.
const kt00004Fixture = {
  return_code: 0,
  return_msg: "조회가 완료되었습니다.",
  acnt_nm: "",
  brch_nm: "",
  entr: "000000001500000",
  d2_entra: "000000001500000",
  tot_est_amt: "000000005500000",
  aset_evlt_amt: "000000007000000",
  tot_pur_amt: "000000005000000",
  prsm_dpst_aset_amt: "000000007500000",
  tot_grnt_sella: "000000000000",
  tdy_lspft_amt: "000002600000",
  invt_bsamt: "000007150000",
  lspft_amt: "000015000000",
  tdy_lspft: "000000013000",
  lspft2: "-00000150000",
  lspft: "000001200000",
  tdy_lspft_rt: "0.50",
  lspft_ratio: "-2.10",
  lspft_rt: "8.00",
  stk_acnt_evlt_prst: [],
};

describe("normalizeStockCode", () => {
  it("strips the asset-class prefix", () => {
    expect(normalizeStockCode("A005930")).toBe("005930");
    expect(normalizeStockCode("005930")).toBe("005930");
  });
});

describe("formatStockInfo", () => {
  it("renders price, change and volume from a ka10001 response", () => {
    const info = stockInfoResponseSchema.parse(ka10001Fixture);
    const text = formatStockInfo(info, MODE);

    expect(text).toContain("[모의투자] 삼성전자 (005930)");
    expect(text).toContain("현재가: 61,300원");
    expect(text).toContain("상승 800원 (+1.32%)");
    expect(text).toContain("거래량: 12,345,678주");
    expect(text).toContain("88,000원 / 49,900원");
    expect(text).toContain("시가총액 3,660,000억원");
  });

  it("tolerates missing optional fields", () => {
    const info = stockInfoResponseSchema.parse({ return_code: 0, stk_cd: "005930", stk_nm: "삼성전자" });
    const text = formatStockInfo(info, MODE);
    expect(text).toContain("현재가: -");
  });

  it("appends 업종/상장일 from the master-list row when provided", () => {
    // ka10099 row captured verbatim from mockapi 2026-07-11.
    const master = stockListItemSchema.parse({
      code: "005930",
      name: "삼성전자",
      listCount: "0000005846278608",
      auditInfo: "정상",
      regDay: "19750611",
      lastPrice: "00278000",
      state: "증거금30%|담보대출|신용가능",
      marketCode: "0",
      marketName: "거래소",
      upName: "전기/전자",
      upSizeName: "대형주",
      companyClassName: "",
      orderWarning: "0",
      nxtEnable: "Y",
      kind: "A",
    });
    const info = stockInfoResponseSchema.parse(ka10001Fixture);
    const text = formatStockInfo(info, MODE, master);

    expect(text).toContain("시장/업종: 거래소 · 전기/전자 (대형주)");
    expect(text).toContain("상장일: 1975-06-11");
    expect(text).not.toContain("투자유의");

    // No master row (lookup miss / master fetch failure) → the block is absent.
    expect(formatStockInfo(info, MODE)).not.toContain("시장/업종");
  });

  it("flags abnormal statuses from the master-list row", () => {
    const master = stockListItemSchema.parse({
      code: "000040",
      name: "KR모터스",
      auditInfo: "거래정지",
      regDay: "19760525",
      lastPrice: "00000267",
      state: "증거금100%|거래정지",
      marketName: "거래소",
      upName: "운송장비/부품",
      upSizeName: "소형주",
      orderWarning: "0",
    });
    const info = stockInfoResponseSchema.parse({ return_code: 0, stk_cd: "000040", stk_nm: "KR모터스" });
    const text = formatStockInfo(info, MODE, master);

    expect(text).toContain("시장/업종: 거래소 · 운송장비/부품 (소형주)");
    expect(text).toContain("⚠️ 투자유의: 거래정지");
  });
});

describe("formatBalance", () => {
  it("renders deposit and evaluation summary", () => {
    const deposit = depositResponseSchema.parse(kt00001Fixture);
    const evaluation = accountEvaluationResponseSchema.parse(kt00018Fixture);
    const text = formatBalance(deposit, evaluation, MODE);

    expect(text).toContain("예수금: 1,500,000원");
    expect(text).toContain("출금가능금액: 1,450,000원");
    expect(text).toContain("총평가금액: 5,500,000원");
    expect(text).toContain("총평가손익: +500,000원 (+10.00%)");
    expect(text).toContain("추정예탁자산: 7,500,000원");
  });

  it("omits the 기간 손익 block without a kt00004 response", () => {
    const deposit = depositResponseSchema.parse(kt00001Fixture);
    const evaluation = accountEvaluationResponseSchema.parse(kt00018Fixture);
    expect(formatBalance(deposit, evaluation, MODE)).not.toContain("기간 손익");
    expect(formatBalance(deposit, evaluation, MODE, null)).not.toContain("기간 손익");
  });

  it("renders 당일/당월/누적 투자손익 from a kt00004 response", () => {
    const deposit = depositResponseSchema.parse(kt00001Fixture);
    const evaluation = accountEvaluationResponseSchema.parse(kt00018Fixture);
    const periodPl = accountPeriodPlResponseSchema.parse(kt00004Fixture);
    const text = formatBalance(deposit, evaluation, MODE, periodPl);

    expect(text).toContain("■ 기간 손익 (kt00004)");
    expect(text).toContain("당일투자손익: +13,000원 (+0.50%) / 당일투자원금 2,600,000원");
    expect(text).toContain("당월투자손익: -150,000원 (-2.10%) / 당월투자원금 7,150,000원");
    expect(text).toContain("누적투자손익: +1,200,000원 (+8.00%) / 누적투자원금 15,000,000원");
  });

  it("replaces an all-zero kt00004 with an honest notice (REAL-observed 2026-07-13)", () => {
    const deposit = depositResponseSchema.parse(kt00001Fixture);
    const evaluation = accountEvaluationResponseSchema.parse(kt00018Fixture);
    // All-zero shape captured verbatim from BOTH mockapi (fresh account) and a
    // REAL account with live holdings (2026-07-13 probe) — zeros do not mean
    // the account earned nothing, so numbers must not be asserted.
    const periodPl = accountPeriodPlResponseSchema.parse({
      return_code: 0,
      return_msg: "조회가 완료되었습니다.",
      tdy_lspft_amt: "000000000000",
      invt_bsamt: "000000000000",
      lspft_amt: "000000000000",
      tdy_lspft: "000000000000",
      lspft2: "000000000000",
      lspft: "000000000000",
      tdy_lspft_rt: "0.00",
      lspft_ratio: "0.00",
      lspft_rt: "0.00",
      stk_acnt_evlt_prst: [],
    });
    const text = formatBalance(deposit, evaluation, MODE, periodPl);
    expect(text).toContain("■ 기간 손익 (kt00004)");
    expect(text).toContain("모두 0으로 반환");
    expect(text).not.toContain("당일투자손익:");
  });

  it("renders numbers when any period-P&L field is non-zero (당일 0 on a no-trade day)", () => {
    const deposit = depositResponseSchema.parse(kt00001Fixture);
    const evaluation = accountEvaluationResponseSchema.parse(kt00018Fixture);
    const periodPl = accountPeriodPlResponseSchema.parse({
      ...kt00004Fixture,
      tdy_lspft_amt: "000000000000",
      tdy_lspft: "000000000000",
      tdy_lspft_rt: "0.00",
    });
    const text = formatBalance(deposit, evaluation, MODE, periodPl);
    expect(text).toContain("당일투자손익: 0원 (0.00%) / 당일투자원금 0원");
    expect(text).toContain("누적투자손익: +1,200,000원 (+8.00%) / 누적투자원금 15,000,000원");
    expect(text).not.toContain("모두 0으로 반환");
  });
});

describe("formatTransactions", () => {
  // Mirrors live kt00015 rows (2026-07 probe): trde_dt is the settlement date,
  // cntr_dt the trade date, trde_unit comma-grouped.
  const kt00015Rows = [
    {
      trde_dt: "20260115",
      cntr_dt: "20260113",
      trde_no: "1",
      trde_kind_nm: "매매",
      rmrk_nm: "장내매도",
      io_tp_nm: "매도",
      stk_cd: "A900100",
      stk_nm: "샘플해외ETF",
      trde_qty_jwa_cnt: "10",
      trde_unit: "50,000",
      trde_amt: "000000500080",
      exct_amt: "000000500000",
      cmsn: "000000000080",
    },
    {
      trde_dt: "20260115",
      cntr_dt: "20260113",
      trde_no: "2",
      trde_kind_nm: "매매",
      rmrk_nm: "장내매수",
      io_tp_nm: "매수",
      stk_cd: "A900200",
      stk_nm: "샘플국내ETF",
      trde_qty_jwa_cnt: "5",
      trde_unit: "20,000",
      trde_amt: "000000099930",
      exct_amt: "000000100000",
      cmsn: "000000000070",
    },
  ].map((r) => transactionRowSchema.parse(r));

  const query = { fromDate: "20260101", toDate: "20260131" };

  it("renders a table row per transaction with trade dates and comma-grouped unit prices", () => {
    const text = formatTransactions(kt00015Rows, query, MODE);

    expect(text).toContain("2026-01-01 ~ 2026-01-31, 2건");
    expect(text).toContain("| 2026-01-13 | 매도 | 샘플해외ETF (900100) | 10 | 50,000원 | 500,000원 |");
    expect(text).toContain("| 2026-01-13 | 매수 | 샘플국내ETF (900200) | 5 | 20,000원 | 100,000원 |");
    expect(text).toContain("체결 2영업일 후 기준");
  });

  it("filters by stock code", () => {
    const text = formatTransactions(kt00015Rows, { ...query, stockCode: "900100" }, MODE);
    expect(text).toContain("종목 900100, 1건");
    expect(text).toContain("샘플해외ETF");
    expect(text).not.toContain("샘플국내ETF");
  });

  it("reports an empty period", () => {
    expect(formatTransactions([], query, MODE)).toContain("거래내역이 없습니다");
  });

  it("warns when the fetch was truncated at the page cap", () => {
    expect(formatTransactions(kt00015Rows, query, MODE, false)).not.toContain("조회 상한");
    const text = formatTransactions(kt00015Rows, query, MODE, true);
    expect(text).toContain("조회 상한");
    expect(text).toContain("누락");
  });
});

describe("formatHoldings", () => {
  it("renders a table row per holding with normalized codes", () => {
    const evaluation = accountEvaluationResponseSchema.parse(kt00018Fixture);
    const text = formatHoldings(evaluation, MODE);

    expect(text).toContain("2종목");
    expect(text).toContain("| 삼성전자 | 005930 | 10 |");
    expect(text).toContain("+13,000원 | +2.16%");
    expect(text).toContain("| KODEX 200 | 069500 | 100 |");
    expect(text).toContain("-50,000원 | -1.43%");
    expect(text).toContain("평가손익 +500,000원 (+10.00%)");
  });

  it("handles an empty account", () => {
    const evaluation = accountEvaluationResponseSchema.parse({ return_code: 0 });
    expect(formatHoldings(evaluation, MODE)).toContain("보유 종목이 없습니다");
  });

  it("warns when holdings were truncated at the page cap", () => {
    const evaluation = accountEvaluationResponseSchema.parse(kt00018Fixture);
    expect(formatHoldings(evaluation, MODE, false)).not.toContain("조회 상한");
    expect(formatHoldings(evaluation, MODE, true)).toContain("조회 상한");
  });
});

describe("formatPendingOrders", () => {
  // ka10075 `oso` item shape is wrapper-sourced (no live open order to observe);
  // values follow the usual Kiwoom encoding (zero-padded, sign-prefixed prices).
  const ka10075Rows = [
    {
      ord_no: "0001234",
      stk_cd: "A005930",
      stk_nm: "삼성전자",
      ord_stt: "접수",
      io_tp_nm: "매수",
      ord_qty: "000000000010",
      ord_pric: "000000061000",
      oso_qty: "000000000010",
      cntr_qty: "000000000000",
      cur_prc: "+000000061300",
      tm: "091530",
      trde_tp: "매수",
    },
    {
      ord_no: "0001235",
      stk_cd: "A069500",
      stk_nm: "KODEX 200",
      ord_stt: "확인",
      io_tp_nm: "매도",
      ord_qty: "000000000100",
      ord_pric: "000000035000",
      oso_qty: "000000000040",
      cntr_qty: "000000000060",
      cur_prc: "-000000034500",
      tm: "100000",
      trde_tp: "매도",
    },
  ].map((r) => pendingOrderItemSchema.parse(r));

  it("renders a row per pending order with normalized codes, abs prices and HH:MM:SS", () => {
    const text = formatPendingOrders(ka10075Rows, MODE);
    expect(text).toContain("미체결 주문 (2건)");
    expect(text).toContain("| 0001234 | 삼성전자 (005930) | 매수 | 접수 | 10 | 10 | 61,000원 | 61,300원 | 09:15:30 |");
    expect(text).toContain("| 0001235 | KODEX 200 (069500) | 매도 | 확인 | 100 | 40 | 35,000원 | 34,500원 | 10:00:00 |");
  });

  it("reports no pending orders when the array is empty", () => {
    expect(formatPendingOrders([], MODE)).toContain("미체결 주문이 없습니다");
  });

  it("filters by stock code", () => {
    const text = formatPendingOrders(ka10075Rows, MODE, "005930");
    expect(text).toContain("종목 005930");
    expect(text).toContain("삼성전자");
    expect(text).not.toContain("KODEX 200");
  });
});
