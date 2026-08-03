import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchInstitutionTrend } from "../kiwoom/api.js";
import type { InstitutionTrendResponse } from "../kiwoom/types.js";
import { assertDateRange, formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import {
  formatKRW,
  formatPercent,
  formatQuantity,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_DISPLAY_ROWS = 15;

export function formatInstitutionTrend(
  res: InstitutionTrendResponse,
  stockCode: string,
  fromDate: string,
  toDate: string,
  limit: number,
  modeLabel: string,
): string {
  const rows = res.stk_orgn_trde_trnsn;
  const period = `${formatDateDashed(fromDate)} ~ ${formatDateDashed(toDate)}`;

  if (rows.length === 0) {
    return (
      `[${modeLabel}] 기관·외국인 매매 추이가 없습니다 (종목 ${stockCode}, ${period}). ` +
      "종목코드나 기간을 확인해 주세요 — 상장 이전 구간이면 빈 결과가 옵니다."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, limit);
  const lines = [
    `[${modeLabel}] ${stockCode} 기관·외국인 매매 추이 (${period}, ${rows.length}거래일)`,
    "",
    "■ 추정평균단가",
    `- 기관: ${formatKRW(parseKiwoomPrice(res.orgn_prsm_avg_pric))} / 외국인: ${formatKRW(parseKiwoomPrice(res.for_prsm_avg_pric))}`,
    "",
    `■ 최근 ${shown.length}거래일`,
    "",
    "| 일자 | 종가 | 등락률 | 거래량 | 기관 순매수 | 기관 누적 | 외국인 순매수 | 외국인 누적 | 한도소진 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    const cells = [
      formatDateDashed(r.dt),
      formatKRW(parseKiwoomPrice(r.close_pric)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(n(r.trde_qty)),
      formatSigned(n(r.orgn_daly_nettrde_qty), 0),
      formatSigned(n(r.orgn_dt_acc), 0),
      formatSigned(n(r.for_daly_nettrde_qty), 0),
      formatSigned(n(r.for_dt_acc), 0),
      formatPercent(n(r.limit_exh_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (rows.length > shown.length) {
    lines.push("", `※ 조회된 ${rows.length}행 중 최근 ${shown.length}행만 표시했습니다 (count로 조정).`);
  }
  lines.push(
    "",
    "※ 최신 일자가 위입니다. 순매수는 수량(주)이며 양수면 순매수, 음수면 순매도입니다.",
    "※ **누적은 조회 기간 시작일부터의 합계**입니다 — 기간을 바꾸면 누적값도 함께 바뀝니다.",
    "※ 추정평균단가는 키움이 산출한 추정치로, 기관·외국인의 실제 체결 단가가 아닙니다. " +
      "현재가와 비교하면 두 주체가 평가이익 구간인지 손실 구간인지 가늠할 수 있습니다.",
    "※ 당일 행은 장중에는 순매수가 0으로 옵니다 (집계 전). 투자자 주체를 더 잘게 " +
      "(금융투자·보험·투신·연기금 등) 보려면 get_investor_trend를 쓰세요.",
    UNIFIED_EXCHANGE_NOTE,
  );
  return lines.join("\n");
}

export function registerInstitutionTrendTool(server: McpServer): void {
  server.registerTool(
    "get_institution_trend",
    {
      title: "기관·외국인 추정평균단가 조회",
      description:
        "특정 종목을 기관·외국인이 **대략 얼마에 담았는지**(추정평균단가)와 일별·기간누적 순매수를 " +
        "조회합니다 (키움 ka10045). 현재가와 추정단가를 비교하면 두 주체의 평가손익 구간을 가늠할 수 있습니다. " +
        "투자자 주체를 더 잘게(개인·금융투자·보험·투신·연기금 등) 보려면 get_investor_trend를, " +
        "외국인 보유주식수·한도소진률 추이는 get_foreign_holding을 쓰세요 — 단가를 주는 것은 이 tool뿐입니다.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .describe("조회할 6자리 종목코드"),
        from_date: z
          .string()
          .regex(/^\d{8}$/, "yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 시작일 yyyyMMdd (기본: 30일 전). 누적 순매수의 기산점이 됩니다"),
        to_date: z
          .string()
          .regex(/^\d{8}$/, "yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 종료일 yyyyMMdd (기본: 오늘)"),
        count: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("표시할 행 수 (기본 15, 최대 60; 최신순)"),
      },
    },
    async ({ stock_code, from_date, to_date, count }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const toDate = to_date ?? todayInKst();
        const fromDate = from_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS);
        assertDateRange(fromDate, toDate);

        const res = await fetchInstitutionTrend(client, code, fromDate, toDate);
        return textResult(
          formatInstitutionTrend(res, code, fromDate, toDate, count ?? DEFAULT_DISPLAY_ROWS, config.modeLabel),
        );
      }),
  );
}
