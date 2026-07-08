import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchWatchlistGroupDetail, fetchWatchlistGroups } from "../kiwoom/api.js";
import type { KiwoomClient } from "../kiwoom/client.js";
import { KiwoomApiError } from "../kiwoom/errors.js";
import { loadMasterList } from "../kiwoom/master-list.js";
import {
  normalizeStockCode,
  type StockListItem,
  type WatchlistGroupItem,
  type WatchlistStockItem,
} from "../kiwoom/types.js";
import { formatKRW, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const normalizeName = (s: string) => s.replaceAll(/\s+/g, "").toLowerCase();

export function formatWatchlistGroups(groups: WatchlistGroupItem[], modeLabel: string): string {
  if (groups.length === 0) {
    return (
      `[${modeLabel}] 등록된 관심종목 그룹이 없습니다. ` +
      `영웅문(HTS)에서 관심종목 그룹을 먼저 만들어 주세요.`
    );
  }

  const [first] = groups;
  const lines = [
    `[${modeLabel}] 관심종목 그룹 (${groups.length}개)`,
    "",
    "| 그룹코드 | 그룹명 |",
    "|---|---|",
  ];
  for (const g of groups) {
    lines.push(`| ${g.gcod || "-"} | ${g.name || "-"} |`);
  }
  lines.push(
    "",
    `특정 그룹의 종목을 보려면 get_watchlist에 그룹코드나 그룹명을 넘기세요 ` +
      `(예: group="${first?.gcod ?? ""}" 또는 "${first?.name ?? ""}").`,
  );
  return lines.join("\n");
}

/** Matches by exact group code first, then by (whitespace-insensitive) name. */
export function findWatchlistGroup(
  groups: WatchlistGroupItem[],
  query: string,
): WatchlistGroupItem | undefined {
  const trimmed = query.trim();
  if (trimmed === "") return undefined;
  const q = normalizeName(trimmed);
  return (
    groups.find((g) => g.gcod === trimmed) ?? groups.find((g) => normalizeName(g.name) === q)
  );
}

export function formatWatchlist(
  group: WatchlistGroupItem,
  stocks: WatchlistStockItem[],
  nameIndex: Map<string, StockListItem>,
  modeLabel: string,
): string {
  const title = `[${modeLabel}] 관심종목: ${group.name || "-"} (${group.gcod}) — ${stocks.length}종목`;
  if (stocks.length === 0) {
    return `${title}\n\n(이 그룹에 등록된 종목이 없습니다.)`;
  }

  const lines = [title, "", "| 코드 | 종목명 | 시장 | 전일종가 |", "|---|---|---|---:|"];
  let missing = 0;
  for (const s of stocks) {
    const code = normalizeStockCode(s.cod2);
    const info = nameIndex.get(code);
    if (!info) missing += 1;
    const bookmark = s.bgb && s.bgb !== "0" ? "⭐ " : "";
    const name = `${bookmark}${info?.name || "-"}`;
    const market = info?.marketName || "-";
    const price = info ? formatKRW(parseKiwoomPrice(info.lastPrice)) : "-";
    lines.push(`| ${code} | ${name} | ${market} | ${price} |`);
  }

  if (nameIndex.size === 0) {
    lines.push("", "※ 종목 마스터를 불러오지 못해 코드만 표시했습니다.");
  } else if (missing > 0) {
    lines.push("", `※ ${missing}개 종목은 상장 마스터에 없어 상세정보를 표시하지 못했습니다.`);
  }
  return lines.join("\n");
}

/** Best-effort code→종목 index for name/전일종가 enrichment (no extra per-stock calls). */
async function buildNameIndex(
  client: KiwoomClient,
  stocks: WatchlistStockItem[],
): Promise<Map<string, StockListItem>> {
  if (stocks.length === 0) return new Map();
  try {
    const items = await loadMasterList(client);
    return new Map(items.map((i) => [i.code, i]));
  } catch {
    // Enrichment is optional — fall back to code-only rather than failing the tool.
    return new Map();
  }
}

export function registerWatchlistGroupsTool(server: McpServer): void {
  server.registerTool(
    "get_watchlist_groups",
    {
      title: "관심종목 그룹 목록",
      description:
        "영웅문(HTS)에 저장한 관심종목 그룹 목록(그룹코드+그룹명)을 조회합니다 (키움 ka01300, 읽기 전용). " +
        "특정 그룹의 종목은 get_watchlist로 조회하세요. " +
        "그룹 편집(추가/삭제)은 키움 REST API가 지원하지 않아 조회만 가능합니다.",
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const groups = await fetchWatchlistGroups(client);
        return textResult(formatWatchlistGroups(groups, config.modeLabel));
      }),
  );
}

export function registerWatchlistTool(server: McpServer): void {
  server.registerTool(
    "get_watchlist",
    {
      title: "관심종목 그룹 상세",
      description:
        "관심종목 그룹에 담긴 종목 목록을 조회합니다 (키움 ka01301, 읽기 전용). " +
        "그룹코드(예: '000') 또는 그룹명(예: 'etf')을 넘기세요. 그룹을 모르면 get_watchlist_groups로 먼저 확인하세요. " +
        "종목명·전일종가·시장은 종목 마스터에서 보강해 함께 표시합니다.",
      inputSchema: {
        group: z
          .string()
          .min(1)
          .describe("관심종목 그룹코드 또는 그룹명 (get_watchlist_groups로 확인)"),
      },
    },
    async ({ group }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const groups = await fetchWatchlistGroups(client);
        const matched = findWatchlistGroup(groups, group);
        if (!matched) {
          const available = groups.length
            ? groups.map((g) => `${g.gcod}(${g.name})`).join(", ")
            : "(없음)";
          throw new KiwoomApiError(
            `관심종목 그룹 "${group}"을(를) 찾을 수 없습니다. 사용 가능한 그룹: ${available}`,
            { apiId: "ka01301" },
          );
        }
        const stocks = await fetchWatchlistGroupDetail(client, matched.gcod);
        const nameIndex = await buildNameIndex(client, stocks);
        return textResult(formatWatchlist(matched, stocks, nameIndex, config.modeLabel));
      }),
  );
}
