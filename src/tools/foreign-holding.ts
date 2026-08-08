import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchForeignHolding,
  fetchForeignLimitSurge,
  fetchForeignPeriodTrade,
  fetchForeignStreakTrade,
  FOREIGN_LIMIT_SURGE_DAYS,
  FOREIGN_PERIOD_DAYS,
  type ForeignLimitSurgeDays,
  type ForeignPeriodDays,
  type RankingMarket,
} from "../kiwoom/api.js";
import {
  type ForeignHoldingItem,
  type ForeignLimitSurgeItem,
  type ForeignPeriodTradeItem,
  type ForeignStreakTradeItem,
} from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import { formatKRW, formatNumber, formatPercent, formatQuantity, formatRatioPercent, formatSigned, isSaturatedInt, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_DISPLAY_DAYS = 15;
const DEFAULT_TOP = 20;
const MAX_TOP = 100;
const DEFAULT_SURGE_DAYS: ForeignLimitSurgeDays = "5";
const DEFAULT_PERIOD_DAYS: ForeignPeriodDays = "20";
/** ka10035가 고정으로 보는 연속 일수 — 파라미터가 아니라 TR의 정의다(dm1~dm3). */
const STREAK_DAYS = "3";

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

/**
 * ka10036의 `trde_qty`에 32비트 포화값(4294967295)이 실재한다 — KODEX 200선물인버스2X가
 * 실측으로 걸렸다. 그대로 찍으면 42.9억주라는 거짓 숫자가 나가므로 상한 표기로 바꾼다.
 */
function quantityOrCap(raw: string): string {
  const value = parseKiwoomNumber(raw);
  return isSaturatedInt(value) ? "상한 초과" : formatQuantity(value);
}

/** 외국인 한도소진율 증가 상위 (ka10036) — ka10008의 시장 전체 스크리너 판. */
export function formatForeignLimitSurge(
  rows: ForeignLimitSurgeItem[],
  market: RankingMarket,
  days: ForeignLimitSurgeDays,
  top: number,
  modeLabel: string,
  /** 사용자가 ka10036이 안 받는 기간을 줘서 대체한 경우의 원래 값 — 조용히 바꾸지 않는다. */
  requestedDays?: string,
): string {
  const title = `외국인 한도소진율 증가 상위 — ${MARKET_LABELS[market]} (${days}일 대비)`;
  if (rows.length === 0) {
    return `[${modeLabel}] ${title}: 해당 종목이 없습니다.`;
  }

  const shown = rows.slice(0, top);
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 거래량 | 기준 소진률 | 현재 소진률 | 증가폭 | 보유주식수 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((r, i) => {
    lines.push(
      row([
        r.rank || String(i + 1),
        r.stk_nm,
        r.stk_cd,
        formatKRW(parseKiwoomPrice(r.cur_prc)),
        quantityOrCap(r.trde_qty),
        formatRatioPercent(n(r.base_limit_exh_rt)),
        formatRatioPercent(n(r.limit_exh_rt)),
        `${formatSigned(n(r.exh_rt_incrs))}%p`,
        formatQuantity(n(r.poss_stkcnt)),
      ]),
    );
  });
  if (requestedDays && requestedDays !== days) {
    lines.push(
      "",
      `⚠️ 요청한 ${requestedDays}일은 이 순위가 지원하지 않아 **${days}일로 조회했습니다** — ` +
        `limit_surge는 ${FOREIGN_LIMIT_SURGE_DAYS.join("/")}일만 받습니다.`,
    );
  }
  lines.push(
    "",
    `※ 증가폭(현재 − ${days}일 전 한도소진률) 내림차순입니다. 한도소진률 = 외국인 보유 / 외국인 한도.`,
    "※ 이 축은 **외국인 보유(한도) 계열**입니다 — 투자자 매매 기준인 get_investor_trend·" +
      "get_net_buy_rank와는 데이터 소스가 다르므로 같은 표에서 비교하지 마세요.",
    "※ 거래량이 '상한 초과'인 종목은 키움이 32비트 상한(4,294,967,295)으로 잘라 보낸 값입니다.",
    UNIFIED_EXCHANGE_NOTE,
  );
  return lines.join("\n");
}

/** 외국인 기간별 순매매 상위 (ka10034). */
export function formatForeignPeriodTrade(
  rows: ForeignPeriodTradeItem[],
  market: RankingMarket,
  days: ForeignPeriodDays,
  direction: "net_sell" | "net_buy",
  top: number,
  modeLabel: string,
): string {
  const dirLabel = direction === "net_sell" ? "순매도" : "순매수";
  const title = `외국인 기간별 ${dirLabel} 상위 — ${MARKET_LABELS[market]} (최근 ${days}일 누적)`;
  if (rows.length === 0) {
    return `[${modeLabel}] ${title}: 해당 종목이 없습니다.`;
  }

  const shown = rows.slice(0, top);
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (${shown.length}종목)`,
    "",
    `| 순위 | 종목명 | 코드 | 현재가 | 거래량 | 기간 ${dirLabel}량 | 취득가능주식수 |`,
    "|---:|---|---|---:|---:|---:|---:|",
  ];
  shown.forEach((r, i) => {
    lines.push(
      row([
        r.rank || String(i + 1),
        r.stk_nm,
        r.stk_cd,
        formatKRW(parseKiwoomPrice(r.cur_prc)),
        quantityOrCap(r.trde_qty),
        `${formatSigned(n(r.netprps_qty), 0)}주`,
        formatQuantity(n(r.gain_pos_stkcnt)),
      ]),
    );
  });
  lines.push(
    "",
    `※ 최근 ${days}거래일 누적 순매매 수량 순입니다. 순매도 조회에서는 값이 음수로 나옵니다.`,
    "※ 이 축은 **외국인 보유(한도) 계열**로 get_foreign_holding의 종목 조회(순변동수량)와 같은 " +
      "소스입니다 — 투자자 매매 기준인 get_net_buy_rank·get_investor_trend와는 부호까지 다를 수 있습니다.",
    UNIFIED_EXCHANGE_NOTE,
  );
  return lines.join("\n");
}

export function formatForeignHolding(
  rows: ForeignHoldingItem[],
  stockCode: string,
  modeLabel: string,
  limit: number,
): string {
  if (rows.length === 0) {
    return `[${modeLabel}] 외국인 보유 추이가 없습니다 (종목 ${stockCode}).`;
  }

  const shown = rows.slice(0, limit);
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 외국인 보유 추이 — 종목 ${stockCode} (최근 ${shown.length}일)`,
    "",
    "| 일자 | 종가 | 거래량 | 외국인순변동 | 보유주식수 | 보유비중 | 한도소진률 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    const cells = [
      formatDateDashed(r.dt),
      formatKRW(parseKiwoomPrice(r.close_pric)),
      formatQuantity(n(r.trde_qty)),
      `${formatSigned(n(r.chg_qty), 0)}주`,
      formatQuantity(n(r.poss_stkcnt)),
      formatRatioPercent(n(r.wght)),
      formatRatioPercent(n(r.limit_exh_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (rows.length > shown.length) {
    lines.push("", `※ 최근 ${shown.length}일만 표시했습니다 (limit으로 최대 50일까지 조정 가능).`);
  }
  lines.push(
    "",
    "※ 보유비중 = 외국인 보유주식수 / 상장주식수. 한도소진률 = 보유 / 외국인 한도. 종가 부호는 전일 대비 방향.",
    UNIFIED_EXCHANGE_NOTE,
  );
  return lines.join("\n");
}

/**
 * 외국인 3일 연속 순매매 상위 (ka10035).
 *
 * `dm1`~`dm3`은 일별 순매매고 `tot`이 합계다. 전 100행에서 세 값의 부호가 같은 것이
 * "연속"의 정의라, 표는 세 날을 그대로 펼쳐 사용자가 흐름을 볼 수 있게 한다.
 *
 * **정렬은 `tot`의 절대값 내림차순이다** — 부호 기준이 아니다(REAL 실측 2026-08-09,
 * `plans/tools/probe_ka10035_order.py`). 순매도(`trde_tp=1`)는 100행이 전부 음수라
 * 부호로는 **오름차순**이고(−5,926,663 → −146,097), 순매수는 부호 내림차순이다. 두 방향
 * 모두 위쪽이 가장 크게 매매한 종목이라 `top` 슬라이스는 맞지만, "합계 내림차순"이라고
 * 적으면 순매도에서 틀린 말이 된다.
 */
export function formatForeignStreakTrade(
  rows: ForeignStreakTradeItem[],
  market: RankingMarket,
  direction: "net_sell" | "net_buy",
  top: number,
  modeLabel: string,
  requestedDays?: string,
): string {
  const marketLabel = MARKET_LABELS[market];
  const dirLabel = direction === "net_buy" ? "순매수" : "순매도";
  if (rows.length === 0) {
    return (
      `[${modeLabel}] ${marketLabel} 외국인 3일 연속 ${dirLabel} 종목이 없습니다.\n` +
      "※ 3일 연속 같은 방향이라는 조건이 엄격합니다 — 휴장일이 끼면 빈 결과가 나올 수 있습니다."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, top);
  const lines = [
    `[${modeLabel}] ${marketLabel} 외국인 3일 연속 ${dirLabel} 상위 (${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 3일전 | 2일전 | 1일전 | 3일 합계 | 한도소진율 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((r, i) => {
    lines.push(
      row([
        String(i + 1),
        r.stk_nm || "-",
        r.stk_cd,
        formatKRW(parseKiwoomPrice(r.cur_prc)),
        formatSigned(n(r.dm3), 0),
        formatSigned(n(r.dm2), 0),
        formatSigned(n(r.dm1), 0),
        formatSigned(n(r.tot), 0),
        formatRatioPercent(n(r.limit_exh_rt)),
      ]),
    );
  });

  if (requestedDays && requestedDays !== STREAK_DAYS) {
    lines.push(
      "",
      `⚠️ 요청한 ${requestedDays}일은 이 순위에 적용되지 않습니다 — ` +
        `streak는 키움이 **${STREAK_DAYS}일 연속**으로 고정한 축이라 기간을 받지 않습니다. ` +
        "기간을 바꾸려면 rank=period_net을 쓰세요.",
    );
  }
  lines.push(
    "",
    `※ 3일 합계의 **크기(절대값)** 내림차순입니다 — ${dirLabel}는 합계가 ` +
      `${direction === "net_sell" ? "음수라 −가 큰" : "양수라 +가 큰"} 종목이 위입니다. ` +
      `**세 날 모두 같은 방향(${dirLabel})**인 종목만 나옵니다 — ` +
      "그게 이 TR이 말하는 '연속'입니다. 수량 단위는 주입니다.",
    "※ 한도소진율 = 외국인 보유 / 외국인 한도. 이 tool은 외국인 **보유·한도** 계열이라 " +
      "투자자 매매 기준인 get_net_buy_rank·get_investor_trend와 부호가 반대일 수 있습니다.",
    UNIFIED_EXCHANGE_NOTE,
  );
  return lines.join("\n");
}

export function registerForeignHoldingTool(server: McpServer): void {
  server.registerTool(
    "get_foreign_holding",
    {
      title: "외국인 보유 추이 조회",
      description:
        "외국인 보유(한도) 동향을 조회합니다 (키움 ka10008/ka10036/ka10034/ka10035). " +
        "stock_code를 주면 **그 종목의 일자별 추이** — 종가·거래량·외국인 순변동수량·보유주식수·보유비중·한도소진률. " +
        "stock_code 없이 rank를 주면 **시장 전체 순위**입니다: " +
        "limit_surge(한도소진율이 가장 많이 오른 종목)/period_net(기간 누적 순매매 상위)/" +
        "streak(3일 **연속** 같은 방향으로 순매매한 종목 — 누적 크기가 아니라 방향의 지속성을 볼 때). " +
        "이 tool은 전부 외국인 **보유·한도** 계열이라, 투자자 매매 기준인 get_net_buy_rank·" +
        "get_investor_trend·get_foreign_intraday와는 데이터 소스가 다릅니다(같은 종목에서 부호가 반대일 수 있음).",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .optional()
          .describe("조회할 6자리 종목코드 — 주면 종목 추이 모드"),
        rank: z
          .enum(["limit_surge", "period_net", "streak"])
          .optional()
          .describe(
            "시장 전체 순위 종류 — limit_surge(한도소진율 증가 상위)/period_net(기간 누적 순매매 상위)/" +
              "streak(3일 연속 같은 방향 순매매). stock_code를 생략할 때 씁니다",
          ),
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 구분 — rank 모드에서만 사용 (기본값 all)"),
        days: z
          .enum(FOREIGN_PERIOD_DAYS)
          .optional()
          .describe(
            `기준 기간(거래일) — limit_surge는 ${FOREIGN_LIMIT_SURGE_DAYS.join("/")} (기본 ${DEFAULT_SURGE_DAYS}), ` +
              `period_net은 ${FOREIGN_PERIOD_DAYS.join("/")} (기본 ${DEFAULT_PERIOD_DAYS}). ` +
              `streak는 ${STREAK_DAYS}일 고정이라 이 값을 받지 않습니다`,
          ),
        direction: z
          .enum(["net_sell", "net_buy"])
          .optional()
          .describe("period_net·streak 방향 — net_sell(순매도, 기본)/net_buy(순매수)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("종목 추이 모드에서 표시할 일수 (기본 15, 최대 50; 최신순)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`rank 모드에서 표시할 종목 수 (기본 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ stock_code, rank, market, days, direction, limit, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();

        if (stock_code && rank) {
          throw new Error(
            "stock_code와 rank는 함께 쓸 수 없습니다 — 종목 추이는 stock_code만, 시장 전체 순위는 rank만 지정하세요.",
          );
        }
        if (!stock_code && !rank) {
          throw new Error(
            "stock_code(종목 추이) 또는 rank(시장 전체 순위) 중 하나를 지정하세요.",
          );
        }

        if (stock_code) {
          const code = stock_code.toUpperCase();
          const rows = await fetchForeignHolding(client, code);
          return textResult(
            formatForeignHolding(rows, code, config.modeLabel, limit ?? DEFAULT_DISPLAY_DAYS),
          );
        }

        const m: RankingMarket = market ?? "all";
        const count = top ?? DEFAULT_TOP;

        if (rank === "limit_surge") {
          // ka10036은 1/5/10/20만 받는다 — period_net의 3/60/120을 그대로 넘기면 빈 결과가 된다.
          const d = (days ?? DEFAULT_SURGE_DAYS) as string;
          const surgeDays = (FOREIGN_LIMIT_SURGE_DAYS as readonly string[]).includes(d)
            ? (d as ForeignLimitSurgeDays)
            : DEFAULT_SURGE_DAYS;
          const rows = await fetchForeignLimitSurge(client, m, surgeDays);
          return textResult(
            formatForeignLimitSurge(rows, m, surgeDays, count, config.modeLabel, d),
          );
        }

        const dir = direction ?? "net_sell";

        if (rank === "streak") {
          // ka10035는 3일 고정이라 days를 받지 않는다 — 받은 days는 **조용히 버리지 않고**
          // 포맷터가 ⚠️로 밝힌다(limit_surge의 기간 대체 경고와 같은 처방).
          const rows = await fetchForeignStreakTrade(client, m, dir);
          return textResult(
            formatForeignStreakTrade(rows, m, dir, count, config.modeLabel, days),
          );
        }

        const periodDays = (days ?? DEFAULT_PERIOD_DAYS) as ForeignPeriodDays;
        const rows = await fetchForeignPeriodTrade(client, m, periodDays, dir);
        return textResult(
          formatForeignPeriodTrade(rows, m, periodDays, dir, count, config.modeLabel),
        );
      }),
  );
}
