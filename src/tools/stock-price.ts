import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchStockInfo } from "../kiwoom/api.js";
import type { StockInfoResponse } from "../kiwoom/types.js";
import {
  formatKRW,
  formatPercent,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const PRE_SIG_LABELS: Record<string, string> = {
  "1": "상한",
  "2": "상승",
  "3": "보합",
  "4": "하한",
  "5": "하락",
};

export function formatStockInfo(info: StockInfoResponse, modeLabel: string): string {
  const cur = parseKiwoomPrice(info.cur_prc);
  const change = parseKiwoomNumber(info.pred_pre);
  const fluRt = parseKiwoomNumber(info.flu_rt);
  const volume = parseKiwoomNumber(info.trde_qty);
  const sigLabel = PRE_SIG_LABELS[info.pre_sig] ?? "";

  const changeText =
    change === null
      ? "-"
      : `${sigLabel ? `${sigLabel} ` : ""}${formatKRW(Math.abs(change))} (${formatPercent(fluRt)})`.trim();

  const lines = [
    `[${modeLabel}] ${info.stk_nm} (${info.stk_cd}) 시세`,
    "",
    `- 현재가: ${formatKRW(cur)}`,
    `- 전일대비: ${changeText}`,
    `- 기준가(전일종가): ${formatKRW(parseKiwoomPrice(info.base_pric))}`,
    `- 시가/고가/저가: ${formatKRW(parseKiwoomPrice(info.open_pric))} / ${formatKRW(parseKiwoomPrice(info.high_pric))} / ${formatKRW(parseKiwoomPrice(info.low_pric))}`,
    `- 거래량: ${volume === null ? "-" : `${volume.toLocaleString("ko-KR")}주`}`,
    `- 250일 최고/최저: ${formatKRW(parseKiwoomPrice(info["250hgst"]))} / ${formatKRW(parseKiwoomPrice(info["250lwst"]))}`,
  ];

  const per = parseKiwoomNumber(info.per);
  const eps = parseKiwoomNumber(info.eps);
  const pbr = parseKiwoomNumber(info.pbr);
  const mac = parseKiwoomNumber(info.mac);
  const fundamentals: string[] = [];
  if (per !== null) fundamentals.push(`PER ${per}`);
  if (eps !== null) fundamentals.push(`EPS ${formatKRW(eps)}`);
  if (pbr !== null) fundamentals.push(`PBR ${pbr}`);
  if (mac !== null) fundamentals.push(`시가총액 ${mac.toLocaleString("ko-KR")}억원`);
  if (fundamentals.length > 0) {
    lines.push(`- ${fundamentals.join(" / ")}`);
  }

  return lines.join("\n");
}

export function registerStockPriceTool(server: McpServer): void {
  server.registerTool(
    "get_stock_price",
    {
      title: "종목 현재가 조회",
      description:
        "6자리 종목코드로 국내 주식/ETF의 현재가, 등락률, 거래량, 기본 지표를 조회합니다 (키움 ka10001). " +
        "종목명만 알고 있다면 search_stock으로 먼저 코드를 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 숫자 종목코드여야 합니다 (예: 005930)")
          .describe("6자리 종목코드 (예: 삼성전자 005930, KODEX 200 069500)"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const info = await fetchStockInfo(client, stock_code);
        return textResult(formatStockInfo(info, config.modeLabel));
      }),
  );
}
