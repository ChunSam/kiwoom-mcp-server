import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchAccountEvaluation,
  fetchAccountPeriodPl,
  fetchDeposit,
  fetchNextDaySettlement,
} from "../kiwoom/api.js";
import {
  normalizeStockCode,
  type AccountEvaluationResponse,
  type AccountPeriodPlResponse,
  type DepositResponse,
  type NextDaySettlementResponse,
} from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import {
  formatKRW,
  formatPercent,
  formatQuantity,
  formatSignedKRW,
  parseKiwoomNumber,
} from "../utils/num.js";
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

/**
 * kt00008 익일결제예정 — 다음 결제일에 결제될 체결의 건별 명세.
 *
 * `d1_entra`/`d2_entra`가 **왜 그 값인지**를 설명하는 드릴다운이다. 총액은 view=summary에
 * 이미 있으므로 여기서는 건별 내역과 세금 분해를 낸다.
 */
export function formatNextDaySettlement(
  res: NextDaySettlementResponse & { truncated?: boolean },
  modeLabel: string,
): string {
  const n = parseKiwoomNumber;
  const rows = res.acnt_nxdy_setl_frcs_prps_array;

  if (rows.length === 0) {
    return [
      `[${modeLabel}] 익일 결제 예정 내역 (kt00008)`,
      "",
      "다음 결제일에 결제될 체결이 없습니다.",
      "체결 당일에는 아직 잡히지 않습니다 — 결제일(체결일 기준 영업일 +2)의 전 영업일에 조회해야 나옵니다.",
    ].join("\n");
  }

  const sellSum = n(res.sell_amt_sum);
  const buySum = n(res.buy_amt_sum);
  const net = (sellSum ?? 0) - (buySum ?? 0);

  const lines = [
    `[${modeLabel}] 익일 결제 예정 내역 (kt00008)`,
    "",
    `- 체결일: ${formatDateDashed(res.trde_dt)} → 결제일: ${formatDateDashed(res.setl_dt)}`,
    `- 매도 정산 합계: ${formatKRW(sellSum)} / 매수 정산 합계: ${formatKRW(buySum)}`,
    `- 순증감: ${formatSignedKRW(net)}`,
    "",
    "| 구분 | 종목 | 수량 | 단가 | 약정금액 | 수수료 | 제세금 | 정산금액 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const row of rows) {
    // 세금은 4갈래로 쪼개져 오지만 표에는 합계를 싣고 각주로 분해를 밝힌다.
    const tax =
      (n(row.incm_tax) ?? 0) + (n(row.rstx) ?? 0) + (n(row.trde_tax) ?? 0) + (n(row.resi_tax) ?? 0);
    const code = normalizeStockCode(row.stk_cd) || "-";
    lines.push(
      `| ${row.sell_tp || "-"} | ${row.stk_nm || "-"} (${code}) | ${formatQuantity(n(row.qty))} | ` +
        `${formatKRW(n(row.unp))} | ${formatKRW(n(row.engg_amt))} | ${formatKRW(n(row.cmsn))} | ` +
        `${formatKRW(tax)} | ${formatKRW(n(row.exct_amt))} |`,
    );
  }

  lines.push(
    "",
    "※ 정산금액은 매도는 수취액, 매수는 지불액이며 둘 다 양수로 옵니다 — 방향은 구분 열로 읽으세요.",
    "※ 제세금은 소득세·농어촌특별세·거래세·주민세의 합계입니다 (매수 체결은 보통 0).",
    "※ 결제일은 키움이 준 값 그대로입니다 — 대체공휴일이 반영되어 있어 체결일+2영업일로 계산하면 어긋날 수 있습니다.",
    "※ 이 조회는 **다음 결제일 하루치**만 보여줍니다. 지난 결제 내역은 get_transactions(kt00015)를 쓰세요.",
  );

  if (res.truncated) {
    lines.push("※ 결과가 많아 일부 건이 빠졌을 수 있습니다.");
  }

  return lines.join("\n");
}

export function registerAccountBalanceTool(server: McpServer): void {
  server.registerTool(
    "get_account_balance",
    {
      title: "계좌 잔고 조회",
      description:
        "view=summary(기본)는 계좌의 예수금(주문가능/출금가능 포함)과 총매입금액, 총평가금액, " +
        "총평가손익, 추정예탁자산, 당일/당월/누적 투자손익입니다 (키움 kt00001 + kt00018 + kt00004). " +
        "view=settlement은 **다음 결제일에 결제될 체결의 건별 명세**입니다 (kt00008) — " +
        "summary의 D+1/D+2 추정예수금이 왜 그 값인지를 종목·수량·수수료·제세금으로 쪼개 보여줍니다. " +
        "지난 결제 내역 전체는 get_transactions(kt00015), 보유 종목별 잔고는 get_account_holdings를 쓰세요.",
      inputSchema: {
        view: z
          .enum(["summary", "settlement"])
          .default("summary")
          .describe("summary=잔고·손익 요약(기본), settlement=익일 결제 예정 건별 명세"),
      },
    },
    async ({ view }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();

        if (view === "settlement") {
          return textResult(
            formatNextDaySettlement(await fetchNextDaySettlement(client), config.modeLabel),
          );
        }

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
