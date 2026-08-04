import { describe, expect, it } from "vitest";

import { quoteTableResponseSchema } from "../src/kiwoom/types.js";
import { formatOrderbook } from "../src/tools/orderbook.js";

const MODE = "실전투자";

/**
 * ka10007 실측 (REAL 2026-08-04 14:04 KST 정규장, `stk_cd: "005930_AL"` 통합 조회).
 * 126개 스칼라 중 스키마가 선언한 것만 남겼다 — 나머지는 looseObject가 통과시킨다.
 *
 * 살려둔 특이값:
 *  - `stk_cd: "005930_AL"` — 통합 조회 응답의 접미사. `code()`가 떼는지 확인하는 자리다.
 *  - **가격 필드가 전부 `-` 접두**: 하락 종목이라 `sel_1bid`까지 `-231000`으로 온다.
 *    부호는 값이 아니라 전일대비 방향이므로 `parseKiwoomPrice`로 절대값을 읽어야 한다 —
 *    `parseKiwoomNumber`를 쓰면 호가가 전부 음수로 렌더된다.
 *  - 잔량은 통합(KRX+NXT) 합산이다. 같은 시각 KRX 단독은 매수1이 약 18,000이었다.
 */
const samsung = quoteTableResponseSchema.parse({
  stk_cd: "005930_AL",
  stk_nm: "삼성전자",
  date: "20260804",
  tm: "140452",
  cur_prc: "-230750",
  smbol: "5",
  flu_rt: "-3.65",
  trde_qty: "37580265",
  tot_sel_req: "355859",
  tot_buy_req: "1786226",
  sel_1bid: "-231000",
  sel_2bid: "-231500",
  sel_3bid: "-232000",
  sel_4bid: "-232500",
  sel_5bid: "-233000",
  sel_6bid: "-233500",
  sel_7bid: "-234000",
  sel_8bid: "-234500",
  sel_9bid: "-235000",
  sel_10bid: "-235500",
  sel_1bid_req: "31774",
  sel_2bid_req: "33970",
  sel_3bid_req: "29867",
  sel_4bid_req: "28614",
  sel_5bid_req: "34088",
  sel_6bid_req: "29409",
  sel_7bid_req: "43688",
  sel_8bid_req: "41210",
  sel_9bid_req: "55159",
  sel_10bid_req: "28080",
  buy_1bid: "-230500",
  buy_2bid: "-230000",
  buy_3bid: "-229500",
  buy_4bid: "-229000",
  buy_5bid: "-228500",
  buy_6bid: "-228000",
  buy_7bid: "-227500",
  buy_8bid: "-227000",
  buy_9bid: "-226500",
  buy_10bid: "-226000",
  buy_1bid_req: "35963",
  buy_2bid_req: "196057",
  buy_3bid_req: "124696",
  buy_4bid_req: "229210",
  buy_5bid_req: "198085",
  buy_6bid_req: "313576",
  buy_7bid_req: "249096",
  buy_8bid_req: "203734",
  buy_9bid_req: "105003",
  buy_10bid_req: "130806",
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
});

/**
 * 같은 시점의 069500(KODEX 200) 통합 조회. 여기 남긴 이유는 **호가 간격이 균등하지 않다**는
 * 것 — 매수 쪽이 97,305 → 97,295 → 97,280처럼 10원·15원씩 건너뛴다(매도 쪽은 5원 등간격).
 * 잔량이 있는 호가만 채워 오기 때문으로, 표를 등간격으로 가정하고 렌더하면 어긋난다.
 */
const kodex = quoteTableResponseSchema.parse({
  stk_cd: "069500_AL",
  stk_nm: "KODEX 200",
  date: "20260804",
  tm: "140453",
  cur_prc: "-97305",
  smbol: "5",
  flu_rt: "-1.82",
  trde_qty: "16103125",
  tot_sel_req: "33822",
  tot_buy_req: "34405",
  sel_1bid: "-97320",
  sel_2bid: "-97325",
  sel_3bid: "-97330",
  sel_4bid: "-97335",
  sel_5bid: "-97340",
  sel_6bid: "-97345",
  sel_7bid: "-97350",
  sel_8bid: "-97355",
  sel_9bid: "-97360",
  sel_10bid: "-97365",
  sel_1bid_req: "75",
  sel_2bid_req: "800",
  sel_3bid_req: "9665",
  sel_4bid_req: "1555",
  sel_5bid_req: "4826",
  sel_6bid_req: "4047",
  sel_7bid_req: "129",
  sel_8bid_req: "2606",
  sel_9bid_req: "10105",
  sel_10bid_req: "14",
  buy_1bid: "-97305",
  buy_2bid: "-97295",
  buy_3bid: "-97280",
  buy_4bid: "-97270",
  buy_5bid: "-97265",
  buy_6bid: "-97260",
  buy_7bid: "-97255",
  buy_8bid: "-97250",
  buy_9bid: "-97245",
  buy_10bid: "-97225",
  buy_1bid_req: "50",
  buy_2bid_req: "1200",
  buy_3bid_req: "15554",
  buy_4bid_req: "390",
  buy_5bid_req: "1336",
  buy_6bid_req: "4044",
  buy_7bid_req: "9011",
  buy_8bid_req: "2515",
  buy_9bid_req: "50",
  buy_10bid_req: "255",
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
});

