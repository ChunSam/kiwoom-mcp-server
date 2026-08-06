import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchIntradayForeign,
  fetchIntradayInvestorRank,
  type IntradayInvestor,
  type InvestorUnit,
  type RankingMarket,
} from "../kiwoom/api.js";
import type { IntradayForeignItem, IntradayInvestorRankItem } from "../kiwoom/types.js";
import { formatKRW, formatPercent, formatQuantity, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

const UNIT_LABELS: Record<InvestorUnit, string> = { amount: "백만원", quantity: "주" };
const MARKET_LABELS: Record<RankingMarket, string> = { all: "전체", kospi: "코스피", kosdaq: "코스닥" };

const INVESTOR_LABELS: Record<IntradayInvestor, string> = {
  foreign: "외국인",
  institution: "기관계",
  insurance: "보험",
  trust: "투신",
  pension: "연기금등",
  other_corp: "기타법인",
};

/** 두 TR이 공유하는 각주 — 값의 성격이 같아서 문구도 같이 간다. */
const PROVISIONAL_NOTE =
  "※ 수량은 **1,000주 단위로 반올림된 장중 잠정치**입니다. 마감 후에도 응답은 오지만 " +
  "**확정치로 갱신되지 않습니다** — 실측에서 같은 종목이 이 지표 +261,000인데 확정치는 " +
  "-99,219로 부호까지 반대였습니다. 마감된 거래일 기준 확정치는 get_net_buy_rank·get_investor_trend를 쓰세요.";

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
      "이 지표는 당일 장중 집계라 장 시작 전에는 빈 결과가 정상입니다. " +
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
    "※ 이 표(ka10063)는 **외국인만** 집계합니다. 기관계·보험·투신·연기금등·기타법인은 " +
      "investor 파라미터로 보세요 — 개인·금융투자는 장중에 공개되지 않습니다.",
    PROVISIONAL_NOTE,
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

/**
 * 장중 주체별 순매매 상위 (ka10065). 가격·금액이 없어 표가 ka10063보다 좁다.
 *
 * `netslmt`는 이름이 "순매도"인데 값은 **순매수 방향**이고, `sel_qty`의 `-`는 방향
 * 표기라 수량은 절대값으로 읽는다 — 자세한 근거는 types.ts.
 */
export function formatIntradayInvestorRank(
  rows: IntradayInvestorRankItem[],
  investor: IntradayInvestor,
  market: RankingMarket,
  direction: "buy" | "sell",
  top: number,
  modeLabel: string,
  /** 사용자가 이 모드에 없는 단위를 줬을 때의 원래 값 — 조용히 바꾸지 않는다. */
  requestedUnit?: InvestorUnit,
): string {
  const investorLabel = INVESTOR_LABELS[investor];
  const dirLabel = direction === "buy" ? "순매수" : "순매도";
  const scope = `${MARKET_LABELS[market]} · ${investorLabel} ${dirLabel} 상위`;

  if (rows.length === 0) {
    return (
      `[${modeLabel}] 장중 ${investorLabel} 매매 데이터가 없습니다 (${scope}). ` +
      "이 지표는 당일 장중 집계라 장 시작 전에는 빈 결과가 정상입니다. " +
      "마감된 거래일 기준으로 보려면 get_net_buy_rank를 쓰세요."
    );
  }

  const shown = rows.slice(0, top);
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 장중 ${investorLabel} 매매 (${scope}) — ${rows.length}종목 중 ${shown.length}종목`,
    "",
    "| 순위 | 종목명 | 코드 | 순매수(주) | 매수 | 매도 |",
    "|---:|---|---|---:|---:|---:|",
  ];

  shown.forEach((r, index) => {
    const cells = [
      String(index + 1),
      r.stk_nm || "-",
      r.stk_cd,
      formatSigned(n(r.netslmt)),
      // 매수/매도의 +/- 는 방향 중복이라 절대값으로 표시한다 (ka10002·ka10037과 같은 규약).
      formatQuantity(Math.abs(n(r.buy_qty) ?? 0)),
      formatQuantity(Math.abs(n(r.sel_qty) ?? 0)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  if (requestedUnit === "amount") {
    lines.push(
      "",
      "⚠️ 이 주체 조회(ka10065)는 **금액을 주지 않아 수량으로 표시했습니다** — " +
        "금액 기준은 investor=foreign(ka10063)에서만 됩니다.",
    );
  }

  lines.push(
    "",
    `※ 순매수 = 매수 − 매도이고 ${dirLabel} 방향으로 정렬돼 있습니다. ` +
      "순매도 조회에서는 값이 음수로 나옵니다.",
    "※ 이 지표는 **한 번에 최대 100종목**입니다 (페이지네이션 없음). 주체에 따라 그보다 적게 " +
      "오는 것은 잘린 게 아니라 그만큼만 매매했다는 뜻입니다.",
    PROVISIONAL_NOTE,
  );
  if (rows.length > shown.length) {
    lines.push(`※ ${rows.length}종목 중 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerForeignIntradayTool(server: McpServer): void {
  server.registerTool(
    "get_foreign_intraday",
    {
      title: "장중 주체별 순매수 상위 (실시간)",
      description:
        "정규장 중 **어떤 주체가 지금 사고 있는 종목**을 전 종목에서 뽑습니다 (키움 ka10063/ka10065). " +
        "'오늘 외국인이 뭘 담고 있나', '장중 연기금 순매수 상위'처럼 **실시간 수급**을 볼 때 쓰세요. " +
        "investor로 외국인(기본)·기관계·보험·투신·연기금등·기타법인을 고릅니다 — " +
        "개인·금융투자는 거래소가 장중에 공개하지 않아 조회할 수 없습니다. " +
        "값은 1,000주 단위 잠정치라 **마감 후 확정치와 다릅니다**(부호가 반대일 수도 있음) — " +
        "마감된 거래일 기준은 get_net_buy_rank, 종목을 이미 정했다면 get_investor_trend를 쓰세요.",
      inputSchema: {
        investor: z
          .enum(["foreign", "institution", "insurance", "trust", "pension", "other_corp"])
          .optional()
          .describe(
            "투자자 주체 — foreign(외국인, 기본)/institution(기관계)/insurance(보험)/trust(투신)/pension(연기금등)/other_corp(기타법인). foreign만 금액·현재가까지 나옵니다",
          ),
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 (기본값 all=전체). foreign은 키움이 코드 순으로 주므로 서버가 정렬합니다"),
        direction: z
          .enum(["buy", "sell"])
          .optional()
          .describe("buy=순매수 상위(기본), sell=순매도 상위"),
        unit: z
          .enum(["amount", "quantity"])
          .optional()
          .describe("정렬·표시 단위 (기본값 amount=백만원) — **investor=foreign에서만 유효**, 나머지 주체는 수량만 옵니다"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ investor, market, direction, unit, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const who: IntradayInvestor = investor ?? "foreign";
        const m: RankingMarket = market ?? "all";
        const dir = direction ?? "buy";
        const count = top ?? DEFAULT_TOP;

        if (who !== "foreign") {
          const rows = await fetchIntradayInvestorRank(client, m, who, dir);
          return textResult(
            formatIntradayInvestorRank(rows, who, m, dir, count, config.modeLabel, unit),
          );
        }

        const options: ForeignIntradayOptions = { market: m, unit: unit ?? "amount", direction: dir };
        const { rows, truncated } = await fetchIntradayForeign(client, options.market);
        return textResult(formatForeignIntraday(rows, options, count, truncated, config.modeLabel));
      }),
  );
}
