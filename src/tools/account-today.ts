import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getKiwoomContext } from "../context.js";
import { fetchAccountTodayStatus } from "../kiwoom/api.js";
import type { AccountTodayStatus } from "../kiwoom/types.js";
import { formatKRW, formatSignedKRW, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

export function formatAccountToday(status: AccountTodayStatus, modeLabel: string): string {
  const n = parseKiwoomNumber;
  const v = (raw: string): number => n(raw) ?? 0;

  const sell = v(status.sell_amt);
  const buy = v(status.buy_amt);
  const cost = v(status.cmsn) + v(status.tax);
  const cashIn = v(status.ina_amt);
  const cashOut = v(status.outa);

  const lines = [
    `[${modeLabel}] 계좌 당일 현황`,
    "",
    "■ 당일 매매",
    `- 매도금액: ${formatKRW(sell)} / 매수금액: ${formatKRW(buy)}`,
    `- 수수료: ${formatKRW(v(status.cmsn))} / 세금: ${formatKRW(v(status.tax))} (합계 ${formatKRW(cost)})`,
    `- 매도−매수: ${formatSignedKRW(sell - buy)}`,
    "",
    "■ 당일 입출금·입출고",
    `- 입금: ${formatKRW(cashIn)} / 출금: ${formatKRW(cashOut)} (순입금 ${formatSignedKRW(cashIn - cashOut)})`,
    `- 입고: ${formatKRW(v(status.inq_amt))} / 출고: ${formatKRW(v(status.outq_amt))}`,
    "",
    "■ D+2 추정",
    `- 추정예수금: ${formatKRW(v(status.d2_entra))}`,
    `- 일반주식 평가금액: ${formatKRW(v(status.gnrl_stk_evlt_amt_d2))}`,
  ];

  // 신용·대출 블록은 값이 있을 때만 — 대다수 계좌는 전부 0이라 그대로 찍으면 소음이다.
  const creditRows: Array<[string, string]> = [
    ["신용융자금", status.crd_loan_d2],
    ["신용융자 평가금", status.crd_loan_evlta_d2],
    ["신용주식 평가금액", status.crd_stk_evlt_amt_d2],
    ["신용대주 담보금", status.crd_ls_grnt_d2],
    ["신용대주 평가금", status.crd_ls_evlta_d2],
    ["신용이자", status.crd_int_amt],
    ["신용이자 미납금", status.crd_int_npay_gold],
    ["예탁담보대출금", status.dpst_grnt_use_amt_d2],
    ["주식매입자금 대출금", status.stk_pur_cptal_loan_amt],
    ["매도대금 담보대출 이자", status.sel_prica_grnt_loan_int_amt_amt],
    ["기타 대여금", status.etc_loana],
  ];
  const credit = creditRows.filter(([, raw]) => v(raw) !== 0);
  if (credit.length > 0) {
    lines.push("", "■ 신용·대출");
    for (const [label, raw] of credit) lines.push(`- ${label}: ${formatKRW(v(raw))}`);
  }

  const otherRows: Array<[string, string]> = [
    ["RP 평가금액", status.rp_evlt_amt],
    ["채권 평가금액", status.bd_evlt_amt],
    ["ELS 평가금액", status.elsevlt_amt],
    ["배당금액", status.dvida_amt],
  ];
  const others = otherRows.filter(([, raw]) => v(raw) !== 0);
  if (others.length > 0) {
    lines.push("", "■ 기타 자산");
    for (const [label, raw] of others) lines.push(`- ${label}: ${formatKRW(v(raw))}`);
  }

  lines.push(
    "",
    "※ 당일 체결 기준 집계입니다 — 종목별 매매 손익은 get_trading_journal, 보유 종목 평가는 " +
      "get_account_holdings, 예수금·총평가는 get_account_balance를 쓰세요.",
    "※ D+2 추정은 결제(T+2)까지 반영한 예상치라 오늘 잔고와 다릅니다.",
  );
  if (credit.length === 0 && others.length === 0) {
    lines.push("※ 신용·대출·기타 자산(RP/채권/ELS/배당)은 전부 0이라 생략했습니다.");
  }
  return lines.join("\n");
}

export function registerAccountTodayTool(server: McpServer): void {
  server.registerTool(
    "get_account_today",
    {
      title: "계좌 당일 현황 조회",
      description:
        "오늘 하루 계좌에 무슨 일이 있었는지를 한 장으로 조회합니다 (키움 kt00017) — 매도·매수 금액, " +
        "수수료·세금, 입출금·입출고, D+2 추정예수금·평가금액, 신용/대출 잔액. " +
        "종목별 실현손익은 get_trading_journal, 현재 보유 종목은 get_account_holdings, " +
        "예수금·총평가 요약은 get_account_balance를 쓰세요 — 당일 현금 흐름을 보는 것은 이 tool뿐입니다. " +
        "모의투자에서는 제공되지 않습니다(RC9000).",
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const status = await fetchAccountTodayStatus(client);
        return textResult(formatAccountToday(status, config.modeLabel));
      }),
  );
}
