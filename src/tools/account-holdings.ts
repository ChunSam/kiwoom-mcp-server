import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getKiwoomContext } from "../context.js";
import { fetchAccountEvaluation } from "../kiwoom/api.js";
import { normalizeStockCode, type AccountEvaluationResponse } from "../kiwoom/types.js";
import {
  formatKRW,
  formatPercent,
  formatSignedKRW,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

export function formatHoldings(
  evaluation: AccountEvaluationResponse,
  modeLabel: string,
  truncated = false,
): string {
  const n = parseKiwoomNumber;
  const holdings = evaluation.acnt_evlt_remn_indv_tot;

  if (holdings.length === 0) {
    return `[${modeLabel}] 보유 종목이 없습니다.`;
  }

  const header = [
    `[${modeLabel}] 보유 종목 (${holdings.length}종목, KRX 기준)`,
    "",
    "| 종목명 | 코드 | 보유수량 | 평균단가 | 현재가 | 평가금액 | 평가손익 | 수익률 | 비중 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  const rows = holdings.map((h) => {
    const cells = [
      h.stk_nm || "-",
      normalizeStockCode(h.stk_cd) || "-",
      n(h.rmnd_qty)?.toLocaleString("ko-KR") ?? "-",
      formatKRW(parseKiwoomPrice(h.pur_pric)),
      formatKRW(parseKiwoomPrice(h.cur_prc)),
      formatKRW(n(h.evlt_amt)),
      formatSignedKRW(n(h.evltv_prft)),
      formatPercent(n(h.prft_rt)),
      n(h.poss_rt) === null ? "-" : `${n(h.poss_rt)}%`,
    ];
    return `| ${cells.join(" | ")} |`;
  });

  const footer = [
    "",
    `합계 — 매입 ${formatKRW(n(evaluation.tot_pur_amt))} / 평가 ${formatKRW(n(evaluation.tot_evlt_amt))} / ` +
      `평가손익 ${formatSignedKRW(n(evaluation.tot_evlt_pl))} (${formatPercent(n(evaluation.tot_prft_rt))})`,
  ];

  if (truncated) {
    footer.push(
      "",
      "⚠️ 보유 종목이 많아 조회 상한에 도달했습니다 — 일부 종목이 누락되었을 수 있습니다.",
    );
  }

  return [...header, ...rows, ...footer].join("\n");
}

export function registerAccountHoldingsTool(server: McpServer): void {
  server.registerTool(
    "get_account_holdings",
    {
      title: "보유 종목 조회",
      description:
        "계좌의 보유 종목 목록을 조회합니다 — 종목별 수량, 평균단가, 현재가, 평가금액, " +
        "평가손익, 수익률, 보유비중 (키움 kt00018). 인자가 필요 없습니다.",
    },
    async () =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const evaluation = await fetchAccountEvaluation(client, "2");
        return textResult(formatHoldings(evaluation, config.modeLabel, evaluation.truncated));
      }),
  );
}
