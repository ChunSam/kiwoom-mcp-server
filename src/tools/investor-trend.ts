import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchInvestorDaily, fetchInvestorTotal, type InvestorUnit } from "../kiwoom/api.js";
import type { InvestorDailyItem, InvestorTotalItem } from "../kiwoom/types.js";
import { formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import { formatNumber, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_LOOKBACK_DAYS = 30;
const DAILY_ROWS = 10;

/** amt_qty_tp cross-checked live: amount mode is 백만원, quantity mode is 주. */
const UNIT_LABELS: Record<InvestorUnit, string> = { amount: "백만원", quantity: "주" };

const ORGN_DETAIL = [
  { key: "fnnc_invt", label: "금융투자" },
  { key: "insrnc", label: "보험" },
  { key: "invtrt", label: "투신" },
  { key: "bank", label: "은행" },
  { key: "penfnd_etc", label: "연기금등" },
  { key: "samo_fund", label: "사모펀드" },
  { key: "etc_fnnc", label: "기타금융" },
] as const;

const s = (raw: string) => formatSigned(parseKiwoomNumber(raw));

export function formatInvestorTrend(
  total: InvestorTotalItem | undefined,
  daily: InvestorDailyItem[],
  stockCode: string,
  fromDate: string,
  toDate: string,
  unit: InvestorUnit,
  modeLabel: string,
): string {
  const period = `${formatDateDashed(fromDate)} ~ ${formatDateDashed(toDate)}`;
  if (!total && daily.length === 0) {
    return `[${modeLabel}] ${stockCode} 투자자 매매동향 데이터가 없습니다 (${period}). 종목코드를 확인해 주세요.`;
  }

  const lines = [
    `[${modeLabel}] ${stockCode} 투자자별 매매동향 (${period}, 순매수, 단위: ${UNIT_LABELS[unit]})`,
  ];

  if (total) {
    lines.push(
      "",
      "■ 기간 합계",
      `- 개인: ${s(total.ind_invsr)} / 외국인: ${s(total.frgnr_invsr)} / 기관계: ${s(total.orgn)}`,
      `  · 기관 세부: ${ORGN_DETAIL.map((d) => `${d.label} ${s(total[d.key])}`).join(", ")}`,
      `- 기타법인: ${s(total.etc_corp)} / 내외국인: ${s(total.natfor)} / 국가: ${s(total.natn)}`,
    );
  }

  if (daily.length > 0) {
    lines.push(
      "",
      `■ 최근 ${Math.min(daily.length, DAILY_ROWS)}거래일`,
      "| 일자 | 종가 | 전일대비 | 개인 | 외국인 | 기관계 |",
      "|---|---:|---:|---:|---:|---:|",
    );
    for (const d of daily.slice(0, DAILY_ROWS)) {
      lines.push(
        `| ${formatDateDashed(d.dt)} | ${formatNumber(parseKiwoomPrice(d.cur_prc))} | ${s(d.pred_pre)} | ` +
          `${s(d.ind_invsr)} | ${s(d.frgnr_invsr)} | ${s(d.orgn)} |`,
      );
    }
  }

  return lines.join("\n");
}

export function registerInvestorTrendTool(server: McpServer): void {
  server.registerTool(
    "get_investor_trend",
    {
      title: "투자자별 매매동향 조회",
      description:
        "종목의 개인/외국인/기관 순매수 동향을 조회합니다 (키움 ka10059+ka10061). 기간 합계와 " +
        "최근 거래일별 내역을 함께 보여줍니다. unit: amount(금액, 백만원, 기본)/quantity(수량, 주). " +
        "종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^[0-9A-Z]{6}$/i, "6자리 종목코드여야 합니다")
          .describe("6자리 종목코드 (예: 005930)"),
        from_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("합계 기간 시작일 (기본값: 30일 전)"),
        to_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("합계 기간 종료일 (기본값: 오늘)"),
        unit: z.enum(["amount", "quantity"]).optional().describe("단위 (기본값: amount=백만원)"),
      },
    },
    async ({ stock_code, from_date, to_date, unit }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const fromDate = (from_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS)).replaceAll("-", "");
        const toDate = (to_date ?? todayInKst()).replaceAll("-", "");
        const u: InvestorUnit = unit ?? "amount";

        // ka10061 and ka10059 are different TRs — per-TR rate limits allow parallel calls.
        const [total, daily] = await Promise.all([
          fetchInvestorTotal(client, code, fromDate, toDate, u),
          fetchInvestorDaily(client, code, toDate, u),
        ]);

        return textResult(formatInvestorTrend(total, daily, code, fromDate, toDate, u, config.modeLabel));
      }),
  );
}
