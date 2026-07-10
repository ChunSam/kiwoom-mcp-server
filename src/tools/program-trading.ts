import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchProgramTrades, type InvestorUnit, type ProgramMarket } from "../kiwoom/api.js";
import type { ProgramTradeItem } from "../kiwoom/types.js";
import { formatNumber, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

export type ProgramDirection = "net_buy" | "net_sell";

const DIRECTION_LABELS: Record<ProgramDirection, string> = {
  net_buy: "프로그램 순매수 상위",
  net_sell: "프로그램 순매도 상위",
};

const MARKET_LABELS: Record<ProgramMarket, string> = {
  kospi: "코스피",
  kosdaq: "코스닥",
};

const UNIT_LABELS: Record<InvestorUnit, string> = {
  amount: "백만원",
  quantity: "주",
};

export function formatProgramTrades(
  items: ProgramTradeItem[],
  direction: ProgramDirection,
  unit: InvestorUnit,
  market: ProgramMarket,
  top: number,
  modeLabel: string,
): string {
  const title = `${MARKET_LABELS[market]} ${DIRECTION_LABELS[direction]}`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title} 데이터가 없습니다 (장 시작 전이거나 당일 집계 전일 수 있습니다).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (상위 ${shown.length}종목, 단위: ${UNIT_LABELS[unit]})`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 프로그램 매수 | 프로그램 매도 | 순매수 |",
    "|---:|---|---|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((item, i) => {
    const cells = [
      String(i + 1),
      item.stk_nm,
      item.stk_cd,
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatPercent(n(item.flu_rt)),
      formatNumber(n(item.prm_buy_amt)),
      formatNumber(n(item.prm_sell_amt)),
      formatSigned(n(item.prm_netprps_amt), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });
  return lines.join("\n");
}

export function registerProgramTradingTool(server: McpServer): void {
  server.registerTool(
    "get_program_trading",
    {
      title: "프로그램 매매 상위 조회",
      description:
        "당일 프로그램 매매 순매수/순매도 상위 종목을 조회합니다 (키움 ka90003). " +
        "direction: net_buy(순매수, 기본)/net_sell(순매도). unit: amount(금액 백만원, 기본)/" +
        "quantity(수량 주). market: kospi(기본)/kosdaq — 이 TR에는 전체(all) 옵션이 없습니다.",
      inputSchema: {
        direction: z.enum(["net_buy", "net_sell"]).optional().describe("순매수/순매도 (기본값: net_buy)"),
        unit: z.enum(["amount", "quantity"]).optional().describe("금액/수량 기준 (기본값: amount)"),
        market: z.enum(["kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: kospi)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ direction, unit, market, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const d: ProgramDirection = direction ?? "net_buy";
        const u: InvestorUnit = unit ?? "amount";
        const m: ProgramMarket = market ?? "kospi";
        const items = await fetchProgramTrades(client, d, u, m);
        return textResult(formatProgramTrades(items, d, u, m, top ?? DEFAULT_TOP, config.modeLabel));
      }),
  );
}
