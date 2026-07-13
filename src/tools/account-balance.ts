import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getKiwoomContext } from "../context.js";
import { fetchAccountEvaluation, fetchAccountPeriodPl, fetchDeposit } from "../kiwoom/api.js";
import type {
  AccountEvaluationResponse,
  AccountPeriodPlResponse,
  DepositResponse,
} from "../kiwoom/types.js";
import { formatKRW, formatPercent, formatSignedKRW, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

export function formatBalance(
  deposit: DepositResponse,
  evaluation: AccountEvaluationResponse,
  modeLabel: string,
  periodPl: AccountPeriodPlResponse | null = null,
): string {
  const n = parseKiwoomNumber;
  const lines = [
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
  ];

  // 기간 손익 블록은 best-effort — kt00004 조회 실패 시 조용히 생략된다.
  // 라벨은 키움 스펙 원문 그대로 (당일/당월/누적 투자손익·투자원금·손익율).
  if (periodPl) {
    const values = [
      periodPl.tdy_lspft_amt, periodPl.invt_bsamt, periodPl.lspft_amt,
      periodPl.tdy_lspft, periodPl.lspft2, periodPl.lspft,
      periodPl.tdy_lspft_rt, periodPl.lspft_ratio, periodPl.lspft_rt,
    ];
    const allZero = values.every((v) => !(n(v) ?? 0));
    lines.push("", "■ 기간 손익 (kt00004)");
    if (allZero) {
      // REAL 실측(2026-07-13): 보유·이력이 있는 계좌도 9필드 전부 0으로 반환될 수
      // 있다 (집계 시점/기준 미설정 추정). "손익 0원"으로 단정 표시하면 오해를
      // 유발하므로, ka40009 NAV 선례처럼 값이 채워질 때만 수치를 렌더한다.
      lines.push(
        "- 키움이 기간 손익을 모두 0으로 반환했습니다 — 집계 전이거나 수익률 산출 기준이 없는 계좌일 수 있어 실제 손익이 0이라는 뜻은 아닐 수 있습니다.",
      );
    } else {
      lines.push(
        `- 당일투자손익: ${formatSignedKRW(n(periodPl.tdy_lspft))} (${formatPercent(n(periodPl.tdy_lspft_rt))}) / 당일투자원금 ${formatKRW(n(periodPl.tdy_lspft_amt))}`,
        `- 당월투자손익: ${formatSignedKRW(n(periodPl.lspft2))} (${formatPercent(n(periodPl.lspft_ratio))}) / 당월투자원금 ${formatKRW(n(periodPl.invt_bsamt))}`,
        `- 누적투자손익: ${formatSignedKRW(n(periodPl.lspft))} (${formatPercent(n(periodPl.lspft_rt))}) / 누적투자원금 ${formatKRW(n(periodPl.lspft_amt))}`,
      );
    }
  }

  return lines.join("\n");
}

export function registerAccountBalanceTool(server: McpServer): void {
  server.registerTool(
    "get_account_balance",
    {
      title: "계좌 잔고 조회",
      description:
        "계좌의 예수금(주문가능/출금가능 포함)과 총매입금액, 총평가금액, 총평가손익, " +
        "추정예탁자산, 당일/당월/누적 투자손익을 조회합니다 (키움 kt00001 + kt00018 + kt00004). " +
        "인자가 필요 없습니다.",
    },
    async () =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        // Different TRs — the per-TR rate limit allows these in parallel.
        // kt00004 is best-effort: on failure only the 기간 손익 block is dropped.
        const [deposit, evaluation, periodPl] = await Promise.all([
          fetchDeposit(client),
          fetchAccountEvaluation(client, "1"),
          fetchAccountPeriodPl(client).catch((error: unknown) => {
            console.error("kt00004 계좌평가현황 조회 실패 — 기간 손익 블록 생략:", error);
            return null;
          }),
        ]);
        return textResult(formatBalance(deposit, evaluation, config.modeLabel, periodPl));
      }),
  );
}
