import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchBidBalance,
  fetchBidRatioSurge,
  fetchBidSurge,
  type BidBalanceSort,
  type BidMarket,
  type BidSurgeMinVolume,
} from "../kiwoom/api.js";
import type { BidBalanceItem, BidRatioSurgeItem, BidSurgeItem } from "../kiwoom/types.js";
import {
  formatKRW,
  formatQuantity,
  formatRatioPercent,
  formatSigned,
  formatSignedKRW,
  isSaturatedInt,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 15;
const MAX_TOP = 50;
const DEFAULT_MINUTES = 30;
const MAX_MINUTES = 120;

const MARKET_LABELS: Record<BidMarket, string> = { kospi: "코스피", kosdaq: "코스닥" };

const BALANCE_SORT_LABELS: Record<BidBalanceSort, string> = {
  net_buy: "순매수잔량",
  net_sell: "순매도잔량",
  buy_ratio: "매수비율",
  sell_ratio: "매도비율",
};

/** 장 시작 전에는 ka10020이 200행을 주되 잔량이 전 행 0이다 (실측) — 그때 붙이는 안내. */
const CLOSED_MARKET_HINT =
  "잔량이 전부 0입니다 — 호가 잔량은 정규장(09:00~15:30) 중에만 쌓입니다. " +
  "개장 전이라면 예상체결은 get_expected_execution, 시간외 단일가는 get_after_hours를 쓰세요.";

/** 32비트 상한에서 잘린 값은 숫자로 찍지 않는다 — 자세한 근거는 isSaturatedInt. */
const qty = (value: number | null): string => (isSaturatedInt(value) ? "집계상한" : formatQuantity(value));

const SATURATION_NOTE =
  "※ `집계상한`은 키움이 32비트 정수 상한(2,147,483,647 / 4,294,967,295)에서 잘라 보낸 값입니다 — " +
  "실제 수치는 그보다 큽니다.";

const emptyNotice = (modeLabel: string, title: string): string =>
  `[${modeLabel}] ${title} 결과가 없습니다. ` +
  "호가 잔량 순위는 정규장(09:00~15:30) 중에만 산출됩니다 — 그 밖의 시간에는 비어 있습니다.";

export function formatBidBalance(
  rows: BidBalanceItem[],
  market: BidMarket,
  sort: BidBalanceSort,
  top: number,
  modeLabel: string,
): string {
  const title = `${MARKET_LABELS[market]} 호가잔량 ${BALANCE_SORT_LABELS[sort]} 상위`;
  if (rows.length === 0) return emptyNotice(modeLabel, title);

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, top);
  const allZero = rows.every((r) => (n(r.tot_buy_req) ?? 0) === 0 && (n(r.tot_sel_req) ?? 0) === 0);

  const lines = [
    `[${modeLabel}] ${title} (${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 전일대비 | 거래량 | 매도잔량 | 매수잔량 | 순매수잔량 | 매수비율 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((r, index) => {
    const cells = [
      String(index + 1),
      r.stk_nm || "-",
      r.stk_cd,
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatSignedKRW(n(r.pred_pre)),
      qty(n(r.trde_qty)),
      qty(n(r.tot_sel_req)),
      qty(n(r.tot_buy_req)),
      formatSigned(n(r.netprps_req), 0),
      formatRatioPercent(n(r.buy_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    "※ 순매수잔량 = 총매수잔량 − 총매도잔량. 양수면 매수 대기 물량이 더 두껍다는 뜻입니다.",
    "※ 잔량은 체결이 아니라 '대기 중인 주문'이라 언제든 취소될 수 있습니다 — 체결 쪽 힘은 " +
      "get_execution_strength, 특정 종목의 10단 호가는 get_orderbook을 쓰세요.",
  );
  if (shown.some((r) => isSaturatedInt(n(r.trde_qty)) || isSaturatedInt(n(r.tot_buy_req)) || isSaturatedInt(n(r.tot_sel_req)))) {
    lines.push(SATURATION_NOTE);
  }
  if (allZero) lines.push(`※ ${CLOSED_MARKET_HINT}`);
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}종목 중 상위 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function formatBidSurge(
  rows: BidSurgeItem[],
  market: BidMarket,
  side: "buy" | "sell",
  minutes: number,
  top: number,
  modeLabel: string,
): string {
  const sideLabel = side === "buy" ? "매수" : "매도";
  const title = `${MARKET_LABELS[market]} ${sideLabel}잔량 급증 (최근 ${minutes}분)`;
  if (rows.length === 0) return emptyNotice(modeLabel, title);

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, top);

  const lines = [
    `[${modeLabel}] ${title} — 급증률 상위 ${shown.length}종목`,
    "",
    `| 순위 | 종목명 | 코드 | 현재가 | 전일대비 | ${minutes}분 전 잔량 | 현재 잔량 | 급증량 | 급증률 |`,
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((r, index) => {
    const cells = [
      String(index + 1),
      r.stk_nm || "-",
      r.stk_cd,
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatSignedKRW(n(r.pred_pre)),
      qty(n(r.int)),
      qty(n(r.now)),
      formatSigned(n(r.sdnin_qty), 0),
      formatRatioPercent(n(r.sdnin_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    `※ ${minutes}분 전 잔량 대비 현재 ${sideLabel} 대기 물량이 얼마나 불었는지의 순위입니다 (minutes로 구간 조정).`,
    "※ 잔량 급증은 체결이 아니라 대기 주문의 변화입니다 — 실제 체결 흐름은 get_execution_strength를 보세요.",
  );
  if (shown.some((r) => isSaturatedInt(n(r.int)) || isSaturatedInt(n(r.now)))) lines.push(SATURATION_NOTE);
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}종목 중 상위 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function formatBidRatioSurge(
  rows: BidRatioSurgeItem[],
  market: BidMarket,
  side: "buy" | "sell",
  minutes: number,
  top: number,
  modeLabel: string,
): string {
  const ratioLabel = side === "buy" ? "매수/매도" : "매도/매수";
  const title = `${MARKET_LABELS[market]} ${ratioLabel} 잔량비율 급증 (최근 ${minutes}분)`;
  if (rows.length === 0) return emptyNotice(modeLabel, title);

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, top);

  const lines = [
    `[${modeLabel}] ${title} — 급증률 상위 ${shown.length}종목`,
    "",
    `| 순위 | 종목명 | 코드 | 현재가 | 전일대비 | ${minutes}분 전 비율 | 현재 비율 | 급증률 | 매도잔량 | 매수잔량 |`,
    "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((r, index) => {
    const cells = [
      String(index + 1),
      r.stk_nm || "-",
      r.stk_cd,
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatSignedKRW(n(r.pred_pre)),
      formatRatioPercent(n(r.int)),
      formatRatioPercent(n(r.now_rt)),
      formatRatioPercent(n(r.sdnin_rt)),
      qty(n(r.tot_sel_req)),
      qty(n(r.tot_buy_req)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    `※ 잔량의 '수량'이 아니라 ${ratioLabel} 비율이 얼마나 기울었는지의 순위입니다 — ` +
      "수량 급증은 view=surge를 쓰세요.",
    "※ 잔량은 대기 주문이라 언제든 취소될 수 있습니다.",
  );
  if (shown.some((r) => isSaturatedInt(n(r.tot_sel_req)) || isSaturatedInt(n(r.tot_buy_req)))) {
    lines.push(SATURATION_NOTE);
  }
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}종목 중 상위 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerOrderbookRankTool(server: McpServer): void {
  server.registerTool(
    "get_orderbook_rank",
    {
      title: "호가잔량 순위 조회 (시장 전체)",
      description:
        "시장 전체에서 호가 잔량이 두껍거나 급증한 종목을 조회합니다 (키움 ka10020/ka10021/ka10022). " +
        "view=balance(기본)는 총매수/매도 잔량과 순매수 잔량 상위, view=surge는 최근 N분간 잔량 " +
        "수량이 급증한 종목, view=ratio_surge는 매수/매도 잔량 비율이 급격히 기운 종목입니다. " +
        "정규장(09:00~15:30) 중에만 산출되며 그 밖의 시간에는 비어 있거나 잔량이 0으로 옵니다. " +
        "특정 종목 하나의 10단 호가는 get_orderbook, 체결 쪽 힘은 get_execution_strength를 쓰세요.",
      inputSchema: {
        view: z
          .enum(["balance", "surge", "ratio_surge"])
          .optional()
          .describe("balance 잔량 상위(기본) / surge 잔량 수량 급증 / ratio_surge 잔량 비율 급증"),
        market: z.enum(["kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: kospi). 전체 조회는 없습니다"),
        sort: z
          .enum(["net_buy", "net_sell", "buy_ratio", "sell_ratio"])
          .optional()
          .describe("view=balance의 정렬 기준 (기본값: net_buy=순매수잔량순)"),
        side: z
          .enum(["buy", "sell"])
          .optional()
          .describe("view=surge/ratio_surge에서 볼 방향 (기본값: buy=매수잔량)"),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(MAX_MINUTES)
          .optional()
          .describe(`view=surge/ratio_surge의 비교 구간(분) (기본값 ${DEFAULT_MINUTES}, 최대 ${MAX_MINUTES})`),
        min_volume: z
          .enum(["1000", "5000", "10000", "50000", "100000"])
          .optional()
          .describe("view=surge/ratio_surge의 최소 거래량 필터 (기본값: 10000주)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ view, market, sort, side, minutes, min_volume, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: BidMarket = market ?? "kospi";
        const cap = top ?? DEFAULT_TOP;

        if (view === "surge" || view === "ratio_surge") {
          const s = side ?? "buy";
          const mins = minutes ?? DEFAULT_MINUTES;
          const vol = (min_volume ?? "10000") as BidSurgeMinVolume;
          if (view === "surge") {
            const rows = await fetchBidSurge(client, m, s, mins, vol);
            return textResult(formatBidSurge(rows, m, s, mins, cap, config.modeLabel));
          }
          const rows = await fetchBidRatioSurge(client, m, s, mins, vol);
          return textResult(formatBidRatioSurge(rows, m, s, mins, cap, config.modeLabel));
        }

        const bal: BidBalanceSort = sort ?? "net_buy";
        const rows = await fetchBidBalance(client, m, bal);
        return textResult(formatBidBalance(rows, m, bal, cap, config.modeLabel));
      }),
  );
}
