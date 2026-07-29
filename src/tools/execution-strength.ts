import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchExecutionStrength, type ExecutionStrengthView } from "../kiwoom/api.js";
import type { ExecutionStrengthItem } from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import { formatKRW, formatPercent, formatQuantity, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_COUNT = 30;
/** 두 TR 모두 한 페이지 60행을 준다 (mock 실측) — 페이지 1만 쓰므로 이게 상한. */
const MAX_COUNT = 60;

const VIEW_LABELS: Record<ExecutionStrengthView, string> = {
  intraday: "시간별",
  daily: "일별",
};

/**
 * 이동평균 컬럼은 같은 필드명(`cntr_str_5min` 등)인데 뷰에 따라 의미가 분 단위/일
 * 단위로 달라진다 (키움 스펙). 헤더에 그대로 반영한다.
 */
const MA_LABELS: Record<ExecutionStrengthView, [string, string, string]> = {
  intraday: ["5분", "20분", "60분"],
  daily: ["5일", "20일", "60일"],
};

/** HHmmss → HH:MM (초는 항상 00이라 버린다). */
function formatClock(raw: string): string {
  return raw.length === 6 ? `${raw.slice(0, 2)}:${raw.slice(2, 4)}` : raw;
}

export function formatExecutionStrength(
  rows: ExecutionStrengthItem[],
  stockCode: string,
  view: ExecutionStrengthView,
  count: number,
  modeLabel: string,
): string {
  const viewLabel = VIEW_LABELS[view];
  if (rows.length === 0) {
    return (
      `[${modeLabel}] 체결강도 ${viewLabel} 추이가 없습니다 (종목 ${stockCode}). ` +
      "종목코드를 확인해 주세요."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, count);
  const [ma5, ma20, ma60] = MA_LABELS[view];
  const axis = view === "intraday" ? "시각" : "일자";

  const latest = n(shown[0]?.cntr_str) ?? 0;
  const lines = [
    `[${modeLabel}] 체결강도 ${viewLabel} 추이 — 종목 ${stockCode} (${shown.length}행)`,
    "",
    `최근 체결강도 ${latest.toFixed(2)} — ${describeStrength(latest)}`,
    "",
    `| ${axis} | 현재가 | 등락률 | 거래량 | 체결강도 | ${ma5} | ${ma20} | ${ma60} |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    // ka10047은 trde_qty가 전 행 공백이고 그날 거래량이 acc_trde_qty에 온다 (실측).
    const volume = view === "intraday" ? n(r.trde_qty) : n(r.acc_trde_qty);
    const cells = [
      view === "intraday" ? formatClock(r.cntr_tm) : formatDateDashed(r.dt),
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(volume),
      (n(r.cntr_str) ?? 0).toFixed(2),
      (n(r.cntr_str_5min) ?? 0).toFixed(2),
      (n(r.cntr_str_20min) ?? 0).toFixed(2),
      (n(r.cntr_str_60min) ?? 0).toFixed(2),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    "※ 체결강도 = 매수 체결량 ÷ 매도 체결량 × 100. **100이 균형**이고, 100보다 크면 " +
      "매수 체결이, 작으면 매도 체결이 우세했다는 뜻입니다.",
    view === "intraday"
      ? "※ 시간별은 최근 60분(1분 간격)이며 최신 시각이 위입니다. 거래량은 해당 분의 거래량입니다."
      : "※ 일별은 최근 60거래일이며 최신 일자가 위입니다. 거래량은 해당 일의 총 거래량입니다.",
  );
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}행 중 최근 ${shown.length}행만 표시했습니다 (count로 조정).`);
  }
  return lines.join("\n");
}

/** 100 균형 기준의 짧은 해석. 경계값은 임의가 아니라 ±10%p 밴드로 잡았다. */
function describeStrength(value: number): string {
  if (value >= 120) return "매수 체결이 크게 우세";
  if (value >= 110) return "매수 체결 우세";
  if (value > 90) return "매수·매도 균형권";
  if (value > 80) return "매도 체결 우세";
  return "매도 체결이 크게 우세";
}

export function registerExecutionStrengthTool(server: McpServer): void {
  server.registerTool(
    "get_execution_strength",
    {
      title: "체결강도 추이 조회",
      description:
        "종목의 체결강도(매수 체결량 ÷ 매도 체결량 × 100) 추이를 조회합니다 (키움 ka10046/ka10047). " +
        "100이 균형이며, 그보다 높으면 매수세가 우세합니다. " +
        "view=daily(기본)는 최근 60거래일, view=intraday는 최근 60분(1분 간격) 흐름을 보여주고 " +
        "5/20/60 이동평균이 함께 옵니다. " +
        "'이 종목에 매수세가 붙고 있나'를 볼 때 씁니다. 정규장 호가는 get_orderbook, " +
        "투자자 주체별 수급은 get_investor_trend를 쓰세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .describe("6자리 종목코드"),
        view: z
          .enum(["daily", "intraday"])
          .optional()
          .describe("daily 일별 최근 60거래일(기본) / intraday 시간별 최근 60분"),
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_COUNT)
          .optional()
          .describe(`표시할 행 수 (기본값 ${DEFAULT_COUNT}, 최대 ${MAX_COUNT})`),
      },
    },
    async ({ stock_code, view, count }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const v: ExecutionStrengthView = view ?? "daily";
        const rows = await fetchExecutionStrength(client, code, v);
        return textResult(formatExecutionStrength(rows, code, v, count ?? DEFAULT_COUNT, config.modeLabel));
      }),
  );
}
