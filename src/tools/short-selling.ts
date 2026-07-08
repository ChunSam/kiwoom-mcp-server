import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchShortSelling } from "../kiwoom/api.js";
import { normalizeStockCode, type ShortSellingItem } from "../kiwoom/types.js";
import { assertDateRange, formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import { formatKRW, formatPercent, formatQuantity, formatRatioPercent, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_LOOKBACK_DAYS = 30;

export interface ShortSellingQuery {
  stockCode: string;
  fromDate: string;
  toDate: string;
}

export function formatShortSelling(
  rows: ShortSellingItem[],
  query: ShortSellingQuery,
  modeLabel: string,
): string {
  const period = `${formatDateDashed(query.fromDate)} ~ ${formatDateDashed(query.toDate)}`;
  if (rows.length === 0) {
    return `[${modeLabel}] 공매도 추이가 없습니다 (종목 ${query.stockCode}, ${period}).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 공매도 추이 — 종목 ${query.stockCode} (${period}, ${rows.length}일)`,
    "",
    "| 일자 | 종가 | 등락률 | 거래량 | 공매도량 | 공매도비중 | 공매도평균가 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of rows) {
    const cells = [
      formatDateDashed(r.dt),
      formatKRW(parseKiwoomPrice(r.close_pric)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(n(r.trde_qty)),
      formatQuantity(n(r.shrts_qty)),
      formatRatioPercent(n(r.trde_wght)),
      formatKRW(parseKiwoomPrice(r.shrts_avg_pric)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("", "※ 공매도비중 = 공매도량 / 거래량. 종가·등락률의 부호는 전일 대비 방향입니다.");
  return lines.join("\n");
}

export function registerShortSellingTool(server: McpServer): void {
  server.registerTool(
    "get_short_selling",
    {
      title: "공매도 추이 조회",
      description:
        "특정 종목의 일자별 공매도 추이를 조회합니다 — 종가, 등락률, 거래량, 공매도량, 공매도비중, " +
        "공매도평균가 (키움 ka10014). 기본 조회 기간은 최근 30일이며 from_date/to_date로 변경할 수 있습니다.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .describe("조회할 6자리 종목코드"),
        from_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 시작일 (기본값: 30일 전)"),
        to_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 종료일 (기본값: 오늘)"),
      },
    },
    async ({ stock_code, from_date, to_date }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const query: ShortSellingQuery = {
          stockCode: stock_code,
          fromDate: (from_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS)).replaceAll("-", ""),
          toDate: (to_date ?? todayInKst()).replaceAll("-", ""),
        };
        assertDateRange(query.fromDate, query.toDate);
        const rows = await fetchShortSelling(client, query.stockCode, query.fromDate, query.toDate);
        return textResult(formatShortSelling(rows, query, config.modeLabel));
      }),
  );
}
