import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchAccountReturnSummary, fetchDailyAssetTrend } from "../kiwoom/api.js";
import type { AccountReturnSummary, DailyAssetItem } from "../kiwoom/types.js";
import { formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import {
  formatKRW,
  formatPercent,
  formatRatioPercent,
  formatSignedKRW,
  parseKiwoomNumber,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

export function formatAccountTrend(
  daily: DailyAssetItem[],
  summary: AccountReturnSummary | null,
  modeLabel: string,
  range: { fromDate: string; toDate: string },
  truncated = false,
): string {
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 계좌 자산 추이 (${formatDateDashed(range.fromDate)} ~ ${formatDateDashed(range.toDate)})`,
  ];

  // 기간 요약 블록은 best-effort — kt00016 조회 실패 시 조용히 생략된다.
  if (summary) {
    lines.push(
      "",
      "■ 기간 요약 (kt00016)",
      `- 순자산: ${formatKRW(n(summary.tot_amt_fr))} → ${formatKRW(n(summary.tot_amt_to))}`,
      `- 예수금: ${formatKRW(n(summary.entr_fr))} → ${formatKRW(n(summary.entr_to))} / ` +
        `유가증권 평가: ${formatKRW(n(summary.scrt_evlt_amt_fr))} → ${formatKRW(n(summary.scrt_evlt_amt_to))}`,
      `- 기간 수익률: ${formatPercent(n(summary.prft_rt))} — 평가손익 ${formatSignedKRW(n(summary.evltv_prft))}, ` +
        `투자원금평잔 ${formatKRW(n(summary.invt_bsamt))} 기준`,
      `- 회전율: ${formatRatioPercent(n(summary.tern_rt))}`,
      `- 기간내 입금 ${formatKRW(n(summary.termin_tot_trns))} / 출금 ${formatKRW(n(summary.termin_tot_pymn))} / ` +
        `입고 ${formatKRW(n(summary.termin_tot_inq))} / 출고 ${formatKRW(n(summary.termin_tot_outq))}`,
    );
  }

  if (daily.length === 0) {
    lines.push("", "조회 기간의 일별 자산 내역이 없습니다.");
    return lines.join("\n");
  }

  lines.push(
    "",
    `■ 일별 추정예탁자산 (kt00002, ${daily.length}일)`,
    "",
    "| 일자 | 예수금 | 대용금 | 추정예탁자산 |",
    "|---|---:|---:|---:|",
  );
  for (const row of daily) {
    lines.push(
      `| ${formatDateDashed(row.dt)} | ${formatKRW(n(row.entr))} | ${formatKRW(n(row.repl_amt))} | ` +
        `${formatKRW(n(row.prsm_dpst_aset_amt))} |`,
    );
  }

  if (truncated) {
    lines.push(
      "",
      "⚠️ 조회 상한에 도달했습니다 — 뒤쪽 일부 일자가 누락되었을 수 있습니다. 기간(days)을 좁혀 다시 조회하세요.",
    );
  }

  // 입출금 안내는 기간 요약 블록이 실제로 렌더된 경우에만 그 블록을 가리킨다.
  lines.push(
    "",
    "※ 주말·휴장일 행은 직전 거래일 값이 그대로 이어집니다." +
      (summary
        ? " 기간내 입출금이 있으면 자산 증감을 수익으로 해석하지 않도록 기간 요약의 입금/출금을 함께 확인하세요."
        : ""),
  );
  return lines.join("\n");
}

export function registerAccountTrendTool(server: McpServer): void {
  server.registerTool(
    "get_account_trend",
    {
      title: "계좌 자산·수익률 추이 조회",
      description:
        "일별 추정예탁자산(예수금·대용금 포함) 추이와 기간 수익률·평가손익·입출금 요약을 조회합니다 " +
        `(키움 kt00002 + kt00016). "내 계좌가 지난 한 달간 어떻게 변했나" 같은 질문에 사용하세요 ` +
        `(기본 ${DEFAULT_DAYS}일, 최대 ${MAX_DAYS}일). 모의투자에서는 지원되지 않는 조회입니다.`,
      inputSchema: {
        days: z
          .number()
          .int()
          .min(2)
          .max(MAX_DAYS)
          .default(DEFAULT_DAYS)
          .describe(`조회 기간(일) — 오늘부터 거슬러 계산 (2~${MAX_DAYS}, 기본 ${DEFAULT_DAYS})`),
      },
    },
    async ({ days }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const fromDate = kstDaysAgo(days ?? DEFAULT_DAYS);
        const toDate = todayInKst();
        // 서로 다른 TR — per-TR 레이트리밋이라 병렬 호출 가능 (get_account_balance 선례).
        // kt00016은 best-effort: 실패해도 일별 테이블은 그대로 나간다.
        const [trend, summary] = await Promise.all([
          fetchDailyAssetTrend(client, fromDate, toDate),
          fetchAccountReturnSummary(client, fromDate, toDate).catch((error: unknown) => {
            console.error("kt00016 일별계좌수익률상세현황 조회 실패 — 기간 요약 블록 생략:", error);
            return null;
          }),
        ]);
        return textResult(
          formatAccountTrend(trend.rows, summary, config.modeLabel, { fromDate, toDate }, trend.truncated),
        );
      }),
  );
}
