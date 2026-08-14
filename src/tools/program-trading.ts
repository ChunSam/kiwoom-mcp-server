import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchProgramArbitrageBalance,
  fetchProgramStockRank,
  fetchProgramTrades,
  fetchProgramTrend,
  fetchStockProgramIntraday,
  fetchStockProgramTrend,
  type InvestorUnit,
  type ProgramMarket,
  type ProgramTrendGranularity,
} from "../kiwoom/api.js";
import type {
  ProgramArbitrageBalanceItem,
  ProgramStockRankItem,
  ProgramTradeItem,
  ProgramTrendItem,
  StockProgramIntradayItem,
  StockProgramTrendItem,
} from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import {
  formatNumber,
  formatPercent,
  formatRatioPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

/**
 * view=date_rank만 상위 20으로 막는다. 서버가 정렬해 주지 않는 전량 스냅샷이라
 * 순위의 모수가 곧 받아 온 페이지 수인데, 상위 50까지 열면 코스닥에서 798행(27페이지)까지
 * 흩어져 `MAX_PAGES`(20 → 코스닥 600행) 예산을 넘긴다 (2026-08-10 실측). 상위 20은
 * 코스피 272행 · 코스닥 242행이라 여유가 3.7배 · 2.5배다.
 */
const MAX_TOP_DATE_RANK = 20;

export type ProgramDirection = "net_buy" | "net_sell";
export type ProgramView =
  | "top"
  | "date_rank"
  | "market_daily"
  | "market_intraday"
  | "stock_daily"
  | "stock_intraday"
  | "arbitrage_balance";

const DIRECTION_LABELS: Record<ProgramDirection, string> = {
  net_buy: "프로그램 순매수 상위",
  net_sell: "프로그램 순매도 상위",
};

const MARKET_LABELS: Record<ProgramMarket, string> = {
  kospi: "코스피",
  kosdaq: "코스닥",
};

const UNIT_LABELS: Record<InvestorUnit, string> = {
  amount: "백만원",
  quantity: "주",
};

const TREND_LABELS: Record<ProgramTrendGranularity, string> = {
  daily: "일자별 추이",
  intraday: "시간대별 추이",
};

export function formatProgramTrades(
  items: ProgramTradeItem[],
  direction: ProgramDirection,
  unit: InvestorUnit,
  market: ProgramMarket,
  top: number,
  modeLabel: string,
): string {
  const title = `${MARKET_LABELS[market]} ${DIRECTION_LABELS[direction]}`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title} 데이터가 없습니다 (장 시작 전이거나 당일 집계 전일 수 있습니다).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (상위 ${shown.length}종목, 단위: ${UNIT_LABELS[unit]})`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 프로그램 매수 | 프로그램 매도 | 순매수 |",
    "|---:|---|---|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((item, i) => {
    const cells = [
      String(i + 1),
      item.stk_nm,
      item.stk_cd,
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatPercent(n(item.flu_rt)),
      formatNumber(n(item.prm_buy_amt)),
      formatNumber(n(item.prm_sell_amt)),
      formatSigned(n(item.prm_netprps_amt), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

/** ka90005의 지수 필드는 ×100 정수로 온다 ("+108970" = 1089.70) — ka90010은 소수 그대로. */
function formatTrendIndex(raw: string, granularity: ProgramTrendGranularity): string {
  const value = parseKiwoomNumber(raw);
  if (value === null) return "-";
  return formatNumber(granularity === "intraday" ? value / 100 : value, 2);
}

function trendTimeLabel(cntrTm: string, granularity: ProgramTrendGranularity): string {
  // daily = yyyyMMdd000000, intraday = HHmmss (분 모드라 초는 00).
  if (granularity === "daily") return formatDateDashed(cntrTm.slice(0, 8));
  return `${cntrTm.slice(0, 2)}:${cntrTm.slice(2, 4)}`;
}

export function formatProgramTrend(
  items: ProgramTrendItem[],
  granularity: ProgramTrendGranularity,
  market: ProgramMarket,
  baseDate: string,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const title = `${MARKET_LABELS[market]} 프로그램 매매 ${TREND_LABELS[granularity]} — 기준일 ${formatDateDashed(baseDate)}`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}: 데이터가 없습니다 (장 시작 전이거나 휴장일일 수 있습니다).`;
  }

  const n = parseKiwoomNumber;
  const timeHeader = granularity === "daily" ? "일자" : "시각";
  const lines = [
    `[${modeLabel}] ${title} (최근 ${shown.length}행, 단위: 백만원)`,
    "",
    `| ${timeHeader} | 전체 매수 | 전체 매도 | 전체 순매수 | 차익 순매수 | 비차익 순매수 | 지수 | BASIS |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((item) => {
    const cells = [
      trendTimeLabel(item.cntr_tm, granularity),
      formatNumber(n(item.all_buy)),
      formatNumber(n(item.all_sel)),
      formatSigned(n(item.all_netprps), 0),
      formatSigned(n(item.dfrt_trde_netprps), 0),
      formatSigned(n(item.ndiffpro_trde_netprps), 0),
      formatTrendIndex(item.kospi200, granularity),
      formatNumber(n(item.basis), 2),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  const notes: string[] = [];
  if (granularity === "intraday") {
    notes.push("※ 각 행은 해당 시각까지의 당일 누적값입니다.");
  }
  if (truncated || items.length > shown.length) {
    notes.push("※ 표시된 범위 이전의 데이터는 생략됐습니다.");
  }
  notes.push("※ 지수: 코스피=KOSPI200, 코스닥=코스닥 시장 지수. 차익+비차익과 전체는 반올림으로 ±1 차이가 날 수 있습니다.");
  notes.push(UNIFIED_EXCHANGE_NOTE);
  return [...lines, "", ...notes].join("\n");
}

export function formatStockProgramTrend(
  items: StockProgramTrendItem[],
  stockCode: string,
  baseDate: string | undefined,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const dateLabel = baseDate ? `기준일 ${formatDateDashed(baseDate)}` : "최근일 기준";
  const title = `종목 일별 프로그램 매매 추이 — ${stockCode} (${dateLabel})`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}: 데이터가 없습니다 (종목코드 또는 기준일을 확인해 주세요).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (최근 ${shown.length}일, 금액 단위: 백만원)`,
    "",
    "| 일자 | 종가 | 등락률 | 프로그램 매수 | 프로그램 매도 | 순매수 | 순매수 증감 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((item) => {
    const cells = [
      formatDateDashed(item.dt),
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatPercent(n(item.flu_rt)),
      formatNumber(n(item.prm_buy_amt)),
      formatNumber(n(item.prm_sell_amt)),
      formatSigned(n(item.prm_netprps_amt), 0),
      formatSigned(n(item.prm_netprps_amt_irds), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });
  if (truncated || items.length > shown.length) {
    lines.push("", "※ 표시된 범위 이전의 데이터는 생략됐습니다.");
  }
  return lines.join("\n");
}

