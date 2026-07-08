import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchEtfInfo, fetchStockInfo } from "../kiwoom/api.js";
import type { EtfInfoResponse, StockInfoResponse } from "../kiwoom/types.js";
import { formatKRW, formatPercent, formatQuantity, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

export function formatEtfInfo(
  etf: EtfInfoResponse,
  quote: StockInfoResponse | null,
  stockCode: string,
  modeLabel: string,
): string {
  if (!etf.stk_nm) {
    return `[${modeLabel}] ${stockCode}의 ETF 정보가 없습니다. ETF 종목코드인지 확인해 주세요.`;
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

  lines.push(
    "",
    "※ 과세유형은 키움 표기 기준입니다. 매매차익 과세 방식(국내주식형 비과세 vs 배당소득 과세)은 " +
      "계좌 유형에 따라 달라질 수 있습니다.",
  );
  return lines.join("\n");
}

export function registerEtfInfoTool(server: McpServer): void {
  server.registerTool(
    "get_etf_info",
    {
      title: "ETF 정보 조회",
      description:
        "ETF의 추적지수, 과세유형, 현재 시세를 조회합니다 (키움 ka40002+ka10001). " +
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

        // Different TRs — parallel is fine; the quote is best-effort garnish.
        const [etf, quote] = await Promise.all([
          fetchEtfInfo(client, code),
          fetchStockInfo(client, code).catch(() => null),
        ]);

        return textResult(formatEtfInfo(etf, quote, code, config.modeLabel));
      }),
  );
}
