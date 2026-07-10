import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchEtfInfo, fetchEtfNav, fetchStockInfo } from "../kiwoom/api.js";
import type { EtfInfoResponse, EtfNavItem, StockInfoResponse } from "../kiwoom/types.js";
import {
  formatKRW,
  formatPercent,
  formatQuantity,
  formatRatioPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { formatNonEtfNotice } from "./etf-returns.js";
import { runTool, textResult } from "./helpers.js";

export function formatEtfInfo(
  etf: EtfInfoResponse,
  quote: StockInfoResponse | null,
  nav: EtfNavItem | null,
  stockCode: string,
  modeLabel: string,
): string {
  // 비ETF/미존재 코드 가드 — get_etf_returns와 동일한 ka40002 판별자
  // (비ETF는 stk_nm만 채워지고 추적지수명이 빈값, 없는 코드는 둘 다 빈값).
  // 이전에는 비ETF에 "-"투성이 카드가 나갔다 (2026-07-10 GUI 테스트 watch item).
  if (!etf.stk_nm || !etf.etfobjt_idex_nm) {
    return formatNonEtfNotice(etf.stk_nm, stockCode, modeLabel, "ETF 정보를");
  }

  const lines = [
    `[${modeLabel}] ${etf.stk_nm} (${stockCode}) ETF 정보`,
    "",
    `- 추적지수: ${etf.etfobjt_idex_nm || "-"}`,
    `- 과세유형: ${etf.etftxon_type || "-"}`,
  ];

  if (quote) {
    lines.push(
      `- 현재가: ${formatKRW(parseKiwoomPrice(quote.cur_prc))} (${formatPercent(parseKiwoomNumber(quote.flu_rt))})`,
      `- 거래량: ${formatQuantity(parseKiwoomNumber(quote.trde_qty))}`,
    );
  }

  // ka40009 NAV — 필드가 빈값으로 오는 환경(mock 확인)이 있어 값이 있을 때만 표시.
  const navValue = parseKiwoomPrice(nav?.nav);
  if (nav && navValue !== null) {
    lines.push(
      `- NAV: ${formatKRW(navValue)} (전일대비 ${formatSigned(parseKiwoomNumber(nav.navpred_pre))}, ` +
        `${formatPercent(parseKiwoomNumber(nav.navflu_rt))})`,
      `- 괴리율: ${formatPercent(parseKiwoomNumber(nav.dispty_rt))} · ` +
        `추적오차율: ${formatRatioPercent(parseKiwoomNumber(nav.trace_eor_rt))}`,
    );
  }

  lines.push(
    "",
    "※ 과세유형은 키움 표기 기준입니다. 매매차익 과세 방식(국내주식형 비과세 vs 배당소득 과세)은 " +
      "계좌 유형에 따라 달라질 수 있습니다.",
    "※ 기간별(1주/1개월/6개월/1년) 수익률은 get_etf_returns로 조회할 수 있습니다.",
  );
  return lines.join("\n");
}

export function registerEtfInfoTool(server: McpServer): void {
  server.registerTool(
    "get_etf_info",
    {
      title: "ETF 정보 조회",
      description:
        "ETF의 추적지수, 과세유형, 현재 시세, NAV·괴리율을 조회합니다 (키움 ka40002+ka10001+ka40009). " +
        "종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^[0-9A-Z]{6}$/i, "6자리 종목코드여야 합니다")
          .describe("6자리 ETF 종목코드 (예: 069500)"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();

        // Different TRs — parallel is fine; quote and NAV are best-effort garnish.
        const [etf, quote, navRows] = await Promise.all([
          fetchEtfInfo(client, code),
          fetchStockInfo(client, code).catch(() => null),
          fetchEtfNav(client, code).catch(() => null),
        ]);

        return textResult(formatEtfInfo(etf, quote, navRows?.[0] ?? null, code, config.modeLabel));
      }),
  );
}
