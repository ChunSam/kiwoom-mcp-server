import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getKiwoomContext } from "../context.js";
import { fetchAccountEvaluation, fetchDeposit } from "../kiwoom/api.js";
import type { AccountEvaluationResponse, DepositResponse } from "../kiwoom/types.js";
import { formatKRW, formatPercent, formatSignedKRW, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

export function formatBalance(
  deposit: DepositResponse,
  evaluation: AccountEvaluationResponse,
  modeLabel: string,
): string {
  const n = parseKiwoomNumber;
  return [
    `[${modeLabel}] 계좌 잔고 요약`,
    "",
    "■ 예수금 (kt00001)",
    `- 예수금: ${formatKRW(n(deposit.entr))}`,
    `- D+1 추정예수금: ${formatKRW(n(deposit.d1_entra))} / D+2 추정예수금: ${formatKRW(n(deposit.d2_entra))}`,
    `- 주문가능금액: ${formatKRW(n(deposit.ord_alow_amt))} / 출금가능금액: ${formatKRW(n(deposit.pymn_alow_amt))}`,
    "",
    "■ 평가 현황 (kt00018)",
    `- 총매입금액: ${formatKRW(n(evaluation.tot_pur_amt))}`,
    `- 총평가금액: ${formatKRW(n(evaluation.tot_evlt_amt))}`,
    `- 총평가손익: ${formatSignedKRW(n(evaluation.tot_evlt_pl))} (${formatPercent(n(evaluation.tot_prft_rt))})`,
    `- 추정예탁자산: ${formatKRW(n(evaluation.prsm_dpst_aset_amt))}`,
  ].join("\n");
}

export function registerAccountBalanceTool(server: McpServer): void {
  server.registerTool(
    "get_account_balance",
    {
      title: "계좌 잔고 조회",
      description:
        "계좌의 예수금(주문가능/출금가능 포함)과 총매입금액, 총평가금액, 총평가손익, " +
        "추정예탁자산을 조회합니다 (키움 kt00001 + kt00018). 인자가 필요 없습니다.",
    },
    async () =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        // Different TRs — the per-TR rate limit allows these in parallel.
        const [deposit, evaluation] = await Promise.all([
          fetchDeposit(client),
          fetchAccountEvaluation(client, "1"),
        ]);
        return textResult(formatBalance(deposit, evaluation, config.modeLabel));
      }),
  );
}
