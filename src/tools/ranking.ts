import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchPriceChangeRanking,
  fetchValueRanking,
  fetchVolumeRanking,
  type RankingMarket,
} from "../kiwoom/api.js";
import type { PriceChangeRankItem, ValueRankItem, VolumeRankItem } from "../kiwoom/types.js";
import { formatNumber, formatPercent, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

const KIND_LABELS = {
  rise: "상승률 상위",
  fall: "하락률 상위",
  volume: "거래량 상위",
  value: "거래대금 상위",
} as const;
export type RankingKind = keyof typeof KIND_LABELS;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

interface CommonRankRow {
  stk_cd: string;
  stk_nm: string;
  cur_prc: string;
  flu_rt: string;
}

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

function commonCells(rank: number, item: CommonRankRow): string[] {
  return [
    String(rank),
    item.stk_nm,
    item.stk_cd,
    formatNumber(parseKiwoomPrice(item.cur_prc)),
    formatPercent(parseKiwoomNumber(item.flu_rt)),
  ];
}

export function formatRanking(
  kind: RankingKind,
  market: RankingMarket,
  items: Array<PriceChangeRankItem | VolumeRankItem | ValueRankItem>,
  top: number,
  modeLabel: string,
): string {
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${MARKET_LABELS[market]} ${KIND_LABELS[kind]} 데이터가 없습니다.`;
  }

  const lines = [`[${modeLabel}] ${MARKET_LABELS[market]} ${KIND_LABELS[kind]} (상위 ${shown.length}종목)`, ""];
  const withValue = kind === "volume" || kind === "value";
  lines.push(
    withValue
      ? "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 | 거래대금(백만원) |"
      : "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 |",
    withValue ? "|---:|---|---|---:|---:|---:|---:|" : "|---:|---|---|---:|---:|---:|",
  );

  shown.forEach((item, i) => {
    const cells = commonCells(i + 1, item);
    if (kind === "volume") {
      const v = item as VolumeRankItem;
      cells.push(formatNumber(parseKiwoomNumber(v.trde_qty)), formatNumber(parseKiwoomNumber(v.trde_amt)));
    } else if (kind === "value") {
      const v = item as ValueRankItem;
      cells.push(formatNumber(parseKiwoomNumber(v.now_trde_qty)), formatNumber(parseKiwoomNumber(v.trde_prica)));
    } else {
      cells.push(formatNumber(parseKiwoomNumber((item as PriceChangeRankItem).now_trde_qty)));
    }
    lines.push(row(cells));
  });
  return lines.join("\n");
}

export function registerRankingTool(server: McpServer): void {
  server.registerTool(
    "get_ranking",
    {
      title: "시장 순위 조회",
      description:
        "당일 시장 순위를 조회합니다 (키움 ka10027/ka10030/ka10032). type: rise(상승률)/" +
        "fall(하락률)/volume(거래량)/value(거래대금). market: all(전체, 기본)/kospi/kosdaq.",
      inputSchema: {
        type: z.enum(["rise", "fall", "volume", "value"]).describe("순위 종류"),
        market: z.enum(["all", "kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: all)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ type, market, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: RankingMarket = market ?? "all";
        const count = top ?? DEFAULT_TOP;

        const items =
          type === "volume"
            ? await fetchVolumeRanking(client, m)
            : type === "value"
              ? await fetchValueRanking(client, m)
              : await fetchPriceChangeRanking(client, m, type);

        return textResult(formatRanking(type, m, items, count, config.modeLabel));
      }),
  );
}
