import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchCreditTrend, type CreditType } from "../kiwoom/api.js";
import type { CreditTrendResponse } from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import {
  formatKRW,
  formatNumber,
  formatQuantity,
  formatRatioPercent,
  formatSigned,
  formatSignedKRW,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_DISPLAY_ROWS = 15;
const MAX_DISPLAY_ROWS = 60;

const TYPE_LABELS: Record<CreditType, string> = { loan: "신용융자", short: "대주" };

export function formatCreditTrend(
  res: CreditTrendResponse,
  stockCode: string,
  baseDate: string,
  creditType: CreditType,
  limit: number,
  modeLabel: string,
): string {
  const rows = res.crd_trde_trend;
  const label = TYPE_LABELS[creditType];
  const [latest] = rows;

  if (!latest) {
    return (
      `[${modeLabel}] ${label} 매매동향이 없습니다 (종목 ${stockCode}, 기준일 ${formatDateDashed(baseDate)}). ` +
      "신용거래가 제한된 종목(투자경고·관리종목 등)이거나 상장 이전 구간이면 빈 결과가 옵니다."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, limit);
  const oldest = shown.at(-1) ?? latest;
  const period = `${formatDateDashed(oldest.dt)} ~ ${formatDateDashed(latest.dt)}`;

  const lines = [
    `[${modeLabel}] ${stockCode} ${label} 매매동향 (${period}, ${rows.length}거래일 중 ${shown.length}행)`,
    "",
    `■ 최신 잔고 (${formatDateDashed(latest.dt)})`,
    `- 잔고: ${formatQuantity(n(latest.remn))} (${formatNumber(n(latest.amt))}백만원) / ` +
      `전일대비 ${formatSigned(n(latest.pre), 0)}주`,
    `- 잔고율: ${formatRatioPercent(n(latest.remn_rt))} / 공여율: ${formatRatioPercent(n(latest.shr_rt))}`,
    "",
    "| 일자 | 종가 | 전일대비 | 거래량 | 신규 | 상환 | 잔고 | 잔고금액(백만원) | 잔고증감 | 공여율 | 잔고율 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    const cells = [
      formatDateDashed(r.dt),
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatSignedKRW(n(r.pred_pre)),
      formatQuantity(n(r.trde_qty)),
      formatNumber(n(r.new), 0),
      formatNumber(n(r.rpya), 0),
      formatNumber(n(r.remn), 0),
      formatNumber(n(r.amt), 0),
      formatSigned(n(r.pre), 0),
      formatRatioPercent(n(r.shr_rt)),
      formatRatioPercent(n(r.remn_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    "※ 최신 일자가 위입니다. 신규·상환·잔고·잔고증감은 **주** 단위이고, 잔고금액만 백만원입니다.",
    `※ ${
      creditType === "loan"
        ? "신용융자는 투자자가 증권사 돈을 빌려 **산** 물량입니다 — 잔고가 늘면 빚을 낸 매수가 쌓였다는 뜻이고, " +
          "주가가 떨어지면 반대매매(강제 청산) 압력이 됩니다."
        : "대주는 투자자가 증권사에서 주식을 빌려 **판** 물량입니다 — 잔고가 늘면 하락에 베팅한 물량이 쌓였다는 뜻입니다. " +
          "기관·외국인이 쓰는 대차거래는 규모가 훨씬 커서 get_stock_lending으로 따로 봐야 합니다."
    }`,
    "※ 잔고율은 잔고/상장주식수이고, 공여율은 거래에서 신용거래가 차지한 비중입니다 (둘 다 키움 산출값).",
    "※ 신용잔고는 하루 지연 집계라 **당일 행은 대개 비어 있습니다** — 기준일을 오늘로 줘도 직전 거래일이 최신 행입니다.",
    "※ 신규·상환·잔고 등 신용 수치는 **KRX 기준**입니다 (신용잔고는 거래소로 갈리지 않습니다). " +
      "같은 표의 종가·거래량은 통합 기준이라 공여율의 분모와는 기준이 다릅니다.",
    UNIFIED_EXCHANGE_NOTE,
  );
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}행 중 최근 ${shown.length}행만 표시했습니다 (count로 조정).`);
  }
  return lines.join("\n");
}

export function registerCreditTrendTool(server: McpServer): void {
  server.registerTool(
    "get_credit_trend",
    {
      title: "신용융자·대주 잔고 추이 조회",
      description:
        "특정 종목의 신용융자(빚내서 산 물량) 또는 대주(빌려서 판 물량) 신규·상환·잔고 추이를 " +
        "조회합니다 (키움 ka10013). 신용잔고가 쌓이면 하락 시 반대매매 압력이, 대주 잔고가 쌓이면 " +
        "하락 베팅이 늘었다는 신호입니다. 기관·외국인의 대차거래 잔고는 get_stock_lending, " +
        "공매도 체결량 추이는 get_short_selling을 쓰세요 — 개인 신용거래를 보는 것은 이 tool뿐입니다.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .describe("조회할 6자리 종목코드"),
        credit_type: z
          .enum(["loan", "short"])
          .optional()
          .describe("loan=신용융자(기본, 빚내서 매수) / short=대주(빌려서 매도)"),
        base_date: z
          .string()
          .regex(/^\d{8}$/, "yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 기준일 yyyyMMdd (기본: 오늘). 이 날짜부터 과거로 거슬러 조회합니다"),
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_DISPLAY_ROWS)
          .optional()
          .describe(`표시할 행 수 (기본 ${DEFAULT_DISPLAY_ROWS}, 최대 ${MAX_DISPLAY_ROWS}; 최신순)`),
      },
    },
    async ({ stock_code, credit_type, base_date, count }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const type: CreditType = credit_type ?? "loan";
        const baseDate = base_date ?? todayInKst();

        const res = await fetchCreditTrend(client, code, baseDate, type);
        return textResult(
          formatCreditTrend(res, code, baseDate, type, count ?? DEFAULT_DISPLAY_ROWS, config.modeLabel),
        );
      }),
  );
}
