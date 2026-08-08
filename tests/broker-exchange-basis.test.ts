import { describe, expect, it, vi } from "vitest";

import {
  fetchBrokerActivity,
  fetchBrokerDropout,
  fetchBrokerStockRank,
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
