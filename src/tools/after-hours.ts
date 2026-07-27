import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchAfterHoursQuote,
  fetchAfterHoursRank,
  type AfterHoursMinVolume,
  type AfterHoursSort,
  type RankingMarket,
} from "../kiwoom/api.js";
import type { AfterHoursQuoteResponse, AfterHoursRankItem } from "../kiwoom/types.js";
import { formatNumber, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;
const BOOK_LEVELS = 5;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const SORT_LABELS: Record<AfterHoursSort, string> = {
  up_rate: "상승률",
  up_amount: "상승폭",
  down_rate: "하락률",
  down_amount: "하락폭",
  unchanged: "보합",
};

const VOLUME_LABELS: Record<AfterHoursMinVolume, string> = {
  all: "전체",
  "100": "100주 이상",
  "500": "500주 이상",
  "1000": "1천주 이상",
  "5000": "5천주 이상",
  "10000": "1만주 이상",
  "50000": "5만주 이상",
  "100000": "10만주 이상",
};

/** 시간외 단일가 매매 시간대. 세션 밖에서는 직전 세션 값이거나 0으로 온다. */
const SESSION_NOTE = "시간외 단일가 매매는 16:00~18:00(KST) 세션입니다";
/** 등락률 기준이 전일이 아니라 당일 종가라는 사실은 실측으로 확인됐다 (types.ts 주석). */
const BASE_NOTE = "시간외 단일가의 대비·등락률은 전일이 아니라 **당일 종가** 기준입니다";

/** 5단 호가는 loose passthrough로 읽는다 (ka10004 get_orderbook 선례). */
function passthroughField(quote: AfterHoursQuoteResponse, key: string): string | null {
  const value = (quote as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function formatTime(raw: string): string {
  return raw.length === 6 ? `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}` : raw;
}

export function formatAfterHoursQuote(
  quote: AfterHoursQuoteResponse,
  stockCode: string,
  modeLabel: string,
): string {
  const price = (raw: string | null) => formatNumber(parseKiwoomPrice(raw));
  const qty = (raw: string | null) => formatNumber(parseKiwoomNumber(raw));

  const curPrc = parseKiwoomPrice(quote.ovt_sigpric_cur_prc);
  const diff = parseKiwoomNumber(quote.ovt_sigpric_pred_pre);
  const accQty = parseKiwoomNumber(quote.ovt_sigpric_acc_trde_qty);
  const selTot = parseKiwoomNumber(quote.ovt_sigpric_sel_bid_tot_req);
  const buyTot = parseKiwoomNumber(quote.ovt_sigpric_buy_bid_tot_req);
  const hasBook = (selTot ?? 0) !== 0 || (buyTot ?? 0) !== 0;

  const lines = [
    `[${modeLabel}] ${stockCode} 시간외 단일가 (호가잔량기준시간 ${formatTime(quote.bid_req_base_tm)})`,
    "",
    `시간외 단일가 ${formatNumber(curPrc)}원 ` +
      `(종가대비 ${formatSigned(diff, 0)}, ${formatPercent(parseKiwoomNumber(quote.ovt_sigpric_flu_rt))}) · ` +
      `누적거래량 ${formatNumber(accQty)}주`,
  ];

  if (hasBook) {
    lines.push("", "| 구분 | 호가 | 잔량 |", "|---|---:|---:|");
    for (let level = BOOK_LEVELS; level >= 1; level--) {
      lines.push(
        `| 매도${level} | ${price(passthroughField(quote, `ovt_sigpric_sel_bid_${level}`))} | ` +
          `${qty(passthroughField(quote, `ovt_sigpric_sel_bid_qty_${level}`))} |`,
      );
    }
    for (let level = 1; level <= BOOK_LEVELS; level++) {
      lines.push(
        `| 매수${level} | ${price(passthroughField(quote, `ovt_sigpric_buy_bid_${level}`))} | ` +
          `${qty(passthroughField(quote, `ovt_sigpric_buy_bid_qty_${level}`))} |`,
      );
    }
    lines.push("", `시간외 단일가 총잔량 — 매도 ${formatNumber(selTot)} / 매수 ${formatNumber(buyTot)}`);
  } else {
    lines.push(
      "",
      "시간외 단일가 호가가 없습니다 (해당 세션에 접수된 호가 없음). " +
        (accQty ? "" : "체결도 없어 현재가 자리에는 당일 종가가 표시됩니다."),
    );
  }

  lines.push(
    `참고 총잔량 — 정규장 매도 ${qty(quote.sel_bid_tot_req)} / 매수 ${qty(quote.buy_bid_tot_req)}, ` +
      `시간외 매도 ${qty(quote.ovt_sel_bid_tot_req)} / 매수 ${qty(quote.ovt_buy_bid_tot_req)}`,
    "",
    `※ ${BASE_NOTE}. 호가잔량기준시간은 시간외가 아닌 정규장 기준 시각입니다(키움 스펙). ${SESSION_NOTE}.`,
  );
  return lines.join("\n");
}

export function formatAfterHoursRank(
  items: AfterHoursRankItem[],
  market: RankingMarket,
  sort: AfterHoursSort,
  minVolume: AfterHoursMinVolume,
  top: number,
  modeLabel: string,
): string {
  const filterSuffix = minVolume === "all" ? "" : `, 거래량 ${VOLUME_LABELS[minVolume]}`;
  const title = `${MARKET_LABELS[market]} 시간외 단일가 ${SORT_LABELS[sort]} 순위${filterSuffix}`;
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title} — 해당 종목이 없습니다.`;
  }

  const lines = [
    `[${modeLabel}] ${title} (${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 시간외가 | 종가대비 | 등락률 | 거래량 | 거래대금(백만원) | 당일종가 | 정규장등락률 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const item of shown) {
    const cells = [
      item.rank,
      item.stk_nm,
      item.stk_cd,
      formatNumber(parseKiwoomPrice(item.cur_prc)),
      formatSigned(parseKiwoomNumber(item.pred_pre), 0),
      formatPercent(parseKiwoomNumber(item.flu_rt)),
      formatNumber(parseKiwoomNumber(item.acc_trde_qty)),
      formatNumber(parseKiwoomNumber(item.acc_trde_prica)),
      formatNumber(parseKiwoomPrice(item.tdy_close_pric)),
      formatPercent(parseKiwoomNumber(item.tdy_close_pric_flu_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    `※ ${BASE_NOTE} (정규장등락률만 전일 대비). ${SESSION_NOTE}.`,
  );
  if (minVolume === "all") {
    lines.push("※ 거래량 1~2주짜리 체결도 순위에 오릅니다 — min_volume으로 걸러낼 수 있습니다.");
  }
  if (items.length > shown.length) {
    lines.push(`※ 조회된 ${items.length}종목 중 상위 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  return lines.join("\n");
}

export function registerAfterHoursTool(server: McpServer): void {
  server.registerTool(
    "get_after_hours",
    {
      title: "시간외 단일가 조회",
      description:
        "장 종료 후 시간외 단일가 매매(16:00~18:00 KST) 정보를 조회합니다 (키움 ka10087/ka10098). " +
        "stock_code를 지정하면 해당 종목의 시간외 단일가 시세와 5단 호가를, 생략하면 시장 전체 " +
        "등락률 순위를 보여줍니다. 대비·등락률은 전일이 아니라 당일 종가 기준입니다. " +
        "순위는 sort(up_rate 상승률 기본/up_amount 상승폭/down_rate 하락률/down_amount 하락폭/" +
        "unchanged 보합), market(all 기본/kospi/kosdaq), min_volume(거래량 하한)으로 조절합니다. " +
        "정규장 호가는 get_orderbook을 쓰세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .optional()
          .describe("6자리 종목코드 (생략 시 시장 전체 시간외 단일가 등락률 순위)"),
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 구분 — 순위 조회에서만 사용 (기본값: all)"),
        sort: z
          .enum(["up_rate", "up_amount", "down_rate", "down_amount", "unchanged"])
          .optional()
          .describe("정렬 기준 — 순위 조회에서만 사용 (기본값: up_rate)"),
        min_volume: z
          .enum(["all", "100", "500", "1000", "5000", "10000", "50000", "100000"])
          .optional()
          .describe("시간외 거래량 하한(주) — 순위 조회에서만 사용 (기본값: all)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 — 순위 조회에서만 사용 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ stock_code, market, sort, min_volume, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        if (stock_code) {
          const code = stock_code.toUpperCase();
          const quote = await fetchAfterHoursQuote(client, code);
          return textResult(formatAfterHoursQuote(quote, code, config.modeLabel));
        }
        const m: RankingMarket = market ?? "all";
        const s: AfterHoursSort = sort ?? "up_rate";
        const v: AfterHoursMinVolume = min_volume ?? "all";
        const items = await fetchAfterHoursRank(client, m, s, v);
        return textResult(formatAfterHoursRank(items, m, s, v, top ?? DEFAULT_TOP, config.modeLabel));
      }),
  );
}
