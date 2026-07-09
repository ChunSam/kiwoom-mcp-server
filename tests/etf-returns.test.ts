import { describe, expect, it } from "vitest";

import { etfReturnItemSchema } from "../src/kiwoom/types.js";
import { formatEtfReturns } from "../src/tools/etf-returns.js";

const MODE = "모의투자";

// Fixtures mirror mockapi ka40001 responses for 069500 (idex 207) captured 2026-07-09.
// orgn_netprps_qty arrives blank on mock; for_netprps_qty arrives "0".

const rows069500 = [
  { etfprft_rt: "-5.43", cntr_prft_rt: "-5.49", for_netprps_qty: "0", orgn_netprps_qty: "" },
  { etfprft_rt: "-5.68", cntr_prft_rt: "-5.10", for_netprps_qty: "0", orgn_netprps_qty: "" },
  { etfprft_rt: "+73.70", cntr_prft_rt: "+72.47", for_netprps_qty: "0", orgn_netprps_qty: "" },
  { etfprft_rt: "+170.39", cntr_prft_rt: "+166.46", for_netprps_qty: "0", orgn_netprps_qty: "" },
].map((i) => etfReturnItemSchema.parse(i));

describe("formatEtfReturns", () => {
  it("renders the four-period table with the benchmark footnote", () => {
    const text = formatEtfReturns(rows069500, "KODEX 200", "069500", "201", MODE);
    expect(text).toContain("[모의투자] KODEX 200 (069500) ETF 기간 수익률");
    expect(text).toContain("| 기간 | ETF 수익률 | 대상지수 수익률 | 외인 순매수량 | 기관 순매수량 |");
    expect(text).toContain("| 1주 | -5.43% | -5.49% | 0 | - |");
    expect(text).toContain("| 1년 | +170.39% | +166.46% | 0 | - |");
    expect(text).toContain("※ 대상지수: 201 (KOSPI200)");
  });

  it("falls back to the bare code when the ETF name is unknown", () => {
    const text = formatEtfReturns(rows069500, null, "069500", "201", MODE);
    expect(text).toContain("[모의투자] 069500 ETF 기간 수익률");
  });

  it("labels a non-mapped benchmark code with its raw code", () => {
    const text = formatEtfReturns(rows069500, "KODEX 200", "069500", "207", MODE);
    expect(text).toContain("※ 대상지수: 207 (업종 207)");
  });

  it("renders dash rows for periods that returned no data", () => {
    const rows = [rows069500[0], null, null, rows069500[3]];
    const text = formatEtfReturns(rows, "KODEX 200", "069500", "201", MODE);
    expect(text).toContain("| 1주 | -5.43% |");
    expect(text).toContain("| 1개월 | - | - | - | - |");
    expect(text).toContain("| 6개월 | - | - | - | - |");
    expect(text).toContain("| 1년 | +170.39% |");
  });

  it("reports a no-data message when every period is empty", () => {
    const blank = etfReturnItemSchema.parse({
      etfprft_rt: "", cntr_prft_rt: "", for_netprps_qty: "", orgn_netprps_qty: "",
    });
    const text = formatEtfReturns([null, blank, null, null], "이상한ETF", "999999", "201", MODE);
    expect(text).toContain("999999의 ETF 수익률 데이터가 없습니다");
    expect(text).not.toContain("| 기간 |");
  });
});
