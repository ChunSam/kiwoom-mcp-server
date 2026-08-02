import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchDailyFlow,
  fetchDailySession,
  type DailyTradingView,
  type InvestorUnit,
} from "../kiwoom/api.js";
import type { DailyFlowItem, DailySessionItem } from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import {
  formatKRW,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatRatioPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_COUNT = 20;
/** ka10086이 20행/page라 60이면 3페이지 — 페이지 간격 1.1초를 감안한 실용 상한. */
const MAX_COUNT = 60;

/** indc_tp cross-checked live: amount mode is 백만원, quantity mode is 주. */
const UNIT_LABELS: Record<InvestorUnit, string> = { amount: "백만원", quantity: "주" };

export function formatDailyFlow(
  rows: DailyFlowItem[],
  stockCode: string,
  unit: InvestorUnit,
  count: number,
  truncated: boolean,
  modeLabel: string,
): string {
  if (rows.length === 0) {
    return (
      `[${modeLabel}] 일별 수급 내역이 없습니다 (종목 ${stockCode}). ` +
      "종목코드와 기준일(base_date)을 확인해 주세요."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, count);
  const unitLabel = UNIT_LABELS[unit];

  const sum = (pick: (r: DailyFlowItem) => string) =>
    shown.reduce((acc, r) => acc + (n(pick(r)) ?? 0), 0);

  const lines = [
    `[${modeLabel}] 일별 거래·수급 — 종목 ${stockCode} (${shown.length}거래일)`,
    "",
    `기간 누적 순매수 — 개인 ${formatSigned(sum((r) => r.ind_netprps), 0)}${unitLabel} · ` +
      `기관 ${formatSigned(sum((r) => r.orgn_netprps), 0)}${unitLabel} · ` +
      `외국인 ${formatSigned(sum((r) => r.for_netprps), 0)}주`,
    "",
    `| 일자 | 종가 | 등락률 | 거래량 | 거래대금(백만원) | 개인(${unitLabel}) | ` +
      `기관(${unitLabel}) | 외국인(주) | 프로그램(${unitLabel}) | 신용비율 |`,
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    const cells = [
      formatDateDashed(r.date),
      formatKRW(parseKiwoomPrice(r.close_pric)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(n(r.trde_qty)),
      formatNumber(n(r.amt_mn), 0),
      formatSigned(n(r.ind_netprps), 0),
      formatSigned(n(r.orgn_netprps), 0),
      formatSigned(n(r.for_netprps), 0),
      formatSigned(n(r.prm), 0),
      formatRatioPercent(n(r.crd_rt)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    "※ 최신 일자가 위입니다. 순매수는 양수면 순매수, 음수면 순매도입니다.",
    "※ **외국인 열만은 unit과 무관하게 항상 수량(주)** 입니다 — 거래소가 외국인 순매수의 " +
      "금액 데이터를 제공하지 않기 때문입니다(키움 스펙, 실측 확인).",
    "※ 신용비율은 해당 일의 신용잔고 비율(%)입니다. 외국인 보유비중 추이는 get_foreign_holding을 쓰세요.",
  );
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}행 중 최근 ${shown.length}행만 표시했습니다 (count로 조정).`);
  }
  if (truncated) {
    lines.push("※ 페이지 상한에 걸려 요청한 기간을 다 채우지 못했습니다 — 결과가 잘렸을 수 있습니다.");
  }
  return lines.join("\n");
}

export function formatDailySession(
  rows: DailySessionItem[],
  stockCode: string,
  count: number,
  modeLabel: string,
): string {
  if (rows.length === 0) {
    return (
      `[${modeLabel}] 일별 거래 상세가 없습니다 (종목 ${stockCode}). ` +
      "종목코드와 기준일(base_date)을 확인해 주세요."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, count);

  const lines = [
    `[${modeLabel}] 일별 장전/장중/장후 거래 분포 — 종목 ${stockCode} (${shown.length}거래일)`,
    "",
    "| 일자 | 종가 | 등락률 | 거래량 | 거래대금(백만원) | 장전비중 | 장중비중 | 장후비중 | 장후거래량 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    const cells = [
      formatDateDashed(r.dt),
      formatKRW(parseKiwoomPrice(r.close_pric)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(n(r.trde_qty)),
      formatNumber(n(r.trde_prica), 0),
      // 비중 필드도 부호가 접두되지만(+98.91) 방향이 아니라 표기 습관이라 절대값으로 읽는다.
      formatRatioPercent(parseKiwoomPrice(r.bf_mkrt_trde_wght)),
      formatRatioPercent(parseKiwoomPrice(r.opmr_trde_wght)),
      formatRatioPercent(parseKiwoomPrice(r.af_mkrt_trde_wght)),
      formatQuantity(n(r.af_mkrt_trde_qty)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    "※ 최신 일자가 위입니다. 장전은 08:30~09:00(시간외 종가), 장후는 15:40 이후(시간외 종가·단일가) 체결분입니다.",
    "※ 장후비중이 평소보다 크면 종가 이후 물량이 몰렸다는 뜻입니다 — 그날의 시간외 호가는 get_after_hours로 봅니다.",
    "※ 이 TR(ka10015)의 체결강도·투자자별 순매수·프로그램·신용잔고율 컬럼은 키움이 모의·실전 " +
      "양쪽 모두 빈 값으로 주므로 표에서 제외했습니다. 그 지표는 view=flow(가격·수급)와 " +
      "get_execution_strength(체결강도)를 쓰세요.",
  );
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}행 중 최근 ${shown.length}행만 표시했습니다 (count로 조정).`);
  }
  return lines.join("\n");
}

export function registerDailyTradingTool(server: McpServer): void {
  server.registerTool(
    "get_daily_trading",
    {
      title: "일별 거래·수급 상세 조회",
      description:
        "종목의 일자별 거래를 한 번의 호출로 조회합니다 (키움 ka10086/ka10015). " +
        "view=flow(기본)는 종가·등락률·거래량·거래대금과 함께 개인/기관/외국인 순매수, 프로그램, " +
        "신용비율을 한 행에 묶어 줍니다 — '이 종목을 최근 누가 사고팔았나'를 볼 때 첫 번째로 쓰는 tool입니다. " +
        "view=session은 같은 일자별로 장전/장중/장후 거래 분포를 보여줍니다. " +
        "가격 캔들만 필요하면 get_stock_chart, 투자자 주체를 증권·투신·연기금까지 세분해 보려면 " +
        "get_investor_trend, 외국인 보유비중 추이는 get_foreign_holding을 쓰세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .describe("6자리 종목코드"),
        view: z
          .enum(["flow", "session"])
          .optional()
          .describe("flow 가격+투자자 수급(기본) / session 장전·장중·장후 거래 분포"),
        unit: z
          .enum(["amount", "quantity"])
          .optional()
          .describe("view=flow의 순매수 단위 (기본값: quantity=주). 외국인 열은 항상 주"),
        base_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 기준일 — 이 날짜부터 과거로 조회 (기본값: 오늘)"),
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_COUNT)
          .optional()
          .describe(`표시할 거래일 수 (기본값 ${DEFAULT_COUNT}, 최대 ${MAX_COUNT})`),
      },
    },
    async ({ stock_code, view, unit, base_date, count }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const v: DailyTradingView = view ?? "flow";
        const rowCount = count ?? DEFAULT_COUNT;
        const baseDate = (base_date ?? todayInKst()).replaceAll("-", "");

        if (v === "session") {
          const rows = await fetchDailySession(client, code, baseDate);
          return textResult(formatDailySession(rows, code, rowCount, config.modeLabel));
        }

        const u: InvestorUnit = unit ?? "quantity";
        const { rows, truncated } = await fetchDailyFlow(client, code, baseDate, u, rowCount);
        return textResult(formatDailyFlow(rows, code, u, rowCount, truncated, config.modeLabel));
      }),
  );
}
