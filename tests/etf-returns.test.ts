import { describe, expect, it } from "vitest";

import { etfReturnItemSchema } from "../src/kiwoom/types.js";
import { formatEtfReturns, formatNonEtfNotice } from "../src/tools/etf-returns.js";

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
    const text = formatEtfReturns(rows069500, "KODEX 200", "069500", "201", "KOSPI200", MODE);
    expect(text).toContain("[모의투자] KODEX 200 (069500) ETF 기간 수익률");
    expect(text).toContain("| 기간 | ETF 수익률 | 비교지수 수익률 | 외인 순매수량 | 기관 순매수량 |");
    expect(text).toContain("| 1주 | -5.43% | -5.49% | 0 | - |");
    expect(text).toContain("| 1년 | +170.39% | +166.46% | 0 | - |");
    expect(text).toContain("※ 비교지수: 201 (KOSPI200)");
  });

  // ka40001의 cntr_prft_rt는 **요청한** etfobjt_idex_cd의 수익률이고 ETF와 대조되지 않는다
  // (types.ts 프로브 주석: 같은 코드면 종목이 달라도 같은 값, 엉뚱한 코드는 "0.00").
  // 컬럼을 "대상지수"로 부르던 v0.52.5까지는 그 값이 ETF의 추적지수 수익률로 읽혔다.
  it("states that the compared index is chosen, not the ETF's tracking index", () => {
    const text = formatEtfReturns(rows069500, "KODEX 200", "069500", "201", "KOSPI200", MODE);
    expect(text).toContain("이 ETF의 추적지수: KOSPI200");
    expect(text).toContain("ETF의 추적지수와 자동으로 맞춰지지 않습니다");
    // 옛 문구("대상지수")가 되살아나면 헤더든 각주든 여기서 걸린다 — 두 자리의 공통 조각이다.
    expect(text).not.toContain("대상지수");
  });

  // 해외지수 추종 ETF(예: 나스닥100)는 비교 지수를 맞출 방법이 아예 없다 —
  // benchmark_index_code가 키움 업종 코드(국내 지수)만 받기 때문이다.
  it("says a foreign-index ETF cannot be matched, and points to view=daily", () => {
    const text = formatEtfReturns(rows069500, "TIGER 미국나스닥100", "133690", "201", "나스닥 100", MODE);
    expect(text).toContain("해외지수(나스닥100·S&P500 등)를 추종하는 ETF는 비교 지수를 맞출 수 없습니다");
    expect(text).toContain("view=daily의 추적오차율");
  });

  it("omits the tracking-index clause when ka40002 did not answer", () => {
    const text = formatEtfReturns(rows069500, null, "069500", "201", null, MODE);
    expect(text).toContain("※ 비교지수: 201 (KOSPI200).");
    expect(text).not.toContain("이 ETF의 추적지수");
  });

  it("falls back to the bare code when the ETF name is unknown", () => {
    const text = formatEtfReturns(rows069500, null, "069500", "201", "KOSPI200", MODE);
    expect(text).toContain("[모의투자] 069500 ETF 기간 수익률");
  });

  it("labels a non-mapped benchmark code with its raw code", () => {
    const text = formatEtfReturns(rows069500, "KODEX 200", "069500", "207", "KOSPI200", MODE);
    expect(text).toContain("※ 비교지수: 207 (업종 207)");
  });

  it("renders dash rows for periods that returned no data", () => {
    // 인덱스 접근은 noUncheckedIndexedAccess 때문에 `| undefined`가 붙는다 — 구조분해로 꺼낸다.
    const [week, , , year] = rows069500;
    const rows = [week ?? null, null, null, year ?? null];
    const text = formatEtfReturns(rows, "KODEX 200", "069500", "201", "KOSPI200", MODE);
    expect(text).toContain("| 1주 | -5.43% |");
    expect(text).toContain("| 1개월 | - | - | - | - |");
    expect(text).toContain("| 6개월 | - | - | - | - |");
    expect(text).toContain("| 1년 | +170.39% |");
  });

  it("reports a no-data message when every period is empty", () => {
    const blank = etfReturnItemSchema.parse({
      etfprft_rt: "", cntr_prft_rt: "", for_netprps_qty: "", orgn_netprps_qty: "",
    });
    const text = formatEtfReturns([null, blank, null, null], "이상한ETF", "999999", "201", "", MODE);
    expect(text).toContain("999999의 ETF 수익률 데이터가 없습니다");
    expect(text).not.toContain("| 기간 |");
  });
});

describe("formatNonEtfNotice", () => {
  // ka40002 mock-probed 2026-07-10: 비ETF(005930)는 stk_nm만 채워지고 추적지수명이
  // 빈값, 존재하지 않는 코드(999999)는 둘 다 빈값.
  it("names the stock when the code is a non-ETF instrument", () => {
    const text = formatNonEtfNotice("삼성전자", "005930", MODE);
    expect(text).toContain("삼성전자 (005930)은(는) ETF가 아니어서");
    expect(text).toContain("get_stock_price");
  });

  it("asks to re-check the code when ka40002 knows nothing about it", () => {
    const text = formatNonEtfNotice("", "999999", MODE);
    expect(text).toContain("999999의 ETF 정보를 찾을 수 없습니다");
    expect(text).toContain("search_stock");
  });
});
