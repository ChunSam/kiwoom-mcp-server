import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchQuoteTable } from "../kiwoom/api.js";
import type { QuoteTableResponse } from "../kiwoom/types.js";
import { formatKRW, formatNumber, formatPercent, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult } from "./helpers.js";

/** ka10001 `pre_sig`와 같은 코드계 — ka10007에서는 `smbol`로 온다. */
const SMBOL_LABELS: Record<string, string> = {
  "1": "상한",
  "2": "상승",
  "3": "보합",
  "4": "하한",
  "5": "하락",
};

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** `sel_7bid` / `buy_3bid_req`처럼 단계가 키 이름에 박혀 있어 인덱스 접근이 필요하다. */
function field(quote: QuoteTableResponse, key: string): string {
  const value = (quote as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function formatOrderbook(quote: QuoteTableResponse, stockCode: string, modeLabel: string): string {
  // 없는 코드·업종코드·소문자 접미사는 rc=0에 전 필드 공백으로 돌아온다 (실측 2026-08-04).
  if (quote.stk_nm.trim() === "") {
    return (
      `[${modeLabel}] ${stockCode} 호가를 찾을 수 없습니다.\n\n` +
      "6자리 종목코드가 맞는지 확인하세요 — 업종코드나 상장폐지 종목은 조회되지 않습니다. " +
      "종목명만 안다면 search_stock으로 코드를 먼저 찾으세요."
    );
  }

  const price = (raw: string) => formatNumber(parseKiwoomPrice(raw));
  const qty = (raw: string) => formatNumber(parseKiwoomNumber(raw));

  const tm = quote.tm;
  const tmLabel = tm.length === 6 ? `${tm.slice(0, 2)}:${tm.slice(2, 4)}:${tm.slice(4, 6)}` : tm;
  const sigLabel = SMBOL_LABELS[quote.smbol] ?? "";
  const lines = [
    `[${modeLabel}] ${quote.stk_nm} (${quote.stk_cd}) 호가 — 기준시각 ${tmLabel}`,
    "",
    `현재가 ${formatKRW(parseKiwoomPrice(quote.cur_prc))} ` +
      `(${formatPercent(parseKiwoomNumber(quote.flu_rt))}${sigLabel ? ` ${sigLabel}` : ""}) · ` +
      `거래량 ${qty(quote.trde_qty)}주`,
    "",
    "| 구분 | 호가 | 잔량 |",
    "|---|---:|---:|",
  ];

  // 매도는 먼 호가가 위(매도10 → 매도1), 매수는 가까운 호가가 위 — 실제 호가창 배열 그대로.
  for (const level of [...LEVELS].reverse()) {
    lines.push(
      `| 매도${level} | ${price(field(quote, `sel_${level}bid`))} | ${qty(field(quote, `sel_${level}bid_req`))} |`,
    );
  }
  for (const level of LEVELS) {
    lines.push(
      `| 매수${level} | ${price(field(quote, `buy_${level}bid`))} | ${qty(field(quote, `buy_${level}bid_req`))} |`,
    );
  }

  const totalSell = parseKiwoomNumber(quote.tot_sel_req);
  const totalBuy = parseKiwoomNumber(quote.tot_buy_req);
  lines.push("", `총잔량 — 매도 ${formatNumber(totalSell)} / 매수 ${formatNumber(totalBuy)}`);

  // 잔량비는 호가창에서 가장 먼저 보는 값이라 계산해서 붙인다 (1보다 크면 매수 대기가 두껍다).
  if (totalSell !== null && totalBuy !== null && totalSell > 0) {
    lines.push(`매수/매도 잔량비 ${formatNumber(totalBuy / totalSell)}배`);
  }

  // UNIFIED_EXCHANGE_NOTE는 "거래량·거래대금이 다를 수 있다"고만 말한다 — 이 tool에서
  // 통합/KRX가 갈리는 주된 수치는 잔량이라 여기서만 문구를 따로 쓴다.
  lines.push(
    "",
    "※ 잔량은 아직 체결되지 않은 대기 주문이며 언제든 취소·정정될 수 있습니다.",
    "※ 호가·잔량·거래량 모두 KRX와 넥스트레이드(NXT)를 합산한 **통합 기준**입니다 — " +
      "KRX만 표시하는 HTS·포털 화면보다 잔량이 크게 나옵니다.",
  );
  return lines.join("\n");
}

export function registerOrderbookTool(server: McpServer): void {
  server.registerTool(
    "get_orderbook",
    {
      title: "호가 조회",
      description:
        "종목의 10단계 매도/매수 호가와 잔량을 KRX+넥스트레이드(NXT) 통합 기준으로 조회합니다 (키움 ka10007). " +
        "지금 어느 가격에 대기 물량이 얼마나 쌓였는지, 매수·매도 어느 쪽이 두꺼운지 볼 때 씁니다. " +
        "호가는 체결이 아니라 대기 주문이므로, 실제 체결 흐름은 get_stock_quotes(체결 내역)나 " +
        "get_execution_strength(체결강도)를 보세요. 종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .describe("6자리 종목코드 (예: 005930)"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const quote = await fetchQuoteTable(client, code);
        return textResult(formatOrderbook(quote, code, config.modeLabel));
      }),
  );
}
