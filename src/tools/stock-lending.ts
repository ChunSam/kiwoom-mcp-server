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
  /**
   * 받고도 쓰지 않은 입력과 기준일 후퇴 — 조용히 버리지 않고 각주로 밝힌다.
   * `pinnedToday`는 사용자가 to_date로 **오늘**을 직접 지정했는지다 — 그러면 후퇴가 꺼져 있어
   * 빈 결과의 원인이 "아직 저녁이 아니다"로 좁혀진다(과거 날짜를 박은 경우와 안내가 갈린다).
   */
  ignored: { stockCode?: string; fromDate?: string; fellBackFrom?: string; pinnedToday?: boolean } = {},
): string {
  const title = `대차잔고 상위 종목 — ${formatDateDashed(baseDate)}`;
  const shown = rows.slice(0, top);
  const ignoredNotes: string[] = [];
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
    //
    // **다만 그 원인은 부른 방식에 따라 셋으로 갈리고, 안내도 같이 갈려야 한다.**
    //  ① 기본 호출인데 후퇴 예산(5칸)을 다 썼다 → 원인은 당일 미집계가 아니라 긴 연휴다.
    //     이때 "전 거래일 기준으로 보여 드립니다"는 **거짓**이므로(보여 준 게 없다) 훑은 범위를 밝힌다 —
    //     안 그러면 마지막 시도일 하루만 비어 보인다.
    //  ② 사용자가 to_date로 **오늘**을 박았다 → 후퇴가 꺼져 있을 뿐이라, 저녁이면 열린다.
    //  ③ 사용자가 **과거 날짜**를 박았다 → 저녁까지 기다려도 그날은 열리지 않는다(휴장일이거나 없는 날).
    // 셋에 같은 문구를 주면 ③에게 "저녁에 다시 부르세요"라는 틀린 안내가 나간다 — 기다릴 것이 없다.
    const lead = ignored.fellBackFrom
      ? `데이터가 없습니다. 오늘이 거래일이면 당일 집계가 저녁 늦게(20시 무렵) 열리니 그때 다시 불러 보세요.`
      : ignored.pinnedToday
        ? "데이터가 없습니다. 이 순위는 당일 집계가 장 마감 후 저녁 늦게(20시 무렵) 열립니다 — " +
          "그때까지는 전 거래일까지만 조회되니 저녁에 다시 부르거나 to_date로 전 거래일을 지정하세요 " +
          "(기준일이 휴장일이어도 비어 있습니다)."
        : "데이터가 없습니다. 요청하신 기준일에는 집계가 없습니다 — 휴장일이거나 아직 집계되지 않은 날입니다. " +
          "to_date로 직전 거래일을 지정해 보세요.";
    const swept = ignored.fellBackFrom
      ? [
          `※ 요청일(${formatDateDashed(ignored.fellBackFrom)})부터 ${formatDateDashed(baseDate)}까지 ` +
            "하루씩 물러서며 찾았지만 행이 없습니다 — 연휴가 더 길면 to_date로 직전 거래일을 직접 지정하세요.",
        ]
      : [];
    return [`[${modeLabel}] ${title}: ${lead}`, ...swept, ...ignoredNotes].join("\n");
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
  const fellBack = ignored.fellBackFrom
    ? [
        `※ 요청일(${formatDateDashed(ignored.fellBackFrom)})은 아직 집계 전이라 ` +
          `전 거래일(${formatDateDashed(baseDate)}) 기준으로 보여 드립니다 — ` +
          "당일 집계는 장 마감 후 저녁 늦게(20시 무렵) 열립니다.",
      ]
    : [];
  return [...lines, "", ...notes, ...fellBack, ...ignoredNotes].join("\n");
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
        "기준일은 to_date로 지정하되 **생략하는 쪽이 안전합니다** — 당일 집계는 장 마감 후 저녁 늦게(20시 무렵) " +
        "열려서, 오늘을 직접 지정하면 그전까지 빈 결과이고 생략하면 최신 집계일로 자동으로 물러섭니다. " +
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
          .describe(
            "조회 종료일 (기본값: 오늘). view=balance_rank에서는 순위의 기준일이며, " +
              "오늘을 지정하면 저녁 집계 전까지 빈 결과입니다 — 생략하면 최신 집계일로 자동으로 물러섭니다",
          ),
      },
    },
    async ({ view, top, stock_code, from_date, to_date }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();

        if (view === "balance_rank") {
          // 이 TR은 하루의 횡단면이라 from_date는 의미가 없다 — to_date를 기준일로 쓴다.
          const requested = to_date?.replaceAll("-", "");
          const today = todayInKst().replaceAll("-", "");
          const asked = requested ?? today;
          // 날짜를 고르지 않은 호출만 전날로 물러선다 — 사용자가 지정한 날짜를 바꾸면 안 된다
          const { items, truncated, baseDate } = await fetchLendingBalanceRank(client, asked, !requested);
          return textResult(
            formatLendingBalanceRank(items, baseDate, top ?? DEFAULT_RANK_TOP, truncated, config.modeLabel, {
              stockCode: stock_code?.toUpperCase(),
              fromDate: from_date?.replaceAll("-", ""),
              fellBackFrom: baseDate === asked ? undefined : asked,
              // 오늘을 직접 박은 호출은 후퇴가 꺼진 채 장중 내내 빈손이다 — 빈 결과 안내가
              // "저녁에 다시"로 갈리는 자리라, 과거 날짜를 박은 호출과 구분해서 넘긴다.
              pinnedToday: requested === today,
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
