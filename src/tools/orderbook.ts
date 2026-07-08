import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchOrderbook } from "../kiwoom/api.js";
import type { OrderbookResponse } from "../kiwoom/types.js";
import { formatNumber, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

/** Levels 2-10 sit in the loose passthrough under sel_/buy_{n}th_pre_* keys. */
function passthroughField(book: OrderbookResponse, key: string): string | null {
  const value = (book as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function formatOrderbook(book: OrderbookResponse, stockCode: string, modeLabel: string): string {
  const price = (raw: string | null) => formatNumber(parseKiwoomPrice(raw));
  const qty = (raw: string | null) => formatNumber(parseKiwoomNumber(raw));

  const baseTm = book.bid_req_base_tm;
  const baseTmLabel =
    baseTm.length === 6 ? `${baseTm.slice(0, 2)}:${baseTm.slice(2, 4)}:${baseTm.slice(4, 6)}` : baseTm;

  const lines = [
    `[${modeLabel}] ${stockCode} 호가 (기준시각 ${baseTmLabel})`,
    "",
    "| 구분 | 호가 | 잔량 |",
    "|---|---:|---:|",
  ];

  for (let level = 10; level >= 2; level--) {
    lines.push(
      `| 매도${level} | ${price(passthroughField(book, `sel_${level}th_pre_bid`))} | ${qty(passthroughField(book, `sel_${level}th_pre_req`))} |`,
    );
  }
  lines.push(`| 매도1 | ${price(book.sel_fpr_bid)} | ${qty(book.sel_fpr_req)} |`);
  lines.push(`| 매수1 | ${price(book.buy_fpr_bid)} | ${qty(book.buy_fpr_req)} |`);
  for (let level = 2; level <= 10; level++) {
    lines.push(
      `| 매수${level} | ${price(passthroughField(book, `buy_${level}th_pre_bid`))} | ${qty(passthroughField(book, `buy_${level}th_pre_req`))} |`,
    );
  }

  lines.push(
    "",
    `총잔량 — 매도 ${qty(book.tot_sel_req)} / 매수 ${qty(book.tot_buy_req)}`,
  );
  return lines.join("\n");
}

export function registerOrderbookTool(server: McpServer): void {
  server.registerTool(
    "get_orderbook",
    {
      title: "호가 조회",
      description:
        "종목의 10단계 매도/매수 호가와 잔량을 조회합니다 (키움 ka10004). " +
        "종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^[0-9A-Z]{6}$/i, "6자리 종목코드여야 합니다")
          .describe("6자리 종목코드 (예: 005930)"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const book = await fetchOrderbook(client, code);
        return textResult(formatOrderbook(book, code, config.modeLabel));
      }),
  );
}
