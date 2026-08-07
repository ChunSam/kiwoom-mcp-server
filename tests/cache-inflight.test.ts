import { afterEach, describe, expect, it, vi } from "vitest";

// sector-list는 5개 시장구분 사이에 1.1초씩 쉰다 — 레이트리밋용이라 테스트에서는 죽인다.
vi.mock("../src/utils/sleep.js", () => ({ sleep: vi.fn(() => Promise.resolve()) }));

import { clearBrokerCodeCache, loadBrokerCodes } from "../src/kiwoom/broker-list.js";
import type { KiwoomClient } from "../src/kiwoom/client.js";
import { clearMasterListCache, loadMasterList } from "../src/kiwoom/master-list.js";
import { clearSectorListCache, loadSectorList } from "../src/kiwoom/sector-list.js";

/**
 * 세 마스터 캐시는 결과가 도착한 **뒤에야** 캐시를 채운다. 캐시가 콜드일 때 tool 두 개가
 * 동시에 들어오면 각자 전체 시퀀스를 처음부터 돌아 ~1 req/s 제한을 밀어붙였다
 * (ka10099 2콜 · ka10101 5콜). TokenManager가 토큰 발급에 쓰는 in-flight 공유를 붙였고,
 * 이 테스트가 "동시 호출은 TR을 한 번만 부른다"를 고정한다.
 */

/** 응답을 수동으로 풀 수 있는 지연 client 스텁 — 동시성 창을 열어 두려고 쓴다. */
function deferredClient(payload: (body: Record<string, unknown>) => unknown) {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const call = vi.fn(async ({ body }: { body: Record<string, unknown> }) => {
    await gate;
    return { json: { return_code: 0, ...(payload(body) as object) }, hasNext: false, nextKey: "" };
  });
  return { client: { call } as unknown as KiwoomClient, call, release };
}

afterEach(() => {
  clearMasterListCache();
  clearSectorListCache();
  clearBrokerCodeCache();
});

describe("마스터 캐시 in-flight 공유", () => {
  it("loadMasterList — 동시 호출 2건이 ka10099를 2콜만 부른다 (4콜이 아니라)", async () => {
    const { client, call, release } = deferredClient(() => ({
      list: [{ code: "005930", name: "삼성전자", lastPrice: "61300", marketName: "거래소" }],
    }));

    const both = Promise.all([loadMasterList(client), loadMasterList(client)]);
    release();
    const [a, b] = await both;

    // ka10099는 코스피·코스닥 2콜이 한 세트다. 공유가 없으면 4콜이 나간다.
    expect(call).toHaveBeenCalledTimes(2);
    expect(a).toBe(b); // 같은 배열 인스턴스를 공유한다
  });

  it("loadSectorList — 동시 호출 2건이 ka10101을 5콜만 부른다 (10콜이 아니라)", async () => {
    const { client, call, release } = deferredClient((body) => ({
      list: [{ marketCode: String(body.mrkt_tp), code: "001", name: "종합" }],
    }));

    const both = Promise.all([loadSectorList(client), loadSectorList(client)]);
    release();
    await both;

    expect(call).toHaveBeenCalledTimes(5); // SECTOR_CODE_MARKETS 5개 시장구분
  });

  it("loadBrokerCodes — 동시 호출 3건이 ka10102를 1콜만 부른다", async () => {
    const { client, call, release } = deferredClient(() => ({
      list: [{ code: "003", name: "한국투자증권", gb: "0" }],
    }));

    const all = Promise.all([loadBrokerCodes(client), loadBrokerCodes(client), loadBrokerCodes(client)]);
    release();
    await all;

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("in-flight가 끝난 뒤의 호출은 캐시를 쓴다 (재적재하지 않는다)", async () => {
    const { client, call, release } = deferredClient(() => ({
      list: [{ code: "003", name: "한국투자증권", gb: "0" }],
    }));

    release();
    await loadBrokerCodes(client);
    await loadBrokerCodes(client);

    expect(call).toHaveBeenCalledTimes(1);
  });

  /**
   * ka10099 행에는 매 거래일 바뀌는 `lastPrice`(전일종가)가 실려 있는데 12h TTL은 경과시간만
   * 본다. 23:00 KST에 채운 캐시는 다음 날 11:00까지 살아남아 하루 묵은 종가를 준다.
   */
  it("KST 날짜가 바뀌면 TTL이 남아 있어도 다시 적재한다", async () => {
    const { client, call, release } = deferredClient(() => ({
      list: [{ code: "005930", name: "삼성전자", lastPrice: "61300", marketName: "거래소" }],
    }));
    release();

    vi.useFakeTimers();
    try {
      // 2026-08-07 23:00 KST = 14:00 UTC
      vi.setSystemTime(new Date("2026-08-07T14:00:00Z"));
      await loadMasterList(client);
      expect(call).toHaveBeenCalledTimes(2);

      // 같은 KST 날짜 안이면 캐시를 쓴다.
      vi.setSystemTime(new Date("2026-08-07T14:30:00Z"));
      await loadMasterList(client);
      expect(call).toHaveBeenCalledTimes(2);

      // 2026-08-08 09:00 KST = 00:00 UTC — 12h TTL은 아직 남았지만 날짜가 넘어갔다.
      vi.setSystemTime(new Date("2026-08-08T00:00:00Z"));
      await loadMasterList(client);
      expect(call).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("적재가 실패하면 in-flight를 놓아 준다 (다음 호출이 재시도된다)", async () => {
    let attempts = 0;
    const client = {
      call: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
        return { json: { return_code: 0, list: [{ code: "003", name: "한투", gb: "0" }] }, hasNext: false, nextKey: "" };
      }),
    } as unknown as KiwoomClient;

    // 실패한 promise를 in-flight에 남겨 두면 이후 호출이 영구히 같은 에러를 받는다.
    await expect(loadBrokerCodes(client)).rejects.toThrow("boom");
    await expect(loadBrokerCodes(client)).resolves.toHaveLength(1);
  });
});
