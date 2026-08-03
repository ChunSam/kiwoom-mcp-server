import { describe, expect, it } from "vitest";

import { expectedExecutionItemSchema } from "../src/kiwoom/types.js";
import { formatExpectedExecution } from "../src/tools/expected-execution.js";

const MODE = "모의투자";

// 07:45와 08:34 KST에 mock·REAL 양쪽이 rc=0 + 0행으로 답했다 (실측 2026-08-03).
// 같은 날 10:43에는 100행이 왔으므로 "동시호가 전용"은 아니고, 어느 구간에 제공되는지는
// 키움이 문서화하지 않았다. 어느 쪽이든 빈 결과는 오류가 아니다 — 그 구분이 전달되지
// 않으면 사용자가 종목코드를 의심하거나 서버가 고장났다고 읽게 된다.
describe("formatExpectedExecution — 빈 결과", () => {
  it("explains the empty result instead of reporting a failure", () => {
    const out = formatExpectedExecution([], "all", "rise", 15, MODE);

    expect(out).toContain("전체 예상체결 예상 상승률 순위가 없습니다");
    expect(out).toContain("제공하지 않는 시간대일 수 있습니다");
    expect(out).not.toContain("|");
  });

  it("points at the tools that do work outside the auction", () => {
    const out = formatExpectedExecution([], "kospi", "fall", 15, MODE);

    expect(out).toContain("get_ranking");
    expect(out).toContain("get_market_movers");
  });
});

// ── 라이브 fixture: REAL 도메인 2026-08-03 10:43 KST 정규장 중 실측 (ka10029,
// mrkt_tp=000/001, sort_tp=1/4). 07:45·08:34에는 mock·REAL 모두 0행이었고 여기서는
// 100행이 왔다 — 즉 이 TR은 동시호가 전용이 아니다.
// 하락률 행의 flu_rt "--13.09"는 키움의 이중부호이고, exp_cntr_pric의 부호는 값의
// 부호가 아니라 기준가 대비 방향이다.
const riseRows = [
  {
    stk_cd: "700030", stk_nm: "하나 S&P 인버스 2X WTI원유 선물 ETN B", exp_cntr_pric: "+4640",
    base_pric: "2900", flu_rt: "+55.44", exp_cntr_qty: "1", sel_req: "1", buy_req: "20000",
  },
  {
    stk_cd: "226340", stk_nm: "본느", exp_cntr_pric: "+2180", base_pric: "1677",
    flu_rt: "+29.99", exp_cntr_qty: "15754", sel_req: "0", buy_req: "3974580",
  },
  {
    stk_cd: "484810", stk_nm: "티엑스알로보틱스", exp_cntr_pric: "+16200", base_pric: "13430",
    flu_rt: "+20.63", exp_cntr_qty: "8925", sel_req: "0", buy_req: "231851",
  },
].map((r) => expectedExecutionItemSchema.parse(r));

const fallRows = [
  {
    stk_cd: "0194M0", stk_nm: "ACE 삼성전자단일종목레버리지", exp_cntr_pric: "-10255",
    base_pric: "11800", flu_rt: "--13.09", exp_cntr_qty: "1601", sel_req: "3342", buy_req: "187",
  },
  {
    stk_cd: "520100", stk_nm: "미래에셋 레버리지 삼성전자 단일종목 ETN", exp_cntr_pric: "-10755",
    base_pric: "12115", flu_rt: "--11.23", exp_cntr_qty: "50", sel_req: "80000", buy_req: "80100",
  },
].map((r) => expectedExecutionItemSchema.parse(r));

describe("formatExpectedExecution — 라이브 데이터", () => {
  it("renders the ranking table with 예상체결가 and 기준가", () => {
    const out = formatExpectedExecution(riseRows, "all", "rise", 15, MODE);

    expect(out).toContain("[모의투자] 전체 예상체결 예상 상승률 상위 (3종목)");
    expect(out).toContain("| 순위 | 종목명 | 코드 | 예상체결가 | 기준가 | 등락률 | 예상체결량 | 매도잔량 | 매수잔량 |");
    expect(out).toContain("| 1 | 하나 S&P 인버스 2X WTI원유 선물 ETN B | 700030 | 4,640원 | 2,900원 | +55.44% |");
    expect(out).toContain("3,974,580주");
  });

  // 하락 종목의 가격에 parseKiwoomNumber를 쓰면 -10,255원으로 렌더된다 — 실제 예상체결가는
  // 10,255원이고 방향은 등락률이 말한다.
  it("shows absolute prices for falling stocks and collapses the doubled sign", () => {
    const out = formatExpectedExecution(fallRows, "kospi", "fall", 15, MODE);

    expect(out).toContain("10,255원");
    expect(out).toContain("-13.09%");
    expect(out).not.toContain("-10,255원");
    expect(out).not.toContain("--13.09");
  });

  it("caps at top and says how many were held back", () => {
    const out = formatExpectedExecution(riseRows, "all", "rise", 2, MODE);

    expect(out).toContain("(2종목)");
    expect(out).toContain("조회된 3종목 중 상위 2종목만 표시했습니다");
    expect(out).not.toContain("티엑스알로보틱스");
  });
});
