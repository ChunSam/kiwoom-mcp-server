import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchSectorPrice, fetchSectorStocks } from "../kiwoom/api.js";
import type { SectorPriceResponse, SectorStockItem, SectorTimeRow } from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import {
  formatNumber,
  formatPercent,
  formatRatioPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_STOCK_LIMIT = 30;
const MAX_STOCK_LIMIT = 100;
const TIME_ROWS_SHOWN = 10;

/** 잘 알려진 업종 코드 라벨 — 전체 코드 목록은 get_market_index로 조회. */
const SECTOR_LABELS: Record<string, string> = {
  "001": "코스피 종합",
  "002": "코스피 대형주",
  "101": "코스닥 종합",
  "201": "KOSPI200",
};

const sectorLabel = (code: string): string => SECTOR_LABELS[code] ?? `업종 ${code}`;

/** "153220" → "15:32:20"; 시각이 아닌 값(장마감 센티널 999999/888888 등)은 null. */
function formatSectorTime(tm: string): string | null {
  if (!/^\d{6}$/.test(tm) || Number(tm.slice(0, 2)) > 23) return null;
  return `${tm.slice(0, 2)}:${tm.slice(2, 4)}:${tm.slice(4, 6)}`;
}

const dashedOr = (yyyymmdd: string): string =>
  /^\d{8}$/.test(yyyymmdd) ? formatDateDashed(yyyymmdd) : "-";

export function formatSectorPrice(
  res: SectorPriceResponse,
  sectorCode: string,
  modeLabel: string,
): string {
  const n = parseKiwoomNumber;
  const p = parseKiwoomPrice;

  const index = p(res.cur_prc);
  if (index === null) {
    return (
      `[${modeLabel}] 업종 ${sectorCode}의 시세 데이터가 없습니다. ` +
      `업종 코드를 확인하세요 (get_market_index의 '코드' 값).`
    );
  }

  const lines = [
    `[${modeLabel}] 업종 현재가 — ${sectorLabel(sectorCode)} (${sectorCode})`,
    "",
    `지수 ${formatNumber(index)} (전일대비 ${formatSigned(n(res.pred_pre))}, ${formatPercent(n(res.flu_rt))})`,
    `시가 ${formatNumber(p(res.open_pric))} · 고가 ${formatNumber(p(res.high_pric))} · 저가 ${formatNumber(p(res.low_pric))}`,
    `거래량 ${formatNumber(n(res.trde_qty), 0)}천주 · 거래대금 ${formatNumber(n(res.trde_prica), 0)}백만원`,
    `등락 구성: 상한 ${n(res.upl) ?? "-"} · 상승 ${n(res.rising) ?? "-"} · 보합 ${n(res.stdns) ?? "-"} · ` +
      `하락 ${n(res.fall) ?? "-"} · 하한 ${n(res.lst) ?? "-"} ` +
      `(거래형성 ${formatNumber(n(res.trde_frmatn_stk_num), 0)}종목, ${formatRatioPercent(p(res.trde_frmatn_rt))})`,
    `52주 최고 ${formatNumber(p(res["52wk_hgst_pric"]))} (${dashedOr(res["52wk_hgst_pric_dt"])}, ` +
      `현재 대비 ${formatPercent(n(res["52wk_hgst_pric_pre_rt"]))}) · ` +
      `최저 ${formatNumber(p(res["52wk_lwst_pric"]))} (${dashedOr(res["52wk_lwst_pric_dt"])}, ` +
      `현재 대비 ${formatPercent(n(res["52wk_lwst_pric_pre_rt"]))})`,
  ];

  const timeRows: Array<{ time: string; row: SectorTimeRow }> = [];
  for (const row of res.inds_cur_prc_tm) {
    const time = formatSectorTime(row.tm_n);
    if (time) timeRows.push({ time, row });
    if (timeRows.length >= TIME_ROWS_SHOWN) break;
  }
  if (timeRows.length > 0) {
    lines.push(
      "",
      `시간대별 추이 (최근 ${timeRows.length}건)`,
      "",
      "| 시각 | 지수 | 전일대비 | 등락률 | 누적거래량(천주) |",
      "|---|---:|---:|---:|---:|",
    );
    for (const { time, row } of timeRows) {
      lines.push(
        `| ${time} | ${formatNumber(p(row.cur_prc_n))} | ${formatSigned(n(row.pred_pre_n))} | ` +
          `${formatPercent(n(row.flu_rt_n))} | ${formatNumber(n(row.acc_trde_qty_n), 0)} |`,
      );
    }
  }

  lines.push("", "※ 구성 종목별 시세는 get_sector_stocks에 같은 업종 코드를 넣어 조회하세요.");
  return lines.join("\n");
}

export function formatSectorStocks(
  items: SectorStockItem[],
  truncated: boolean,
  sectorCode: string,
  limit: number,
  modeLabel: string,
): string {
  if (items.length === 0) {
    return (
      `[${modeLabel}] ${sectorLabel(sectorCode)} (${sectorCode})의 구성 종목이 없습니다. ` +
      `업종 코드를 확인하세요 (get_market_index의 '코드' 값).`
    );
  }

  const n = parseKiwoomNumber;
  const p = parseKiwoomPrice;
  const shown = items.slice(0, limit);

  const lines = [
    `[${modeLabel}] 업종별 주가 — ${sectorLabel(sectorCode)} (${sectorCode}), ${shown.length}종목 (종목코드순)`,
    "",
    "| 종목명 | 코드 | 현재가 | 전일대비 | 등락률 | 거래량 | 고가 | 저가 |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const item of shown) {
    lines.push(
      `| ${item.stk_nm || "-"} | ${item.stk_cd || "-"} | ${formatNumber(p(item.cur_prc), 0)} | ` +
        `${formatSigned(n(item.pred_pre), 0)} | ${formatPercent(n(item.flu_rt))} | ` +
        `${formatNumber(n(item.now_trde_qty), 0)} | ${formatNumber(p(item.high_pric), 0)} | ` +
        `${formatNumber(p(item.low_pric), 0)} |`,
    );
  }

  const notes: string[] = [];
  if (items.length > shown.length) {
    notes.push(`※ 첫 ${shown.length}종목만 표시했습니다 (limit으로 최대 ${MAX_STOCK_LIMIT}개까지 조정 가능).`);
  }
  if (truncated) {
    notes.push("※ 구성 종목이 더 있습니다 — 이 조회는 첫 페이지(종목코드순 100종목)만 가져옵니다.");
  }
  if (notes.length > 0) lines.push("", ...notes);
  return lines.join("\n");
}

const sectorCodeSchema = z
  .string()
  .regex(/^\d{3}$/)
  .describe("업종 코드 3자리 (예: 001 코스피 종합, 101 코스닥 종합 — get_market_index의 '코드' 값)");

export function registerSectorPriceTool(server: McpServer): void {
  server.registerTool(
    "get_sector_price",
    {
      title: "업종 현재가 조회",
      description:
        "업종(섹터) 지수의 현재가 상세를 조회합니다 (키움 ka20001) — 지수·시/고/저가·거래량·" +
        "상승/하락 종목수·52주 고저·시간대별 추이. sector_code는 get_market_index가 보여주는 " +
        "업종 코드입니다 (001 코스피 종합, 002 코스피 대형주, 101 코스닥 종합, 201 KOSPI200 등).",
      inputSchema: {
        sector_code: sectorCodeSchema,
      },
    },
    async ({ sector_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const res = await fetchSectorPrice(client, sector_code);
        return textResult(formatSectorPrice(res, sector_code, config.modeLabel));
      }),
  );
}

export function registerSectorStocksTool(server: McpServer): void {
  server.registerTool(
    "get_sector_stocks",
    {
      title: "업종별 종목 시세 조회",
      description:
        "특정 업종에 속한 종목들의 시세를 조회합니다 (키움 ka20002). 종목코드순 정렬이며 " +
        "첫 페이지(최대 100종목)만 가져옵니다. sector_code는 get_market_index의 업종 코드입니다.",
      inputSchema: {
        sector_code: sectorCodeSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_STOCK_LIMIT)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_STOCK_LIMIT}, 최대 ${MAX_STOCK_LIMIT})`),
      },
    },
    async ({ sector_code, limit }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const { items, truncated } = await fetchSectorStocks(client, sector_code);
        return textResult(
          formatSectorStocks(items, truncated, sector_code, limit ?? DEFAULT_STOCK_LIMIT, config.modeLabel),
        );
      }),
  );
}
