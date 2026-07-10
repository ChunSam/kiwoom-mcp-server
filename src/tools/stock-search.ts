import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { loadMasterList, masterItemWarnings } from "../kiwoom/master-list.js";
import type { StockListItem } from "../kiwoom/types.js";
import { formatKRW, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const MAX_RESULTS = 10;

/** Test hook — clears the shared master-list cache. */
export { clearMasterListCache as clearStockListCache } from "../kiwoom/master-list.js";

const normalize = (s: string) => s.replaceAll(/\s+/g, "").toLowerCase();

export function searchStockItems(
  items: StockListItem[],
  query: string,
  limit = MAX_RESULTS,
): StockListItem[] {
  const q = normalize(query);
  if (q === "") return [];

  if (/^[0-9a-z]{6}$/.test(q)) {
    const byCode = items.filter((i) => i.code.toLowerCase() === q);
    if (byCode.length > 0) return byCode.slice(0, limit);
  }

  const exact: StockListItem[] = [];
  const prefix: StockListItem[] = [];
  const partial: StockListItem[] = [];
  for (const item of items) {
    const name = normalize(item.name);
    if (name === q) exact.push(item);
    else if (name.startsWith(q)) prefix.push(item);
    else if (name.includes(q)) partial.push(item);
  }
  return [...exact, ...prefix, ...partial].slice(0, limit);
}

export function formatSearchResults(results: StockListItem[], query: string, modeLabel: string): string {
  if (results.length === 0) {
    return (
      `[${modeLabel}] "${query}"에 해당하는 종목을 찾지 못했습니다. ` +
      `다른 키워드나 정확한 종목명으로 다시 검색해 보세요.`
    );
  }

  const lines = [
    `[${modeLabel}] 종목 검색: "${query}" (${results.length}건${results.length >= MAX_RESULTS ? ", 상위만 표시" : ""})`,
    "",
    "| 코드 | 종목명 | 시장 | 전일종가 | 업종 | 비고 |",
    "|---|---|---|---:|---|---|",
  ];
  for (const r of results) {
    const warnings = masterItemWarnings(r);
    lines.push(
      `| ${r.code} | ${r.name} | ${r.marketName || "-"} | ${formatKRW(parseKiwoomPrice(r.lastPrice))} | ${r.upName || "-"} | ${warnings.join("·") || "-"} |`,
    );
  }
  return lines.join("\n");
}

export function registerStockSearchTool(server: McpServer): void {
  server.registerTool(
    "search_stock",
    {
      title: "종목 검색 (이름→코드)",
      description:
        "종목명(부분 일치)이나 6자리 코드로 코스피/코스닥 상장 종목(ETF/ETN 포함)을 검색해 " +
        "종목코드를 찾습니다 (키움 ka10099). 다른 tool에 넘길 종목코드를 모를 때 먼저 사용하세요. " +
        "거래정지·관리종목·투자경고 같은 투자유의 상태는 비고 컬럼에 표시됩니다. " +
        "첫 호출은 종목 마스터를 내려받아 몇 초 걸리고, 이후 12시간 동안 캐시됩니다.",
      inputSchema: {
        query: z.string().min(1).describe("종목명 일부(예: '삼성전자', 'KODEX 미국') 또는 6자리 종목코드"),
      },
    },
    async ({ query }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const items = await loadMasterList(client);
        return textResult(formatSearchResults(searchStockItems(items, query), query, config.modeLabel));
      }),
  );
}
