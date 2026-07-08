import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchAllIndices } from "../kiwoom/api.js";
import type { IndexItem } from "../kiwoom/types.js";
import { formatNumber, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const MARKET_LABELS = { kospi: "코스피", kosdaq: "코스닥" } as const;
type IndexMarket = keyof typeof MARKET_LABELS;

export function formatIndices(items: IndexItem[], market: IndexMarket, modeLabel: string): string {
  if (items.length === 0) {
    return `[${modeLabel}] ${MARKET_LABELS[market]} 지수 데이터가 없습니다.`;
  }

  const lines = [
    `[${modeLabel}] ${MARKET_LABELS[market]} 업종 지수 (${items.length}개)`,
    "",
    "| 지수 | 현재 | 전일대비 | 등락률 | 상승/보합/하락 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const item of items) {
    lines.push(
      `| ${item.stk_nm} | ${formatNumber(parseKiwoomPrice(item.cur_prc))} | ` +
        `${formatSigned(parseKiwoomNumber(item.pred_pre))} | ${formatPercent(parseKiwoomNumber(item.flu_rt))} | ` +
        `${parseKiwoomNumber(item.rising) ?? "-"}/${parseKiwoomNumber(item.stdns) ?? "-"}/${parseKiwoomNumber(item.fall) ?? "-"} |`,
    );
  }
  return lines.join("\n");
}

export function registerMarketIndexTool(server: McpServer): void {
  server.registerTool(
    "get_market_index",
    {
      title: "시장 지수 조회",
      description:
        "코스피/코스닥 종합지수와 업종별 지수를 조회합니다 (키움 ka20003). " +
        "첫 행이 시장 종합지수, 이후는 업종 지수입니다.",
      inputSchema: {
        market: z
          .enum(["kospi", "kosdaq"])
          .optional()
          .describe("시장 구분 (기본값: kospi)"),
      },
    },
    async ({ market }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: IndexMarket = market ?? "kospi";
        const items = await fetchAllIndices(client, m === "kospi" ? "001" : "101");
        return textResult(formatIndices(items, m, config.modeLabel));
      }),
  );
}
