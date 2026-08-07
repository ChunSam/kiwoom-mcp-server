import { describe, expect, it } from "vitest";

import { etfAllPriceResponseSchema } from "../src/kiwoom/types.js";
import { formatEtfRank, type EtfRankFilters } from "../src/tools/etf-rank.js";

const MODE = "실전투자";

/**
 * ka40004 실측 (REAL 2026-08-03 23:4x KST, txon_type=0 / navpre=0 / mngmcomp=0000 /
 * txon_yn=0 / trace_idex=0 / stex_tp=3). 모의투자도 1,155종목 전 필드가 같은 응답을 줬고,
 * 통합(3)과 KRX(1)도 `_AL` 접미사 말고는 차이가 없었다.
 *
 * 살려둔 특이값:
 *  - **ACE 러시아MSCI**: 거래량 0에 NAV 48.32 vs 종가 8,535 → 괴리율 +17,563%. 거래정지
 *    종목의 NAV가 붕괴한 실제 사례로, 극단값이 그대로 렌더되는지와 각주가 붙는지를 본다.
 *  - **KODEX 200선물인버스2X**: `trde_qty` 4294967295 = 2^32−1 포화값 (ka10020과 같은 종목).
 *  - `close_pric`·`nav`의 부호는 값의 부호가 아니라 **전일대비 방향**이다 — KODEX 200은
 *    종가 "-99105"지만 실제 가격은 99,105원이다. 여기에 parseKiwoomNumber를 쓰면 음수로 샌다.
 *  - `trace_idex_nm`은 절반이 빈 문자열 (전체 1,155행 중 317행만 채워짐).
 *  - `trace_idex`/`trace_flu_rt`가 `close_pric`/`pre_rt`와 똑같이 온다 — 스키마가 이 둘을
 *    선언하지 않는 이유이고, looseObject라 그대로 통과한다.
 */
const { etfall_mrpr: rows } = etfAllPriceResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  etfall_mrpr: [
    {
      stk_cd: "153270_AL", stk_cls: "19", stk_nm: "KIWOOM 코스피100", close_pric: "-76150",
      pre_sig: "5", pred_pre: "-5850", pre_rt: "-7.13", trde_qty: "7490", nav: "-76388.61",
      trace_eor_rt: "1.24", txbs: "", dvid_bf_base: "", pred_dvida: "", trace_idex_nm: "KOSPI100",
      drng: "", trace_idex_cd: "", trace_idex: "-76150", trace_flu_rt: "-7.13",
    },
    {
      stk_cd: "0000D0_AL", stk_cls: "20", stk_nm: "TIGER 엔비디아미국채커버드콜밸런스(합성)",
      close_pric: "-9150", pre_sig: "5", pred_pre: "-15", pre_rt: "-0.16", trde_qty: "19794",
      nav: "+9159.78", trace_eor_rt: "0.28", txbs: "", dvid_bf_base: "", pred_dvida: "",
      trace_idex_nm: "", drng: "", trace_idex_cd: "", trace_idex: "-9150", trace_flu_rt: "-0.16",
    },
    {
      stk_cd: "252670_AL", stk_cls: "20", stk_nm: "KODEX 200선물인버스2X", close_pric: "+99",
      pre_sig: "2", pred_pre: "+17", pre_rt: "+20.73", trde_qty: "4294967295", nav: "+99.42",
      trace_eor_rt: "1.93", txbs: "", dvid_bf_base: "", pred_dvida: "", trace_idex_nm: "F-KOSPI200",
      drng: "", trace_idex_cd: "", trace_idex: "+99", trace_flu_rt: "+20.73",
    },
    {
      stk_cd: "265690_AL", stk_cls: "11", stk_nm: "ACE 러시아MSCI(합성)", close_pric: "8535",
      pre_sig: "3", pred_pre: "0", pre_rt: "0.00", trde_qty: "0", nav: "48.32",
      trace_eor_rt: "0.16", txbs: "", dvid_bf_base: "", pred_dvida: "", trace_idex_nm: "",
      drng: "", trace_idex_cd: "", trace_idex: "8535", trace_flu_rt: "0.00",
    },
    {
      stk_cd: "133690_AL", stk_cls: "23", stk_nm: "TIGER 미국나스닥100", close_pric: "+180335",
      pre_sig: "2", pred_pre: "+485", pre_rt: "+0.27", trde_qty: "1189881", nav: "+179017.62",
      trace_eor_rt: "0.08", txbs: "", dvid_bf_base: "", pred_dvida: "", trace_idex_nm: "NASDAQ 100",
      drng: "", trace_idex_cd: "", trace_idex: "+180335", trace_flu_rt: "+0.27",
    },
    {
      stk_cd: "069500_AL", stk_cls: "19", stk_nm: "KODEX 200", close_pric: "-99105",
      pre_sig: "5", pred_pre: "-9715", pre_rt: "-8.93", trde_qty: "27169695", nav: "-99119.02",
      trace_eor_rt: "0.39", txbs: "", dvid_bf_base: "", pred_dvida: "", trace_idex_nm: "KOSPI200",
      drng: "", trace_idex_cd: "", trace_idex: "-99105", trace_flu_rt: "-8.93",
    },
  ],
});

