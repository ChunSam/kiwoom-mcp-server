import { describe, expect, it } from "vitest";

import { executionsResponseSchema } from "../src/kiwoom/types.js";
import { formatOrderExecutions } from "../src/tools/order-executions.js";

const MODE = "모의투자";

// Captured VERBATIM from mockapi.kiwoom.com 2026-07-31 (ka10076, all five body
// combinations returned exactly this — rc=0, `cntr` present but empty, cont-yn N).
// The fresh mock account has no orders, so this empty envelope is the only part of
// the contract that is observed rather than spec-sourced.
const ka10076EmptyFixture = {
  cntr: [],
  return_code: 0,
  return_msg: " 조회가 완료되었습니다.",
};

// ka10076 `cntr` ITEM values are unobservable without placing an order (out of scope
// by design) — the identical situation ka10075's `oso` item has been in since v0.6.0.
// Field NAMES are spec-sourced (계좌.md:601, 19 fields); values below follow the usual
// Kiwoom encoding (zero-padded, sign-prefixed prices). Treat as PROVISIONAL.
const provisionalRows = [
  {
    ord_no: "0001234",
    orig_ord_no: "0000000",
    stk_cd: "A005930",
    stk_nm: "삼성전자",
    ord_stt: "체결",
    io_tp_nm: "매수",
    trde_tp: "보통",
    ord_qty: "000000000010",
    ord_pric: "000000061000",
    cntr_qty: "000000000010",
    cntr_pric: "000000060900",
    oso_qty: "000000000000",
    tdy_trde_cmsn: "000000000091",
    tdy_trde_tax: "000000000000",
    ord_tm: "091530",
    stop_pric: "000000000000",
    sor_yn: "N",
    stex_tp: "0",
    stex_tp_txt: "KRX",
  },
  {
    ord_no: "0001240",
    orig_ord_no: "0001235",
    stk_cd: "A069500",
    stk_nm: "KODEX 200",
    ord_stt: "체결",
    io_tp_nm: "매도",
    trde_tp: "정정",
    ord_qty: "000000000005",
    ord_pric: "000000037000",
    cntr_qty: "000000000005",
    cntr_pric: "000000037150",
    oso_qty: "000000000000",
    tdy_trde_cmsn: "000000000027",
    tdy_trde_tax: "000000000334",
    ord_tm: "133045",
    stop_pric: "000000000000",
    sor_yn: "N",
    stex_tp: "0",
    stex_tp_txt: "KRX",
  },
];

const parseRows = (rows: unknown[]) =>
  executionsResponseSchema.parse({ return_code: 0, return_msg: "", cntr: rows }).cntr;

describe("executionsResponseSchema", () => {
  it("parses the verbatim empty mock envelope and yields an empty cntr array", () => {
    const parsed = executionsResponseSchema.parse(ka10076EmptyFixture);
    expect(parsed.return_code).toBe(0);
    expect(parsed.cntr).toEqual([]);
  });

  it("defaults cntr to [] when the key is absent entirely", () => {
    const parsed = executionsResponseSchema.parse({ return_code: 0, return_msg: "" });
    expect(parsed.cntr).toEqual([]);
  });

  it("keeps all 19 spec fields on a parsed row", () => {
    const [row] = parseRows([provisionalRows[0]]);
    for (const field of [
      "ord_no",
      "orig_ord_no",
      "stk_cd",
      "stk_nm",
      "ord_stt",
      "io_tp_nm",
      "trde_tp",
      "ord_qty",
      "ord_pric",
      "cntr_qty",
      "cntr_pric",
      "oso_qty",
      "tdy_trde_cmsn",
      "tdy_trde_tax",
      "ord_tm",
      "stop_pric",
      "sor_yn",
      "stex_tp",
      "stex_tp_txt",
    ]) {
      expect(row).toHaveProperty(field);
    }
  });
});

describe("formatOrderExecutions", () => {
  it("reports no executions and points at the sibling tools when the list is empty", () => {
    const out = formatOrderExecutions([], MODE);
    expect(out).toContain("[모의투자] 체결 내역이 없습니다.");
    expect(out).toContain("get_trading_journal");
    expect(out).toContain("get_transactions");
  });

  it("renders a row with quantities, prices and the stripped stock code", () => {
    const out = formatOrderExecutions(parseRows([provisionalRows[0]]), MODE);
    expect(out).toContain("체결 내역 (1건)");
    expect(out).toContain("삼성전자 (005930)"); // "A005930" prefix stripped
    expect(out).toContain("| 0001234 |");
    expect(out).toContain("09:15:30"); // HHmmss → HH:MM:SS
    expect(out).toContain("60,900원"); // 체결가격
    expect(out).toContain("61,000원"); // 주문가격
  });

  it("sums 수수료+세금 across rows", () => {
    const out = formatOrderExecutions(parseRows(provisionalRows), MODE);
    // 91 + 0 + 27 + 334 = 452
    expect(out).toContain("수수료+세금 합계 452원");
  });

  it("filters client-side by stock_code and labels the scope", () => {
    const out = formatOrderExecutions(parseRows(provisionalRows), MODE, {
      stockCode: "005930",
    });
    expect(out).toContain("체결 내역 (1건 — 종목 005930)");
    expect(out).toContain("삼성전자");
    expect(out).not.toContain("KODEX 200");
  });

  it("labels side and order_no in the scope line", () => {
    const out = formatOrderExecutions(parseRows(provisionalRows), MODE, {
      side: "buy",
      orderNo: "0001234",
    });
    expect(out).toContain("매수");
    expect(out).toContain("주문번호 0001234");
  });

  it("omits the scope suffix when side is the default 'all'", () => {
    const out = formatOrderExecutions(parseRows(provisionalRows), MODE, { side: "all" });
    expect(out).toContain("체결 내역 (2건)");
    expect(out).not.toContain(" — 전체");
  });

  it("footnotes rows that carry a distinct 원주문번호 (정정·취소)", () => {
    const out = formatOrderExecutions(parseRows(provisionalRows), MODE);
    expect(out).toContain("1건은 원주문번호가 따로 있습니다");
    expect(out).toContain("0001240←0001235");
  });

  it("does not footnote a blank 원주문번호", () => {
    const out = formatOrderExecutions(parseRows([provisionalRows[0]]), MODE);
    expect(out).not.toContain("원주문번호가 따로 있습니다");
  });

  // NEGATIVE CONTROL for the zero-strip in the 원주문번호 comparison. Removing
  // `.replace(/^0+/, "")` fails exactly the three 원주문번호 tests in this block and
  // nothing else (verified 2026-07-31: 3 failed / 10 passed), because the strip carries
  // three behaviours at once: the "0000000" all-zeros sentinel, the blank case, and the
  // padding difference below ("0001234" vs "1234" is the SAME order).
  it("treats zero-padding differences as the same 주문번호, not an amendment", () => {
    const row = { ...provisionalRows[0], ord_no: "1234", orig_ord_no: "0001234" };
    const out = formatOrderExecutions(parseRows([row]), MODE);
    expect(out).not.toContain("원주문번호가 따로 있습니다");
  });

  it("renders '-' for a row whose fee fields are blank rather than a bogus 0원", () => {
    const row = { ...provisionalRows[0], tdy_trde_cmsn: "", tdy_trde_tax: "" };
    const out = formatOrderExecutions(parseRows([row]), MODE);
    expect(out).not.toContain("수수료+세금 합계");
    expect(out).toContain("| - |");
  });
});
