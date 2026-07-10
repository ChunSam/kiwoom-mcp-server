import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchViStocks, type RankingMarket, type ViDirection, type ViType } from "../kiwoom/api.js";
import type { ViStockItem } from "../kiwoom/types.js";
import { formatNumber, formatPercent, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const DIRECTION_LABELS: Record<ViDirection, string> = {
  all: "",
  up: "상승 ",
  down: "하락 ",
};

const TYPE_LABELS: Record<ViType, string> = {
  all: "",
  static: "정적 ",
  dynamic: "동적 ",
};

/** "133301" → "13:33:01"; "000000"(미해제)과 그 외 비정상 값은 "-". */
function formatHms(hms: string): string {
  if (hms.length !== 6 || hms === "000000") return "-";
  return `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
}

export function formatViStocks(
  items: ViStockItem[],
  market: RankingMarket,
  direction: ViDirection,
  viType: ViType,
  stockCode: string | undefined,
  top: number,
  modeLabel: string,
): string {
  const scope = stockCode
    ? `종목 ${stockCode}`
    : `${MARKET_LABELS[market]} ${DIRECTION_LABELS[direction]}${TYPE_LABELS[viType]}`.trimEnd();
  const shown = items.slice(0, top);
  if (shown.length === 0) {
    return `[${modeLabel}] ${scope} VI 발동 내역이 없습니다 (당일 기준).`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${scope} VI 발동 종목 (${shown.length}건)`,
    "",
    "| 종목명 | 코드 | 구분 | 발동가 | 괴리율 | 시가대비 | 발동시각 | 해제시각 | 횟수 |",
    "|---|---|---|---:|---:|---:|---|---|---:|",
  ];

  for (const item of shown) {
    // 정적 VI 행은 dynm_* 필드가 "0"으로 오므로 적용구분에 맞는 괴리율을 고른다.
    const dispty = item.viaplc_tp.includes("동적") ? item.dynm_dispty_rt : item.static_dispty_rt;
    const cells = [
      item.stk_nm,
      item.stk_cd,
      item.viaplc_tp || "-",
      formatNumber(parseKiwoomPrice(item.motn_pric)),
      formatPercent(n(dispty)),
      formatPercent(n(item.open_pric_pre_flu_rt)),
      formatHms(item.trde_cntr_proc_time),
      formatHms(item.virelis_time),
      formatNumber(n(item.vimotn_cnt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("", "※ VI(변동성완화장치) = 급등락 시 단일가 매매로 전환되는 안전장치. 해제시각 '-'는 아직 해제되지 않았거나 기록이 없는 경우입니다.");
  return lines.join("\n");
}

export function registerViStocksTool(server: McpServer): void {
  server.registerTool(
    "get_vi_stocks",
    {
      title: "VI 발동 종목 조회",
      description:
        "당일 변동성완화장치(VI)가 발동된 종목을 조회합니다 — 발동가격·괴리율·시가대비등락률·발동/해제 " +
        "시각·발동횟수 (키움 ka10054). market: all(기본)/kospi/kosdaq, direction: all(기본)/up(상승)/" +
        "down(하락), vi_type: all(기본)/static(정적)/dynamic(동적). stock_code를 지정하면 해당 종목의 " +
        "당일 발동 내역만 조회합니다.",
      inputSchema: {
        market: z.enum(["all", "kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: all)"),
        direction: z.enum(["all", "up", "down"]).optional().describe("발동 방향 (기본값: all)"),
        vi_type: z.enum(["all", "static", "dynamic"]).optional().describe("VI 유형 (기본값: all)"),
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .optional()
          .describe("특정 종목의 발동 내역만 조회 (생략 시 전체)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 건수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ market, direction, vi_type, stock_code, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: RankingMarket = market ?? "all";
        const d: ViDirection = direction ?? "all";
        const t: ViType = vi_type ?? "all";
        const items = await fetchViStocks(client, m, d, t, stock_code);
        return textResult(formatViStocks(items, m, d, t, stock_code, top ?? DEFAULT_TOP, config.modeLabel));
      }),
  );
}
