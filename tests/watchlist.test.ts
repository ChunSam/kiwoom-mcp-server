import { describe, expect, it } from "vitest";

import {
  stockListItemSchema,
  watchlistGroupItemSchema,
  watchlistStockItemSchema,
  type StockListItem,
} from "../src/kiwoom/types.js";
import {
  findWatchlistGroup,
  formatWatchlist,
  formatWatchlistGroups,
} from "../src/tools/watchlist.js";

const MODE = "모의투자";

// Fixtures mirror live ka01300/ka01301 shapes captured 2026-07-06 (synthetic codes).

const groups = [
  { gcod: "000", name: "관심" },
  { gcod: "003", name: "전자기기" },
  { gcod: "004", name: "IT 대형주" },
].map((g) => watchlistGroupItemSchema.parse(g));

const masterItems: StockListItem[] = [
  { code: "005930", name: "삼성전자", lastPrice: "00061300", marketName: "거래소", upName: "전기/전자", upSizeName: "대형주", state: "", auditInfo: "정상", orderWarning: "0" },
  { code: "000660", name: "SK하이닉스", lastPrice: "00195000", marketName: "거래소", upName: "전기/전자", upSizeName: "대형주", state: "", auditInfo: "정상", orderWarning: "0" },
].map((i) => stockListItemSchema.parse(i));

const nameIndex = new Map(masterItems.map((i) => [i.code, i]));

const stocks = [
  { cod2: "005930", bgb: "0", bgb_clr: "" },
  { cod2: "000660", bgb: "1", bgb_clr: "red" }, // bookmarked
  { cod2: "999999", bgb: "0", bgb_clr: "" }, // not in master list
].map((s) => watchlistStockItemSchema.parse(s));

describe("formatWatchlistGroups", () => {
  it("renders a friendly message when there are no groups", () => {
    expect(formatWatchlistGroups([], MODE)).toContain("등록된 관심종목 그룹이 없습니다");
  });

  it("renders a group table and a get_watchlist hint", () => {
    const text = formatWatchlistGroups(groups, MODE);
    expect(text).toContain("관심종목 그룹 (3개)");
    expect(text).toContain("| 003 | 전자기기 |");
    expect(text).toContain('group="000"');
  });
});

describe("findWatchlistGroup", () => {
  it("matches by exact group code", () => {
    expect(findWatchlistGroup(groups, "003")?.name).toBe("전자기기");
  });

  it("matches by group name, ignoring case and spaces", () => {
    expect(findWatchlistGroup(groups, "전자기기")?.gcod).toBe("003");
    expect(findWatchlistGroup(groups, "it대형주")?.gcod).toBe("004");
  });

  it("returns undefined for an unknown group or empty query", () => {
    expect(findWatchlistGroup(groups, "없는그룹")).toBeUndefined();
    expect(findWatchlistGroup(groups, "  ")).toBeUndefined();
  });
});

describe("formatWatchlist", () => {
  const group = groups[2]!; // "IT 대형주" (004)

  it("renders a friendly message for an empty group", () => {
    const text = formatWatchlist(group, [], nameIndex, MODE);
    expect(text).toContain("관심종목: IT 대형주 (004) — 0종목");
    expect(text).toContain("등록된 종목이 없습니다");
  });

  it("enriches codes with name/시장/전일종가 and marks bookmarks", () => {
    const text = formatWatchlist(group, stocks, nameIndex, MODE);
    expect(text).toContain("관심종목: IT 대형주 (004) — 3종목");
    expect(text).toContain("| 005930 | 삼성전자 | 거래소 | 61,300원 |");
    expect(text).toContain("| 000660 | ⭐ SK하이닉스 | 거래소 | 195,000원 |");
    // unknown code degrades to code-only and is counted
    expect(text).toContain("| 999999 | - | - | - |");
    expect(text).toContain("※ 1개 종목은 상장 마스터에 없어");
  });

  it("falls back to code-only when the master list is unavailable", () => {
    const text = formatWatchlist(group, stocks, new Map(), MODE);
    expect(text).toContain("| 005930 |");
    expect(text).toContain("종목 마스터를 불러오지 못해 코드만 표시했습니다");
  });
});
