import { afterEach, describe, expect, it, vi } from "vitest";

// loadSectorList가 5개 시장구분 사이에 1.1초씩 쉰다 — 레이트리밋용이라 테스트에서는 죽인다.
vi.mock("../src/utils/sleep.js", () => ({ sleep: vi.fn(() => Promise.resolve()) }));

import { clearSectorListCache, resolveSectorCode, sectorNameFromCache } from "../src/kiwoom/sector-list.js";
import { sectorCodeItemSchema, sectorNetBuyItemSchema } from "../src/kiwoom/types.js";
import { formatSectorFlow } from "../src/tools/sector-flow.js";

const MODE = "모의투자";

// Fixtures captured verbatim from mockapi 2026-08-03 (ka10051, stex_tp=1 KRX,
// amt_qty_tp=0 금액). REAL returned the same shapes the same day.
// 지수·등락률이 ×100 정수인 것에 주의: 종합(KOSPI) "+659545"/"1791" 은 같은 시각
// ka20003의 "+6595.45"/"+17.91"과 같은 값이다.
const kospiRows = [
  {
    inds_cd: "001", inds_nm: "종합(KOSPI)", cur_prc: "+659545", flu_rt: "1791", trde_qty: "434445",
    ind_netprps: "-82840", frgnr_netprps: "+72773", orgn_netprps: "+11503", sc_netprps: "-6663",
    insrnc_netprps: "-1071", invtrt_netprps: "+12080", bank_netprps: "-35", endw_netprps: "+1647",
    samo_fund_netprps: "+5115", etc_corp_netprps: "-1073",
  },
  {
    inds_cd: "002", inds_nm: "대형주", cur_prc: "+724963", flu_rt: "1912", trde_qty: "166761",
    ind_netprps: "-79091", frgnr_netprps: "+69055", orgn_netprps: "+11395", sc_netprps: "-6301",
    insrnc_netprps: "-993", invtrt_netprps: "+11956", bank_netprps: "+59", endw_netprps: "+1876",
    samo_fund_netprps: "+4354", etc_corp_netprps: "-1026",
  },
  {
    inds_cd: "003", inds_nm: "중형주", cur_prc: "+367674", flu_rt: "511", trde_qty: "120174",
    ind_netprps: "-23", frgnr_netprps: "+414", orgn_netprps: "-409", sc_netprps: "-373",
    insrnc_netprps: "-83", invtrt_netprps: "-25", bank_netprps: "-87", endw_netprps: "-232",
    samo_fund_netprps: "+404", etc_corp_netprps: "+26",
  },
  {
    inds_cd: "004", inds_nm: "소형주", cur_prc: "+220140", flu_rt: "428", trde_qty: "134142",
    ind_netprps: "-467", frgnr_netprps: "+401", orgn_netprps: "+83", sc_netprps: "+14",
    insrnc_netprps: "+1", invtrt_netprps: "+20", bank_netprps: "-7", endw_netprps: "+4",
    samo_fund_netprps: "+51", etc_corp_netprps: "-11",
  },
].map((r) => sectorNetBuyItemSchema.parse(r));

