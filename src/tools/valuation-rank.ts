import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchValuationRank, type ValuationMetric } from "../kiwoom/api.js";
import type { ValuationRankItem } from "../kiwoom/types.js";
import {
  formatKRW,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatSignedKRW,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 100;

const METRIC_LABELS: Record<ValuationMetric, string> = {
  low_per: "저PER",
  high_per: "고PER",
  low_pbr: "저PBR",
  high_pbr: "고PBR",
  low_roe: "저ROE",
  high_roe: "고ROE",
};

/** 표의 값 컬럼 머리글 — 응답 필드는 항상 `per`지만 실제 지표는 metric이 정한다. */
const METRIC_COLUMNS: Record<ValuationMetric, string> = {
  low_per: "PER(배)",
  high_per: "PER(배)",
  low_pbr: "PBR(배)",
  high_pbr: "PBR(배)",
  low_roe: "ROE(%)",
  high_roe: "ROE(%)",
};

const METRIC_NOTES: Record<ValuationMetric, string> = {
  low_per:
    "PER = 주가/주당순이익. 낮을수록 이익 대비 주가가 싸다는 뜻이지만, 일회성 이익이나 " +
    "쇠퇴 업종 때문에 낮은 경우도 많습니다 (가치함정).",
  high_per:
    "PER = 주가/주당순이익. 높을수록 미래 이익에 대한 기대가 크다는 뜻이며, 적자 기업은 " +
    "PER 자체가 산출되지 않아 이 순위에 오르지 않습니다.",
  low_pbr:
    "PBR = 주가/주당순자산. 1배 미만이면 장부상 순자산보다 시가총액이 작다는 뜻입니다 — " +
    "자산가치주 스크리닝의 출발점이지만 자산의 질은 따로 봐야 합니다.",
  high_pbr:
    "PBR = 주가/주당순자산. 자본이 잠식됐거나 매우 얇은 기업은 분모가 작아 PBR이 극단적으로 " +
    "커집니다 — 성장 기대와 자본잠식이 같은 순위에 섞여 있을 수 있습니다.",
  low_roe:
    "ROE = 순이익/자기자본. **음수가 정상적으로 옵니다** (적자). 값이 클수록 손실 폭이 " +
    "자기자본 대비 크다는 뜻이라, 이 순위는 부실 스크리닝에 가깝습니다.",
  high_roe:
    "ROE = 순이익/자기자본. 높을수록 자본을 효율적으로 굴린다는 뜻이지만, 자기자본이 " +
    "잠식에 가까우면 분모가 작아 비정상적으로 큰 값이 나옵니다.",
};

export function formatValuationRank(
  rows: ValuationRankItem[],
  metric: ValuationMetric,
  top: number,
  modeLabel: string,
): string {
  const label = METRIC_LABELS[metric];

  if (rows.length === 0) {
    return (
      `[${modeLabel}] ${label} 순위 결과가 없습니다. ` +
      "지표 산출에 필요한 재무 데이터가 갱신되는 중이면 일시적으로 비어 있을 수 있습니다."
    );
  }

  const n = parseKiwoomNumber;
  const shown = rows.slice(0, top);
  const isRoe = metric === "low_roe" || metric === "high_roe";
  const value = (raw: string): string => (isRoe ? formatPercent(n(raw)) : formatNumber(n(raw)));

  const lines = [
    `[${modeLabel}] ${label} 상위 ${shown.length}종목`,
    "",
    `| 순위 | 종목명 | 코드 | ${METRIC_COLUMNS[metric]} | 현재가 | 전일대비 | 등락률 | 거래량 |`,
    "|---:|---|---|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((r, index) => {
    const cells = [
      String(index + 1),
      r.stk_nm || "-",
      r.stk_cd,
      value(r.per),
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatSignedKRW(n(r.pred_pre)),
      formatPercent(n(r.flu_rt)),
      formatQuantity(n(r.now_trde_qty)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    `※ ${METRIC_NOTES[metric]}`,
    "※ 지표는 키움이 산출한 값으로, 재무제표 공시 시점에 갱신됩니다 — 최근 실적 변화가 즉시 반영되지는 않습니다.",
    "※ 시장 전체(코스피+코스닥) 대상이며 상위 100종목까지만 제공됩니다. " +
      "특정 종목 하나의 PER·PBR·ROE는 get_stock_price로 확인하세요.",
    UNIFIED_EXCHANGE_NOTE,
  );
  if (rows.length > shown.length) {
    lines.push(`※ 조회된 ${rows.length}종목 중 상위 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  return lines.join("\n");
}

export function registerValuationRankTool(server: McpServer): void {
  server.registerTool(
    "get_valuation_rank",
    {
      title: "PER·PBR·ROE 순위 조회 (시장 전체)",
      description:
        "시장 전체를 PER·PBR·ROE로 줄 세운 상위 100종목을 조회합니다 (키움 ka10026). " +
        "저PER·저PBR은 가치주 스크리닝, 고ROE는 자본효율이 높은 기업 찾기, 고PBR·저ROE는 " +
        "과열·부실 점검에 씁니다. 거래량·등락률 기준 순위는 get_ranking, 특정 종목 하나의 " +
        "PER·PBR은 get_stock_price를 쓰세요 — 밸류에이션으로 시장을 훑는 것은 이 tool뿐입니다.",
      inputSchema: {
        metric: z
          .enum(["low_per", "high_per", "low_pbr", "high_pbr", "low_roe", "high_roe"])
          .optional()
          .describe(
            "정렬 기준 (기본값: low_per). low_per 저PER / high_per 고PER / low_pbr 저PBR / " +
              "high_pbr 고PBR / low_roe 저ROE(적자 상위) / high_roe 고ROE",
          ),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ metric, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: ValuationMetric = metric ?? "low_per";

        const rows = await fetchValuationRank(client, m);
        return textResult(formatValuationRank(rows, m, top ?? DEFAULT_TOP, config.modeLabel));
      }),
  );
}
