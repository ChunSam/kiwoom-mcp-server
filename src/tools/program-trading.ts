import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchProgramTrades,
  fetchProgramTrend,
  fetchStockProgramTrend,
  type InvestorUnit,
  type ProgramMarket,
  type ProgramTrendGranularity,
} from "../kiwoom/api.js";
import type { ProgramTradeItem, ProgramTrendItem, StockProgramTrendItem } from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import { formatNumber, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

export type ProgramDirection = "net_buy" | "net_sell";
export type ProgramView = "top" | "market_daily" | "market_intraday" | "stock_daily";

const DIRECTION_LABELS: Record<ProgramDirection, string> = {
  net_buy: "프로그램 순매수 상위",
  net_sell: "프로그램 순매도 상위",
};

const MARKET_LABELS: Record<ProgramMarket, string> = {
  kospi: "코스피",
  kosdaq: "코스닥",
};

const UNIT_LABELS: Record<InvestorUnit, string> = {
  amount: "백만원",
  quantity: "주",
};

const TREND_LABELS: Record<ProgramTrendGranularity, string> = {
  daily: "일자별 추이",
  intraday: "시간대별 추이",
};

export function formatProgramTrades(
  items: ProgramTradeItem[],
  direction: ProgramDirection,
  unit: InvestorUnit,
  market: ProgramMarket,
  top: number,
  modeLabel: string,
): string {
  const title = `${MARKET_LABELS[market]} ${DIRECTION_LABELS[direction]}`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title} 데이터가 없습니다 (장 시작 전이거나 당일 집계 전일 수 있습니다).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (상위 ${shown.length}종목, 단위: ${UNIT_LABELS[unit]})`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 프로그램 매수 | 프로그램 매도 | 순매수 |",
    "|---:|---|---|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((item, i) => {
    const cells = [
      String(i + 1),
      item.stk_nm,
      item.stk_cd,
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatPercent(n(item.flu_rt)),
      formatNumber(n(item.prm_buy_amt)),
      formatNumber(n(item.prm_sell_amt)),
      formatSigned(n(item.prm_netprps_amt), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });
  return lines.join("\n");
}

/** ka90005의 지수 필드는 ×100 정수로 온다 ("+108970" = 1089.70) — ka90010은 소수 그대로. */
function formatTrendIndex(raw: string, granularity: ProgramTrendGranularity): string {
  const value = parseKiwoomNumber(raw);
  if (value === null) return "-";
  return formatNumber(granularity === "intraday" ? value / 100 : value, 2);
}

function trendTimeLabel(cntrTm: string, granularity: ProgramTrendGranularity): string {
  // daily = yyyyMMdd000000, intraday = HHmmss (분 모드라 초는 00).
  if (granularity === "daily") return formatDateDashed(cntrTm.slice(0, 8));
  return `${cntrTm.slice(0, 2)}:${cntrTm.slice(2, 4)}`;
}

export function formatProgramTrend(
  items: ProgramTrendItem[],
  granularity: ProgramTrendGranularity,
  market: ProgramMarket,
  baseDate: string,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const title = `${MARKET_LABELS[market]} 프로그램 매매 ${TREND_LABELS[granularity]} — 기준일 ${formatDateDashed(baseDate)}`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}: 데이터가 없습니다 (장 시작 전이거나 휴장일일 수 있습니다).`;
  }

  const n = parseKiwoomNumber;
  const timeHeader = granularity === "daily" ? "일자" : "시각";
  const lines = [
    `[${modeLabel}] ${title} (최근 ${shown.length}행, 단위: 백만원)`,
    "",
    `| ${timeHeader} | 전체 매수 | 전체 매도 | 전체 순매수 | 차익 순매수 | 비차익 순매수 | 지수 | BASIS |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((item) => {
    const cells = [
      trendTimeLabel(item.cntr_tm, granularity),
      formatNumber(n(item.all_buy)),
      formatNumber(n(item.all_sel)),
      formatSigned(n(item.all_netprps), 0),
      formatSigned(n(item.dfrt_trde_netprps), 0),
      formatSigned(n(item.ndiffpro_trde_netprps), 0),
      formatTrendIndex(item.kospi200, granularity),
      formatNumber(n(item.basis), 2),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  const notes: string[] = [];
  if (granularity === "intraday") {
    notes.push("※ 각 행은 해당 시각까지의 당일 누적값입니다.");
  }
  if (truncated || items.length > shown.length) {
    notes.push("※ 표시된 범위 이전의 데이터는 생략됐습니다.");
  }
  notes.push("※ 지수: 코스피=KOSPI200, 코스닥=코스닥 시장 지수. 차익+비차익과 전체는 반올림으로 ±1 차이가 날 수 있습니다.");
  return [...lines, "", ...notes].join("\n");
}

export function formatStockProgramTrend(
  items: StockProgramTrendItem[],
  stockCode: string,
  baseDate: string | undefined,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const dateLabel = baseDate ? `기준일 ${formatDateDashed(baseDate)}` : "최근일 기준";
  const title = `종목 일별 프로그램 매매 추이 — ${stockCode} (${dateLabel})`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}: 데이터가 없습니다 (종목코드 또는 기준일을 확인해 주세요).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (최근 ${shown.length}일, 금액 단위: 백만원)`,
    "",
    "| 일자 | 종가 | 등락률 | 프로그램 매수 | 프로그램 매도 | 순매수 | 순매수 증감 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((item) => {
    const cells = [
      formatDateDashed(item.dt),
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatPercent(n(item.flu_rt)),
      formatNumber(n(item.prm_buy_amt)),
      formatNumber(n(item.prm_sell_amt)),
      formatSigned(n(item.prm_netprps_amt), 0),
      formatSigned(n(item.prm_netprps_amt_irds), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });
  if (truncated || items.length > shown.length) {
    lines.push("", "※ 표시된 범위 이전의 데이터는 생략됐습니다.");
  }
  return lines.join("\n");
}

