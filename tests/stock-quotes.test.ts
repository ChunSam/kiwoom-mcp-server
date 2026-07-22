import { describe, expect, it } from "vitest";

import { batchQuoteItemSchema, stockListItemSchema } from "../src/kiwoom/types.js";
import { formatBatchQuotes } from "../src/tools/stock-quotes.js";

const MODE = "모의투자";

// Fixtures mirror mockapi ka10095 responses captured 2026-07-22
// (verbatim consumed-subset rows; an unknown code returns rc=0 plus an
// all-blank row — the invalid-mix case below).

const quoteRows = [
  {
    stk_cd: "005930", stk_nm: "삼성전자", cur_prc: "+260500", pred_pre: "+1500",
    pred_pre_sig: "2", flu_rt: "+0.58", trde_qty: "22292003", trde_prica: "6021001",
    cntr_str: "82.67", mac: "15229556",
  },
  {
    stk_cd: "000660", stk_nm: "SK하이닉스", cur_prc: "-1830000", pred_pre: "-6000",
    pred_pre_sig: "5", flu_rt: "-0.33", trde_qty: "4802637", trde_prica: "9293780",
    cntr_str: "82.92", mac: "13042453",
  },
  {
    stk_cd: "069500", stk_nm: "KODEX 200", cur_prc: "+108315", pred_pre: "+175",
    pred_pre_sig: "2", flu_rt: "+0.16", trde_qty: "18621312", trde_prica: "2095861",
    cntr_str: "96.00", mac: "243871",
  },
].map((i) => batchQuoteItemSchema.parse(i));

const blankRow = batchQuoteItemSchema.parse({
  stk_cd: "", stk_nm: "", cur_prc: "", pred_pre: "", pred_pre_sig: "",
  flu_rt: "", trde_qty: "", trde_prica: "", cntr_str: "", mac: "",
});

const masterIndex = new Map(
  [
    { code: "005930", name: "삼성전자", auditInfo: "정상", orderWarning: "0" },
    { code: "000660", name: "SK하이닉스", auditInfo: "관리종목", orderWarning: "0" },
    { code: "069500", name: "KODEX 200", auditInfo: "정상", orderWarning: "1" },
  ].map((i) => [i.code, stockListItemSchema.parse(i)] as const),
);

describe("formatBatchQuotes", () => {
  it("renders one table row per stock in request order", () => {
    const text = formatBatchQuotes(quoteRows, ["005930", "000660", "069500"], MODE);
    expect(text).toContain("[모의투자] 종목 일괄 시세 (3종목)");
    expect(text).toContain(
      "| 종목명 | 코드 | 현재가 | 전일대비 | 등락률 | 거래량 | 거래대금(백만원) | 시가총액(억원) | 비고 |",
    );
    expect(text).toContain(
      "| 삼성전자 | 005930 | 260,500원 | +1,500 | +0.58% | 22,292,003 | 6,021,001 | 15,229,556 | - |",
    );
    // 현재가는 부호 접두를 벗긴 절대값, 전일대비는 부호 유지
    expect(text).toContain(
      "| SK하이닉스 | 000660 | 1,830,000원 | -6,000 | -0.33% | 4,802,637 | 9,293,780 | 13,042,453 | - |",
    );
    expect(text).toContain(
      "| KODEX 200 | 069500 | 108,315원 | +175 | +0.16% | 18,621,312 | 2,095,861 | 243,871 | - |",
    );
    expect(text).not.toContain("조회되지 않은 코드");
  });

  it("filters the all-blank row of an unknown code and lists it as unresolved", () => {
    const text = formatBatchQuotes([quoteRows[0]!, blankRow], ["005930", "999999"], MODE);
    expect(text).toContain("(1종목)");
    expect(text).toContain("삼성전자");
    expect(text).toContain("⚠️ 조회되지 않은 코드: 999999");
  });

  it("reports an all-unknown request without a table", () => {
    const text = formatBatchQuotes([blankRow], ["999999"], MODE);
    expect(text).toContain("조회된 종목이 없습니다");
    expect(text).toContain("999999");
    expect(text).not.toContain("| 종목명 |");
  });

  it("fills 비고 from master-list warnings when the index is available", () => {
    const text = formatBatchQuotes(quoteRows, ["005930", "000660", "069500"], MODE, masterIndex);
    expect(text).toContain("| 삼성전자 | 005930 | 260,500원 | +1,500 | +0.58% | 22,292,003 | 6,021,001 | 15,229,556 | - |");
    expect(text).toContain("| 관리종목 |");
    expect(text).toContain("| ETF투자주의요망 |");
  });

  it("points to get_stock_price for the per-stock drill-down", () => {
    const text = formatBatchQuotes(quoteRows, ["005930", "000660", "069500"], MODE);
    expect(text).toContain("get_stock_price");
  });
});
