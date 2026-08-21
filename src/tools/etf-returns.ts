import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  ETF_RETURN_PERIODS,
  fetchEtfDailyTrend,
  fetchEtfInfo,
  fetchEtfInvestorFlow,
  fetchEtfReturns,
} from "../kiwoom/api.js";
import type { EtfDailyTrendItem, EtfInvestorFlowItem, EtfReturnItem } from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import { formatNumber, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult } from "./helpers.js";
import { sectorLabel } from "./sector.js";

/** ka40001의 etfobjt_idex_cd는 필수 — 지정이 없으면 KOSPI200(201)을 기본 벤치마크로 쓴다. */
const DEFAULT_BENCHMARK = "201";

/**
 * 비ETF 가드 안내 (2026-07-10 GUI 테스트 발견 대응): ka40001은 일반 종목 코드에도
 * 수익률을 돌려주므로 ka40002로 선별한다 — 비ETF는 stk_nm은 있지만 추적지수명이
 * 빈값, 존재하지 않는 코드는 둘 다 빈값 (mock-probed 2026-07-10).
 * get_etf_info도 같은 판별자를 쓴다 — featurePhrase는 조사까지 포함한 목적어구.
 */
export function formatNonEtfNotice(
  stockName: string,
  stockCode: string,
  modeLabel: string,
  featurePhrase = "ETF 기간 수익률을",
): string {
  if (stockName) {
    return (
      `[${modeLabel}] ${stockName} (${stockCode})은(는) ETF가 아니어서 ${featurePhrase} 제공하지 않습니다. ` +
      `일반 종목 시세는 get_stock_price / get_stock_chart를 이용하세요.`
    );
  }
  return (
    `[${modeLabel}] ${stockCode}의 ETF 정보를 찾을 수 없습니다. ` +
    `ETF 종목코드인지 확인해 주세요 (search_stock으로 검색 가능).`
  );
}

export function formatEtfReturns(
  rows: (EtfReturnItem | null)[],
  etfName: string | null,
  stockCode: string,
  benchmarkCode: string,
  trackingIndexName: string | null,
  modeLabel: string,
): string {
  const n = parseKiwoomNumber;

  if (rows.every((r) => r === null || n(r.etfprft_rt) === null)) {
    return (
      `[${modeLabel}] ${stockCode}의 ETF 수익률 데이터가 없습니다. ` +
      `ETF 종목코드인지 확인해 주세요 (search_stock으로 검색 가능).`
    );
  }

  const title = etfName ? `${etfName} (${stockCode})` : stockCode;
  const lines = [
    `[${modeLabel}] ${title} ETF 기간 수익률`,
    "",
    "| 기간 | ETF 수익률 | 비교지수 수익률 | 외인 순매수량 | 기관 순매수량 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [i, period] of ETF_RETURN_PERIODS.entries()) {
    const row = rows[i] ?? null;
    lines.push(
      `| ${period.label} | ${formatPercent(n(row?.etfprft_rt))} | ${formatPercent(n(row?.cntr_prft_rt))} | ` +
        `${formatSigned(n(row?.for_netprps_qty), 0)} | ${formatSigned(n(row?.orgn_netprps_qty), 0)} |`,
    );
  }
  // 컬럼을 "대상지수"라 부르던 시절엔 이 값이 **그 ETF의 추적지수** 수익률로 읽혔다
  // (2026-08-21 라우팅 감사에서 세 모델이 전부 그 자리에 medium을 줬다). 실제로는
  // 요청한 etfobjt_idex_cd의 수익률이 그대로 오고 ETF와 대조되지 않는다 — 모의·실전
  // 양쪽 실측 2026-08-21: 133690(나스닥100 추종)의 1년 수익률 +24.72% 옆에 기본값
  // 201이 준 +156.13%가 앉는다 (probe_ka40001_benchmark.py).
  lines.push(
    "",
    `※ 비교지수: ${benchmarkCode} (${sectorLabel(benchmarkCode)})` +
      (trackingIndexName ? ` · 이 ETF의 추적지수: ${trackingIndexName}` : "") +
      `. 비교지수는 benchmark_index_code로 고른 지수일 뿐 **ETF의 추적지수와 자동으로 맞춰지지 않습니다** — ` +
      `키움 ka40001은 둘을 대조하지 않고 요청한 지수의 수익률을 그대로 채웁니다.`,
    `※ 지정할 수 있는 코드는 get_market_index의 '코드' 값(국내 지수)뿐이라 ` +
      `해외지수(나스닥100·S&P500 등)를 추종하는 ETF는 비교 지수를 맞출 수 없습니다 — ` +
      `그 ETF가 자기 지수를 얼마나 잘 따라갔는지는 view=daily의 추적오차율로 보세요.`,
  );
  return lines.join("\n");
}

