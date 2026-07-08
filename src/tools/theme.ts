import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchThemeGroups, fetchThemeStocks } from "../kiwoom/api.js";
import { normalizeStockCode, type ThemeGroupItem, type ThemeStocksResponse } from "../kiwoom/types.js";
import {
  formatKRW,
  formatPercent,
  formatQuantity,
  formatSignedKRW,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_GROUP_LIMIT = 30;

export function formatThemeGroups(
  groups: ThemeGroupItem[],
  modeLabel: string,
  opts: { stockCode?: string | undefined; limit: number },
): string {
  if (groups.length === 0) {
    return opts.stockCode
      ? `[${modeLabel}] 종목 ${opts.stockCode}이(가) 편입된 테마가 없습니다.`
      : `[${modeLabel}] 테마 그룹을 찾을 수 없습니다.`;
  }

  // 종목 검색(qry_tp 2)은 결과가 적어 전부, 전체 목록은 등락률 상위 limit개만 표시.
  const shown = opts.stockCode ? groups : groups.slice(0, opts.limit);
  const n = parseKiwoomNumber;

  const heading = opts.stockCode
    ? `[${modeLabel}] 종목 ${opts.stockCode} 편입 테마 (${groups.length}개)`
    : `[${modeLabel}] 테마 그룹 — 등락률 상위 ${shown.length}개 (기간수익률 10일 기준)`;

  const lines = [
    heading,
    "",
    "| 테마 | 코드 | 종목수 | 등락률 | 상승/하락 | 기간수익률 | 주요종목 |",
    "|---|---|---:|---:|---:|---:|---|",
  ];

  for (const g of shown) {
    const cells = [
      g.thema_nm || "-",
      g.thema_grp_cd || "-",
      n(g.stk_num)?.toLocaleString("ko-KR") ?? "-",
      formatPercent(n(g.flu_rt)),
      `${n(g.rising_stk_num) ?? "-"}/${n(g.fall_stk_num) ?? "-"}`,
      formatPercent(n(g.dt_prft_rt)),
      g.main_stk || "-",
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (!opts.stockCode && groups.length > shown.length) {
    lines.push("", `※ 등락률 상위 ${shown.length}개만 표시했습니다 (limit으로 최대 100개까지 조정 가능).`);
  }
  lines.push("", "※ 특정 테마의 구성종목은 get_theme_stocks에 '코드' 값을 넣어 조회하세요.");
  return lines.join("\n");
}

export function formatThemeStocks(
  response: ThemeStocksResponse,
  themeCode: string,
  modeLabel: string,
): string {
  const stocks = response.thema_comp_stk;
  if (stocks.length === 0) {
    return `[${modeLabel}] 테마 ${themeCode}의 구성종목이 없습니다 (테마 코드를 확인하세요).`;
  }

  const n = parseKiwoomNumber;
  const themeRt = n(response.flu_rt);
  const themePrft = n(response.dt_prft_rt);
  const aggregate =
    themeRt !== null || themePrft !== null
      ? ` — 테마 등락률 ${formatPercent(themeRt)} · 기간수익률 ${formatPercent(themePrft)}`
      : "";

  const lines = [
    `[${modeLabel}] 테마 구성종목 (코드 ${themeCode}, ${stocks.length}종목)${aggregate}`,
    "",
    "| 종목 | 현재가 | 전일대비 | 등락률 | 거래량 | 기간수익률 |",
    "|---|---:|---:|---:|---:|---:|",
  ];

  for (const s of stocks) {
    const code = normalizeStockCode(s.stk_cd);
    const cells = [
      s.stk_nm ? `${s.stk_nm} (${code})` : code || "-",
      formatKRW(parseKiwoomPrice(s.cur_prc)),
      formatSignedKRW(n(s.pred_pre)),
      formatPercent(n(s.flu_rt)),
      formatQuantity(n(s.acc_trde_qty)),
      formatPercent(n(s.dt_prft_rt_n)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

export function registerThemeGroupsTool(server: McpServer): void {
  server.registerTool(
    "get_theme_groups",
    {
      title: "테마 그룹 조회",
      description:
        "키움 테마 그룹 목록을 조회합니다 — 테마명, 종목수, 등락률, 상승/하락 종목수, 기간수익률(10일), " +
        "주요종목 (키움 ka90001). 기본은 등락률 상위 테마를 보여주며, stock_code를 주면 해당 종목이 " +
        "편입된 테마를 검색합니다. 특정 테마의 구성종목은 get_theme_stocks로 조회하세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .optional()
          .describe("특정 종목이 편입된 테마만 검색할 6자리 종목코드"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("표시할 테마 개수 (기본 30, 최대 100; 등락률 상위순). 종목 검색 시에는 무시됩니다."),
      },
    },
    async ({ stock_code, limit }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const groups = await fetchThemeGroups(client, stock_code);
        return textResult(
          formatThemeGroups(groups, config.modeLabel, {
            stockCode: stock_code,
            limit: limit ?? DEFAULT_GROUP_LIMIT,
          }),
        );
      }),
  );
}

export function registerThemeStocksTool(server: McpServer): void {
  server.registerTool(
    "get_theme_stocks",
    {
      title: "테마 구성종목 조회",
      description:
        "특정 테마 그룹의 구성종목과 시세를 조회합니다 — 종목별 현재가, 전일대비, 등락률, 거래량, " +
        "기간수익률 (키움 ka90002). theme_code는 get_theme_groups가 돌려주는 '코드' 값입니다.",
      inputSchema: {
        theme_code: z
          .string()
          .regex(/^\d{1,6}$/, "테마 코드는 숫자여야 합니다")
          .describe("테마 그룹 코드 (get_theme_groups의 '코드' 열 값)"),
      },
    },
    async ({ theme_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const response = await fetchThemeStocks(client, theme_code);
        return textResult(formatThemeStocks(response, theme_code, config.modeLabel));
      }),
  );
}
