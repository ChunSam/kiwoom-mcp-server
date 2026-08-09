import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchLendingBalanceRank, fetchLendingTrend } from "../kiwoom/api.js";
import type { LendingBalanceRankItem, LendingTrendItem } from "../kiwoom/types.js";
import { assertDateRange, formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import { formatNumber, formatSigned, parseKiwoomNumber } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
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

const DEFAULT_RANK_TOP = 20;
const MAX_RANK_TOP = 50;

export function formatLendingBalanceRank(
  rows: LendingBalanceRankItem[],
  baseDate: string,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const title = `대차잔고 상위 종목 — ${formatDateDashed(baseDate)}`;
  const shown = rows.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}: 데이터가 없습니다 (기준일이 휴장일일 수 있습니다).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (상위 ${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 대차잔고(주) | 잔고금액(백만원) | 체결(주) | 상환(주) |",
    "|---:|---|---|---:|---:|---:|---:|",
  ];
  shown.forEach((r, i) => {
    const cells = [
      String(i + 1),
      r.stk_nm,
      r.stk_cd,
      formatNumber(n(r.rmnd)),
      formatNumber(n(r.remn_amt)),
      formatNumber(n(r.dbrt_trde_cntrcnt)),
      formatNumber(n(r.dbrt_trde_rpy)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  const notes = [
    "※ 대차잔고(주) 내림차순입니다 — 잔고금액이나 체결 주수 순이 아닙니다.",
    "※ 잔고는 빌려 간 뒤 아직 갚지 않은 물량입니다. 공매도 대기 물량으로 읽히지만 " +
      "차익거래·헤지 목적도 섞여 있어 그대로 공매도로 보면 안 됩니다.",
    "※ 시장 구분이 없는 TR이라 시장 전체 기준입니다.",
  ];
  if (truncated || rows.length > shown.length) {
    notes.push("※ 이 순위는 상위 50종목까지만 제공됩니다 — 그 아래는 조회되지 않습니다.");
  }
  return [...lines, "", ...notes].join("\n");
}

export function registerStockLendingTool(server: McpServer): void {
  server.registerTool(
    "get_stock_lending",
    {
      title: "대차거래 추이 조회",
      description:
        "대차거래(주식 대여) 정보를 조회합니다 (키움 ka10068/ka20068/ka90012). " +
        "view=trend(기본)은 일자별 추이 — 체결·상환·증감 주수와 대차잔고, 잔고금액을 시계열로 보여줍니다. " +
        "stock_code를 지정하면 해당 종목, 생략하면 시장 전체 집계이고 기본 기간은 최근 30일입니다. " +
        "view=balance_rank는 특정 하루의 **대차잔고가 가장 많은 종목 순위**입니다 — " +
        "'어느 종목에 대차 물량이 쌓여 있나'를 물을 때 쓰고, 한 종목의 시간 흐름은 trend를 쓰세요. " +
        "공매도 흐름과 함께 보려면 get_short_selling을 참고하세요.",
      inputSchema: {
        view: z
          .enum(["trend", "balance_rank"])
          .optional()
          .describe("조회 종류 (기본값: trend)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_RANK_TOP)
          .optional()
          .describe(`view=balance_rank의 표시 종목 수 (기본값 ${DEFAULT_RANK_TOP}, 최대 ${MAX_RANK_TOP})`),
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
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
    async ({ view, top, stock_code, from_date, to_date }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();

        if (view === "balance_rank") {
          // 이 TR은 하루의 횡단면이라 from_date는 의미가 없다 — to_date를 기준일로 쓴다.
          const baseDate = (to_date ?? todayInKst()).replaceAll("-", "");
          const { items, truncated } = await fetchLendingBalanceRank(client, baseDate);
          return textResult(
            formatLendingBalanceRank(items, baseDate, top ?? DEFAULT_RANK_TOP, truncated, config.modeLabel),
          );
        }

        const query: LendingQuery = {
          stockCode: stock_code?.toUpperCase(),
          fromDate: (from_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS)).replaceAll("-", ""),
          toDate: (to_date ?? todayInKst()).replaceAll("-", ""),
        };
        assertDateRange(query.fromDate, query.toDate);
        const rows = await fetchLendingTrend(client, query.stockCode, query.fromDate, query.toDate);
        return textResult(formatLendingTrend(rows, query, config.modeLabel));
      }),
  );
}
