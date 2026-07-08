import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/sleep.js", () => ({ sleep: vi.fn(() => Promise.resolve()) }));

import { classifyInstrument, isLikelyEtf, mapEtfTaxonType, type TaxType } from "../src/isa/classify.js";
import { classifyInstruments, clearEtfTaxonCache } from "../src/isa/classify-etf.js";
import type { KiwoomClient } from "../src/kiwoom/client.js";

type Handler = (code: string) => Record<string, unknown> | Error;

/** Minimal KiwoomClient stand-in: routes ka40002 bodies through `handler`. */
function fakeClient(handler: Handler) {
  const call = vi.fn(async (req: { apiId: string; body: Record<string, string> }) => {
    const out = handler(req.body.stk_cd);
    if (out instanceof Error) throw out;
    return { json: { return_code: 0, ...out }, hasNext: false, nextKey: "" };
  });
  return { client: { call } as unknown as KiwoomClient, call };
}

beforeEach(() => clearEtfTaxonCache());
afterEach(() => vi.clearAllMocks());

describe("mapEtfTaxonType", () => {
  it("maps 비과세 to DOMESTIC_EQUITY and 보유기간과세 to TAXABLE", () => {
    expect(mapEtfTaxonType("비과세")).toBe("DOMESTIC_EQUITY");
    expect(mapEtfTaxonType("보유기간과세")).toBe("TAXABLE");
  });

  it("trims surrounding whitespace", () => {
    expect(mapEtfTaxonType("  비과세 ")).toBe("DOMESTIC_EQUITY");
  });

  it("returns null for empty or unrecognized values", () => {
    expect(mapEtfTaxonType("")).toBeNull();
    expect(mapEtfTaxonType("기타")).toBeNull();
  });
});

describe("isLikelyEtf", () => {
  it("recognizes ETF brand prefixes case-insensitively", () => {
    expect(isLikelyEtf("KODEX 200")).toBe(true);
    expect(isLikelyEtf("tiger 미국S&P500")).toBe(true);
  });

  it("rejects individual stock names", () => {
    expect(isLikelyEtf("삼성전자")).toBe(false);
    expect(isLikelyEtf("SK하이닉스")).toBe(false);
  });
});

describe("classifyInstruments", () => {
  it("uses ka40002 taxation type over the name heuristic and upgrades confidence", async () => {
    // 휴리스틱만으로는 유형 미확인 → TAXABLE(추정)
    expect(classifyInstrument("999999", "KODEX 신재생에너지테마").confident).toBe(false);

    const { client, call } = fakeClient(() => ({ stk_nm: "KODEX 신재생에너지테마", etftxon_type: "비과세" }));
    const map = await classifyInstruments(client, [{ code: "999999", name: "KODEX 신재생에너지테마" }]);

    const c = map.get("999999")!;
    expect(c.taxType).toBe("DOMESTIC_EQUITY");
    expect(c.confident).toBe(true);
    expect(c.reason).toContain("키움 과세유형: 비과세");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("lets ka40002 flip a heuristic DOMESTIC_EQUITY to TAXABLE", async () => {
    // "KODEX 200" 휴리스틱은 국내주식형이지만 실제 과세유형이 보유기간과세면 과세대상.
    expect(classifyInstrument("069500", "KODEX 200").taxType).toBe("DOMESTIC_EQUITY");

    const { client } = fakeClient(() => ({ stk_nm: "KODEX 200", etftxon_type: "보유기간과세" }));
    const map = await classifyInstruments(client, [{ code: "069500", name: "KODEX 200" }]);
    expect(map.get("069500")!.taxType).toBe("TAXABLE");
  });

  it("falls back to the heuristic when the ka40002 call fails", async () => {
    const { client, call } = fakeClient(() => new Error("network down"));
    const map = await classifyInstruments(client, [{ code: "999999", name: "KODEX 신재생에너지테마" }]);

    const c = map.get("999999")!;
    expect(c.taxType).toBe("TAXABLE");
    expect(c.confident).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("honors overrides without calling the API", async () => {
    const { client, call } = fakeClient(() => ({ stk_nm: "KODEX 200", etftxon_type: "비과세" }));
    const overrides = new Map<string, TaxType>([["069500", "TAXABLE"]]);
    const map = await classifyInstruments(client, [{ code: "069500", name: "KODEX 200" }], overrides);

    const c = map.get("069500")!;
    expect(c.taxType).toBe("TAXABLE");
    expect(c.reason).toBe("수동 지정");
    expect(call).not.toHaveBeenCalled();
  });

  it("does not call the API for individual stocks", async () => {
    const { client, call } = fakeClient(() => ({ stk_nm: "", etftxon_type: "" }));
    const map = await classifyInstruments(client, [{ code: "005930", name: "삼성전자" }]);

    expect(map.get("005930")!.taxType).toBe("DOMESTIC_EQUITY");
    expect(call).not.toHaveBeenCalled();
  });

  it("dedups repeated codes to a single ka40002 call", async () => {
    const { client, call } = fakeClient(() => ({ stk_nm: "KODEX 200", etftxon_type: "보유기간과세" }));
    const map = await classifyInstruments(client, [
      { code: "069500", name: "KODEX 200" }, // realized
      { code: "069500", name: "KODEX 200" }, // unrealized (same holding)
    ]);

    expect(map.get("069500")!.taxType).toBe("TAXABLE");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("queries ka40002 for a brand-unmatched ETF flagged by the master-list ETF gate", async () => {
    // 브랜드 접두어가 없어 이름만으론 개별주식으로 보이지만, 마스터리스트가 ETF로 표시.
    const name = "생소한이름 채권혼합"; // isLikelyEtf=false
    expect(isLikelyEtf(name)).toBe(false);
    // etfCodes 없이는 개별주식으로 오분류(조회 안 함).
    expect(classifyInstrument("900001", name).taxType).toBe("DOMESTIC_EQUITY");

    const { client, call } = fakeClient(() => ({ stk_nm: name, etftxon_type: "보유기간과세" }));
    const map = await classifyInstruments(
      client,
      [{ code: "900001", name }],
      undefined,
      new Set(["900001"]),
    );

    const c = map.get("900001")!;
    expect(call).toHaveBeenCalledTimes(1); // 마스터리스트 ETF 게이트 덕에 ka40002 호출됨
    expect(c.taxType).toBe("TAXABLE");
    expect(c.confident).toBe(true);
    expect(c.reason).toContain("키움 과세유형");
  });

  it("still skips ka40002 for a genuine individual stock even with an ETF-code set", async () => {
    const { client, call } = fakeClient(() => ({ stk_nm: "", etftxon_type: "" }));
    const map = await classifyInstruments(
      client,
      [{ code: "005930", name: "삼성전자" }],
      undefined,
      new Set(["900001"]), // 다른 코드만 ETF — 005930은 여전히 개별주식
    );

    expect(map.get("005930")!.taxType).toBe("DOMESTIC_EQUITY");
    expect(call).not.toHaveBeenCalled();
  });
});
