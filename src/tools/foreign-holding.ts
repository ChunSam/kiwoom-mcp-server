import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchForeignHolding } from "../kiwoom/api.js";
import { type ForeignHoldingItem } from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import { formatKRW, formatPercent, formatQuantity, formatRatioPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_DISPLAY_DAYS = 15;

export function formatForeignHolding(
  rows: ForeignHoldingItem[],
  stockCode: string,
  modeLabel: string,
  limit: number,
): string {
  if (rows.length === 0) {
    return `[${modeLabel}] 외국인 보유 추이가 없습니다 (종목 ${stockCode}).`;
  }

  const shown = rows.slice(0, limit);
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 외국인 보유 추이 — 종목 ${stockCode} (최근 ${shown.length}일)`,
    "",
    "| 일자 | 종가 | 거래량 | 외국인순변동 | 보유주식수 | 보유비중 | 한도소진률 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    const cells = [
      formatDateDashed(r.dt),
      formatKRW(parseKiwoomPrice(r.close_pric)),
      formatQuantity(n(r.trde_qty)),
      `${formatSigned(n(r.chg_qty), 0)}주`,
      formatQuantity(n(r.poss_stkcnt)),
      formatRatioPercent(n(r.wght)),
      formatRatioPercent(n(r.limit_exh_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (rows.length > shown.length) {
    lines.push("", `※ 최근 ${shown.length}일만 표시했습니다 (limit으로 최대 50일까지 조정 가능).`);
  }
  lines.push("", "※ 보유비중 = 외국인 보유주식수 / 상장주식수. 한도소진률 = 보유 / 외국인 한도. 종가 부호는 전일 대비 방향.");
  return lines.join("\n");
}

export function registerForeignHoldingTool(server: McpServer): void {
  server.registerTool(
    "get_foreign_holding",
    {
      title: "외국인 보유 추이 조회",
      description:
        "특정 종목의 일자별 외국인 보유 동향을 조회합니다 — 종가, 거래량, 외국인 순변동수량, 보유주식수, " +
        "보유비중, 한도소진률 (키움 ka10008). 최신순으로 기본 15일 표시하며 limit으로 최대 50일까지 조정할 수 있습니다.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .describe("조회할 6자리 종목코드"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("표시할 일수 (기본 15, 최대 50; 최신순)"),
      },
    },
    async ({ stock_code, limit }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const rows = await fetchForeignHolding(client, stock_code);
        return textResult(formatForeignHolding(rows, stock_code, config.modeLabel, limit ?? DEFAULT_DISPLAY_DAYS));
      }),
  );
}
