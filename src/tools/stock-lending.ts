import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchLendingBalanceRank, fetchLendingTrend } from "../kiwoom/api.js";
import type { LendingBalanceRankItem, LendingTrendItem } from "../kiwoom/types.js";
import { assertDateRange, formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import { formatNumber, formatSigned, parseKiwoomNumber } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_LOOKBACK_DAYS = 30;

export interface LendingQuery {
  stockCode?: string;
  fromDate: string;
  toDate: string;
}

export function formatLendingTrend(rows: LendingTrendItem[], query: LendingQuery, modeLabel: string): string {
  const scope = query.stockCode ? `종목 ${query.stockCode}` : "시장 전체";
  const period = `${formatDateDashed(query.fromDate)} ~ ${formatDateDashed(query.toDate)}`;
  if (rows.length === 0) {
    return `[${modeLabel}] 대차거래 추이가 없습니다 (${scope}, ${period}).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 대차거래 추이 — ${scope} (${period}, ${rows.length}일)`,
    "",
    "| 일자 | 체결(주) | 상환(주) | 증감(주) | 잔고(주) | 잔고금액(백만원) |",
    "|---|---:|---:|---:|---:|---:|",
  ];

  for (const r of rows) {
    const cells = [
      formatDateDashed(r.dt),
      formatNumber(n(r.dbrt_trde_cntrcnt)),
      formatNumber(n(r.dbrt_trde_rpy)),
      formatSigned(n(r.dbrt_trde_irds), 0),
      formatNumber(n(r.rmnd)),
      formatNumber(n(r.remn_amt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("", "※ 증감 = 체결 − 상환. 당일 행은 집계 확정 전이라 0으로 표시될 수 있습니다.");
  return lines.join("\n");
}

const DEFAULT_RANK_TOP = 20;
const MAX_RANK_TOP = 50;

export function formatLendingBalanceRank(
  rows: LendingBalanceRankItem[],
  baseDate: string,
  top: number,
  truncated: boolean,
  modeLabel: string,
  /** 받고도 쓰지 않은 입력과 기준일 후퇴 — 조용히 버리지 않고 각주로 밝힌다 */
  ignored: { stockCode?: string; fromDate?: string; fellBackFrom?: string } = {},
): string {
  const title = `대차잔고 상위 종목 — ${formatDateDashed(baseDate)}`;
  const shown = rows.slice(0, top);
  const ignoredNotes: string[] = [];
  if (ignored.fellBackFrom) {
    ignoredNotes.push(
      `※ 요청일(${formatDateDashed(ignored.fellBackFrom)})은 아직 집계 전이라 ` +
        `전 거래일(${formatDateDashed(baseDate)}) 기준으로 보여 드립니다.`,
    );
  }
  if (ignored.stockCode) {
    ignoredNotes.push(
      `※ 요청하신 종목코드(${ignored.stockCode})는 적용되지 않았습니다 — 이 순위는 시장 전체 횡단면이라 ` +
        "종목을 고를 수 없습니다. 한 종목의 대차 추이는 view=trend를 쓰세요.",
    );
  }
  if (ignored.fromDate) {
    ignoredNotes.push(
      `※ 요청하신 조회 시작일(${formatDateDashed(ignored.fromDate)})은 적용되지 않았습니다 — ` +
        "이 순위는 하루의 횡단면이라 to_date만 기준일로 씁니다.",
    );
  }
  if (shown.length === 0) {
    // 종목을 지정해 부른 사용자에게 "휴장일일 수 있다"만 주면 종목이 무시된 걸 끝내 모른다.
    // 원인도 휴장일부터 대지 않는다 — 당일 미집계가 훨씬 흔하다(2026-08-14 거래일 실측 0행).
    return [
      `[${modeLabel}] ${title}: 데이터가 없습니다. ` +
        "이 순위는 당일 집계를 장중에 주지 않아 전 거래일까지만 조회됩니다 — " +
        "to_date로 전 거래일을 지정해 보세요 (기준일이 휴장일이어도 비어 있습니다).",
      ...ignoredNotes,
    ].join("\n");
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (상위 ${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 대차잔고(주) | 잔고금액(백만원) | 체결(주) | 상환(주) |",
    "|---:|---|---|---:|---:|---:|---:|",
  ];
  shown.forEach((r, i) => {
    const cells = [
      String(i + 1),
      r.stk_nm,
      r.stk_cd,
      formatNumber(n(r.rmnd)),
      formatNumber(n(r.remn_amt)),
      formatNumber(n(r.dbrt_trde_cntrcnt)),
      formatNumber(n(r.dbrt_trde_rpy)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  const notes = [
    "※ 대차잔고(주) 내림차순입니다 — 잔고금액이나 체결 주수 순이 아닙니다.",
    "※ 잔고는 빌려 간 뒤 아직 갚지 않은 물량입니다. 공매도 대기 물량으로 읽히지만 " +
      "차익거래·헤지 목적도 섞여 있어 그대로 공매도로 보면 안 됩니다.",
    "※ 시장 구분이 없는 TR이라 시장 전체 기준입니다.",
  ];
  // cont-yn=Y라 더 받을 수는 있다(50행/페이지) — 안 받는 것이지 못 받는 게 아니므로
  // "조회되지 않습니다"로 적으면 거짓말이 된다. top 상한이 50이라 더 받아도 쓸 자리가 없다.
  // 조건도 truncated 하나여야 한다 — rows.length > shown.length는 사용자가 고른 top이라
  // 기본값(top 20 · 50행 응답)만으로 매 호출마다 이 각주가 떴다.
  if (truncated) {
    notes.push("※ 이 tool은 첫 50종목만 받아 옵니다 — 51위 아래는 조회하지 않습니다.");
  }
  return [...lines, "", ...notes, ...ignoredNotes].join("\n");
}

export function registerStockLendingTool(server: McpServer): void {
  server.registerTool(
    "get_stock_lending",
    {
      title: "대차거래 추이 조회",
      description:
        "대차거래(주식 대여) 정보를 조회합니다 (키움 ka10068/ka20068/ka90012). " +
        "view=trend(기본)은 일자별 추이 — 체결·상환·증감 주수와 대차잔고, 잔고금액을 시계열로 보여줍니다. " +
        "stock_code를 지정하면 해당 종목, 생략하면 시장 전체 집계이고 기본 기간은 최근 30일입니다. " +
        "view=balance_rank는 특정 하루의 **대차잔고가 가장 많은 종목 순위**입니다 — " +
        "'어느 종목에 대차 물량이 쌓여 있나'를 물을 때 쓰고, 한 종목의 시간 흐름은 trend를 쓰세요. " +
        "balance_rank는 시장 전체 횡단면이라 stock_code·from_date를 받지 않으며(주면 무시하고 각주로 알립니다), " +
        "기준일은 to_date로 지정합니다. " +
        "공매도 흐름과 함께 보려면 get_short_selling을 참고하세요.",
      inputSchema: {
        view: z
          .enum(["trend", "balance_rank"])
          .optional()
          .describe("조회 종류 (기본값: trend)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_RANK_TOP)
          .optional()
          .describe(`view=balance_rank의 표시 종목 수 (기본값 ${DEFAULT_RANK_TOP}, 최대 ${MAX_RANK_TOP})`),
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .optional()
          .describe("6자리 종목코드 (생략 시 시장 전체 대차 추이). view=balance_rank에서는 무시됩니다"),
        from_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 시작일 (기본값: 30일 전). view=balance_rank에서는 무시됩니다"),
        to_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 종료일 (기본값: 오늘). view=balance_rank에서는 순위의 기준일입니다"),
      },
    },
    async ({ view, top, stock_code, from_date, to_date }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();

        if (view === "balance_rank") {
          // 이 TR은 하루의 횡단면이라 from_date는 의미가 없다 — to_date를 기준일로 쓴다.
          const requested = to_date?.replaceAll("-", "");
          const asked = requested ?? todayInKst().replaceAll("-", "");
          // 날짜를 고르지 않은 호출만 전날로 물러선다 — 사용자가 지정한 날짜를 바꾸면 안 된다
          const { items, truncated, baseDate } = await fetchLendingBalanceRank(client, asked, !requested);
          return textResult(
            formatLendingBalanceRank(items, baseDate, top ?? DEFAULT_RANK_TOP, truncated, config.modeLabel, {
              stockCode: stock_code?.toUpperCase(),
              fromDate: from_date?.replaceAll("-", ""),
              fellBackFrom: baseDate === asked ? undefined : asked,
            }),
          );
        }

        const query: LendingQuery = {
          stockCode: stock_code?.toUpperCase(),
          fromDate: (from_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS)).replaceAll("-", ""),
          toDate: (to_date ?? todayInKst()).replaceAll("-", ""),
        };
        assertDateRange(query.fromDate, query.toDate);
        const rows = await fetchLendingTrend(client, query.stockCode, query.fromDate, query.toDate);
        return textResult(formatLendingTrend(rows, query, config.modeLabel));
      }),
  );
}