export function registerProgramTradingTool(server: McpServer): void {
  server.registerTool(
    "get_program_trading",
    {
      title: "프로그램 매매 조회",
      description:
        "프로그램 매매 상위 종목과 추이를 조회합니다 (키움 ka90003/ka90010/ka90005/ka90013). " +
        "view: top(당일 순매수/순매도 상위 종목, 기본) / market_daily(시장 전체 일자별 추이) / " +
        "market_intraday(당일 시간대별 누적 추이) / stock_daily(특정 종목의 일자별 추이 — stock_code 필수). " +
        "direction/unit은 view=top에만 적용됩니다. market: kospi(기본)/kosdaq — 전체(all) 옵션이 없습니다. " +
        "추이 금액 단위는 백만원입니다.",
      inputSchema: {
        view: z
          .enum(["top", "market_daily", "market_intraday", "stock_daily"])
          .optional()
          .describe("조회 종류 (기본값: top)"),
        direction: z.enum(["net_buy", "net_sell"]).optional().describe("view=top의 순매수/순매도 (기본값: net_buy)"),
        unit: z.enum(["amount", "quantity"]).optional().describe("view=top의 금액/수량 기준 (기본값: amount)"),
        market: z.enum(["kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: kospi)"),
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .optional()
          .describe("view=stock_daily 전용 — 조회할 6자리 종목코드"),
        base_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("추이 조회 기준일 — 이 날짜부터 과거로 조회 (기본값: 오늘/최근일)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목/행 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ view, direction, unit, market, stock_code, base_date, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const v: ProgramView = view ?? "top";
        const m: ProgramMarket = market ?? "kospi";
        const cap = top ?? DEFAULT_TOP;

        if (v === "top") {
          const d: ProgramDirection = direction ?? "net_buy";
          const u: InvestorUnit = unit ?? "amount";
          const items = await fetchProgramTrades(client, d, u, m);
          return textResult(formatProgramTrades(items, d, u, m, cap, config.modeLabel));
        }

        const dateParam = base_date?.replaceAll("-", "");
        if (v === "stock_daily") {
          if (!stock_code) {
            throw new Error("view=stock_daily에는 stock_code(6자리 종목코드)가 필요합니다.");
          }
          const { items, truncated } = await fetchStockProgramTrend(client, stock_code, dateParam ?? "");
          return textResult(formatStockProgramTrend(items, stock_code, dateParam, cap, truncated, config.modeLabel));
        }

        const granularity: ProgramTrendGranularity = v === "market_intraday" ? "intraday" : "daily";
        const baseDate = dateParam ?? todayInKst();
        const { items, truncated } = await fetchProgramTrend(client, granularity, m, baseDate);
        return textResult(formatProgramTrend(items, granularity, m, baseDate, cap, truncated, config.modeLabel));
      }),
  );
}
