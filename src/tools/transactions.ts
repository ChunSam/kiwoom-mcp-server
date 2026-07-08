import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchTransactions } from "../kiwoom/api.js";
import { normalizeStockCode, type TransactionRow } from "../kiwoom/types.js";
import { formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import { formatKRW, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_LOOKBACK_DAYS = 30;

export interface TransactionsQuery {
  fromDate: string;
  toDate: string;
  /** normalized 6-digit code; undefined = all stocks */
  stockCode?: string | undefined;
}

export function formatTransactions(
  rows: TransactionRow[],
  query: TransactionsQuery,
  modeLabel: string,
  truncated = false,
): string {
  const filtered = query.stockCode
    ? rows.filter((r) => normalizeStockCode(r.stk_cd) === query.stockCode)
    : rows;

  const period = `${formatDateDashed(query.fromDate)} ~ ${formatDateDashed(query.toDate)}`;
  const scope = query.stockCode ? `, 종목 ${query.stockCode}` : "";

  if (filtered.length === 0) {
    return `[${modeLabel}] 거래내역이 없습니다 (${period}${scope}).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 계좌 거래내역 (${period}${scope}, ${filtered.length}건)`,
    "",
    "| 체결일 | 구분 | 종목 | 수량 | 단가 | 정산금액 | 수수료 |",
    "|---|---|---|---:|---:|---:|---:|",
  ];

  for (const row of filtered) {
    const kind = row.io_tp_nm || row.trde_kind_nm || row.rmrk_nm || "-";
    const stock = row.stk_nm ? `${row.stk_nm} (${normalizeStockCode(row.stk_cd)})` : "-";
    const cells = [
      formatDateDashed(row.cntr_dt || row.trde_dt),
      kind,
      stock,
      n(row.trde_qty_jwa_cnt)?.toLocaleString("ko-KR") ?? "-",
      formatKRW(n(row.trde_unit)),
      formatKRW(n(row.exct_amt)),
      formatKRW(n(row.cmsn)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (truncated) {
    lines.push(
      "",
      "⚠️ 거래가 많아 조회 상한에 도달했습니다 — 오래된 일부 거래가 누락되었을 수 있습니다. " +
        "조회 기간(from_date~to_date)을 좁혀 다시 조회하세요.",
    );
  }

  lines.push(
    "",
    "※ 조회 기간과 결제는 체결 2영업일 후 기준이라, 최근 1~2영업일의 매매는 아직 결제 전이라 " +
      "조회에 빠질 수 있습니다. 정산금액은 수수료·세금 반영 금액입니다.",
  );
  return lines.join("\n");
}

export function registerTransactionsTool(server: McpServer): void {
  server.registerTool(
    "get_transactions",
    {
      title: "계좌 거래내역 조회",
      description:
        "계좌의 거래내역(매수/매도 등)을 기간별로 조회합니다 (키움 kt00015). 기본 조회 기간은 " +
        "최근 30일이며 from_date/to_date로 변경, stock_code로 특정 종목만 필터링할 수 있습니다. " +
        "일자는 결제일(D+2) 기준입니다.",
      inputSchema: {
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
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .optional()
          .describe("특정 종목만 조회할 때의 6자리 종목코드"),
      },
    },
    async ({ from_date, to_date, stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const query: TransactionsQuery = {
          fromDate: (from_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS)).replaceAll("-", ""),
          toDate: (to_date ?? todayInKst()).replaceAll("-", ""),
          stockCode: stock_code,
        };
        const { rows, truncated } = await fetchTransactions(client, query.fromDate, query.toDate);
        return textResult(formatTransactions(rows, query, config.modeLabel, truncated));
      }),
  );
}
