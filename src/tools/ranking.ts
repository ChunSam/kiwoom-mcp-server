import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchCreditRatioRank,
  fetchOpenPriceChange,
  fetchPriceChangeRanking,
  fetchValueRanking,
  fetchVolumeRanking,
  type NetBuyMarket,
  type OpenChangeMinVolume,
  type RankingMarket,
} from "../kiwoom/api.js";
import type {
  CreditRatioRankItem,
  OpenPriceChangeItem,
  PriceChangeRankItem,
  ValueRankItem,
  VolumeRankItem,
} from "../kiwoom/types.js";
import { formatNumber, formatPercent, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;
const DEFAULT_MIN_VOLUME: OpenChangeMinVolume = "0010";
const MIN_VOLUME_VALUES = ["0010", "0050", "0100", "0500"] as const;
/** 코드값 × 1,000주가 하한이다 (실측 "0100" → 최소 100,929주). */
const MIN_VOLUME_LABELS: Record<OpenChangeMinVolume, string> = {
  "0010": "1만주",
  "0050": "5만주",
  "0100": "10만주",
  "0500": "50만주",
};

const KIND_LABELS = {
  rise: "상승률 상위",
  fall: "하락률 상위",
  volume: "거래량 상위",
  value: "거래대금 상위",
  open_rise: "시가대비 상승률 상위",
  open_fall: "시가대비 하락률 상위",
  credit_ratio: "신용비율 상위",
} as const;
export type RankingKind = keyof typeof KIND_LABELS;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

interface CommonRankRow {
  stk_cd: string;
  stk_nm: string;
  cur_prc: string;
  flu_rt: string;
}

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

function commonCells(rank: number, item: CommonRankRow): string[] {
  return [
    String(rank),
    item.stk_nm,
    item.stk_cd,
    formatNumber(parseKiwoomPrice(item.cur_prc)),
    formatPercent(parseKiwoomNumber(item.flu_rt)),
  ];
}

/**
 * ka10028은 순위가 아니라 종목코드 순으로 오고 `sort_tp`가 무효라 서버가 정렬한다.
 * 시가대비 등락률이 빈 문자열인 행은 정렬 기준이 없어 뒤로 민다.
 */
function sortByOpenChange(items: OpenPriceChangeItem[], descending: boolean): OpenPriceChangeItem[] {
  return [...items].sort((a, b) => {
    const x = parseKiwoomNumber(a.open_pric_pre);
    const y = parseKiwoomNumber(b.open_pric_pre);
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    return descending ? y - x : x - y;
  });
}

export function formatRanking(
  kind: RankingKind,
  market: RankingMarket,
  items: Array<
    | PriceChangeRankItem
    | VolumeRankItem
    | ValueRankItem
    | OpenPriceChangeItem
    | CreditRatioRankItem
  >,
  top: number,
  modeLabel: string,
  options?: { minVolume?: OpenChangeMinVolume; truncated?: boolean },
): string {
  const isOpenChange = kind === "open_rise" || kind === "open_fall";
  const ordered = isOpenChange
    ? sortByOpenChange(items as OpenPriceChangeItem[], kind === "open_rise")
    : items;
  const shown = ordered.slice(0, top);
  const filterSuffix = isOpenChange
    ? `, 거래량 ${MIN_VOLUME_LABELS[options?.minVolume ?? DEFAULT_MIN_VOLUME]} 이상`
    : "";
  if (shown.length === 0) {
    return `[${modeLabel}] ${MARKET_LABELS[market]} ${KIND_LABELS[kind]}${filterSuffix} 데이터가 없습니다.`;
  }

  const lines = [
    `[${modeLabel}] ${MARKET_LABELS[market]} ${KIND_LABELS[kind]}${filterSuffix} (상위 ${shown.length}종목)`,
    "",
  ];
  const withValue = kind === "volume" || kind === "value";
  const isCredit = kind === "credit_ratio";
  lines.push(
    isCredit
      ? "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 신용비율 | 거래량 | 매수잔량 | 매도잔량 |"
      : isOpenChange
      ? "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 시가 | 시가대비 | 거래량 | 체결강도 |"
      : withValue
        ? "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 | 거래대금(백만원) |"
        : "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 |",
    isCredit
      ? "|---:|---|---|---:|---:|---:|---:|---:|---:|"
      : isOpenChange
      ? "|---:|---|---|---:|---:|---:|---:|---:|---:|"
      : withValue
        ? "|---:|---|---|---:|---:|---:|---:|"
        : "|---:|---|---|---:|---:|---:|",
  );

  shown.forEach((item, i) => {
    const cells = commonCells(i + 1, item);
    if (isCredit) {
      const v = item as CreditRatioRankItem;
      cells.push(
        formatPercent(parseKiwoomNumber(v.crd_rt)),
        formatNumber(parseKiwoomNumber(v.now_trde_qty)),
        formatNumber(parseKiwoomNumber(v.buy_req)),
        formatNumber(parseKiwoomNumber(v.sel_req)),
      );
    } else if (isOpenChange) {
      const v = item as OpenPriceChangeItem;
      cells.push(
        formatNumber(parseKiwoomPrice(v.open_pric)),
        formatPercent(parseKiwoomNumber(v.open_pric_pre)),
        formatNumber(parseKiwoomNumber(v.now_trde_qty)),
        formatNumber(parseKiwoomNumber(v.cntr_str)),
      );
    } else if (kind === "volume") {
      const v = item as VolumeRankItem;
      cells.push(formatNumber(parseKiwoomNumber(v.trde_qty)), formatNumber(parseKiwoomNumber(v.trde_amt)));
    } else if (kind === "value") {
      const v = item as ValueRankItem;
      cells.push(formatNumber(parseKiwoomNumber(v.now_trde_qty)), formatNumber(parseKiwoomNumber(v.trde_prica)));
    } else {
      cells.push(formatNumber(parseKiwoomNumber((item as PriceChangeRankItem).now_trde_qty)));
    }
    lines.push(row(cells));
  });

  if (isOpenChange) {
    lines.push(
      "",
      "※ 시가대비 = (현재가 − 시가) / 시가. 전일 종가 기준인 등락률과 달리 **오늘 장이 열린 뒤의 " +
        "움직임**만 봅니다 — 갭 상승 후 밀린 종목은 등락률이 +인데 시가대비는 −입니다.",
      "※ 체결강도 = 매수 체결량 ÷ 매도 체결량 × 100 (100이 균형). 종목별 추이는 get_execution_strength.",
    );
  }
  if (isCredit) {
    lines.push(
      "",
      "※ 신용비율 = 신용융자 잔고 / 상장주식수. 높을수록 빚으로 산 물량이 많아 반대매매·" +
        "만기 청산 압력이 크다는 뜻이며, 그 자체로 방향 신호는 아닙니다.",
      "※ 종목별 신용잔고의 시계열 추이는 get_credit_trend를 쓰세요.",
    );
  }
  // ka10028은 종목코드 순 전량 스냅샷이고 정렬은 위 sortByOpenChange가 한다 — 상한에 걸리면
  // 잘리는 건 표의 꼬리가 아니라 **정렬 모수**다. "결과가 잘렸다"로 쓰면 상위권이 틀렸다는
  // 사실이 가려진다 (get_net_buy_rank와 같은 처방).
  if (options?.truncated) {
    lines.push(
      "",
      "⚠️ 페이지 상한에 걸려 **일부 종목이 빠졌습니다** — 이 TR은 종목코드 순으로 오기 때문에 " +
        "뒤쪽 코드가 순위에서 통째로 누락됐을 수 있습니다. 거래량 하한(min_volume)을 올려 모수를 좁히세요.",
    );
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerRankingTool(server: McpServer): void {
  server.registerTool(
    "get_ranking",
    {
      title: "시장 순위 조회",
      description:
        "당일 시장 순위를 조회합니다 (키움 ka10027/ka10030/ka10032/ka10028/ka10033). type: rise(상승률)/" +
        "fall(하락률)/volume(거래량)/value(거래대금)/open_rise(시가대비 상승률)/" +
        "open_fall(시가대비 하락률)/credit_ratio(신용비율). market: all(전체, 기본)/kospi/kosdaq. " +
        "rise·fall은 전일 종가 기준이고 open_rise·open_fall은 **오늘 시가 기준**이라, " +
        "갭으로 뜬 뒤 밀렸는지 장중에 밀어올렸는지를 가릅니다(체결강도 컬럼 포함). " +
        "시가대비 두 종류는 시장 전 종목을 훑어야 해서 market이 kospi 또는 kosdaq여야 하고, " +
        "min_volume(거래량 하한, 기본 1만주)으로 모수를 좁힙니다. " +
        "credit_ratio는 신용융자 잔고비율이 높은 종목으로, 반대매매 압력이 쌓인 곳을 찾을 때 씁니다 — " +
        "특정 종목의 신용잔고 시계열은 get_credit_trend를 쓰세요.",
      inputSchema: {
        type: z
          .enum(["rise", "fall", "volume", "value", "open_rise", "open_fall", "credit_ratio"])
          .describe("순위 종류"),
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 구분 (기본값: all — open_rise/open_fall은 all을 지원하지 않습니다)"),
        min_volume: z
          .enum(MIN_VOLUME_VALUES)
          .optional()
          .describe(
            "거래량 하한 — open_rise/open_fall/credit_ratio에서 사용. 0010=1만주(기본)/0050=5만주/" +
              "0100=10만주/0500=50만주",
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
    async ({ type, market, min_volume, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: RankingMarket = market ?? "all";
        const count = top ?? DEFAULT_TOP;

        if (type === "credit_ratio") {
          const rows = await fetchCreditRatioRank(client, m, min_volume ?? DEFAULT_MIN_VOLUME);
          return textResult(formatRanking(type, m, rows, count, config.modeLabel));
        }

        if (type === "open_rise" || type === "open_fall") {
          // ka10028은 전체 시장을 훑으면 30페이지에도 끝나지 않아 MAX_PAGES에 걸린다.
          // 행이 종목코드 순이라 잘린 결과를 정렬하면 뒤쪽 코드가 통째로 빠진다 (ka10066과 같은 제약).
          if (m === "all") {
            throw new Error(
              "시가대비 순위는 시장 전 종목을 훑어야 해서 전체 조회를 지원하지 않습니다 — " +
                "market을 kospi 또는 kosdaq으로 지정하세요.",
            );
          }
          const minVolume: OpenChangeMinVolume = min_volume ?? DEFAULT_MIN_VOLUME;
          const { rows, truncated } = await fetchOpenPriceChange(client, m as NetBuyMarket, minVolume);
          return textResult(
            formatRanking(type, m, rows, count, config.modeLabel, { minVolume, truncated }),
          );
        }

        const items =
          type === "volume"
            ? await fetchVolumeRanking(client, m)
            : type === "value"
              ? await fetchValueRanking(client, m)
              : await fetchPriceChangeRanking(client, m, type);

        return textResult(formatRanking(type, m, items, count, config.modeLabel));
      }),
  );
}
