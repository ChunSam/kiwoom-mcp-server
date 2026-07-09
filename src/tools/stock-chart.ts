import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchDailyChart, fetchMinuteChart, fetchTickChart, type ChartPeriod } from "../kiwoom/api.js";
import type { DailyChartItem, MinuteChartItem } from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import { formatNumber, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_COUNT = 30;
const MAX_COUNT = 200;

const PERIOD_LABELS: Record<ChartPeriod, string> = {
  day: "일봉",
  week: "주봉",
  month: "월봉",
  year: "년봉",
};

/** "20260703153000" → "2026-07-03 15:30" */
function formatMinuteTime(cntrTm: string): string {
  if (cntrTm.length < 12) return cntrTm;
  return `${formatDateDashed(cntrTm)} ${cntrTm.slice(8, 10)}:${cntrTm.slice(10, 12)}`;
}

function candleRow(time: string, item: DailyChartItem | MinuteChartItem, volume: string): string {
  const p = (raw: string) => formatNumber(parseKiwoomPrice(raw));
  return `| ${time} | ${p(item.open_pric)} | ${p(item.high_pric)} | ${p(item.low_pric)} | ${p(item.cur_prc)} | ${volume} |`;
}

export function formatDailyChart(
  items: DailyChartItem[],
  stockCode: string,
  period: ChartPeriod,
  count: number,
  modeLabel: string,
): string {
  if (items.length === 0) {
    return `[${modeLabel}] ${stockCode} ${PERIOD_LABELS[period]} 데이터가 없습니다. 종목코드를 확인해 주세요.`;
  }
  // API answers newest-first; display oldest→newest for trend reading.
  const shown = items.slice(0, count).reverse();
  const lines = [
    `[${modeLabel}] ${stockCode} ${PERIOD_LABELS[period]} 차트 (최근 ${shown.length}개, 수정주가 반영)`,
    "",
    "| 일자 | 시가 | 고가 | 저가 | 종가 | 거래량 |",
    "|---|---:|---:|---:|---:|---:|",
    ...shown.map((i) => candleRow(formatDateDashed(i.dt), i, formatNumber(parseKiwoomNumber(i.trde_qty)))),
  ];
  return lines.join("\n");
}

/** 분봉과 틱봉이 같은 행 구조(cntr_tm)를 공유 — scopeLabel은 "5분"/"30틱" 형태. */
export function formatMinuteChart(
  items: MinuteChartItem[],
  stockCode: string,
  scopeLabel: string,
  count: number,
  modeLabel: string,
): string {
  if (items.length === 0) {
    return `[${modeLabel}] ${stockCode} ${scopeLabel}봉 데이터가 없습니다. 종목코드를 확인해 주세요.`;
  }
  const shown = items.slice(0, count).reverse();
  const lines = [
    `[${modeLabel}] ${stockCode} ${scopeLabel}봉 차트 (최근 ${shown.length}개, 수정주가 반영)`,
    "",
    "| 시각 | 시가 | 고가 | 저가 | 종가 | 거래량 |",
    "|---|---:|---:|---:|---:|---:|",
    ...shown.map((i) => candleRow(formatMinuteTime(i.cntr_tm), i, formatNumber(parseKiwoomNumber(i.trde_qty)))),
  ];
  return lines.join("\n");
}

export function registerStockChartTool(server: McpServer): void {
  server.registerTool(
    "get_stock_chart",
    {
      title: "주식 차트 조회 (일/주/월/년/분/틱봉)",
      description:
        "종목의 캔들 차트 데이터를 조회합니다 (키움 ka10079~ka10083/ka10094, 수정주가 반영). " +
        "period: day(일봉, 기본)/week(주봉)/month(월봉)/year(년봉)/minute(분봉)/tick(틱봉). " +
        "분봉은 minute_scope로 분 단위를, 틱봉은 tick_scope로 캔들당 틱 수를 지정합니다. " +
        "종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^[0-9A-Z]{6}$/i, "6자리 종목코드여야 합니다")
          .describe("6자리 종목코드 (예: 005930)"),
        period: z
          .enum(["day", "week", "month", "year", "minute", "tick"])
          .optional()
          .describe("봉 주기 (기본값: day)"),
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_COUNT)
          .optional()
          .describe(`캔들 개수 (기본값 ${DEFAULT_COUNT}, 최대 ${MAX_COUNT})`),
        minute_scope: z
          .enum(["1", "3", "5", "10", "15", "30", "45", "60"])
          .optional()
          .describe("period=minute일 때 분 단위 (기본값: 5)"),
        tick_scope: z
          .enum(["1", "3", "5", "10", "30"])
          .optional()
          .describe("period=tick일 때 캔들당 틱 수 (기본값: 30)"),
      },
    },
    async ({ stock_code, period, count, minute_scope, tick_scope }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const n = count ?? DEFAULT_COUNT;

        if (period === "minute" || period === "tick") {
          const isTick = period === "tick";
          const scope = isTick ? (tick_scope ?? "30") : (minute_scope ?? "5");
          const items = isTick
            ? await fetchTickChart(client, code, scope)
            : await fetchMinuteChart(client, code, scope);
          return textResult(
            formatMinuteChart(items, code, `${scope}${isTick ? "틱" : "분"}`, n, config.modeLabel),
          );
        }

        const p: ChartPeriod = period ?? "day";
        const items = await fetchDailyChart(client, code, p, todayInKst());
        return textResult(formatDailyChart(items, code, p, n, config.modeLabel));
      }),
  );
}