const filters = (overrides: Partial<EtfRankFilters> = {}): EtfRankFilters => ({
  sort: "volume",
  taxType: "all",
  minVolume: 0,
  ...overrides,
});

/** 표 본문에서 한 종목의 행을 꺼낸다 (각주·헤더에 걸리지 않도록 `| ` 시작으로 제한). */
function rowOf(text: string, name: string): string {
  const line = text.split("\n").find((l) => l.startsWith("| ") && l.includes(`| ${name} |`));
  expect(line, `${name} 행이 표에 없다`).toBeDefined();
  return line as string;
}

describe("formatEtfRank", () => {
  it("거래량 내림차순으로 세우고 _AL 접미사를 뗀 코드를 쓴다", () => {
    const text = formatEtfRank(rows, filters(), 10, false, MODE);
    const order = text
      .split("\n")
      .filter((l) => /^\| \d+ \|/.test(l))
      .map((l) => l.split(" | ")[1]);

    expect(order).toEqual([
      "KODEX 200선물인버스2X", // 포화값이지만 수치상 최대
      "KODEX 200",
      "TIGER 미국나스닥100",
      "TIGER 엔비디아미국채커버드콜밸런스(합성)",
      "KIWOOM 코스피100",
      "ACE 러시아MSCI(합성)", // 거래량 0 → 꼴찌
    ]);
    expect(text).toContain("| 069500 |");
    expect(text).not.toContain("069500_AL");
    expect(text).toContain(`[${MODE}]`);
  });

  it("가격 필드의 부호를 방향으로 읽어 하락 종목도 양수 가격으로 렌더한다", () => {
    // close_pric "-99105" / nav "-99119.02" — 부호는 전일대비 방향이고 값은 절대값이다.
    const line = rowOf(formatEtfRank(rows, filters(), 10, false, MODE), "KODEX 200");
    expect(line).toContain("99,105원");
    expect(line).toContain("99,119.02원"); // NAV는 소수점이 살아 있어야 괴리율을 검증할 수 있다
    expect(line).not.toContain("-99,105");
    expect(line).toContain("-8.93%"); // 등락률은 부호가 그대로 의미를 갖는다
  });

  it("괴리율을 (종가−NAV)/NAV로 계산하고 부호를 붙인다", () => {
    const text = formatEtfRank(rows, filters(), 10, false, MODE);
    // TIGER 미국나스닥100: (180335 − 179017.62) / 179017.62 = +0.736%
    expect(rowOf(text, "TIGER 미국나스닥100")).toContain("+0.74%");
    // KODEX 200: (99105 − 99119.02) / 99119.02 = −0.014% → 반올림하면 -0.01%
    expect(rowOf(text, "KODEX 200")).toContain("-0.01%");
  });

  it("32비트 포화 거래량은 숫자 대신 상한 표기로 바꾸고 각주를 붙인다", () => {
    const text = formatEtfRank(rows, filters(), 10, false, MODE);
    const line = rowOf(text, "KODEX 200선물인버스2X");
    expect(line).toContain("집계상한");
    // 숫자 자체는 각주에만 남고 표에는 나오지 않아야 한다 ("42억 주"라는 거짓말 방지).
    expect(line).not.toContain("4,294,967,295");
    expect(text).toContain("32비트 정수 상한");
  });

  it("거래정지 종목의 극단 괴리율을 그대로 보여주되 원인 각주를 단다", () => {
    const text = formatEtfRank(rows, filters({ sort: "premium" }), 10, false, MODE);
    const [first] = text.split("\n").filter((l) => /^\| 1 \|/.test(l));
    expect(first).toContain("ACE 러시아MSCI(합성)");
    expect(first).toContain("+17563.49%");
    expect(text).toContain("거래량 0인 종목은 거래정지");
  });

  it("min_volume으로 거래정지 종목을 걸러낸다", () => {
    const text = formatEtfRank(rows, filters({ sort: "premium", minVolume: 1 }), 10, false, MODE);
    expect(text).not.toContain("ACE 러시아MSCI");
    expect(text).toContain("5종목 중 상위 5종목");
    // 남은 종목 중 최고 괴리는 TIGER 미국나스닥100(+0.74%)
    const [first] = text.split("\n").filter((l) => /^\| 1 \|/.test(l));
    expect(first).toContain("TIGER 미국나스닥100");
  });

  it("discount는 괴리율 오름차순으로, losers는 등락률 오름차순으로 세운다", () => {
    const discount = formatEtfRank(rows, filters({ sort: "discount" }), 3, false, MODE);
    const [firstDiscount] = discount.split("\n").filter((l) => /^\| 1 \|/.test(l));
    expect(firstDiscount).toContain("KODEX 200선물인버스2X"); // -0.42%가 최저

    const losers = formatEtfRank(rows, filters({ sort: "losers" }), 3, false, MODE);
    const [firstLoser] = losers.split("\n").filter((l) => /^\| 1 \|/.test(l));
    expect(firstLoser).toContain("KODEX 200"); // -8.93%
  });

  it("운용사는 종목명 브랜드 접두어로만 거른다", () => {
    const text = formatEtfRank(rows, filters({ manager: "tiger" }), 10, false, MODE);
    expect(text).toContain("TIGER 미국나스닥100");
    expect(text).toContain("TIGER 엔비디아미국채커버드콜밸런스(합성)");
    expect(text).not.toContain("KODEX 200 |");
    expect(text).toContain('운용사 "tiger"');

    // 브랜드가 아니라 이름 뒷부분에 걸리는 문자열은 매칭되지 않아야 한다.
    const nope = formatEtfRank(rows, filters({ manager: "나스닥" }), 10, false, MODE);
    expect(nope).toContain("조건에 맞는 ETF가 없습니다");
  });

  it("추적지수명이 빈 종목은 지수 필터에서 빠지고 표에서는 '-'로 찍힌다", () => {
    const text = formatEtfRank(rows, filters({ indexName: "KOSPI" }), 10, false, MODE);
    expect(text).toContain("KIWOOM 코스피100"); // KOSPI100
    expect(text).toContain("KODEX 200선물인버스2X"); // F-KOSPI200
    expect(text).not.toContain("ACE 러시아MSCI"); // 지수명 없음

    const all = formatEtfRank(rows, filters(), 10, false, MODE);
    expect(rowOf(all, "ACE 러시아MSCI(합성)")).toMatch(/\| - \|$/);
    expect(all).toContain("추적지수가 `-`인 종목은");
  });

  it("빈 결과는 에러가 아니라 원인 힌트를 준다", () => {
    const text = formatEtfRank([], filters(), 10, false, MODE);
    expect(text).toContain("조건에 맞는 ETF가 없습니다");
    expect(text).toContain("필터를 완화해 보세요");
  });

  // ka40004는 종목코드 순 전량 스냅샷이다 (REAL 실측 2026-08-07: 300행 중 역전 1곳).
  // 정렬을 포맷터가 하므로 잘리면 표의 꼬리가 아니라 정렬 모수에서 종목이 빠진다.
  it("top 초과분과 페이지 상한 절단을 각각 알린다", () => {
    const text = formatEtfRank(rows, filters(), 2, true, MODE);
    expect(text).toContain("6종목 중 상위 2종목");
    expect(text).toContain("일부 종목이 빠졌습니다");
    expect(text).toContain("종목코드 순으로 오기 때문에");
    expect(text).not.toContain("결과가 잘렸을 수 있습니다");
  });
});
