import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchInvestorRankDaily,
  fetchInvestorStreak,
  type InvestorUnit,
  type RankingMarket,
} from "../kiwoom/api.js";
import type { InvestorRankDailyItem, InvestorStreakItem } from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import { formatNumber, formatPercent, formatSigned, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const DEFAULT_STREAK_DAYS = "5";
const STREAK_DAYS_VALUES = ["1", "3", "5", "10", "20", "120"] as const;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

/** ka90009 금액은 천만원 단위로 온다 — LLM 소비자를 위해 억원(÷10)으로 환산해 표시. */
function rankAmount(raw: string): string {
  const value = parseKiwoomNumber(raw);
  return formatNumber(value === null ? null : Math.abs(value) / 10, 1);
}

/** 수량(천주)은 원본 그대로 절대값 표시 (방향은 열 의미로 충분). */
function rankQuantity(raw: string): string {
  const value = parseKiwoomNumber(raw);
  return formatNumber(value === null ? null : Math.abs(value), 0);
}

function rankSection(
  title: string,
  items: InvestorRankDailyItem[],
  prefix: "for" | "orgn",
  unit: InvestorUnit,
): string[] {
  const valueHeader = unit === "amount" ? "금액(억원)" : "수량(천주)";
  const cell = unit === "amount" ? rankAmount : rankQuantity;
  const field = unit === "amount" ? "amt" : "qty";
  const lines = [
    `■ ${title}`,
    "",
    `| 순위 | 순매수 종목 | 코드 | ${valueHeader} | 순매도 종목 | 코드 | ${valueHeader} |`,
    "|---:|---|---|---:|---|---|---:|",
  ];
  items.forEach((item, i) => {
    const buyCode = item[`${prefix}_netprps_stk_cd`];
    const sellCode = item[`${prefix}_netslmt_stk_cd`];
    lines.push(
      `| ${i + 1} | ${item[`${prefix}_netprps_stk_nm`] || "-"} | ${buyCode || "-"} | ` +
        `${cell(item[`${prefix}_netprps_${field}`])} | ` +
        `${item[`${prefix}_netslmt_stk_nm`] || "-"} | ${sellCode || "-"} | ` +
        `${cell(item[`${prefix}_netslmt_${field}`])} |`,
    );
  });
  return lines;
}

export function formatInvestorRankDaily(
  items: InvestorRankDailyItem[],
  market: RankingMarket,
  unit: InvestorUnit,
  date: string | undefined,
  limit: number,
  modeLabel: string,
): string {
  const dateLabel = date ? formatDateDashed(date) : "최근 거래일";
  const title = `${MARKET_LABELS[market]} 외국인·기관 순매매 상위 (${dateLabel})`;
  if (items.length === 0) {
    return (
      `[${modeLabel}] ${title} — 데이터가 없습니다. ` +
      `휴장일이거나 조회 일자가 잘못됐을 수 있습니다 (date: yyyyMMdd).`
    );
  }

  const shown = items.slice(0, limit);
  const lines = [
    `[${modeLabel}] ${title} (상위 ${shown.length}종목)`,
    "",
    ...rankSection("외국인", shown, "for", unit),
    "",
    ...rankSection("기관", shown, "orgn", unit),
    "",
  ];
  const unitNote =
    unit === "amount"
      ? "※ 금액은 키움 원본(천만원 단위)을 억원으로 환산(÷10)한 값입니다."
      : "※ 수량 단위는 천주입니다.";
  lines.push(unitNote, "※ 개별 종목의 기간별 수급 추이는 get_investor_trend로 조회하세요.");
  return lines.join("\n");
}

const d = (raw: string) => {
  const value = parseKiwoomNumber(raw);
  return value === null ? "-" : `${formatSigned(value, 0)}일`;
};

export function formatInvestorStreak(
  items: InvestorStreakItem[],
  market: "kospi" | "kosdaq",
  days: string,
  unit: InvestorUnit,
  limit: number,
  modeLabel: string,
  marketFallback: boolean,
): string {
  const title =
    `${MARKET_LABELS[market]} 기관·외국인 연속매매 현황 ` +
    `(${days === "1" ? "최근일" : `최근 ${days}일`}, ${unit === "amount" ? "금액" : "수량"} 기준 순매수 상위)`;
  if (items.length === 0) {
    return `[${modeLabel}] ${title} — 데이터가 없습니다.`;
  }

  const s = (raw: string) => formatSigned(parseKiwoomNumber(raw), 0);
  const shown = items.slice(0, limit);
  const lines = [
    `[${modeLabel}] ${title} (상위 ${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 기간등락률 | 외국인 순매매(백만원) | 외인 연속 | 기관 순매매(백만원) | 기관 연속 | 합계 연속 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
    ...shown.map(
      (item) =>
        `| ${item.rank || "-"} | ${item.stk_nm || "-"} | ${item.stk_cd || "-"} | ` +
        `${formatPercent(parseKiwoomNumber(item.prid_stkpc_flu_rt))} | ` +
        `${s(item.frgnr_nettrde_amt)} | ${d(item.frgnr_cont_netprps_dys)} | ` +
        `${s(item.orgn_nettrde_amt)} | ${d(item.orgn_cont_netprps_dys)} | ` +
        `${d(item.tot_cont_netprps_dys)} |`,
    ),
    "",
    "※ 연속일수 음수는 연속 순매도를 뜻합니다.",
  ];
  if (marketFallback) {
    lines.push("※ 연속매매 현황은 시장별로만 제공되어 코스피 기준으로 조회했습니다 (코스닥: market=kosdaq).");
  }
  lines.push("※ 개별 종목의 기간별 수급 추이는 get_investor_trend로 조회하세요.");
  return lines.join("\n");
}

export function registerInvestorRankTool(server: McpServer): void {
  server.registerTool(
    "get_investor_rank",
    {
      title: "외국인·기관 순매매 상위 / 연속매매 현황",
      description:
        "외국인과 기관이 많이 사고판 종목을 조회합니다 (키움 ka90009/ka10131). " +
        "view: daily(일자별 순매수·순매도 상위, 기본) / streak(N일 연속 순매수 상위). " +
        "\"오늘 외국인이 뭘 샀나\", \"외국인이 며칠째 사는 종목\" 질문에 사용하세요. " +
        "daily는 market all/kospi/kosdaq, streak는 kospi/kosdaq만 지원합니다.",
      inputSchema: {
        view: z.enum(["daily", "streak"]).optional().describe("daily=일자별 상위 (기본), streak=연속 순매수"),
        market: z.enum(["all", "kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: daily=all, streak=kospi)"),
        unit: z.enum(["amount", "quantity"]).optional().describe("금액/수량 기준 (기본값: amount)"),
        date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("view=daily의 조회 일자 (기본값: 최근 거래일)"),
        days: z
          .enum(STREAK_DAYS_VALUES)
          .optional()
          .describe(`view=streak의 집계 기간(일) (기본값 ${DEFAULT_STREAK_DAYS})`),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_LIMIT}, 최대 ${MAX_LIMIT})`),
      },
    },
    async ({ view, market, unit, date, days, limit }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const u: InvestorUnit = unit ?? "amount";
        const top = limit ?? DEFAULT_LIMIT;

        if (view === "streak") {
          // ka10131 has no 전체(000) market — default/fallback to 코스피 with a notice.
          const marketFallback = market === "all";
          const m = market === "kosdaq" ? "kosdaq" : "kospi";
          const dt = days ?? DEFAULT_STREAK_DAYS;
          const items = await fetchInvestorStreak(client, m, dt, u);
          return textResult(formatInvestorStreak(items, m, dt, u, top, config.modeLabel, marketFallback));
        }

        const m: RankingMarket = market ?? "all";
        const dateParam = date?.replaceAll("-", "");
        const items = await fetchInvestorRankDaily(client, m, u, dateParam);
        return textResult(formatInvestorRankDaily(items, m, u, dateParam, top, config.modeLabel));
      }),
  );
}