/**
 * 없는 코드("999999")·업종코드("001")·소문자 접미사("005930_al")는 셋 다 rc=0에 전 필드
 * 공백으로 돌아온다 — 에러가 아니라 빈 껍데기다(실측 2026-08-04). 그대로 렌더하면 값이
 * 전부 "-"인 표가 나가므로 포맷터가 먼저 걸러야 한다.
 */
const blank = quoteTableResponseSchema.parse({
  stk_cd: "",
  stk_nm: "",
  date: "",
  tm: "",
  cur_prc: "",
  smbol: "",
  flu_rt: "",
  trde_qty: "",
  tot_sel_req: "",
  tot_buy_req: "",
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
});

describe("formatOrderbook", () => {
  it("통합 호가를 10단계씩 매도→매수 순서로 렌더한다", () => {
    const out = formatOrderbook(samsung, "005930", MODE);

    expect(out).toContain(`[${MODE}] 삼성전자 (005930) 호가 — 기준시각 14:04:52`);
    expect(out).toContain("| 매도10 | 235,500 | 28,080 |");
    expect(out).toContain("| 매도1 | 231,000 | 31,774 |");
    expect(out).toContain("| 매수1 | 230,500 | 35,963 |");
    expect(out).toContain("| 매수10 | 226,000 | 130,806 |");

    // 매도10이 매도1보다, 매도1이 매수1보다 위 — 실제 호가창 배열
    expect(out.indexOf("| 매도10 |")).toBeLessThan(out.indexOf("| 매도1 |"));
    expect(out.indexOf("| 매도1 |")).toBeLessThan(out.indexOf("| 매수1 |"));
    expect(out.indexOf("| 매수1 |")).toBeLessThan(out.indexOf("| 매수10 |"));
  });

  it("응답의 _AL 접미사를 떼고 시세 요약을 붙인다", () => {
    const out = formatOrderbook(samsung, "005930", MODE);

    expect(out).toContain("(005930)");
    expect(out).not.toContain("005930_AL");
    expect(out).toContain("현재가 230,750원 (-3.65% 하락) · 거래량 37,580,265주");
  });

  it("하락 종목의 호가를 음수로 렌더하지 않는다", () => {
    // 가격 문자열의 `-`는 값의 부호가 아니라 전일대비 방향 — parseKiwoomPrice의 존재 이유
    const out = formatOrderbook(samsung, "005930", MODE);

    expect(out).not.toContain("-231,000");
    expect(out).not.toContain("-230,500");
  });

  it("총잔량과 매수/매도 잔량비를 계산한다", () => {
    const out = formatOrderbook(samsung, "005930", MODE);

    expect(out).toContain("총잔량 — 매도 355,859 / 매수 1,786,226");
    expect(out).toContain("매수/매도 잔량비 5.02배"); // 1,786,226 / 355,859
    expect(out).toContain("통합 기준");
  });

  it("호가 간격이 균등하지 않은 ETF도 응답 순서대로 렌더한다", () => {
    const out = formatOrderbook(kodex, "069500", MODE);

    expect(out).toContain("| 매수1 | 97,305 | 50 |");
    expect(out).toContain("| 매수2 | 97,295 | 1,200 |");
    expect(out).toContain("| 매수3 | 97,280 | 15,554 |");
    expect(out).toContain("| 매도10 | 97,365 | 14 |");
  });

  it("빈 껍데기 응답은 표 대신 안내로 답한다", () => {
    const out = formatOrderbook(blank, "999999", MODE);

    expect(out).toContain("999999 호가를 찾을 수 없습니다");
    expect(out).toContain("search_stock");
    expect(out).not.toContain("| 매도1 |");
  });
});
