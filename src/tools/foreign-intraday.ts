import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchIntradayForeign, type InvestorUnit, type RankingMarket } from "../kiwoom/api.js";
import type { IntradayForeignItem } from "../kiwoom/types.js";
import { formatKRW, formatPercent, formatQuantity, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

const UNIT_LABELS: Record<InvestorUnit, string> = { amount: "백만원", quantity: "주" };
const MARKET_LABELS: Record<RankingMarket, string> = { all: "전체", kospi: "코스피", kosdaq: "코스닥" };

export interface ForeignIntradayOptions {
  market: RankingMarket;
  unit: InvestorUnit;
  direction: "buy" | "sell";
}

/** 행에 금액·수량이 항상 둘 다 실려 오므로 정렬 키만 골라 쓴다 (amt_qty_tp는 효과가 없다). */
function metric(row: IntradayForeignItem, unit: InvestorUnit): number | null {
  return parseKiwoomNumber(unit === "amount" ? row.netprps_amt : row.netprps_qty);
}

export function formatForeignIntraday(
  rows: IntradayForeignItem[],
  options: ForeignIntradayOptions,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const unitLabel = UNIT_LABELS[options.unit];
  const scope =
    `${MARKET_LABELS[options.market]} · 외국인 ${options.direction === "buy" ? "순매수" : "순매도"} 상위 · 단위 ${unitLabel}`;

  if (rows.length === 0) {
    return (
      `[${modeLabel}] 장중 외국인 매매 데이터가 없습니다 (${scope}). ` +
      "이 지표는 정규장(09:00~15:30)에만 산출됩니다 — 장 시작 전·마감 후에는 빈 결과가 정상입니다. " +
      "마감된 거래일 기준으로 보려면 get_net_buy_rank를 쓰세요."
    );
  }

  const scored = rows
    .map((row) => ({ row, value: metric(row, options.unit) }))
    .sort((a, b) => {
      if (a.value === null) return b.value === null ? 0 : 1;
      if (b.value === null) return -1;
      return options.direction === "buy" ? b.value - a.value : a.value - b.value;
    });
  const shown = scored.slice(0, top);

  const lines = [
    `[${modeLabel}] 장중 외국인 매매 (${scope}) — ${rows.length}종목 중 ${shown.length}종목`,
    "",
    `| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 순매수(${unitLabel}) | 매수 | 매도 | 누적거래량 |`,
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  const pick = (row: IntradayForeignItem, side: "buy" | "sell"): number | null =>
    parseKiwoomNumber(
      options.unit === "amount"
        ? side === "buy"
          ? row.buy_amt
          : row.sell_amt
        : side === "buy"
          ? row.buy_qty
          : row.sell_qty,
    );

  shown.forEach((s, index) => {
    const cells = [
      String(index + 1),
      s.row.stk_nm || "-",
      s.row.stk_cd,
      formatKRW(parseKiwoomPrice(s.row.cur_prc)),
      formatPercent(parseKiwoomNumber(s.row.flu_rt)),
      formatSigned(s.value),
      formatSigned(pick(s.row, "buy")),
      formatSigned(pick(s.row, "sell")),
      formatQuantity(parseKiwoomNumber(s.row.acc_trde_qty)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    "※ 정규장 중 **외국인만** 집계되는 잠정치입니다 — 거래소가 장중에 다른 주체(개인·기관 등)를 " +
      "공개하지 않기 때문입니다. 12주체 전부를 보려면 마감 후 get_net_buy_rank를 쓰세요.",
    "※ 수량은 **1,000주 단위로 반올림**되어 옵니다 (마감 후 확정치는 주 단위로 정확합니다).",
  );
  if (rows.length > shown.length) {
    lines.push(`※ ${rows.length}종목 중 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  if (truncated) {
    lines.push("※ 페이지 상한에 걸려 **일부 종목이 빠졌습니다** — market으로 범위를 좁혀 보세요.");
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerForeignIntradayTool(server: McpServer): void {
  server.registerTool(
    "get_foreign_intraday",
    {
      title: "장중 외국인 순매수 상위 (실시간)",
      description:
        "정규장 중 **외국인이 지금 사고 있는 종목**을 전 종목에서 뽑습니다 (키움 ka10063). " +
        "'오늘 외국인이 뭘 담고 있나', '장중 외국인 순매도 상위'처럼 **실시간 수급**을 볼 때 쓰세요. " +
        "거래소가 장중에는 외국인만 공개하므로 개인·기관은 나오지 않습니다 — " +
        "12주체 전부를 마감된 거래일 기준으로 보려면 get_net_buy_rank를 쓰세요. " +
        "종목을 이미 정했다면 get_investor_trend가 낫습니다. " +
        "정규장(09:00~15:30) 밖에서는 빈 결과가 정상입니다.",
      inputSchema: {
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 (기본값 all=전체 약 1,420종목). 키움이 코드 순으로 주므로 서버가 정렬합니다"),
        direction: z
          .enum(["buy", "sell"])
          .optional()
          .describe("buy=순매수 상위(기본), sell=순매도 상위"),
        unit: z.enum(["amount", "quantity"]).optional().describe("정렬·표시 단위 (기본값: amount=백만원)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ market, direction, unit, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const options: ForeignIntradayOptions = {
          market: market ?? "all",
          unit: unit ?? "amount",
          direction: direction ?? "buy",
        };

        const { rows, truncated } = await fetchIntradayForeign(client, options.market);
        return textResult(formatForeignIntraday(rows, options, top ?? DEFAULT_TOP, truncated, config.modeLabel));
      }),
  );
}
