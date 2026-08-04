import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchEqualNetTradeRank, type RankingMarket } from "../kiwoom/api.js";
import type { EqualNetTradeRankItem } from "../kiwoom/types.js";
import { formatDateDashed, kstDaysAgo, todayInKst } from "../utils/date.js";
import {
  formatKRW,
  formatNumber,
  formatPercent,
  formatSigned,
  isSaturatedInt,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;
const DEFAULT_LOOKBACK_DAYS = 7;

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

/**
 * `orgn_nettrde_avg_pric`의 포화값 — 효성중공업이 `-2147483`로 실측됐다.
 * `isSaturatedInt`가 아는 2³¹−1이 아니라 **그것을 1000으로 나눈 몫**(2147483647/1000)이라
 * 공용 유틸에 걸리지 않는다. 금액이 천원 단위로 환산돼 들어오는 자리이기 때문으로 보인다.
 * 공용 유틸을 넓히면 다른 tool의 정상 가격까지 삼킬 수 있어 여기서만 막는다.
 */
const AVG_PRICE_SATURATION = 2_147_483;

/**
 * 평균단가는 음수일 수 없다 — 부호가 붙어 오면 그 자체가 이상 신호다.
 * `parseKiwoomPrice`는 부호를 방향으로 보고 떼어 버리므로 여기서는 **부호를 보존하는**
 * `parseKiwoomNumber`로 읽어 0 이하와 포화값을 함께 걸러낸다.
 */
function avgPriceOrDash(raw: string): string {
  const value = parseKiwoomNumber(raw);
  if (value === null) return "-";
  if (value <= 0 || Math.abs(value) === AVG_PRICE_SATURATION || isSaturatedInt(Math.abs(value))) {
    return "산출 불가";
  }
  return formatKRW(value);
}

export function formatEqualNetTrade(
  rows: EqualNetTradeRankItem[],
  market: RankingMarket,
  startDate: string,
  direction: "net_buy" | "net_sell",
  sort: "amount" | "quantity",
  top: number,
  modeLabel: string,
): string {
  const dirLabel = direction === "net_buy" ? "동시 순매수" : "동시 순매도";
  const title = `기관·외국인 ${dirLabel} 상위 — ${MARKET_LABELS[market]} (${formatDateDashed(startDate)}~)`;
  if (rows.length === 0) {
    return (
      `[${modeLabel}] ${title}: 해당 종목이 없습니다.\n` +
      "※ 시작일이 너무 최근이면 두 주체가 함께 움직인 종목이 없을 수 있습니다 — 기간을 늘려 보세요."
    );
  }

  const shown = rows.slice(0, top);
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 기관(천주) | 기관 평단 | 외국인(천주) | 외국인 평단 | 합계(천주) | 합계(백만) |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((r, i) => {
    lines.push(
      row([
        r.rank || String(i + 1),
        r.stk_nm,
        r.stk_cd,
        formatKRW(parseKiwoomPrice(r.cur_prc)),
        formatPercent(n(r.flu_rt)),
        formatSigned(n(r.orgn_nettrde_qty), 0),
        avgPriceOrDash(r.orgn_nettrde_avg_pric),
        formatSigned(n(r.for_nettrde_qty), 0),
        avgPriceOrDash(r.for_nettrde_avg_pric),
        formatSigned(n(r.nettrde_qty), 0),
        formatSigned(n(r.nettrde_amt), 0),
      ]),
    );
  });
  lines.push(
    "",
    `※ 정렬 기준은 순매매 ${sort === "quantity" ? "**수량**" : "**금액**"}입니다. ` +
      "기관과 외국인이 **같은 방향으로 함께** 움직인 종목만 나옵니다.",
    "※ **한 행 안에서 단위가 갈립니다** — 순매매 수량은 **천주**, 금액은 **백만원**, " +
      "평균단가는 **원**입니다. 현재가와 평균단가를 비교하면 두 주체의 평가손익 방향을 볼 수 있습니다.",
    "※ 평균단가가 '산출 불가'인 종목은 키움이 32비트 상한으로 잘라 보낸 값입니다.",
    "※ 이 값은 투자자 매매 기준(get_investor_trend·get_net_buy_rank와 같은 계열)이며, " +
      "외국인 보유·한도 기준인 get_foreign_holding과는 소스가 다릅니다.",
    UNIFIED_EXCHANGE_NOTE,
  );
  return lines.join("\n");
}

export function registerEqualNetTradeTool(server: McpServer): void {
  server.registerTool(
    "get_equal_net_trade",
    {
      title: "기관·외국인 동시 순매매 조회",
      description:
        "기관과 외국인이 **같은 방향으로 동시에** 순매매한 종목 순위를 조회합니다 (키움 ka10062). " +
        "두 주체의 방향이 겹치는 종목과 **각각의 추정 평균단가**를 함께 주는 건 이 tool뿐입니다 — " +
        "현재가와 평단을 비교하면 누가 물려 있고 누가 이익 구간인지 볼 수 있습니다. " +
        "direction: net_buy(동시 순매수, 기본)/net_sell(동시 순매도). " +
        "주체별로 따로 보려면 get_net_buy_rank(마감 후 12주체)나 get_investor_trend(종목별)를 쓰세요.",
      inputSchema: {
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 구분 (기본값: all)"),
        start_date: z
          .string()
          .regex(/^\d{8}$/)
          .optional()
          .describe(`누적 시작일 yyyyMMdd (기본값: ${DEFAULT_LOOKBACK_DAYS}일 전)`),
        direction: z
          .enum(["net_buy", "net_sell"])
          .optional()
          .describe("net_buy(동시 순매수, 기본)/net_sell(동시 순매도)"),
        sort: z
          .enum(["amount", "quantity"])
          .optional()
          .describe("정렬 기준 — amount(순매매 금액, 기본)/quantity(순매매 수량)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ market, start_date, direction, sort, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const m: RankingMarket = market ?? "all";
        const start = start_date ?? kstDaysAgo(DEFAULT_LOOKBACK_DAYS);
        const dir = direction ?? "net_buy";
        const s = sort ?? "amount";

        if (start > todayInKst()) {
          throw new Error("start_date가 미래입니다 — 오늘 이전 날짜를 지정하세요.");
        }

        const rows = await fetchEqualNetTradeRank(client, m, start, dir, s);
        return textResult(
          formatEqualNetTrade(rows, m, start, dir, s, top ?? DEFAULT_TOP, config.modeLabel),
        );
      }),
  );
}