/** ka90008의 `tm`은 HHmmss — 초까지 갈리는 행이 실재하므로(153019/153020) 초를 버리지 않는다. */
function intradayTimeLabel(tm: string): string {
  if (tm.length < 6) return tm || "-";
  return `${tm.slice(0, 2)}:${tm.slice(2, 4)}:${tm.slice(4, 6)}`;
}

export function formatStockProgramIntraday(
  items: StockProgramIntradayItem[],
  stockCode: string,
  requestedDate: string | undefined,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const title = `종목 시간대별 프로그램 매매 추이 — ${stockCode} (최근 거래일)`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    // 기준일을 확인하라고 하면 안 된다 — 이 TR은 date를 받고도 무시하므로(2026-08-09 실측)
    // 날짜를 바꿔 재시도해도 결과가 달라질 수 없다.
    return (
      `[${modeLabel}] ${title}: 데이터가 없습니다 (종목코드를 확인해 주세요). ` +
      "이 조회는 기준일을 고를 수 없어 최근 거래일만 봅니다 — 날짜별 추이는 view=stock_daily를 쓰세요."
    );
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (최근 ${shown.length}행, 금액 단위: 백만원)`,
    "",
    "| 시각 | 현재가 | 등락률 | 프로그램 매수 | 프로그램 매도 | 순매수 | 순매수 증감 | 순매수량(주) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((item) => {
    const cells = [
      intradayTimeLabel(item.tm),
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatPercent(n(item.flu_rt)),
      formatNumber(n(item.prm_buy_amt)),
      formatNumber(n(item.prm_sell_amt)),
      formatSigned(n(item.prm_netprps_amt), 0),
      formatSigned(n(item.prm_netprps_amt_irds), 0),
      formatSigned(n(item.prm_netprps_qty), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  const notes = [
    "※ 각 행은 해당 시각까지의 당일 누적값입니다 — 순매수 증감이 그 시각의 순수 변화분입니다.",
  ];
  if (requestedDate) {
    // 조용히 버리지 않는다 — ka90008은 date를 필수로 받고도 무시한다(2026-08-09 실측).
    notes.push(
      `※ 요청하신 기준일(${formatDateDashed(requestedDate)})은 적용되지 않았습니다 — ` +
        "이 TR은 날짜를 고를 수 없고 최근 거래일만 제공합니다. 날짜별 추이는 view=stock_daily를 쓰세요.",
    );
  }
  if (truncated || items.length > shown.length) {
    // 200행/페이지가 최신 구간만 덮는다(통합은 시간외까지 와서 23분, 2026-08-09 실측).
    notes.push("※ 최신 구간만 조회했습니다 — 이 표보다 이른 시각은 포함되지 않았습니다.");
  }
  notes.push(UNIFIED_EXCHANGE_NOTE);
  return [...lines, "", ...notes].join("\n");
}

export function formatProgramArbitrageBalance(
  items: ProgramArbitrageBalanceItem[],
  baseDate: string,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const title = `프로그램 차익거래 잔고 추이 — 기준일 ${formatDateDashed(baseDate)}`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}: 데이터가 없습니다 (기준일이 휴장일일 수 있습니다).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (최근 ${shown.length}일)`,
    "",
    "| 일자 | 매수잔고(천주) | 매수잔고(백만원) | 전일대비 | 매도잔고(천주) | 매도잔고(백만원) | 전일대비 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((item) => {
    const cells = [
      formatDateDashed(item.dt),
      formatNumber(n(item.buy_dfrt_trde_qty)),
      formatNumber(n(item.buy_dfrt_trde_amt)),
      formatSigned(n(item.buy_dfrt_trde_irds_amt), 0),
      formatNumber(n(item.sel_dfrt_trde_qty)),
      formatNumber(n(item.sel_dfrt_trde_amt)),
      formatSigned(n(item.sel_dfrt_trde_irds_amt), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  const notes = [
    "※ 매매가 아니라 **잔고**입니다 — 차익거래로 보유 중인 미청산 물량이고, 전일대비는 그 증감입니다.",
    "※ 수량은 천주, 금액은 백만원 단위입니다 (한 행 안에서 단위가 갈립니다).",
    "※ 시장 구분이 없는 TR이라 시장 전체 기준입니다 — market 인자는 이 view에 적용되지 않습니다.",
  ];
  if (truncated || items.length > shown.length) {
    notes.push("※ 표시된 범위 이전의 데이터는 생략됐습니다.");
  }
  return [...lines, "", ...notes].join("\n");
}

/**
 * ka90004는 이름과 달리 순위가 아니라 전량 스냅샷이라(코스피 2,472행) **정렬을 여기서 한다.**
 * 그래서 잘림 문구도 "뒤가 잘렸다"가 아니라 **"일부 종목이 빠졌다"**로 쓴다 — 정렬 모수에서
 * 종목이 빠지는 것이지 표의 꼬리가 잘리는 게 아니다(ka10024·ka10028과 같은 처방).
 */
export function formatProgramStockRank(
  items: ProgramStockRankItem[],
  direction: ProgramDirection,
  market: ProgramMarket,
  baseDate: string,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const n = parseKiwoomNumber;
  const scope = `${MARKET_LABELS[market]} ${DIRECTION_LABELS[direction]}`;
  const dateLabel = formatDateDashed(baseDate);

  // 프로그램 매매가 아예 없는 종목이 모수의 3분의 2다(코스피 2,472행 중 1,685행) —
  // 순매수 0인 행이 순위에 섞이면 표가 0으로 채워지므로 먼저 걷어낸다.
  const traded = items.filter((item) => n(item.netprps_prica) !== 0);
  // 방향으로도 갈라야 한다 — ka90003(view=top)은 서버가 한 방향만 주지만 이쪽은 양방향이
  // 한 응답에 섞여 오므로, 걸러내지 않으면 "순매도 상위"에 순매수 종목이 딸려 온다.
  const sign = direction === "net_sell" ? -1 : 1;
  const sided = traded.filter((item) => Math.sign(n(item.netprps_prica) ?? 0) === sign);
  const sorted = [...sided].sort(
    (a, b) => ((n(b.netprps_prica) ?? 0) - (n(a.netprps_prica) ?? 0)) * sign,
  );
  // 상한 적용은 핸들러가 아니라 여기서 한다 — 잘랐다는 사실을 각주로 알리려면
  // 포맷터가 "요청받은 수"와 "보여 준 수"를 둘 다 알아야 한다.
  const shown = sorted.slice(0, Math.min(top, MAX_TOP_DATE_RANK));

  if (shown.length === 0) {
    return (
      `[${modeLabel}] ${dateLabel} ${scope} 종목이 없습니다. ` +
      `휴장일이거나 아직 집계 전일 수 있습니다 (프로그램 매매가 있는 종목 ${traded.length}개).`
    );
  }

  const lines = [
    `[${modeLabel}] ${dateLabel} ${scope} (${shown.length}종목)`,
    "",
    "| 종목명 | 코드 | 현재가 | 순매수 | 매수 | 매도 | 매수량 | 매도량 | 거래비중 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const item of shown) {
    const cells = [
      item.stk_nm,
      item.stk_cd,
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatSigned(n(item.netprps_prica), 0),
      formatNumber(n(item.buy_cntr_amt)),
      formatNumber(n(item.sel_cntr_amt)),
      formatNumber(n(item.buy_cntr_qty)),
      formatNumber(n(item.sel_cntr_qty)),
      formatRatioPercent(parseKiwoomPrice(item.all_trde_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  const notes = [
    "※ 금액(순매수·매수·매도)은 **백만원**, 수량(매수량·매도량)은 **천주** 단위입니다 — 한 행 안에서 단위가 갈립니다.",
    "※ 거래비중 = 그 종목의 전체 거래에서 프로그램 매매가 차지한 비율입니다. 방향이 아니라 크기이므로 부호가 없습니다.",
    `※ 조회일(${dateLabel}) 기준이며, view=top과 달리 과거 날짜를 지정할 수 있습니다. 당일 순위는 view=top이 서버 집계라 더 정확합니다.`,
  ];
  if (top > MAX_TOP_DATE_RANK) {
    notes.push(
      `※ 요청하신 ${top}종목 대신 상위 ${MAX_TOP_DATE_RANK}종목만 보여 드립니다 — ` +
        "이 view는 순위를 조회 범위 안에서 직접 매기므로, 범위 밖 종목이 끼어들 수 있는 깊이까지는 내려가지 않습니다.",
    );
  }
  if (truncated) {
    notes.push(
      "※ 이 TR은 순위가 아니라 시장 전량을 종목별로 주므로 이 표의 순위는 서버가 아니라 조회한 범위 안에서 매긴 것입니다 — " +
        "범위 밖의 **일부 종목이 빠졌을 수 있습니다**(실측 기준 프로그램 매매대금의 99% 이상이 범위 안에 들어옵니다).",
    );
  }
  return [...lines, "", ...notes, "", UNIFIED_EXCHANGE_NOTE].join("\n");
}

export function registerProgramTradingTool(server: McpServer): void {
  server.registerTool(
    "get_program_trading",
    {
      title: "프로그램 매매 조회",
      description:
        "프로그램 매매 상위 종목과 추이를 조회합니다 (키움 ka90003/ka90004/ka90010/ka90005/ka90013/ka90008/ka90006). " +
        "view: top(당일 순매수/순매도 상위 종목, 기본) / " +
        "date_rank(지정한 날짜의 순매수/순매도 상위 종목 — top과 달리 과거 날짜를 볼 수 있고 매수·매도 금액과 " +
        "'거래비중'(그 종목 거래에서 프로그램이 차지한 비율)까지 나옵니다. 당일 순위는 top이 서버 집계라 더 정확합니다) / " +
        "market_daily(시장 전체 일자별 추이) / " +
        "market_intraday(당일 시간대별 누적 추이) / stock_daily(특정 종목의 일자별 추이 — stock_code 필수) / " +
        "stock_intraday(특정 종목의 시간대별 누적 추이 — stock_code 필수, 초 단위이며 순매수 '수량'까지 나옵니다. " +
        "최근 거래일만 제공되어 base_date가 적용되지 않습니다) / " +
        "arbitrage_balance(차익거래 잔고 추이 — 매매가 아니라 미청산 보유 물량이라 다른 view로는 알 수 없습니다). " +
        "한 종목의 프로그램 수급이 장중 언제 뒤집혔는지를 보려면 stock_intraday, 날짜별 흐름은 stock_daily입니다. " +
        "direction은 top·date_rank에, unit은 view=top에만, market은 top·date_rank·market_daily·market_intraday에만 적용됩니다 " +
        "(종목 단위 view와 arbitrage_balance에는 적용되지 않습니다). " +
        "market: kospi(기본)/kosdaq — 전체(all) 옵션이 없습니다. 추이 금액 단위는 백만원입니다.",
      inputSchema: {
        view: z
          .enum([
            "top",
            "date_rank",
            "market_daily",
            "market_intraday",
            "stock_daily",
            "stock_intraday",
            "arbitrage_balance",
          ])
          .optional()
          .describe("조회 종류 (기본값: top)"),
        direction: z
          .enum(["net_buy", "net_sell"])
          .optional()
          .describe("view=top / date_rank의 순매수/순매도 (기본값: net_buy)"),
        unit: z.enum(["amount", "quantity"]).optional().describe("view=top의 금액/수량 기준 (기본값: amount)"),
        market: z
          .enum(["kospi", "kosdaq"])
          .optional()
          .describe(
            "시장 구분 (기본값: kospi) — 종목 단위 view와 arbitrage_balance에는 적용되지 않습니다. " +
              "date_rank는 전체(all) 조회를 제공하지 않는 TR이라 시장을 하나 골라야 합니다",
          ),
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .optional()
          .describe("view=stock_daily / stock_intraday 전용 — 조회할 6자리 종목코드"),
        base_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe(
            "추이 조회 기준일 — 이 날짜부터 과거로 조회 (기본값: 오늘/최근일). view=stock_intraday에는 적용되지 않습니다",
          ),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(
            `표시할 종목/행 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP}) — ` +
              `view=date_rank는 순위를 조회 범위 안에서 매기므로 ${MAX_TOP_DATE_RANK}로 제한됩니다`,
          ),
      },
    },
    async ({ view, direction, unit, market, stock_code, base_date, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const v: ProgramView = view ?? "top";
        const m: ProgramMarket = market ?? "kospi";
        const cap = top ?? DEFAULT_TOP;

        if (v === "top") {
          const d: ProgramDirection = direction ?? "net_buy";
          const u: InvestorUnit = unit ?? "amount";
          const items = await fetchProgramTrades(client, d, u, m);
          return textResult(formatProgramTrades(items, d, u, m, cap, config.modeLabel));
        }

        const dateParam = base_date?.replaceAll("-", "");
        if (v === "stock_daily" || v === "stock_intraday") {
          if (!stock_code) {
            throw new Error(`view=${v}에는 stock_code(6자리 종목코드)가 필요합니다.`);
          }
          const code = stock_code.toUpperCase();
          if (v === "stock_intraday") {
            const { items, truncated } = await fetchStockProgramIntraday(client, code);
            return textResult(formatStockProgramIntraday(items, code, dateParam, cap, truncated, config.modeLabel));
          }
          const { items, truncated } = await fetchStockProgramTrend(client, code, dateParam ?? "");
          return textResult(formatStockProgramTrend(items, code, dateParam, cap, truncated, config.modeLabel));
        }

        if (v === "date_rank") {
          const d: ProgramDirection = direction ?? "net_buy";
          const baseDate = dateParam ?? todayInKst();
          const { items, truncated } = await fetchProgramStockRank(client, m, baseDate);
          return textResult(
            formatProgramStockRank(
              items,
              d,
              m,
              baseDate,
              cap,
              truncated,
              config.modeLabel,
            ),
          );
        }

        if (v === "arbitrage_balance") {
          const baseDate = dateParam ?? todayInKst();
          const { items, truncated } = await fetchProgramArbitrageBalance(client, baseDate);
          return textResult(formatProgramArbitrageBalance(items, baseDate, cap, truncated, config.modeLabel));
        }

        const granularity: ProgramTrendGranularity = v === "market_intraday" ? "intraday" : "daily";
        const baseDate = dateParam ?? todayInKst();
        const { items, truncated } = await fetchProgramTrend(client, granularity, m, baseDate);
        return textResult(formatProgramTrend(items, granularity, m, baseDate, cap, truncated, config.modeLabel));
      }),
  );
}
