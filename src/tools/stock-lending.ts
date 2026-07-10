import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchLendingTrend } from "../kiwoom/api.js";
import type { LendingTrendItem } from "../kiwoom/types.js";
import { assertDateRange, formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import { formatNumber, formatSigned, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_LOOKBACK_DAYS = 30;

export interface LendingQuery {
  stockCode?: string;
  fromDate: string;
  toDate: string;
}

export function formatLendingTrend(rows: LendingTrendItem[], query: LendingQuery, modeLabel: string): string {
  const scope = query.stockCode ? `종목 ${query.stockCode}` : "시장 전체";
  const period = `${formatDateDashed(query.fromDate)} ~ ${formatDateDashed(query.toDate)}`;
  if (rows.length === 0) {
    return `[${modeLabel}] 대차거래 추이가 없습니다 (${scope}, ${period}).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 대차거래 추이 — ${scope} (${period}, ${rows.length}일)`,
    "",
    "| 일자 | 체결(주) | 상환(주) | 증감(주) | 잔고(주) | 잔고금액(백만원) |",
    "|---|---:|---:|---:|---:|---:|",
  ];

  for (const r of rows) {
    const cells = [
      formatDateDashed(r.dt),
      formatNumber(n(r.dbrt_trde_cntrcnt)),
      formatNumber(n(r.dbrt_trde_rpy)),
      formatSigned(n(r.dbrt_trde_irds), 0),
      formatNumber(n(r.rmnd)),
      formatNumber(n(r.remn_amt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("", "※ 증감 = 체결 − 상환. 당일 행은 집계 확정 전이라 0으로 표시될 수 있습니다.");
  return lines.join("\n");
}

export function registerStockLendingTool(server: McpServer): void {
  server.registerTool(
    "get_stock_lending",
    {
      title: "대차거래 추이 조회",
      description:
        "일자별 대차거래(주식 대여) 추이를 조회합니다 — 체결·상환·증감 주수와 대차잔고, 잔고금액 " +
        "(키움 ka10068/ka20068). stock_code를 지정하면 해당 종목, 생략하면 시장 전체 집계입니다. " +
        "기본 조회 기간은 최근 30일이며 from_date/to_date로 변경할 수 있습니다. " +
        "공매도 흐름과 함께 보려면 get_short_selling을 참고하세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .optional()
          .describe("6자리 종목코드 (생략 시 시장 전체 대차 추이)"),
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
        const query: LendingQuery = {
          stockCode: stock_code,
          fromDate: (from_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS)).replaceAll("-", ""),
          toDate: (to_date ?? todayInKst()).replaceAll("-", ""),
        };
        assertDateRange(query.fromDate, query.toDate);
        const rows = await fetchLendingTrend(client, query.stockCode, query.fromDate, query.toDate);
        return textResult(formatLendingTrend(rows, query, config.modeLabel));
      }),
  );
}