const DEFAULT_DAYS = 20;
const MAX_DAYS = 30;

/**
 * ka40003의 `trace_eor_rt`는 **×100 정수**다 — 069500 "39" / 379800 "7" / 371460 "246"이
 * 같은 ETF·같은 날 ka40006의 `trace` "0.39" / "0.07" / "2.46"과 각각 맞는다(2026-08-09 실측).
 * 그대로 찍으면 추적오차율이 100배로 나간다. 괴리율 두 필드는 이미 소수로 오므로 손대지 않는다.
 */
function trackingError(raw: string): string {
  const value = parseKiwoomNumber(raw);
  return value === null ? "-" : formatNumber(value / 100, 2);
}

export function formatEtfDailyTrend(
  rows: EtfDailyTrendItem[],
  etfName: string | null,
  stockCode: string,
  days: number,
  modeLabel: string,
): string {
  const title = etfName ? `${etfName} (${stockCode})` : stockCode;
  const shown = rows.slice(0, days);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}의 ETF 일별 추이 데이터가 없습니다.`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} ETF 일별 NAV·괴리율 추이 (최근 ${shown.length}일)`,
    "",
    "| 일자 | 종가 | 등락률 | 거래량 | NAV | 지수 괴리율 | ETF 괴리율 | 추적오차율 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of shown) {
    const cells = [
      formatDateDashed(r.cntr_dt),
      // 종가·NAV의 +/-는 값의 부호가 아니라 전일대비 방향이다 → 절대값 파서
      formatNumber(parseKiwoomPrice(r.cur_prc)),
      formatPercent(n(r.pre_rt)),
      formatNumber(n(r.trde_qty)),
      formatNumber(parseKiwoomPrice(r.nav), 2),
      formatSigned(n(r.navidex_dispty_rt), 2),
      formatSigned(n(r.navetfdispty_rt), 2),
      trackingError(r.trace_eor_rt),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push(
    "",
    "※ 괴리율은 두 종류입니다 — '지수 괴리율'은 NAV가 추적지수에서 얼마나 벌어졌는지, " +
      "'ETF 괴리율'은 시장가가 NAV에서 얼마나 벌어졌는지입니다. 후자가 크면 비싸게/싸게 거래되는 중입니다.",
    "※ 괴리율·추적오차율 단위는 %입니다. 추적오차율은 지수를 얼마나 촘촘히 따라갔는지로, 낮을수록 좋습니다.",
  );
  return lines.join("\n");
}

