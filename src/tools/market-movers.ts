import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchLimitStocks,
  fetchNewHighLow,
  fetchPriceJumps,
  fetchVolumeSurge,
  type RankingMarket,
} from "../kiwoom/api.js";
import type {
  LimitStockItem,
  NewHighLowItem,
  PriceJumpItem,
  VolumeSurgeItem,
} from "../kiwoom/types.js";
import {
  formatNumber,
  formatPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;
const DEFAULT_DAYS = "5";
const DAYS_VALUES = ["5", "10", "20", "60", "250"] as const;

const SIGNAL_LABELS = {
  new_high: "신고가",
  new_low: "신저가",
  upper_limit: "상한가",
  lower_limit: "하한가",
  surge: "급등",
  plunge: "급락",
  volume_surge: "거래량급증",
} as const;
export type MoverSignal = keyof typeof SIGNAL_LABELS;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

function commonCells(
  rank: number,
  item: { stk_nm: string; stk_cd: string; cur_prc: string; flu_rt: string },
): string[] {
  return [
    String(rank),
    item.stk_nm,
    item.stk_cd,
    formatNumber(parseKiwoomPrice(item.cur_prc)),
    formatPercent(parseKiwoomNumber(item.flu_rt)),
  ];
}

export function formatMarketMovers(
  signal: MoverSignal,
  market: RankingMarket,
  items: Array<NewHighLowItem | LimitStockItem | PriceJumpItem | VolumeSurgeItem>,
  top: number,
  modeLabel: string,
  days?: string,
): string {
  const shown = items.slice(0, top);
  const daysSuffix = signal === "new_high" || signal === "new_low" ? ` (${days ?? DEFAULT_DAYS}일 기준)` : "";
  const title = `${MARKET_LABELS[market]} ${SIGNAL_LABELS[signal]} 종목${daysSuffix}`;
  if (shown.length === 0) {
    return `[${modeLabel}] ${title} — 해당 종목이 없습니다.`;
  }

  const lines = [`[${modeLabel}] ${title} (${shown.length}종목)`, ""];
  if (signal === "new_high" || signal === "new_low") {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 | 기간고가 | 기간저가 |",
      "|---:|---|---|---:|---:|---:|---:|---:|",
    );
    (shown as NewHighLowItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatNumber(parseKiwoomNumber(item.trde_qty)),
          formatNumber(parseKiwoomPrice(item.high_pric)),
          formatNumber(parseKiwoomPrice(item.low_pric)),
        ]),
      );
    });
  } else if (signal === "upper_limit" || signal === "lower_limit") {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 | 연속 |",
      "|---:|---|---|---:|---:|---:|---:|",
    );
    (shown as LimitStockItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatNumber(parseKiwoomNumber(item.trde_qty)),
          `${parseKiwoomNumber(item.cnt) ?? "-"}회`,
        ]),
      );
    });
  } else if (signal === "volume_surge") {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 현재거래량 | 급증량 | 급증률(전일 대비) |",
      "|---:|---|---|---:|---:|---:|---:|---:|",
    );
    (shown as VolumeSurgeItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatNumber(parseKiwoomNumber(item.now_trde_qty)),
          formatSigned(parseKiwoomNumber(item.sdnin_qty)),
          formatPercent(parseKiwoomNumber(item.sdnin_rt)),
        ]),
      );
    });
  } else {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 급등락률(기준가 대비) | 거래량 |",
      "|---:|---|---|---:|---:|---:|---:|",
    );
    (shown as PriceJumpItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatPercent(parseKiwoomNumber(item.jmp_rt)),
          formatNumber(parseKiwoomNumber(item.trde_qty)),
        ]),
      );
    });
  }
  return lines.join("\n");
}

export function registerMarketMoversTool(server: McpServer): void {
  server.registerTool(
    "get_market_movers",
    {
      title: "시장 특이 종목 조회",
      description:
        "시장 특이 종목을 조회합니다 (키움 ka10016/ka10017/ka10019/ka10023). signal: " +
        "new_high(신고가)/new_low(신저가)/upper_limit(상한가)/lower_limit(하한가)/" +
        "surge(급등)/plunge(급락)/volume_surge(거래량급증). market: all(전체, 기본)/kospi/kosdaq. " +
        "신고/신저는 days(5/10/20/60/250일, 기본 5일) 기준, 급등/급락과 거래량급증은 전일 대비입니다 " +
        "(거래량급증은 급증량 순, 5천주 이상).",
      inputSchema: {
        signal: z
          .enum(["new_high", "new_low", "upper_limit", "lower_limit", "surge", "plunge", "volume_surge"])
          .describe("특이 신호 종류"),
        market: z.enum(["all", "kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: all)"),
        days: z
          .enum(DAYS_VALUES)
          .optional()
          .describe(`신고/신저 기준 기간(일) — new_high/new_low에서만 사용 (기본값 ${DEFAULT_DAYS})`),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ signal, market, days, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: RankingMarket = market ?? "all";
        const count = top ?? DEFAULT_TOP;
        const d = days ?? DEFAULT_DAYS;

        const items =
          signal === "new_high" || signal === "new_low"
            ? await fetchNewHighLow(client, m, signal === "new_high" ? "high" : "low", d)
            : signal === "upper_limit" || signal === "lower_limit"
              ? await fetchLimitStocks(client, m, signal === "upper_limit" ? "upper" : "lower")
              : signal === "volume_surge"
                ? await fetchVolumeSurge(client, m)
                : await fetchPriceJumps(client, m, signal);

        return textResult(formatMarketMovers(signal, m, items, count, config.modeLabel, d));
      }),
  );
}
