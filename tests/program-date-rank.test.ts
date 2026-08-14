import { describe, expect, it, vi } from "vitest";

// 페이지 간 1.1초 대기를 실제로 태우면 이 파일 하나가 스위트를 20초 넘게 늘린다.
vi.mock("../src/utils/sleep.js", () => ({ sleep: vi.fn(() => Promise.resolve()) }));

import { fetchProgramStockRank } from "../src/kiwoom/api.js";
import type { KiwoomClient } from "../src/kiwoom/client.js";
import { programStockRankItemSchema } from "../src/kiwoom/types.js";
import { formatProgramStockRank } from "../src/tools/program-trading.js";

const MODE = "실전투자";

// ── ka90004 종목별프로그램매매현황 — REAL 실측 2026-08-10 마감 후, 코스피 통합(_AL) ──
// 2,472행 전량에서 뽑았다: 순매수 상위 3 / 순매도 상위 2 / 프로그램 매매가 없는 행 1.
// 마지막 행이 중요하다 — 코스피 2,472행 중 1,685행이 이 모양이라 걸러내지 않으면
// 순위표가 0으로 채워진다.
const rows = [
  {
    stk_cd: "005380_AL",
    stk_nm: "현대차",
    cur_prc: "+408500",
    flu_sig: "2",
    pred_pre: "+13000",
    buy_cntr_qty: "283",
    buy_cntr_amt: "114501",
    sel_cntr_qty: "157",
    sel_cntr_amt: "63642",
    netprps_prica: "50859",
    all_trde_rt: "+1.05",
  },
  {
    stk_cd: "042700_AL",
    stk_nm: "한미반도체",
    cur_prc: "+206500",
    flu_sig: "2",
    pred_pre: "+14200",
    buy_cntr_qty: "500",
    buy_cntr_amt: "101436",
    sel_cntr_qty: "271",
    sel_cntr_amt: "55121",
    netprps_prica: "46315",
    all_trde_rt: "+0.92",
  },
  {
    stk_cd: "005930_AL",
    stk_nm: "삼성전자",
    cur_prc: "-230500",
    flu_sig: "5",
    pred_pre: "-500",
    buy_cntr_qty: "5025",
    buy_cntr_amt: "1165590",
    sel_cntr_qty: "8662",
    sel_cntr_amt: "2004848",
    netprps_prica: "-839258",
    all_trde_rt: "+18.71",
  },
  {
    stk_cd: "000660_AL",
    stk_nm: "SK하이닉스",
    cur_prc: "-1420000",
    flu_sig: "5",
    pred_pre: "-2000",
    buy_cntr_qty: "1408",
    buy_cntr_amt: "2023661",
    sel_cntr_qty: "1712",
    sel_cntr_amt: "2453395",
    netprps_prica: "-429734",
    all_trde_rt: "+26.42",
  },
  {
    stk_cd: "005935_AL",
    stk_nm: "삼성전자우",
    cur_prc: "+172000",
    flu_sig: "2",
    pred_pre: "+1900",
    buy_cntr_qty: "0",
    buy_cntr_amt: "0",
    sel_cntr_qty: "0",
    sel_cntr_amt: "0",
    netprps_prica: "0",
    all_trde_rt: "+0.00",
  },
].map((r) => programStockRankItemSchema.parse(r));

