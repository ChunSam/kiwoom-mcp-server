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

/**
 * 비ETF 가드 안내 (2026-07-10 GUI 테스트 발견 대응): ka40001은 일반 종목 코드에도
 * 수익률을 돌려주므로 ka40002로 선별한다 — 비ETF는 stk_nm은 있지만 추적지수명이
 * 빈값, 존재하지 않는 코드는 둘 다 빈값 (mock-probed 2026-07-10).
 * get_etf_info도 같은 판별자를 쓴다 — featurePhrase는 조사까지 포함한 목적어구.
 */
export function formatNonEtfNotice(
  stockName: string,
  stockCode: string,
  modeLabel: string,
  featurePhrase = "ETF 기간 수익률을",
): string {
  if (stockName) {
    return (
      `[${modeLabel}] ${stockName} (${stockCode})은(는) ETF가 아니어서 ${featurePhrase} 제공하지 않습니다. ` +
      `일반 종목 시세는 get_stock_price / get_stock_chart를 이용하세요.`
    );
  }
  return (
    `[${modeLabel}] ${stockCode}의 ETF 정보를 찾을 수 없습니다. ` +
    `ETF 종목코드인지 확인해 주세요 (search_stock으로 검색 가능).`
  );
}

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

        // Non-ETF guard BEFORE the 4-call loop — best-effort: a flaky ka40002
        // lookup must not block a real ETF, so only a successful blank-index
        // response refuses (and it also saves the 4 wasted ka40001 calls).
        const etf = await fetchEtfInfo(client, code).catch(() => null);
        if (etf && !etf.etfobjt_idex_nm) {
          return textResult(formatNonEtfNotice(etf.stk_nm, code, config.modeLabel));
        }

        const rows = await fetchEtfReturns(client, code, benchmark);
        return textResult(
          formatEtfReturns(rows, etf?.stk_nm || null, code, benchmark, config.modeLabel),
        );
      }),
  );
}
