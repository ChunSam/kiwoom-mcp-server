import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchSectorNetBuy, type InvestorUnit, type SectorMarket } from "../kiwoom/api.js";
import type { SectorNetBuyItem } from "../kiwoom/types.js";
import { formatNumber, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 15;
/** 코스피 28행 / 코스닥 32행이 한 페이지에 다 온다 (실측) — 그게 곧 상한. */
const MAX_TOP = 40;

const MARKET_LABELS: Record<SectorMarket, string> = { kospi: "코스피", kosdaq: "코스닥" };

/** 금액은 백만원, 수량은 천주 — 같은 응답의 trde_qty가 천주인 데 맞춘 해석이다. */
const UNIT_LABELS: Record<InvestorUnit, string> = { amount: "백만원", quantity: "천주" };

/** ka10051은 지수·등락률을 ×100 정수로 준다 (ka20003과 교차검증). 등락률은 부호가 값의 부호다. */
const scaleRate = (raw: string): number | null => {
  const value = parseKiwoomNumber(raw);
  return value === null ? null : value / 100;
};

/**
 * 지수 값은 `parseKiwoomPrice`로 읽는다 — 키움은 `cur_prc`의 `-`를 값의 부호가 아니라
 * **전일대비 방향**으로 쓴다. `parseKiwoomNumber`로 읽으면 하락일 KOSPI 종합지수가
 * `-6,241.19`로 찍힌다 (2026-08-03 실측 행, tests/sector-flow.test.ts).
 */
const scaleIndex = (raw: string): number | null => {
  const value = parseKiwoomPrice(raw);
  return value === null ? null : value / 100;
};

export type SectorFlowSort = "foreign" | "institution" | "individual" | "change";

const SORT_LABELS: Record<SectorFlowSort, string> = {
  foreign: "외국인 순매수",
  institution: "기관 순매수",
  individual: "개인 순매수",
  change: "등락률",
};

const SORT_KEYS: Record<SectorFlowSort, (row: SectorNetBuyItem) => number> = {
  foreign: (r) => parseKiwoomNumber(r.frgnr_netprps) ?? 0,
  institution: (r) => parseKiwoomNumber(r.orgn_netprps) ?? 0,
  individual: (r) => parseKiwoomNumber(r.ind_netprps) ?? 0,
  change: (r) => scaleRate(r.flu_rt) ?? 0,
};

export function formatSectorFlow(
  rows: SectorNetBuyItem[],
  market: SectorMarket,
  unit: InvestorUnit,
  sort: SectorFlowSort,
  top: number,
  baseDate: string | null,
  modeLabel: string,
): string {
  const marketLabel = MARKET_LABELS[market];
  if (rows.length === 0) {
    return (
      `[${modeLabel}] ${marketLabel} 업종별 투자자 순매수 내역이 없습니다. ` +
      "기준일(base_date)이 휴장일인지 확인해 주세요."
    );
  }

  const n = parseKiwoomNumber;
  const unitLabel = UNIT_LABELS[unit];
  const shown = [...rows].sort((a, b) => SORT_KEYS[sort](b) - SORT_KEYS[sort](a)).slice(0, top);
  const dateLabel = baseDate ? `기준일 ${baseDate}` : "최근 거래일";

  const lines = [
    `[${modeLabel}] ${marketLabel} 업종별 투자자 순매수 — ${dateLabel} ` +
      `(${SORT_LABELS[sort]} 상위 ${shown.length}개 업종, 단위: ${unitLabel})`,
    "",
    "| 업종 | 코드 | 지수 | 등락률 | 개인 | 외국인 | 기관계 | 증권 | 투신 | 연기금 | 사모 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of shown) {
    const cells = [
      r.inds_nm || "-",
      r.inds_cd,
      formatNumber(scaleIndex(r.cur_prc)),
      formatPercent(scaleRate(r.flu_rt)),
      formatSigned(n(r.ind_netprps), 0),
      formatSigned(n(r.frgnr_netprps), 0),
      formatSigned(n(r.orgn_netprps), 0),
      formatSigned(n(r.sc_netprps), 0),
      formatSigned(n(r.invtrt_netprps), 0),
      formatSigned(n(r.endw_netprps), 0),
      formatSigned(n(r.samo_fund_netprps), 0),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    `※ ${SORT_LABELS[sort]} 내림차순입니다 (sort로 변경). 순매수는 양수면 순매수, 음수면 순매도입니다.`,
    "※ 기관계는 증권·보험·투신·은행·연기금·사모 등을 합친 값이고, 표에는 비중이 큰 넷만 펼쳤습니다.",
    "※ 단위는 키움 스펙에 명시돼 있지 않아 같은 응답의 거래량(천주, ka20003과 값 일치 확인)에 맞춰 " +
      "금액=백만원 / 수량=천주로 표기했습니다.",
    "※ 업종 하나를 깊게 보려면 get_sector_price(지수 상세)·get_sector_stocks(구성 종목)를, " +
      "종목 단위 수급은 get_investor_trend를 쓰세요.",
  );
  if (rows.length > shown.length) {
    lines.push(`※ 전체 ${rows.length}개 업종 중 ${shown.length}개만 표시했습니다 (top으로 조정).`);
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerSectorFlowTool(server: McpServer): void {
  server.registerTool(
    "get_sector_flow",
    {
      title: "업종별 투자자 순매수 조회",
      description:
        "시장 전체 업종의 투자자 주체별 순매수를 한 번에 조회합니다 (키움 ka10051). " +
        "'오늘 돈이 어느 섹터로 갔나'를 볼 때 쓰는 tool로, 업종마다 개인/외국인/기관계와 " +
        "증권·투신·연기금·사모 순매수를 지수 등락률과 함께 보여줍니다. " +
        "종목 단위 수급은 get_investor_trend, 종목별 순매수 상위는 get_investor_rank, " +
        "특정 업종의 지수 상세와 구성 종목은 get_sector_price / get_sector_stocks를 쓰세요.",
      inputSchema: {
        market: z.enum(["kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: kospi)"),
        unit: z
          .enum(["amount", "quantity"])
          .optional()
          .describe("순매수 단위 (기본값: amount=백만원, quantity=천주)"),
        sort: z
          .enum(["foreign", "institution", "individual", "change"])
          .optional()
          .describe("정렬 기준 (기본값: foreign=외국인 순매수 상위)"),
        base_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("조회 기준일 (기본값: 최근 거래일)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 업종 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ market, unit, sort, base_date, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: SectorMarket = market ?? "kospi";
        const u: InvestorUnit = unit ?? "amount";
        const s: SectorFlowSort = sort ?? "foreign";
        const baseDate = base_date?.replaceAll("-", "") ?? "";
        const rows = await fetchSectorNetBuy(client, m, u, baseDate);
        return textResult(
          formatSectorFlow(rows, m, u, s, top ?? DEFAULT_TOP, baseDate || null, config.modeLabel),
        );
      }),
  );
}