describe("formatSectorFlow", () => {
  it("renders the sector table with the investor breakdown", () => {
    const out = formatSectorFlow(kospiRows, "kospi", "amount", "foreign", 15, null, MODE);

    expect(out).toContain("[모의투자] 코스피 업종별 투자자 순매수 — 최근 거래일");
    expect(out).toContain("외국인 순매수 상위 4개 업종, 단위: 백만원");
    expect(out).toContain("| 업종 | 코드 | 지수 | 등락률 | 개인 | 외국인 | 기관계 | 증권 | 투신 | 연기금 | 사모 |");
    expect(out).toContain("| 종합(KOSPI) | 001 |");
  });

  // ka20003이 같은 시각에 "+6595.45"/"+17.91"을 주는 값이다 — ÷100을 빠뜨리면
  // 지수가 659,545, 등락률이 +1791%로 찍힌다.
  it("divides 지수 and 등락률 by 100", () => {
    const out = formatSectorFlow(kospiRows, "kospi", "amount", "foreign", 15, null, MODE);

    expect(out).toContain("6,595.45");
    expect(out).toContain("+17.91%");
    expect(out).not.toContain("659,545");
    expect(out).not.toContain("+1791");
  });

  it("sorts by the requested investor group", () => {
    const codeOrder = (sort: Parameters<typeof formatSectorFlow>[3]) =>
      formatSectorFlow(kospiRows, "kospi", "amount", sort, 15, null, MODE)
        .split("\n")
        .filter((line) => /^\| \S+ \| \d{3} \|/.test(line))
        .map((line) => line.split(" | ")[1]);

    // 외국인: 001(+72,773) > 002(+69,055) > 003(+414) > 004(+401)
    expect(codeOrder("foreign")).toEqual(["001", "002", "003", "004"]);
    // 개인은 전부 순매도라 덜 판 업종이 위로 온다: 003(-23) > 004(-467) > 002 > 001
    expect(codeOrder("individual")).toEqual(["003", "004", "002", "001"]);
    // 등락률: 002(19.12) > 001(17.91) > 003(5.11) > 004(4.28)
    expect(codeOrder("change")).toEqual(["002", "001", "003", "004"]);
  });

  it("labels the unit and switches it with the unit argument", () => {
    const amount = formatSectorFlow(kospiRows, "kospi", "amount", "foreign", 15, null, MODE);
    const quantity = formatSectorFlow(kospiRows, "kosdaq", "quantity", "foreign", 15, null, MODE);

    expect(amount).toContain("단위: 백만원");
    expect(quantity).toContain("단위: 천주");
    expect(quantity).toContain("코스닥 업종별 투자자 순매수");
  });

  it("caps at top and says how many sectors were held back", () => {
    const out = formatSectorFlow(kospiRows, "kospi", "amount", "foreign", 2, null, MODE);

    expect(out).toContain("상위 2개 업종");
    expect(out).toContain("전체 4개 업종 중 2개만 표시했습니다");
    expect(out).not.toContain("| 중형주 |");
  });

  it("shows the base date when one was requested", () => {
    const out = formatSectorFlow(kospiRows, "kospi", "amount", "foreign", 15, "20260731", MODE);

    expect(out).toContain("기준일 20260731");
  });

  it("returns a plain notice when the TR returns no rows", () => {
    const out = formatSectorFlow([], "kospi", "amount", "foreign", 15, null, MODE);

    expect(out).toContain("업종별 투자자 순매수 내역이 없습니다");
    expect(out).not.toContain("|");
  });
});

// ka10101 마스터 (실측 2026-08-03): 5개 시장구분 합쳐 124행, code는 전부 3자리.
// 이름 중복이 20건이라 "화학"만 해도 코스피 008 / 코스닥 119다.
const sectorMaster = [
  { marketCode: "0", code: "001", name: "종합(KOSPI)" },
  { marketCode: "0", code: "008", name: "화학" },
  { marketCode: "0", code: "022", name: "증권" },
  { marketCode: "0", code: "029", name: "IT 서비스" },
  { marketCode: "1", code: "101", name: "종합(KOSDAQ)" },
  { marketCode: "1", code: "119", name: "화학" },
  { marketCode: "7", code: "703", name: "KRX반도체" },
].map((r) => sectorCodeItemSchema.parse(r));

/** loadSectorList가 부르는 ka10101을 대신하는 최소 client 스텁. */
const stubClient = (items = sectorMaster) =>
  ({
    call: async ({ body }: { body: Record<string, unknown> }) => ({
      json: { return_code: 0, list: items.filter((i) => i.marketCode === body.mrkt_tp) },
      hasNext: false,
      nextKey: undefined,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("resolveSectorCode", () => {
  afterEach(() => clearSectorListCache());

  it("passes a 3-digit code through untouched", async () => {
    expect(await resolveSectorCode(stubClient(), "001")).toBe("001");
  });

  it("resolves a unique sector name to its code", async () => {
    expect(await resolveSectorCode(stubClient(), "증권")).toBe("022");
    expect(await resolveSectorCode(stubClient(), "KRX반도체")).toBe("703");
  });

  it("ignores spacing and case when matching names", async () => {
    expect(await resolveSectorCode(stubClient(), "it서비스")).toBe("029");
  });

  // 조용히 코스피를 고르면 사용자가 의도한 시장이 아닌 표를 그럴듯하게 돌려주게 된다.
  it("refuses to guess when a name exists in more than one market", async () => {
    await expect(resolveSectorCode(stubClient(), "화학")).rejects.toThrow(
      /여러 업종에 해당합니다.*008\(코스피 화학\).*119\(코스닥 화학\)/s,
    );
  });

  it("explains what to do when nothing matches", async () => {
    await expect(resolveSectorCode(stubClient(), "존재하지않는업종")).rejects.toThrow(
      /찾지 못했습니다/,
    );
  });

  it("warms the cache so formatters can label a bare code", async () => {
    expect(sectorNameFromCache("008")).toBeNull();
    await resolveSectorCode(stubClient(), "001");
    expect(sectorNameFromCache("008")).toBe("화학");
  });
});
