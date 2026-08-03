import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchExpectedExecution,
  type ExpectedExecutionSort,
  type RankingMarket,
} from "../kiwoom/api.js";
import type { ExpectedExecutionItem } from "../kiwoom/types.js";
import { formatKRW, formatPercent, formatQuantity, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 15;
const MAX_TOP = 50;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const SORT_LABELS: Record<ExpectedExecutionSort, string> = {
  rise: "예상 상승률",
  fall: "예상 하락률",
  volume: "예상 체결량",
};

/**
 * 빈 결과를 "실패"가 아니라 "지금은 예상체결이 안 나오는 시간"으로 설명하기 위한 문구.
 *
 * 실측(2026-08-03)으로는 07:45과 08:34에 mock·REAL 모두 0행, 10:43 정규장 중에는 100행이
 * 왔다 — 즉 **동시호가 전용이 아니다**. 어느 시간대에 정확히 제공되는지는 키움이
 * 문서화하지 않았으므로 "산출되는 구간이 따로 있다"까지만 말하고 단정하지 않는다.
 */
const EMPTY_HINT =
  "키움이 예상체결 정보를 제공하지 않는 시간대일 수 있습니다 (이른 장 시작 전에는 빈 결과가 실측됐습니다)";

export function formatExpectedExecution(
  rows: ExpectedExecutionItem[],
  market: RankingMarket,
  sort: ExpectedExecutionSort,
  top: number,
  modeLabel: string,
): string {
  const marketLabel = MARKET_LABELS[market];
  if (rows.length === 0) {
    return (
      `[${modeLabel}] ${marketLabel} 예상체결 ${SORT_LABELS[sort]} 순위가 없습니다. ` +
      `${EMPTY_HINT}. ` +
      "체결이 끝난 뒤의 순위는 get_ranking, 특이 종목은 get_market_movers를 쓰세요."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, top);

  const lines = [
    `[${modeLabel}] ${marketLabel} 예상체결 ${SORT_LABELS[sort]} 상위 (${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 예상체결가 | 기준가 | 등락률 | 예상체결량 | 매도잔량 | 매수잔량 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((r, index) => {
    const cells = [
      String(index + 1),
      r.stk_nm || "-",
      r.stk_cd,
      formatKRW(parseKiwoomPrice(r.exp_cntr_pric)),
      formatKRW(parseKiwoomPrice(r.base_pric)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(n(r.exp_cntr_qty)),
      formatQuantity(n(r.sel_req)),
      formatQuantity(n(r.buy_req)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    "※ 예상체결가는 '지금 체결된다면 이 값'이라는 지표라 실제 체결가와 다를 수 있고 계속 바뀝니다. " +
      "등락률은 기준가(전일 종가) 대비입니다.",
    "※ 예상체결이 산출되지 않는 시간대에는 결과가 비어 있습니다(오류가 아닙니다).",
    "※ 실제 체결이 끝난 뒤의 순위는 get_ranking, 신고가·상한가 같은 특이 종목은 get_market_movers를 쓰세요.",
  );
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}종목 중 상위 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerExpectedExecutionTool(server: McpServer): void {
  server.registerTool(
    "get_expected_execution",
    {
      title: "예상체결 순위 조회 (동시호가)",
      description:
        "예상체결가 기준 순위를 조회합니다 (키움 ka10029). 예상체결가는 '지금 체결된다면 이 값'이라 " +
        "동시호가(개장 전 08:30~09:00, 마감 전 15:20~15:30)에 오늘의 시초가·종가 방향을 미리 볼 때 " +
        "특히 유용합니다. 키움이 예상체결을 산출하지 않는 시간대에는 빈 결과가 돌아옵니다(오류가 아닙니다). " +
        "실제로 체결된 결과의 등락률·거래량 순위는 get_ranking, 신고가·상한가·급등 같은 특이 종목은 " +
        "get_market_movers, 시간외 단일가는 get_after_hours를 쓰세요.",
      inputSchema: {
        market: z.enum(["all", "kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: all)"),
        sort: z
          .enum(["rise", "fall", "volume"])
          .optional()
          .describe("정렬 기준 — rise 예상 상승률(기본) / fall 예상 하락률 / volume 예상 체결량"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ market, sort, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: RankingMarket = market ?? "all";
        const s: ExpectedExecutionSort = sort ?? "rise";
        const rows = await fetchExpectedExecution(client, m, s);
        return textResult(formatExpectedExecution(rows, m, s, top ?? DEFAULT_TOP, config.modeLabel));
      }),
  );
}