describe("formatProgramStockRank", () => {
  it("서버가 정렬해 주지 않으므로 순매수 내림차순으로 다시 세운다", () => {
    const text = formatProgramStockRank(rows, "net_buy", "kospi", "20260810", 20, false, MODE);
    expect(text).toContain("2026-08-10 코스피 프로그램 순매수 상위 (2종목)");
    const body = text.slice(text.indexOf("|---"));
    expect(body.indexOf("현대차")).toBeLessThan(body.indexOf("한미반도체"));
    // 응답 순서에서는 삼성전자·SK하이닉스가 앞이지만 순매수 방향에서는 빠져야 한다.
    expect(text).not.toContain("삼성전자 |");
  });

  it("순매도 방향은 같은 모수를 반대로 세운다", () => {
    const text = formatProgramStockRank(rows, "net_sell", "kospi", "20260810", 20, false, MODE);
    expect(text).toContain("코스피 프로그램 순매도 상위 (2종목)");
    const body = text.slice(text.indexOf("|---"));
    expect(body.indexOf("삼성전자")).toBeLessThan(body.indexOf("SK하이닉스"));
    expect(text).toContain("| 삼성전자 | 005930 | 230,500 | -839,258 | 1,165,590 | 2,004,848 | 5,025 | 8,662 | 18.71% |");
  });

  /**
   * `cur_prc`의 `-`는 값의 부호가 아니라 전일대비 방향이다 — parseKiwoomNumber를 쓰면
   * 삼성전자 종가가 −230,500으로 렌더된다. 반대로 `netprps_prica`의 `-`는 값의 부호라
   * 그대로 살아야 한다. 한 행 안에서 규약이 갈리는 자리다.
   */
  it("현재가는 절대값, 순매수는 부호를 살린다", () => {
    const text = formatProgramStockRank(rows, "net_sell", "kospi", "20260810", 1, false, MODE);
    expect(text).toContain("| 230,500 |");
    expect(text).not.toContain("| -230,500 |");
    expect(text).toContain("-839,258");
  });

  // 거래비중은 방향이 아니라 크기라 `+`가 붙으면 안 된다 (4,292행 전부 양수).
  it("거래비중에는 부호를 붙이지 않는다", () => {
    const text = formatProgramStockRank(rows, "net_sell", "kospi", "20260810", 2, false, MODE);
    expect(text).toContain("26.42%");
    expect(text).not.toContain("+26.42%");
  });

  it("프로그램 매매가 없는 종목은 순위 모수에서 뺀다", () => {
    const text = formatProgramStockRank(rows, "net_buy", "kospi", "20260810", 20, false, MODE);
    expect(text).not.toContain("삼성전자우");
  });

  it("전량을 못 받았으면 '뒤가 잘렸다'가 아니라 '일부 종목이 빠졌다'로 알린다", () => {
    const text = formatProgramStockRank(rows, "net_buy", "kospi", "20260810", 20, true, MODE);
    expect(text).toContain("일부 종목이 빠졌을 수 있습니다");
    const clean = formatProgramStockRank(rows, "net_buy", "kospi", "20260810", 20, false, MODE);
    expect(clean).not.toContain("일부 종목이 빠졌을 수 있습니다");
  });

  it("모수가 비면 에러가 아니라 원인 힌트를 붙인 안내를 낸다", () => {
    const blank = rows.filter((r) => r.stk_nm === "삼성전자우");
    const text = formatProgramStockRank(blank, "net_buy", "kospi", "20260810", 20, false, MODE);
    expect(text).toContain("종목이 없습니다");
    expect(text).toContain("휴장일이거나");
  });

  /**
   * 스키마는 top 50까지 받는데 이 view는 20으로 깎는다(페이지 예산이 곧 순위의 모수라서).
   * 깎는 것 자체는 맞지만 출력에 아무 말이 없으면 사용자는 50을 요청하고 20을 받은 줄 모른다 —
   * 이유가 입력 스키마의 describe에만 있고 그건 사용자에게 안 보인다.
   */
  it("top을 상한으로 깎았으면 그 사실을 출력에 밝힌다", () => {
    const text = formatProgramStockRank(rows, "net_buy", "kospi", "20260810", 50, false, MODE);
    expect(text).toContain("요청하신 50종목 대신 상위 20종목만");
    const within = formatProgramStockRank(rows, "net_buy", "kospi", "20260810", 20, false, MODE);
    expect(within).not.toContain("요청하신");
  });

  it("단위가 갈리는 것을 각주로 밝힌다", () => {
    const text = formatProgramStockRank(rows, "net_buy", "kospi", "20260810", 20, false, MODE);
    expect(text).toContain("**백만원**");
    expect(text).toContain("**천주**");
    expect(text).toContain("통합 기준");
  });
});

/**
 * 요청 body 고정 — ka90004는 `mrkt_tp`가 "0"·"000"이면 rc=0에 **빈 행 1개**를 준다.
 * 에러가 아니라서 포맷터 테스트로는 안 잡히고 "그 날은 매매가 없었다"로 읽힌다.
 */
describe("fetchProgramStockRank 요청", () => {
  function captureClient(pages: number) {
    const calls: Array<Record<string, unknown>> = [];
    let n = 0;
    const client = {
      call: vi.fn(async (req: { body: Record<string, unknown> }) => {
        calls.push(req.body);
        n += 1;
        return {
          json: { return_code: 0, stk_prm_trde_prst: [] },
          hasNext: n < pages,
          nextKey: `k${n}`,
        };
      }),
    } as unknown as KiwoomClient;
    return { client, calls };
  }

  it("코스피/코스닥 코드와 통합 기준을 body에 싣는다", async () => {
    const { client, calls } = captureClient(1);
    await fetchProgramStockRank(client, "kosdaq", "20260810");

    expect(calls[0]).toEqual({ dt: "20260810", mrkt_tp: "P10102", stex_tp: "3" });
  });

  it("cont-yn이 끝날 때까지 이어 받고 상한에서 멈추면 truncated로 알린다", async () => {
    const { client, calls } = captureClient(3);
    const done = await fetchProgramStockRank(client, "kospi", "20260810");
    expect(calls).toHaveLength(3);
    expect(done.truncated).toBe(false);

    // MAX_PAGES(20)에서 멈추는 경우 — 아직 남아 있으므로 truncated
    const { client: c2, calls: calls2 } = captureClient(99);
    const capped = await fetchProgramStockRank(c2, "kospi", "20260810");
    expect(calls2).toHaveLength(20);
    expect(capped.truncated).toBe(true);
  });
});