export function formatEtfInvestorFlow(
  rows: EtfInvestorFlowItem[],
  etfName: string | null,
  stockCode: string,
  days: number,
  modeLabel: string,
): string {
  const title = etfName ? `${etfName} (${stockCode})` : stockCode;
  const shown = rows.slice(0, days);
  if (shown.length === 0) {
    return `[${modeLabel}] ${title}의 ETF 일자별 순매수 데이터가 없습니다.`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} ETF 일자별 외국인·기관 순매수 (최근 ${shown.length}일, 단위: 주)`,
    "",
    "| 일자 | 종가 | 누적거래량 | 외국인 순매수 | 기관 순매수 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const r of shown) {
    const cells = [
      formatDateDashed(r.dt),
      formatNumber(parseKiwoomPrice(r.cur_prc_n)),
      formatNumber(n(r.acc_trde_qty)),
      formatSigned(n(r.for_netprps_qty), 0),
      formatSigned(n(r.orgn_netprps_qty), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("", "※ 기간 단위(1주/1개월/6개월/1년) 합계로 보려면 view=period를 쓰세요.");
  return lines.join("\n");
}

export function registerEtfReturnsTool(server: McpServer): void {
  server.registerTool(
    "get_etf_returns",
    {
      title: "ETF 수익률·NAV 추이 조회",
      description:
        "ETF의 성과를 세 각도로 조회합니다 (키움 ka40001/ka40003/ka40008). " +
        "view=period(기본)는 기간별(1주/1개월/6개월/1년) 수익률을 **비교지수** 수익률과 나란히 보여줍니다 — " +
        "이 비교지수는 benchmark_index_code로 **직접 고르는 국내 지수**이고 " +
        `**ETF의 추적지수와 자동으로 맞춰지지 않습니다**(지정하지 않으면 ${DEFAULT_BENCHMARK} KOSPI200이 그대로 들어갑니다). ` +
        "코드는 get_market_index의 '코드' 값(001 코스피 종합, 101 코스닥 종합 등)이라 " +
        "**해외지수(나스닥100·S&P500 등)를 추종하는 ETF는 비교 지수를 맞출 수 없습니다** — " +
        "그때는 ETF 수익률만 읽고 지수 비교는 제공되지 않는다고 답하세요(추종 성과는 view=daily의 추적오차율). " +
        "view=daily는 일별 NAV와 괴리율·추적오차 추이입니다 — 'ETF가 제값에 거래되고 있나', " +
        "'지수를 잘 따라가고 있나'를 물을 때 씁니다(get_etf_info는 최신 1점만 보여줍니다). " +
        "view=investor는 일자별 외국인·기관 순매수량입니다(period는 기간 합계라 해상도가 다릅니다). " +
        "종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .describe("6자리 ETF 종목코드 (예: 069500)"),
        view: z
          .enum(["period", "daily", "investor"])
          .optional()
          .describe("조회 종류 (기본값: period)"),
        benchmark_index_code: z
          .string()
          .regex(/^\d{3}$/)
          .optional()
          .describe(
            `비교할 지수 코드 3자리 (기본값 ${DEFAULT_BENCHMARK} KOSPI200 — get_market_index의 '코드' 값). ` +
              `view=period 전용이며 ETF의 추적지수와 자동으로 맞춰지지 않습니다 — 국내 지수 코드만 받습니다`,
          ),
        days: z
          .number()
          .int()
          .min(1)
          .max(MAX_DAYS)
          .optional()
          .describe(`view=daily/investor의 표시 일수 (기본값 ${DEFAULT_DAYS}, 최대 ${MAX_DAYS})`),
      },
    },
    async ({ stock_code, view, benchmark_index_code, days }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code.toUpperCase();
        const benchmark = benchmark_index_code ?? DEFAULT_BENCHMARK;
        const cap = days ?? DEFAULT_DAYS;

        // Non-ETF guard BEFORE the real call — best-effort: a flaky ka40002
        // lookup must not block a real ETF, so only a successful blank-index
        // response refuses (and it also saves the 4 wasted ka40001 calls).
        // daily/investor에도 필요하다 — ka40003/ka40008은 비ETF 코드에 rc=0으로 답하고
        // NAV·괴리율만 0으로 채운 껍데기를 준다(2026-08-09 실측).
        const etf = await fetchEtfInfo(client, code).catch(() => null);
        if (etf && !etf.etfobjt_idex_nm) {
          const phrase = view === "daily" ? "ETF NAV 추이를" : view === "investor" ? "ETF 수급 추이를" : undefined;
          return textResult(formatNonEtfNotice(etf.stk_nm, code, config.modeLabel, phrase));
        }

        if (view === "daily") {
          const { items } = await fetchEtfDailyTrend(client, code);
          return textResult(formatEtfDailyTrend(items, etf?.stk_nm || null, code, cap, config.modeLabel));
        }
        if (view === "investor") {
          const { items } = await fetchEtfInvestorFlow(client, code);
          return textResult(formatEtfInvestorFlow(items, etf?.stk_nm || null, code, cap, config.modeLabel));
        }

        const rows = await fetchEtfReturns(client, code, benchmark);
        return textResult(
          formatEtfReturns(
            rows,
            etf?.stk_nm || null,
            code,
            benchmark,
            etf?.etfobjt_idex_nm || null,
            config.modeLabel,
          ),
        );
      }),
  );
}
