import { describe, expect, it, vi } from "vitest";

import {
  fetchBrokerActivity,
  fetchBrokerDropout,
  fetchBrokerStockRank,
  fetchViStocks,
} from "../src/kiwoom/api.js";
import type { KiwoomClient } from "../src/kiwoom/client.js";

/**
 * 거래원 계열 세 TR이 **통합(`_AL`) 기준으로 조회하는지**를 요청 body에서 직접 고정한다.
 *
 * 왜 포맷터 테스트로는 부족한가: v0.45.0~0.46.0이 이 세 TR을 접미사 없이 불러 **KRX 값만**
 * 받고 있었는데, 포맷터는 받은 값을 그대로 렌더할 뿐이라 테스트가 전부 초록이었다.
 * 버그가 요청 쪽에 있으면 응답 포맷터로는 원리상 잡히지 않는다 — 그래서 body를 본다.
 *
 * 실측 근거(REAL 2026-08-08): `stex_tp`는 세 TR 모두 무시하고 `_AL` 접미사만 듣는다.
 * 거래원별로 `KRX + NXT = _AL`이 정확히 맞는다(ka10038 32/32, ka10002 3/3).
 * 접미사가 없으면 **상위 5의 순위 자체가 달라진다** — 005930 매수 1위가 KRX 기준
 * KB증권인데 통합에서는 미래에셋이다.
 */
function captureClient(json: unknown = { return_code: 0 }) {
  const calls: Array<{ apiId: string; body: Record<string, unknown> }> = [];
  const client = {
    call: vi.fn(async (req: { apiId: string; body: Record<string, unknown> }) => {
      calls.push({ apiId: req.apiId, body: req.body });
      return { json: { return_code: 0, ...(json as object) }, hasNext: false, nextKey: "" };
    }),
  } as unknown as KiwoomClient;
  return { client, calls };
}

describe("거래원 계열 TR의 거래소 기준", () => {
  it("ka10002(거래원 상위5)를 _AL로 부른다", async () => {
    const { client, calls } = captureClient();
    await fetchBrokerActivity(client, "005930");

    expect(calls[0]?.apiId).toBe("ka10002");
    expect(calls[0]?.body).toEqual({ stk_cd: "005930_AL" });
  });

  it("ka10038(전 거래원 순위)을 _AL로 부르고 qry_tp는 그대로 넘긴다", async () => {
    const { client, calls } = captureClient({ stk_sec_rank: [] });
    await fetchBrokerStockRank(client, "005930", "net_buy");

    expect(calls[0]?.apiId).toBe("ka10038");
    expect(calls[0]?.body).toEqual({ stk_cd: "005930_AL", qry_tp: "2" });
  });

  it("ka10053(상위 이탈)을 _AL로 부른다", async () => {
    const { client, calls } = captureClient({ tdy_upper_scesn_ori: [] });
    await fetchBrokerDropout(client, "005930");

    expect(calls[0]?.apiId).toBe("ka10053");
    expect(calls[0]?.body).toEqual({ stk_cd: "005930_AL" });
  });

  /**
   * `stex_tp`는 세 TR이 모두 무시한다(1/2/3 응답 지문이 접미사 없음과 동일). 보내면
   * "통합으로 부르고 있다"는 착시를 만들어 접미사가 빠진 걸 못 보게 되므로 넣지 않는다.
   */
  it("stex_tp는 보내지 않는다 — 무시되는 파라미터라 착시만 만든다", async () => {
    const { client, calls } = captureClient({ stk_sec_rank: [], tdy_upper_scesn_ori: [] });
    await fetchBrokerActivity(client, "005930");
    await fetchBrokerStockRank(client, "005930", "all");
    await fetchBrokerDropout(client, "005930");

    for (const c of calls) expect(c.body).not.toHaveProperty("stex_tp");
  });

  // 6자리지만 숫자 전용이 아닌 코드에서도 접미사가 정상적으로 붙어야 한다.
  it("영문이 섞인 종목코드에도 접미사를 붙인다", async () => {
    const { client, calls } = captureClient();
    await fetchBrokerActivity(client, "0156T0");

    expect(calls[0]?.body).toEqual({ stk_cd: "0156T0_AL" });
  });
});

/**
 * ka10054는 같은 부류의 버그가 **반대 방향**으로 났던 자리다 — `stex_tp="3"`은 보내면서
 * `stk_cd`에 접미사를 안 붙였고, 그 조합이 rc=0에 0행이라 종목 지정 조회가 v0.49.0까지
 * 항상 "발동 내역 없음"이었다(REAL 실측 2026-08-10, 정규장 중). 응답이 비어 있을 뿐
 * 에러가 아니라서 포맷터 테스트로는 원리상 안 잡힌다 — 그래서 body를 고정한다.
 */
describe("ka10054(VI 발동종목)의 거래소 기준", () => {
  it("시장 전체 조회는 stex_tp=3 + 빈 stk_cd로 부르고 market 필터를 그대로 싣는다", async () => {
    const { client, calls } = captureClient({ motn_stk: [] });
    await fetchViStocks(client, "kosdaq", "all", "all");

    expect(calls[0]?.apiId).toBe("ka10054");
    expect(calls[0]?.body).toMatchObject({ stk_cd: "", stex_tp: "3", mrkt_tp: "101" });
  });

  it("종목 지정은 _AL을 붙인다 — 접미사가 없으면 rc=0에 0행이다", async () => {
    const { client, calls } = captureClient({ motn_stk: [] });
    await fetchViStocks(client, "all", "all", "all", "000670");

    expect(calls[0]?.body).toMatchObject({ stk_cd: "000670_AL", stex_tp: "3" });
  });

  /**
   * `mrkt_tp`도 종목의 시장과 어긋나면 조용히 0행이다(코스닥 327260 + "001" → 0행).
   * 종목을 이미 지목한 조회에서 시장 필터는 의미가 없으므로 호출자의 market을 무시한다.
   */
  it("종목 지정 시 mrkt_tp를 전체('000')로 고정해 시장 불일치로 비는 걸 막는다", async () => {
    const { client, calls } = captureClient({ motn_stk: [] });
    await fetchViStocks(client, "kospi", "all", "all", "327260");

    expect(calls[0]?.body).toMatchObject({ stk_cd: "327260_AL", mrkt_tp: "000" });
  });

  // 방향·유형 필터는 종목 지정과 함께 정상 동작한다 (530106에서 2행 → 1/1 분할 확인).
  it("방향·유형 필터는 종목 지정과 함께 그대로 넘긴다", async () => {
    const { client, calls } = captureClient({ motn_stk: [] });
    await fetchViStocks(client, "all", "down", "dynamic", "000670");

    expect(calls[0]?.body).toMatchObject({ motn_drc: "2", motn_tp: "2" });
  });
});
