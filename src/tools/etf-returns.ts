import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { ETF_RETURN_PERIODS, fetchEtfInfo, fetchEtfReturns } from "../kiwoom/api.js";
import type { EtfReturnItem } from "../kiwoom/types.js";
import { formatPercent, formatSigned, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";
import { sectorLabel } from "./sector.js";

/** ka40001의 etfobjt_idex_cd는 필수 — 지정이 없으면 KOSPI200(201)을 기본 벤치마크로 쓴다. */
const DEFAULT_BENCHMARK = "201";

export function formatEtfReturns(
  rows: (EtfReturnItem | null)[],
  etfName: string | null,
  stockCode: string,
  benchmarkCode: string,
  modeLabel: string,
): string {
  const n = parseKiwoomNumber;

  if (rows.every((r) => r === null || n(r.etfprft_rt) === null)) {
    return (
      `[${modeLabel}] ${stockCode}의 ETF 수익률 데이터가 없습니다. ` +
      `ETF 종목코드인지 확인해 주세요 (search_stock으로 검색 가능).`
    );
  }

  const title = etfName ? `${etfName} (${stockCode})` : stockCode;
  const lines = [
    `[${modeLabel}] ${title} ETF 기간 수익률`,
    "",
    "| 기간 | ETF 수익률 | 대상지수 수익률 | 외인 순매수량 | 기관 순매수량 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [i, period] of ETF_RETURN_PERIODS.entries()) {
    const row = rows[i] ?? null;
    lines.push(
      `| ${period.label} | ${formatPercent(n(row?.etfprft_rt))} | ${formatPercent(n(row?.cntr_prft_rt))} | ` +
        `${formatSigned(n(row?.for_netprps_qty), 0)} | ${formatSigned(n(row?.orgn_netprps_qty), 0)} |`,
    );
  }
  lines.push(
    "",
    `※ 대상지수: ${benchmarkCode} (${sectorLabel(benchmarkCode)}) — benchmark_index_code로 변경할 수 ` +
      `있습니다 (get_market_index의 '코드' 값).`,
  );
  return lines.join("\n");
}

export function registerEtfReturnsTool(server: McpServer): void {
  server.registerTool(
    "get_etf_returns",
    {
      title: "ETF 기간 수익률 조회",
      description:
        "ETF의 기간별(1주/1개월/6개월/1년) 수익률을 대상지수 수익률과 나란히 조회합니다 (키움 ka40001). " +
        `대상지수는 benchmark_index_code로 지정하며 기본값은 ${DEFAULT_BENCHMARK}(KOSPI200)입니다 — ` +
        "코드는 get_market_index의 '코드' 값을 사용하세요 (001 코스피 종합, 101 코스닥 종합 등). " +
        "종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^[0-9A-Z]{6}$/i, "6자리 종목코드여야 합니다")
          .describe("6자리 ETF 종목코드 (예: 069500)"),
        benchmark_index_code: z
          .string()
          .regex(/^\d{3}$/)
          .optional()
          .describe(`비교할 지수 코드 3자리 (기본값 ${DEFAULT_BENCHMARK} KOSPI200 — get_market_index의 '코드' 값)`),
      },
    },
    async ({ stock_code, benchmark_index_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const benchmark = benchmark_index_code ?? DEFAULT_BENCHMARK;

        // 4-period loop (~3.3s, same-TR rate limit) + name garnish in parallel.
        const [rows, etf] = await Promise.all([
          fetchEtfReturns(client, code, benchmark),
          fetchEtfInfo(client, code).catch(() => null),
        ]);

        return textResult(
          formatEtfReturns(rows, etf?.stk_nm || null, code, benchmark, config.modeLabel),
        );
      }),
  );
}
