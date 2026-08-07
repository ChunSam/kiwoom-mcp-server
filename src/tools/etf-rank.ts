import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchEtfAllPrices, type EtfTaxType } from "../kiwoom/api.js";
import type { EtfAllPriceItem } from "../kiwoom/types.js";
import {
  formatKRW,
  formatPercent,
  formatQuantity,
  formatRatioPercent,
  isSaturatedInt,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

export type EtfSort = "volume" | "premium" | "discount" | "gainers" | "losers" | "tracking_error";

const SORT_LABELS: Record<EtfSort, string> = {
  volume: "거래량 많은 순",
  premium: "괴리율 높은 순(고평가)",
  discount: "괴리율 낮은 순(저평가)",
  gainers: "등락률 높은 순",
  losers: "등락률 낮은 순",
  tracking_error: "추적오차율 높은 순",
};

const TAX_TYPE_LABELS: Record<EtfTaxType, string> = {
  all: "전체",
  tax_free: "비과세",
  holding_period: "보유기간과세",
  reit: "배당소득세(부동산)",
  overseas: "배당소득세(해외)",
};

/** 32비트 상한에서 잘린 값은 숫자로 찍지 않는다 — 자세한 근거는 isSaturatedInt. */
const qty = (value: number | null): string => (isSaturatedInt(value) ? "집계상한" : formatQuantity(value));

const SATURATION_NOTE =
  "※ `집계상한`은 키움이 32비트 정수 상한(4,294,967,295)에서 잘라 보낸 값입니다 — 실제 거래량은 그보다 큽니다.";

export interface EtfRankFilters {
  sort: EtfSort;
  taxType: EtfTaxType;
  manager?: string | undefined;
  indexName?: string | undefined;
  minVolume: number;
}

interface Scored {
  row: EtfAllPriceItem;
  close: number | null;
  nav: number | null;
  /** 괴리율(%) — 키움이 주지 않아 계산한다. NAV가 0 이하면 계산 불가라 null. */
  disparity: number | null;
  changeRate: number | null;
  volume: number | null;
  trackingError: number | null;
}

/**
 * ka40004는 괴리율을 주지 않는다. 종가와 NAV가 같은 단위(원)임은 ka10001 대조로
 * 확인했으므로 표준 정의대로 계산한다. 두 값 모두 부호가 **전일대비 방향**이라
 * 절대값으로 읽어야 한다 — 부호를 그대로 쓰면 하락 종목의 괴리율이 뒤집힌다.
 */
function score(row: EtfAllPriceItem): Scored {
  const close = parseKiwoomPrice(row.close_pric);
  const nav = parseKiwoomPrice(row.nav);
  const disparity = close !== null && nav !== null && nav > 0 ? ((close - nav) / nav) * 100 : null;
  return {
    row,
    close,
    nav,
    disparity,
    changeRate: parseKiwoomNumber(row.pre_rt),
    volume: parseKiwoomNumber(row.trde_qty),
    trackingError: parseKiwoomNumber(row.trace_eor_rt),
  };
}

/** 정렬 키가 없는 행(NAV 미제공 등)은 순위 싸움에서 빠지도록 항상 뒤로 보낸다. */
function compare(sort: EtfSort, a: Scored, b: Scored): number {
  const pick = (s: Scored): { value: number | null; desc: boolean } => {
    switch (sort) {
      case "volume":
        return { value: s.volume, desc: true };
      case "premium":
        return { value: s.disparity, desc: true };
      case "discount":
        return { value: s.disparity, desc: false };
      case "gainers":
        return { value: s.changeRate, desc: true };
      case "losers":
        return { value: s.changeRate, desc: false };
      case "tracking_error":
        return { value: s.trackingError, desc: true };
    }
  };
  const left = pick(a);
  const right = pick(b);
  if (left.value === null) return right.value === null ? 0 : 1;
  if (right.value === null) return -1;
  return left.desc ? right.value - left.value : left.value - right.value;
}

/** 종목명은 전 행 "브랜드 공백 이름" 꼴이라 첫 토큰이 운용사 브랜드다 (1155/1155행 실측). */
function brandOf(name: string): string {
  return name.split(" ")[0] ?? "";
}

export function formatEtfRank(
  rows: EtfAllPriceItem[],
  filters: EtfRankFilters,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const scopeParts = [SORT_LABELS[filters.sort]];
  if (filters.taxType !== "all") scopeParts.push(`과세유형 ${TAX_TYPE_LABELS[filters.taxType]}`);
  if (filters.manager) scopeParts.push(`운용사 "${filters.manager}"`);
  if (filters.indexName) scopeParts.push(`추적지수 "${filters.indexName}"`);
  if (filters.minVolume > 0) scopeParts.push(`거래량 ${formatQuantity(filters.minVolume)} 이상`);
  const scope = scopeParts.join(" · ");

  const manager = filters.manager?.toLowerCase();
  const indexName = filters.indexName?.toLowerCase();
  const matched = rows.filter((r) => {
    if (manager && !brandOf(r.stk_nm).toLowerCase().includes(manager)) return false;
    if (indexName && !r.trace_idex_nm.toLowerCase().includes(indexName)) return false;
    if (filters.minVolume > 0 && (parseKiwoomNumber(r.trde_qty) ?? 0) < filters.minVolume) return false;
    return true;
  });

  if (matched.length === 0) {
    const hint = manager
      ? "운용사는 종목명 앞의 브랜드로 거릅니다 — KODEX·TIGER·RISE·ACE·PLUS·SOL·KIWOOM·HANARO 등을 써 보세요."
      : indexName
        ? "추적지수명은 ETF 1,155종목 중 일부에만 채워져 있습니다 — 지수 이름 대신 운용사(manager)나 과세유형으로 좁혀 보세요."
        : "필터를 완화해 보세요 (min_volume을 낮추거나 tax_type을 all로).";
    return `[${modeLabel}] 조건에 맞는 ETF가 없습니다 (${scope}). ${hint}`;
  }

  const scored = matched.map(score).sort((a, b) => compare(filters.sort, a, b));
  const shown = scored.slice(0, top);

  const lines = [
    `[${modeLabel}] ETF 전체시세 (${scope}) — ${matched.length}종목 중 상위 ${shown.length}종목`,
    "",
    "| 순위 | 종목명 | 코드 | 종가 | 등락률 | 거래량 | NAV | 괴리율 | 추적오차 | 추적지수 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|---|",
  ];

  shown.forEach((s, index) => {
    const cells = [
      String(index + 1),
      s.row.stk_nm || "-",
      s.row.stk_cd,
      formatKRW(s.close),
      formatPercent(s.changeRate),
      qty(s.volume),
      formatKRW(s.nav),
      formatPercent(s.disparity),
      formatRatioPercent(s.trackingError),
      s.row.trace_idex_nm || "-",
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    "※ 괴리율 = (종가 − NAV) ÷ NAV × 100. 키움이 주지 않아 서버가 계산했습니다 — " +
      "양수면 순자산가치보다 비싸게(고평가), 음수면 싸게(저평가) 거래되고 있다는 뜻입니다.",
    "※ 추적오차율은 ETF가 추적지수를 얼마나 못 따라갔는지를 나타내는 별개 지표입니다 — 괴리율과 혼동하지 마세요.",
    "※ NAV·종가는 장 마감 후에는 당일 종가 기준입니다.",
  );
  if (shown.some((s) => (s.volume ?? 0) === 0)) {
    lines.push(
      "※ 거래량 0인 종목은 거래정지·상장폐지 절차 중일 수 있고, 이때 NAV가 종가와 크게 벌어져 " +
        "괴리율이 비정상적으로 큽니다 — min_volume으로 걸러 보세요.",
    );
  }
  if (shown.some((s) => isSaturatedInt(s.volume))) lines.push(SATURATION_NOTE);
  if (shown.some((s) => !s.row.trace_idex_nm)) {
    lines.push("※ 추적지수가 `-`인 종목은 키움이 지수명을 주지 않은 경우입니다 (전체의 약 3/4) — 종목이 없는 게 아닙니다.");
  }
  if (matched.length > shown.length) {
    lines.push(`※ 조건에 맞는 ${matched.length}종목 중 상위 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  // ka40004는 종목코드 순 전량 스냅샷이다 (REAL 실측 2026-08-07: 300행 중 역전 1곳,
  // 선두 153270만 예외이고 rows[1:]는 코드 오름차순). 정렬은 위 compare가 하므로 상한에
  // 걸리면 표의 꼬리가 아니라 정렬 모수에서 종목이 빠진다 — get_net_buy_rank와 같은 처방.
  if (truncated) {
    lines.push(
      "※ 페이지 상한에 걸려 **일부 종목이 빠졌습니다** — 이 TR은 종목코드 순으로 오기 때문에 " +
        "뒤쪽 코드가 순위에서 통째로 누락됐을 수 있습니다. tax_type으로 모수를 좁혀 보세요.",
    );
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerEtfRankTool(server: McpServer): void {
  server.registerTool(
    "get_etf_rank",
    {
      title: "ETF 전체시세 스크리너 (시장 전체)",
      description:
        "상장 ETF 전 종목(약 1,150개)을 한 번에 훑어 괴리율·등락률·거래량·추적오차로 정렬합니다 (키움 ka40004). " +
        "'NAV보다 비싸게 거래되는 ETF', '거래량 많은 ETF', '추적오차가 큰 ETF'처럼 " +
        "**종목을 아직 고르지 않은 상태에서 찾을 때** 쓰세요. " +
        "종목을 이미 정했다면 get_etf_info(추적지수·과세유형·NAV)나 get_etf_returns(기간 수익률)가 낫고, " +
        "ETF가 아닌 일반 주식 스크리닝은 get_valuation_rank·get_ranking을 쓰세요.",
      inputSchema: {
        sort: z
          .enum(["volume", "premium", "discount", "gainers", "losers", "tracking_error"])
          .optional()
          .describe(
            "정렬 기준 (기본값 volume). premium=괴리율 높은 순(고평가), discount=괴리율 낮은 순(저평가), " +
              "gainers/losers=등락률, tracking_error=추적오차율 큰 순",
          ),
        tax_type: z
          .enum(["all", "tax_free", "holding_period", "reit", "overseas"])
          .optional()
          .describe(
            "과세유형 필터 (기본값 all). tax_free=비과세(국내주식형), holding_period=보유기간과세, " +
              "reit=배당소득세(부동산), overseas=배당소득세(해외). 좁힐수록 조회도 빨라집니다",
          ),
        manager: z
          .string()
          .min(1)
          .optional()
          .describe('운용사 브랜드 (종목명 앞 접두어 부분일치, 예: "KODEX", "TIGER", "RISE", "ACE")'),
        index_name: z
          .string()
          .min(1)
          .optional()
          .describe('추적지수명 부분일치 (예: "KOSPI200", "S&P 500"). 지수명이 채워진 종목은 전체의 약 1/4입니다'),
        min_volume: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("최소 거래량(주) (기본값 0). 거래정지 종목의 극단적인 괴리율을 걸러낼 때 씁니다"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ sort, tax_type, manager, index_name, min_volume, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const taxType: EtfTaxType = tax_type ?? "all";
        const filters: EtfRankFilters = {
          sort: sort ?? "volume",
          taxType,
          manager: manager?.trim() || undefined,
          indexName: index_name?.trim() || undefined,
          minVolume: min_volume ?? 0,
        };

        const { rows, truncated } = await fetchEtfAllPrices(client, taxType);
        return textResult(formatEtfRank(rows, filters, top ?? DEFAULT_TOP, truncated, config.modeLabel));
      }),
  );
}
