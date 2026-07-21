import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchSectorChart, fetchSectorIntradayChart, type ChartPeriod } from "../kiwoom/api.js";
import type { DailyChartItem, MinuteChartItem } from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import { formatNumber, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { sectorLabel } from "./sector.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_COUNT = 30;
const MAX_COUNT = 200;

const PERIOD_LABELS: Record<ChartPeriod, string> = {
  day: "일봉",
  week: "주봉",
  month: "월봉",
  year: "년봉",
};

/** 업종 차트 지수값은 ×100 정수로 온다 ("674795" = 6747.95) — 표시 시 ÷100. */
function indexValue(raw: string): string {
  const value = parseKiwoomPrice(raw);
  return formatNumber(value === null ? null : value / 100);
}

/** "20260721153000" → "2026-07-21 15:30" */
function formatMinuteTime(cntrTm: string): string {
  if (cntrTm.length < 12) return cntrTm;
  return `${formatDateDashed(cntrTm)} ${cntrTm.slice(8, 10)}:${cntrTm.slice(10, 12)}`;
}

function candleRow(time: string, item: DailyChartItem | MinuteChartItem): string {
  return (
    `| ${time} | ${indexValue(item.open_pric)} | ${indexValue(item.high_pric)} | ` +
    `${indexValue(item.low_pric)} | ${indexValue(item.cur_prc)} | ` +
    `${formatNumber(parseKiwoomNumber(item.trde_qty), 0)} |`
  );
}

const noDataMessage = (sectorCode: string, periodLabel: string, modeLabel: string): string =>
  `[${modeLabel}] ${sectorLabel(sectorCode)} (${sectorCode}) ${periodLabel} 데이터가 없습니다. ` +
  `업종 코드를 확인하세요 (get_market_index의 '코드' 값).`;

export function formatSectorDailyChart(
  items: DailyChartItem[],
  sectorCode: string,
  period: ChartPeriod,
  count: number,
  modeLabel: string,
): string {
  if (items.length === 0) return noDataMessage(sectorCode, PERIOD_LABELS[period], modeLabel);
  // API answers newest-first; display oldest→newest for trend reading.
  const shown = items.slice(0, count).reverse();
  const lines = [
    `[${modeLabel}] ${sectorLabel(sectorCode)} (${sectorCode}) ${PERIOD_LABELS[period]} 차트 (최근 ${shown.length}개)`,
    "",
    "| 일자 | 시가 | 고가 | 저가 | 종가 | 거래량(천주) |",
    "|---|---:|---:|---:|---:|---:|",
    ...shown.map((i) => candleRow(formatDateDashed(i.dt), i)),
    "",
    "※ 업종 현재가 상세는 get_sector_price, 구성 종목은 get_sector_stocks로 조회하세요.",
  ];
  return lines.join("\n");
}

/** 분봉과 틱봉이 같은 행 구조(cntr_tm)를 공유 — scopeLabel은 "5분"/"30틱" 형태. */
export function formatSectorMinuteChart(
  items: MinuteChartItem[],
  sectorCode: string,
  scopeLabel: string,
  count: number,
  modeLabel: string,
): string {
  if (items.length === 0) return noDataMessage(sectorCode, `${scopeLabel}봉`, modeLabel);
  const shown = items.slice(0, count).reverse();
  const lines = [
    `[${modeLabel}] ${sectorLabel(sectorCode)} (${sectorCode}) ${scopeLabel}봉 차트 (최근 ${shown.length}개)`,
    "",
    "| 시각 | 시가 | 고가 | 저가 | 종가 | 거래량(천주) |",
    "|---|---:|---:|---:|---:|---:|",
    ...shown.map((i) => candleRow(formatMinuteTime(i.cntr_tm), i)),
    "",
    "※ 업종 현재가 상세는 get_sector_price, 구성 종목은 get_sector_stocks로 조회하세요.",
  ];
  return lines.join("\n");
}

export function registerSectorChartTool(server: McpServer): void {
  server.registerTool(
    "get_sector_chart",
    {
      title: "업종 지수 차트 조회 (일/주/월/년/분/틱봉)",
      description:
        "업종(섹터) 지수의 캔들 차트를 조회합니다 (키움 ka20004~ka20008/ka20019). " +
        "period: day(일봉, 기본)/week(주봉)/month(월봉)/year(년봉)/minute(분봉)/tick(틱봉). " +
        "sector_code는 get_market_index의 업종 코드입니다 " +
        "(001 코스피 종합, 002 코스피 대형주, 101 코스닥 종합, 201 KOSPI200 등).",
      inputSchema: {
        sector_code: z
          .string()
          .regex(/^\d{3}$/)
          .describe("업종 코드 3자리 (예: 001 코스피 종합, 101 코스닥 종합 — get_market_index의 '코드' 값)"),
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
          .enum(["1", "3", "5", "10", "30"])
          .optional()
          .describe("period=minute일 때 분 단위 (기본값: 5)"),
        tick_scope: z
          .enum(["1", "3", "5", "10", "30"])
          .optional()
          .describe("period=tick일 때 캔들당 틱 수 (기본값: 30)"),
      },
    },
    async ({ sector_code, period, count, minute_scope, tick_scope }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const n = count ?? DEFAULT_COUNT;

        if (period === "minute" || period === "tick") {
          const isTick = period === "tick";
          const scope = isTick ? (tick_scope ?? "30") : (minute_scope ?? "5");
          const items = await fetchSectorIntradayChart(client, sector_code, period, scope);
          return textResult(
            formatSectorMinuteChart(items, sector_code, `${scope}${isTick ? "틱" : "분"}`, n, config.modeLabel),
          );
        }

        const p: ChartPeriod = period ?? "day";
        const items = await fetchSectorChart(client, sector_code, p, todayInKst());
        return textResult(formatSectorDailyChart(items, sector_code, p, n, config.modeLabel));
      }),
  );
}
