import { describe, expect, it, vi } from "vitest";

import { fetchProgramArbitrageBalance, fetchStockProgramIntraday, fetchStockProgramTrend } from "../src/kiwoom/api.js";
import type { KiwoomClient } from "../src/kiwoom/client.js";
import { todayInKst } from "../src/utils/date.js";

/**
 * 프로그램매매 종목 TR들의 **요청 body**를 고정한다 — 응답 포맷터로는 원리상 못 잡는 자리다.
 *
 * ka90013은 v0.48.0 전까지 `_AL` 없이 불려 **KRX 단독 값**을 내보내고 있었고, 포맷터
 * 테스트는 받은 값을 렌더할 뿐이라 전부 초록이었다(거래원 계열이 v0.45~0.46에서 당한 것과
 * 같은 사고). 거래량만 어긋난 게 아니라 부호가 갈렸다 — 005930 20260806 프로그램 순매수가
 * KRX +37,591 / 통합 −59,796이다(REAL 실측 2026-08-09, 응답의 stex_tp도 "KRX"/"통합"으로 갈림).
 */
function captureClient(json: unknown = {}) {
  const calls: Array<{ apiId: string; body: Record<string, unknown> }> = [];
  const client = {
    call: vi.fn(async (req: { apiId: string; body: Record<string, unknown> }) => {
      calls.push({ apiId: req.apiId, body: req.body });
      return { json: { return_code: 0, ...(json as object) }, hasNext: false, nextKey: "" };
    }),
  } as unknown as KiwoomClient;
  return { client, calls };
}

describe("프로그램매매 종목 TR의 거래소 기준", () => {
  it("ka90013(종목 일별)을 _AL로 부른다", async () => {
    const { client, calls } = captureClient({ stk_daly_prm_trde_trnsn: [] });
    await fetchStockProgramTrend(client, "005930", "20260807");

    expect(calls[0]?.apiId).toBe("ka90013");
    expect(calls[0]?.body).toEqual({ amt_qty_tp: "1", stk_cd: "005930_AL", date: "20260807" });
  });

  it("ka90008(종목 시간대별)을 _AL로 부른다", async () => {
    const { client, calls } = captureClient({ stk_tm_prm_trde_trnsn: [] });
    await fetchStockProgramIntraday(client, "005930");

    expect(calls[0]?.apiId).toBe("ka90008");
    expect(calls[0]?.body.stk_cd).toBe("005930_AL");
  });

  // 6자리지만 숫자 전용이 아닌 실제 코드(0156T0, 33626K)에서도 접미사가 붙어야 한다.
  it("영문이 섞인 종목코드에도 접미사를 붙인다", async () => {
    const { client, calls } = captureClient({ stk_daly_prm_trde_trnsn: [], stk_tm_prm_trde_trnsn: [] });
    await fetchStockProgramTrend(client, "0156T0", "");
    await fetchStockProgramIntraday(client, "33626K");

    expect(calls[0]?.body.stk_cd).toBe("0156T0_AL");
    expect(calls[1]?.body.stk_cd).toBe("33626K_AL");
  });
});

describe("효과 없는 필수 파라미터", () => {
  /**
   * ka90008의 `date`는 빈 값이면 rc=2인데 값을 바꿔도 응답이 안 바뀐다 — 20260701을 넣어도
   * 최근 거래일 200행이 전 행 완전 동일하게 온다(20260805·20260806·20260807 대조).
   * 그래서 호출자에게 받지 않고 형식만 채운다. 받는 척하면 사용자가 그 날짜 데이터로 읽는다.
   */
  it("ka90008은 date를 호출자에게서 받지 않고 오늘로 채운다", async () => {
    const { client, calls } = captureClient({ stk_tm_prm_trde_trnsn: [] });
    await fetchStockProgramIntraday(client, "005930");

    expect(calls[0]?.body.date).toBe(todayInKst());
    // 시그니처에 기준일 인자가 없어야 한다 — 있으면 "고를 수 있다"는 착각을 부른다
    expect(fetchStockProgramIntraday.length).toBe(2);
  });

  /**
   * ka90006의 `mrkt_tp`는 P00101과 P10102가 전 필드 동일하다 — 보내면 "시장을 골라
   * 부르고 있다"는 착시를 만들어 각주의 '시장 전체 기준'과 모순된다.
   */
  it("ka90006은 mrkt_tp를 보내지 않고, 필수 파라미터 이름은 date다", async () => {
    const { client, calls } = captureClient({ prm_trde_dfrt_remn_trnsn: [] });
    await fetchProgramArbitrageBalance(client, "20260807");

    expect(calls[0]?.apiId).toBe("ka90006");
    expect(calls[0]?.body).toEqual({ date: "20260807", stex_tp: "3" });
    expect(calls[0]?.body).not.toHaveProperty("mrkt_tp");
    // 통상 표기 `dt`/`base_dt`로 보내면 rc=2가 난다 (실측)
    expect(calls[0]?.body).not.toHaveProperty("dt");
    expect(calls[0]?.body).not.toHaveProperty("base_dt");
  });
});
