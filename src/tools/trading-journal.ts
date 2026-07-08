import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchTradingJournal } from "../kiwoom/api.js";
import { normalizeStockCode, type TradingJournalResponse } from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import { formatKRW, formatPercent, formatSignedKRW, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

export function formatTradingJournal(
  response: TradingJournalResponse,
  baseDate: string,
  modeLabel: string,
): string {
  // 매매 없는 날은 전 필드가 빈 placeholder 1행을 돌려주므로 실제 종목행만 남긴다.
  const rows = response.tdy_trde_diary.filter((r) => r.stk_cd.trim() !== "" || r.stk_nm.trim() !== "");
  // 2개월 초과 조회는 return_code 0 + return_msg 안내 + 빈 데이터로 온다.
  const notice = (response.return_msg ?? "").includes("2개월") ? `\n⚠️ ${response.return_msg?.trim()}` : "";
  const dateLabel = formatDateDashed(baseDate);

  if (rows.length === 0) {
    return `[${modeLabel}] ${dateLabel} 당일 매매 내역이 없습니다.${notice}`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 당일매매일지 — ${dateLabel} (${rows.length}종목)`,
    `합계 — 매도 ${formatKRW(n(response.tot_sell_amt))} / 매수 ${formatKRW(n(response.tot_buy_amt))} / ` +
      `손익 ${formatSignedKRW(n(response.tot_pl_amt))} (${formatPercent(n(response.tot_prft_rt))}) · ` +
      `수수료·세금 ${formatKRW(n(response.tot_cmsn_tax))}`,
    "",
    "| 종목 | 매수평균가 | 매수수량 | 매도평균가 | 매도수량 | 손익금액 | 수익률 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of rows) {
    const code = normalizeStockCode(r.stk_cd);
    const cells = [
      r.stk_nm ? `${r.stk_nm} (${code})` : code || "-",
      formatKRW(parseKiwoomPrice(r.buy_avg_pric)),
      n(r.buy_qty)?.toLocaleString("ko-KR") ?? "-",
      formatKRW(parseKiwoomPrice(r.sel_avg_pric)),
      n(r.sell_qty)?.toLocaleString("ko-KR") ?? "-",
      formatSignedKRW(n(r.pl_amt)),
      formatPercent(n(r.prft_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("", "※ 당일 매수·매도가 모두 있는 종목의 실현손익입니다 (수수료·세금 반영).");
  return lines.join("\n") + notice;
}

export function registerTradingJournalTool(server: McpServer): void {
  server.registerTool(
    "get_trading_journal",
    {
      title: "당일매매일지 조회",
      description:
        "특정일의 당일매매일지를 조회합니다 — 종목별 매수/매도 평균가·수량, 손익금액, 수익률과 총손익·총수익률 " +
        "(키움 ka10170). base_date를 생략하면 오늘 기준이며, 최근 2개월 이내 날짜만 조회할 수 있습니다.",
      inputSchema: {
        base_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 기준일 (기본값: 오늘, 최근 2개월 이내)"),
      },
    },
    async ({ base_date }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const baseDate = (base_date ?? todayInKst()).replaceAll("-", "");
        const response = await fetchTradingJournal(client, baseDate);
        return textResult(formatTradingJournal(response, baseDate, config.modeLabel));
      }),
  );
}
