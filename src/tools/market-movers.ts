import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchLimitStocks,
  fetchNewHighLow,
  fetchPriceJumps,
  fetchVolumeRenew,
  fetchVolumeSurge,
  type RankingMarket,
  type VolumeRenewCycle,
} from "../kiwoom/api.js";
import type {
  LimitStockItem,
  NewHighLowItem,
  PriceJumpItem,
  VolumeRenewItem,
  VolumeSurgeItem,
} from "../kiwoom/types.js";
import {
  formatNumber,
  formatPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;
const DEFAULT_DAYS = "5";
const DAYS_VALUES = ["5", "10", "20", "60", "250"] as const;
const DEFAULT_CYCLE: VolumeRenewCycle = "20";
const CYCLE_VALUES = ["5", "10", "20", "60", "120"] as const;

const SIGNAL_LABELS = {
  new_high: "신고가",
  new_low: "신저가",
  upper_limit: "상한가",
  lower_limit: "하한가",
  surge: "급등",
  plunge: "급락",
  volume_surge: "거래량급증",
  volume_renew: "거래량갱신",
} as const;
export type MoverSignal = keyof typeof SIGNAL_LABELS;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

function commonCells(
  rank: number,
  item: { stk_nm: string; stk_cd: string; cur_prc: string; flu_rt: string },
): string[] {
  return [
    String(rank),
    item.stk_nm,
    item.stk_cd,
    formatNumber(parseKiwoomPrice(item.cur_prc)),
    formatPercent(parseKiwoomNumber(item.flu_rt)),
  ];
}

/**
 * ka10024는 순위가 아니라 종목코드 순으로 오므로 서버가 정렬한다. 기준을 **증가량**
 * (당일 − 직전 N일 최대)으로 잡은 건 ka10023에서 급증률 정렬이 `prev 11주 → +49709%`
 * 같은 미세 모수 행을 위로 올린 전례가 있어서다 — 배수는 컬럼으로만 보여준다.
 */
function renewGain(item: VolumeRenewItem): number {
  return (parseKiwoomNumber(item.now_trde_qty) ?? 0) - (parseKiwoomNumber(item.prev_trde_qty) ?? 0);
}

export function formatMarketMovers(
  signal: MoverSignal,
  market: RankingMarket,
  items: Array<NewHighLowItem | LimitStockItem | PriceJumpItem | VolumeSurgeItem | VolumeRenewItem>,
  top: number,
  modeLabel: string,
  days?: string,
  options?: { cycle?: VolumeRenewCycle; truncated?: boolean },
): string {
  const sorted =
    signal === "volume_renew"
      ? [...(items as VolumeRenewItem[])].sort((a, b) => renewGain(b) - renewGain(a))
      : items;
  const shown = sorted.slice(0, top);
  const daysSuffix =
    signal === "new_high" || signal === "new_low"
      ? ` (${days ?? DEFAULT_DAYS}일 기준)`
      : signal === "volume_renew"
        ? ` (직전 ${options?.cycle ?? DEFAULT_CYCLE}거래일 대비)`
        : "";
  const title = `${MARKET_LABELS[market]} ${SIGNAL_LABELS[signal]} 종목${daysSuffix}`;
  if (shown.length === 0) {
    return `[${modeLabel}] ${title} — 해당 종목이 없습니다.`;
  }

  const lines = [`[${modeLabel}] ${title} (${shown.length}종목)`, ""];
  if (signal === "new_high" || signal === "new_low") {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 | 기간고가 | 기간저가 |",
      "|---:|---|---|---:|---:|---:|---:|---:|",
    );
    (shown as NewHighLowItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatNumber(parseKiwoomNumber(item.trde_qty)),
          formatNumber(parseKiwoomPrice(item.high_pric)),
          formatNumber(parseKiwoomPrice(item.low_pric)),
        ]),
      );
    });
  } else if (signal === "upper_limit" || signal === "lower_limit") {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 거래량 | 연속 |",
      "|---:|---|---|---:|---:|---:|---:|",
    );
    (shown as LimitStockItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatNumber(parseKiwoomNumber(item.trde_qty)),
          `${parseKiwoomNumber(item.cnt) ?? "-"}회`,
        ]),
      );
    });
  } else if (signal === "volume_renew") {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 직전최대 거래량 | 당일 거래량 | 증가량 | 배수 |",
      "|---:|---|---|---:|---:|---:|---:|---:|---:|",
    );
    (shown as VolumeRenewItem[]).forEach((item, i) => {
      const prev = parseKiwoomNumber(item.prev_trde_qty);
      const now = parseKiwoomNumber(item.now_trde_qty);
      // 직전 최대가 0인 신규·재개 종목이 실제로 온다 — 배수는 계산하지 않고 "-"로 둔다.
      const multiple = prev !== null && prev > 0 && now !== null ? `${formatNumber(now / prev)}배` : "-";
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatNumber(prev),
          formatNumber(now),
          formatSigned(renewGain(item)),
          multiple,
        ]),
      );
    });
  } else if (signal === "volume_surge") {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 현재거래량 | 급증량 | 급증률(전일 대비) |",
      "|---:|---|---|---:|---:|---:|---:|---:|",
    );
    (shown as VolumeSurgeItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatNumber(parseKiwoomNumber(item.now_trde_qty)),
          formatSigned(parseKiwoomNumber(item.sdnin_qty)),
          formatPercent(parseKiwoomNumber(item.sdnin_rt)),
        ]),
      );
    });
  } else {
    lines.push(
      "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 급등락률(기준가 대비) | 거래량 |",
      "|---:|---|---|---:|---:|---:|---:|",
    );
    (shown as PriceJumpItem[]).forEach((item, i) => {
      lines.push(
        row([
          ...commonCells(i + 1, item),
          formatPercent(parseKiwoomNumber(item.jmp_rt)),
          formatNumber(parseKiwoomNumber(item.trde_qty)),
        ]),
      );
    });
  }
  if (signal === "volume_renew") {
    lines.push(
      "",
      `※ 직전 ${options?.cycle ?? DEFAULT_CYCLE}거래일 중 최대 거래량을 오늘 넘어선 종목입니다. ` +
        "전일 하루와만 비교하는 volume_surge(거래량급증)와는 기준이 다릅니다 — " +
        "정렬은 증가량(당일 − 직전최대) 순입니다.",
    );
  }
  if (options?.truncated) {
    lines.push("", "⚠️ 페이지 상한에 걸려 결과가 잘렸을 수 있습니다 — 조회 범위를 좁혀 주세요.");
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerMarketMoversTool(server: McpServer): void {
  server.registerTool(
    "get_market_movers",
    {
      title: "시장 특이 종목 조회",
      description:
        "시장 특이 종목을 조회합니다 (키움 ka10016/ka10017/ka10019/ka10023/ka10024). signal: " +
        "new_high(신고가)/new_low(신저가)/upper_limit(상한가)/lower_limit(하한가)/" +
        "surge(급등)/plunge(급락)/volume_surge(거래량급증)/volume_renew(거래량갱신). " +
        "market: all(전체, 기본)/kospi/kosdaq. " +
        "신고/신저는 days(5/10/20/60/250일, 기본 5일) 기준, 급등/급락과 거래량급증은 전일 대비입니다 " +
        "(거래량급증은 급증량 순, 5천주 이상). " +
        "volume_renew는 **직전 cycle거래일(5/10/20/60/120, 기본 20) 중 최대 거래량을 오늘 갱신한** " +
        "종목으로, 전일 하루만 보는 volume_surge보다 긴 호흡의 거래량 돌파를 찾을 때 씁니다.",
      inputSchema: {
        signal: z
          .enum([
            "new_high",
            "new_low",
            "upper_limit",
            "lower_limit",
            "surge",
            "plunge",
            "volume_surge",
            "volume_renew",
          ])
          .describe("특이 신호 종류"),
        market: z.enum(["all", "kospi", "kosdaq"]).optional().describe("시장 구분 (기본값: all)"),
        days: z
          .enum(DAYS_VALUES)
          .optional()
          .describe(`신고/신저 기준 기간(일) — new_high/new_low에서만 사용 (기본값 ${DEFAULT_DAYS})`),
        cycle: z
          .enum(CYCLE_VALUES)
          .optional()
          .describe(`거래량갱신 비교 기간(거래일) — volume_renew에서만 사용 (기본값 ${DEFAULT_CYCLE})`),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ signal, market, days, cycle, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: RankingMarket = market ?? "all";
        const count = top ?? DEFAULT_TOP;
        const d = days ?? DEFAULT_DAYS;
        const c = cycle ?? DEFAULT_CYCLE;

        if (signal === "volume_renew") {
          const { rows, truncated } = await fetchVolumeRenew(client, m, c);
          return textResult(
            formatMarketMovers(signal, m, rows, count, config.modeLabel, d, { cycle: c, truncated }),
          );
        }

        const items =
          signal === "new_high" || signal === "new_low"
            ? await fetchNewHighLow(client, m, signal === "new_high" ? "high" : "low", d)
            : signal === "upper_limit" || signal === "lower_limit"
              ? await fetchLimitStocks(client, m, signal === "upper_limit" ? "upper" : "lower")
              : signal === "volume_surge"
                ? await fetchVolumeSurge(client, m)
                : await fetchPriceJumps(client, m, signal);

        return textResult(formatMarketMovers(signal, m, items, count, config.modeLabel, d));
      }),
  );
}
