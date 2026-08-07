import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchSupplyConcentration, type SupplyMarket } from "../kiwoom/api.js";
import type { SupplyConcentrationItem } from "../kiwoom/types.js";
import {
  formatKRW,
  formatPercent,
  formatQuantity,
  formatRatioPercent,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;
const DEFAULT_MIN_RATIO = 50;
/** 20 미만은 키움이 빈 결과를 준다 (실측: "0"·"10" 모두 0행) — 입력 단계에서 막는다. */
const MIN_RATIO_FLOOR = 20;
const DEFAULT_ZONE_COUNT = 10;
const DEFAULT_PERIOD_DAYS = 50;

const MARKET_LABELS: Record<SupplyMarket, string> = { all: "전체", kospi: "코스피", kosdaq: "코스닥" };

export function formatSupplyConcentration(
  rows: SupplyConcentrationItem[],
  market: SupplyMarket,
  minRatio: number,
  periodDays: number,
  currentPriceOnly: boolean,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const scope = `${MARKET_LABELS[market]} · 최근 ${periodDays}일 · 매물비율 ${minRatio}% 이상${
    currentPriceOnly ? " · 현재가 진입" : ""
  }`;

  if (rows.length === 0) {
    return (
      `[${modeLabel}] 매물대집중 종목이 없습니다 (${scope}). ` +
      "매물비율 기준을 낮추거나(min_ratio) 기간을 늘려 보세요 — 조건이 빡빡하면 정상적으로 빈 결과가 옵니다."
    );
  }

  const n = parseKiwoomNumber;
  // 키움 응답은 매물비율 순이 아니다 — 집중도가 높은 순으로 세워야 스크리닝이 된다.
  const sorted = [...rows].sort((a, b) => (n(b.prps_rt) ?? 0) - (n(a.prps_rt) ?? 0));
  const shown = sorted.slice(0, top);

  const lines = [
    `[${modeLabel}] 매물대집중 종목 (${scope}) — ${rows.length}건 중 상위 ${shown.length}건`,
    "",
    "| 순위 | 종목명 | 코드 | 매물비율 | 매물대 구간 | 매물량 | 현재가 | 등락률 | 거래량 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((r, index) => {
    const start = parseKiwoomPrice(r.pric_strt);
    const end = parseKiwoomPrice(r.pric_end);
    const cells = [
      String(index + 1),
      r.stk_nm || "-",
      r.stk_cd,
      formatRatioPercent(n(r.prps_rt)),
      `${formatKRW(start)} ~ ${formatKRW(end)}`,
      formatQuantity(n(r.prps_qty)),
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(n(r.now_trde_qty)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    `※ 매물대는 최근 ${periodDays}일 거래를 가격 구간으로 나눴을 때 거래가 몰린 구간입니다. ` +
      "매물비율은 그 구간이 전체 거래에서 차지한 비중이라, 높을수록 특정 가격대에 물량이 뭉쳐 있다는 뜻입니다.",
    "※ 위쪽 매물대는 반등 시 저항, 아래쪽 매물대는 하락 시 지지로 읽는 것이 통상적인 해석입니다 — " +
      "현재가와 구간을 함께 보세요.",
    "※ 행 단위는 종목이 아니라 **종목 × 매물대 구간**입니다 — 한 종목이 서로 다른 가격대로 두 번 이상 나올 수 있습니다.",
    "※ 키움 응답은 매물비율 순이 아니어서 **서버가 매물비율 내림차순으로 정렬**했습니다.",
  );
  if (currentPriceOnly) {
    lines.push("※ current_price_only=true라 현재가가 매물대 구간에 들어온 종목만 남겼습니다.");
  }
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}건 중 상위 ${shown.length}건만 표시했습니다 (top으로 조정).`);
  }
  // ka10025는 `prps_rt` **오름차순**으로 온다 (REAL 실측 2026-08-07: 하한 20에서 3,042행
  // 16페이지가 20.00→100.00으로 단조 증가). 포맷터는 내림차순 상위 N을 보여주므로 상한에
  // 걸리면 **최고값이 있는 뒷페이지가 통째로 빠져** 표가 "상위"라면서 최하위를 보여준다 —
  // 다른 TR의 "일부 종목이 빠졌다"보다 나쁜 실패라 문구를 따로 쓴다.
  if (truncated) {
    lines.push(
      "⚠️ 페이지 상한에 걸려 **이 순위를 믿을 수 없습니다** — 이 TR은 매물비율 **오름차순**으로 " +
        "오기 때문에 잘린 뒷부분에 더 높은 비율의 종목이 남아 있습니다. min_ratio를 올려 " +
        "모수를 좁힌 뒤 다시 조회하세요.",
    );
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerSupplyConcentrationTool(server: McpServer): void {
  server.registerTool(
    "get_supply_concentration",
    {
      title: "매물대집중 종목 조회 (시장 전체)",
      description:
        "최근 N일 거래가 특정 가격대(매물대)에 몰린 종목을 조회합니다 (키움 ka10025). " +
        "매물대는 반등 시 저항·하락 시 지지로 읽히므로, 현재가 위아래 어디에 물량이 뭉쳐 있는지 " +
        "확인할 때 씁니다. 특정 종목 하나의 호가 잔량은 get_orderbook, 거래량 급증 종목은 " +
        "get_market_movers를 쓰세요 — 가격대별 거래 분포를 보는 것은 이 tool뿐입니다.",
      inputSchema: {
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 구분 (기본값: all=전체)"),
        min_ratio: z
          .number()
          .int()
          .min(MIN_RATIO_FLOOR)
          .max(100)
          .optional()
          .describe(
            `매물비율 하한(%) (기본값 ${DEFAULT_MIN_RATIO}, 최소 ${MIN_RATIO_FLOOR}). ` +
              "높일수록 한 가격대에 더 심하게 뭉친 종목만 남습니다",
          ),
        period_days: z
          .number()
          .int()
          .min(5)
          .max(250)
          .optional()
          .describe(`매물대를 집계할 기간(일) (기본값 ${DEFAULT_PERIOD_DAYS})`),
        zone_count: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe(`기간을 몇 개의 가격 구간으로 나눌지 (기본값 ${DEFAULT_ZONE_COUNT})`),
        current_price_only: z
          .boolean()
          .optional()
          .describe("true면 현재가가 매물대 구간 안에 들어온 종목만 (기본값: false)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 건수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP}; 매물비율 높은 순)`),
      },
    },
    async ({ market, min_ratio, period_days, zone_count, current_price_only, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: SupplyMarket = market ?? "all";
        const ratio = min_ratio ?? DEFAULT_MIN_RATIO;
        const days = period_days ?? DEFAULT_PERIOD_DAYS;
        const zones = zone_count ?? DEFAULT_ZONE_COUNT;
        const entryOnly = current_price_only ?? false;

        const { rows, truncated } = await fetchSupplyConcentration(client, m, ratio, zones, days, entryOnly);
        return textResult(
          formatSupplyConcentration(
            rows,
            m,
            ratio,
            days,
            entryOnly,
            top ?? DEFAULT_TOP,
            truncated,
            config.modeLabel,
          ),
        );
      }),
  );
}
