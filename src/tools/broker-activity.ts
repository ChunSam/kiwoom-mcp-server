import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchBrokerActivity,
  fetchBrokerStockRank,
  fetchForeignBrokerRank,
  FOREIGN_BROKER_DAYS,
  type BrokerRankSide,
  type ForeignBrokerDays,
  type RankingMarket,
} from "../kiwoom/api.js";
import { brokerIndexByName, isForeignBroker, loadBrokerCodes } from "../kiwoom/broker-list.js";
import type {
  BrokerActivityResponse,
  BrokerCodeItem,
  BrokerStockRankItem,
  ForeignBrokerRankItem,
} from "../kiwoom/types.js";
import { formatKRW, formatNumber, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { KRX_ONLY_NOTE, runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 100;
const DEFAULT_BROKER_DAYS: ForeignBrokerDays = "1";

const MARKET_LABELS: Record<RankingMarket, string> = {
  all: "전체",
  kospi: "코스피",
  kosdaq: "코스닥",
};

const DIRECTION_LABELS = {
  net_buy: "순매수",
  net_sell: "순매도",
  all: "전체",
} as const;
export type BrokerRankDirection = keyof typeof DIRECTION_LABELS;

/** 외국계 창구 매매 상위 (ka10037) — ka10002의 시장 전체 판. */
export function formatForeignBrokerRank(
  rows: ForeignBrokerRankItem[],
  market: RankingMarket,
  days: ForeignBrokerDays,
  direction: BrokerRankDirection,
  sort: "amount" | "quantity",
  top: number,
  modeLabel: string,
): string {
  const periodLabel = days === "1" ? "당일" : `최근 ${days}일 누적`;
  const title = `외국계 창구 ${DIRECTION_LABELS[direction]} 상위 — ${MARKET_LABELS[market]} (${periodLabel})`;
  if (rows.length === 0) {
    return `[${modeLabel}] ${title}: 해당 종목이 없습니다.`;
  }

  const shown = rows.slice(0, top);
  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] ${title} (${shown.length}종목)`,
    "",
    "| 순위 | 종목명 | 코드 | 현재가 | 등락률 | 창구 매수 | 창구 매도 | 순매매 | 순매매액(백만) |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((r, i) => {
    // 매수/매도량의 부호는 방향 중복이라 절대값으로 표시한다 (ka10002와 같은 규약).
    const buy = parseKiwoomPrice(r.buy_trde_qty);
    const sell = parseKiwoomPrice(r.sel_trde_qty);
    lines.push(
      `| ${[
        r.rank || String(i + 1),
        r.stk_nm,
        r.stk_cd,
        formatKRW(parseKiwoomPrice(r.cur_prc)),
        formatPercent(n(r.flu_rt)),
        formatNumber(buy),
        formatNumber(sell),
        `${formatSigned(n(r.netprps_trde_qty), 0)}주`,
        formatSigned(n(r.netprps_prica), 0),
      ].join(" | ")} |`,
    );
  });
  lines.push(
    "",
    `※ 정렬 기준은 순매매 ${sort === "quantity" ? "**수량**" : "**금액**"}입니다.` +
      (direction === "all"
        ? " 방향 all은 순위가 아니라 **종목코드 순**이라 순매수·순매도가 섞여 있습니다."
        : ""),
    "※ **창구 기준**입니다 — 외국계 증권사 창구를 거친 거래일 뿐 투자자 국적이 아닙니다. " +
      "외국인 투자자의 순매수를 보려면 get_investor_trend / get_foreign_intraday를 쓰세요.",
    UNIFIED_EXCHANGE_NOTE,
  );
  return lines.join("\n");
}

export function formatBrokerActivity(
  data: BrokerActivityResponse,
  stockCode: string,
  modeLabel: string,
  brokerCodes?: BrokerCodeItem[],
): string {
  // (매수명, 매수량, 매도명, 매도량) 순위 1~5 — 이름이 전부 비면 데이터 없음.
  const slots: Array<[string, string, string, string]> = [
    [data.buy_trde_ori_nm_1, data.buy_trde_qty_1, data.sel_trde_ori_nm_1, data.sel_trde_qty_1],
    [data.buy_trde_ori_nm_2, data.buy_trde_qty_2, data.sel_trde_ori_nm_2, data.sel_trde_qty_2],
    [data.buy_trde_ori_nm_3, data.buy_trde_qty_3, data.sel_trde_ori_nm_3, data.sel_trde_qty_3],
    [data.buy_trde_ori_nm_4, data.buy_trde_qty_4, data.sel_trde_ori_nm_4, data.sel_trde_qty_4],
    [data.buy_trde_ori_nm_5, data.buy_trde_qty_5, data.sel_trde_ori_nm_5, data.sel_trde_qty_5],
  ];
  const filled = slots.filter(([buyNm, , selNm]) => buyNm || selNm);
  if (filled.length === 0) {
    return `[${modeLabel}] ${stockCode}의 거래원 정보가 없습니다. 종목코드를 확인해 주세요.`;
  }

  const n = parseKiwoomNumber;
  const title = data.stk_nm ? `${data.stk_nm} (${stockCode})` : stockCode;
  const lines = [
    `[${modeLabel}] ${title} 거래원 상위 — 현재가 ${formatKRW(parseKiwoomPrice(data.cur_prc))} (${formatPercent(n(data.flu_rt))})`,
    "",
    "| 순위 | 매수 거래원 | 매수량(주) | 매도 거래원 | 매도량(주) |",
    "|---:|---|---:|---|---:|",
  ];

  // ka10102 코드표는 best-effort 부가정보 — 못 불러오면 이름만 그대로 나간다.
  const index = brokerCodes ? brokerIndexByName(brokerCodes) : null;
  const label = (name: string) =>
    !name ? "-" : index && isForeignBroker(index, name) ? `${name} 🌐` : name;

  let foreignBuy = 0;
  let foreignSell = 0;

  filled.forEach(([buyNm, buyQty, selNm, selQty], i) => {
    // 수량 부호는 매수/매도 방향 중복이라 절대값으로 표시.
    const buyQuantity = parseKiwoomPrice(buyQty);
    const sellQuantity = parseKiwoomPrice(selQty);
    if (index && buyNm && isForeignBroker(index, buyNm)) foreignBuy += buyQuantity ?? 0;
    if (index && selNm && isForeignBroker(index, selNm)) foreignSell += sellQuantity ?? 0;

    const cells = [
      String(i + 1),
      label(buyNm),
      formatNumber(buyQuantity),
      label(selNm),
      formatNumber(sellQuantity),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push("", "※ 당일 거래원(증권사)별 누적 매수/매도 수량 상위 5개사입니다.");
  if (index) {
    // 상위 5개사만 보이는 표라 이 합계는 부분합이다 — 순매수로 읽히지 않게 못을 박는다.
    lines.push(
      `※ 🌐 = 외국계 창구 (키움 ka10102 거래원 구분). 위 표 안에서만 합산하면 ` +
        `매수 ${formatNumber(foreignBuy)}주 / 매도 ${formatNumber(foreignSell)}주입니다 — ` +
        `상위 5개사 밖의 외국계 물량은 빠져 있으니 외국인 순매수로 읽지 마세요 ` +
        `(그 용도는 get_investor_trend / get_foreign_intraday).`,
    );
  }
  lines.push(KRX_ONLY_NOTE);
  return lines.join("\n");
}

/**
 * 종목별 **전 거래원** 순위 (ka10038) — ka10002가 상위 5개만 주는 것을 50개로 넓힌다.
 *
 * `side`는 키움 `qry_tp`가 고르는 거래원 집합이다: net_sell(순매도 거래원)/net_buy(순매수)/
 * all(전체). 세 집합은 실측상 정확한 분할이라(net_sell ∩ net_buy = ∅, 합집합 = all),
 * all의 행수는 나머지 둘의 합이다.
 *
 * 응답의 `prid_trde_qty`(기간 총 거래량)는 **기간 정의를 확정하지 못해 렌더하지 않는다** —
 * 자세한 근거는 types.ts의 스키마 주석.
 */
export function formatBrokerStockRank(
  rows: BrokerStockRankItem[],
  stockCode: string,
  side: BrokerRankSide,
  top: number,
  modeLabel: string,
  brokerCodes?: BrokerCodeItem[],
): string {
  const sideLabel = { net_sell: "순매도", net_buy: "순매수", all: "전체" }[side];
  if (rows.length === 0) {
    return (
      `[${modeLabel}] 거래원 순위가 없습니다 (종목 ${stockCode}, ${sideLabel}).\n` +
      "※ 종목코드를 확인해 주세요 — 거래가 없는 종목은 빈 결과가 옵니다."
    );
  }

  const index = brokerCodes ? brokerIndexByName(brokerCodes) : undefined;
  const n = parseKiwoomNumber;
  const shown = rows.slice(0, top);
  const lines = [
    `[${modeLabel}] 종목별 거래원 순위 — 종목 ${stockCode} (${sideLabel}, ${shown.length}/${rows.length}개사)`,
    "",
    "| 순위 | 거래원 | 매수 | 매도 | 순매매 |",
    "|---:|---|---:|---:|---:|",
  ];

  let foreignNet = 0;
  for (const r of shown) {
    const name = r.mmcm_nm.trim();
    const foreign = index ? isForeignBroker(index, name) : false;
    const net = n(r.acc_netprps_qty) ?? 0;
    if (foreign) foreignNet += net;
    lines.push(
      `| ${[
        r.rank || "-",
        foreign ? `🌐 ${name}` : name,
        formatNumber(n(r.buy_qty), 0),
        formatNumber(n(r.sell_qty), 0),
        formatSigned(net, 0),
      ].join(" | ")} |`,
    );
  }

  if (rows.length > shown.length) {
    lines.push("", `※ ${rows.length}개사 중 상위 ${shown.length}개만 표시했습니다 (top으로 조정).`);
  }
  lines.push(
    "",
    "※ 매도 수량은 음수로 옵니다. 순매매 = 매수 + 매도이며 단위는 주입니다.",
    "※ **누적 기간**은 키움이 밝히지 않아 이 표에 적지 않았습니다 — 당일 값이 아니니 " +
      "당일 거래원만 보려면 stock_code만 주고 view를 생략하세요(ka10002, 상위 5개사).",
  );
  if (index) {
    lines.push(
      `※ 🌐 = 외국계 창구 (키움 ka10102 거래원 구분). 표시된 외국계 순매매 합은 ` +
        `${formatSigned(foreignNet, 0)}주입니다 — **창구 기준**이라 외국인 순매수와 다릅니다 ` +
        `(그 용도는 get_investor_trend / get_foreign_intraday).`,
    );
  }
  lines.push(KRX_ONLY_NOTE);
  return lines.join("\n");
}

export function registerBrokerActivityTool(server: McpServer): void {
  server.registerTool(
    "get_broker_activity",
    {
      title: "거래원 동향 조회",
      description:
        "증권사 창구별 매매 동향을 조회합니다 (키움 ka10002/ka10102/ka10037/ka10038). " +
        "stock_code를 주면 **그 종목의 당일 거래원 상위 5개사**(매수/매도)이고, 외국계 창구에는 🌐를 붙입니다. " +
        "같은 종목을 `view=broker_rank`로 부르면 **전 거래원 50개사의 누적 순위**를 순매수/순매도로 갈라 봅니다 " +
        "(상위 5개사 밖의 창구까지 봐야 할 때). " +
        "stock_code를 생략하면 **시장 전체에서 외국계 창구 순매매가 큰 종목 순위**입니다 " +
        "(direction: net_buy 기본/net_sell/all, days: 1·5·10일 누적). " +
        "둘 다 **창구 기준**이라 투자자 주체별 순매수와는 다릅니다 — 외국인 순매수 자체는 " +
        "get_investor_trend나 get_foreign_intraday를 쓰세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .optional()
          .describe("조회할 6자리 종목코드 — 주면 종목별 거래원, 생략하면 시장 전체 외국계 창구 순위"),
        view: z
          .enum(["top5", "broker_rank"])
          .optional()
          .describe(
            "stock_code를 줬을 때의 표 종류 — top5(당일 상위 5개사, 기본)/broker_rank(전 거래원 50개사 누적 순위)",
          ),
        market: z
          .enum(["all", "kospi", "kosdaq"])
          .optional()
          .describe("시장 구분 — 시장 전체 순위에서만 사용 (기본값 all)"),
        days: z
          .enum(FOREIGN_BROKER_DAYS)
          .optional()
          .describe(`누적 기간(거래일) — 시장 전체 순위에서만 사용 (기본값 ${DEFAULT_BROKER_DAYS})`),
        direction: z
          .enum(["net_buy", "net_sell", "all"])
          .optional()
          .describe(
            "순매매 방향 — 시장 전체 순위에서는 net_buy(기본)/net_sell/all(종목코드 순, 순위 아님), " +
              "view=broker_rank에서는 볼 거래원 집합 net_buy(순매수한 곳)/net_sell(순매도한 곳)/all(전체, 기본)",
          ),
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
          .describe(`시장 전체 순위에서 표시할 종목 수 (기본 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ stock_code, view, market, days, direction, sort, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();

        if (!stock_code && view) {
          throw new Error("view는 stock_code와 함께 씁니다 — 시장 전체 순위에는 적용되지 않습니다.");
        }

        if (stock_code && view === "broker_rank") {
          const code = stock_code.toUpperCase();
          const side: BrokerRankSide = direction ?? "all";
          const [rows, brokerCodes] = await Promise.all([
            fetchBrokerStockRank(client, code, side),
            loadBrokerCodes(client).catch(() => undefined),
          ]);
          return textResult(
            formatBrokerStockRank(rows, code, side, top ?? MAX_TOP, config.modeLabel, brokerCodes),
          );
        }

        if (!stock_code) {
          const m: RankingMarket = market ?? "all";
          const d = days ?? DEFAULT_BROKER_DAYS;
          const dir: BrokerRankDirection = direction ?? "net_buy";
          const s = sort ?? "amount";
          const rows = await fetchForeignBrokerRank(client, m, d, dir, s);
          return textResult(
            formatForeignBrokerRank(rows, m, d, dir, s, top ?? DEFAULT_TOP, config.modeLabel),
          );
        }

        const code = stock_code.toUpperCase();
        // 코드표는 12h 캐시라 보통 추가 콜이 없다. 실패해도 거래원 표는 그대로 나간다.
        const [data, brokerCodes] = await Promise.all([
          fetchBrokerActivity(client, code),
          loadBrokerCodes(client).catch(() => undefined),
        ]);
        return textResult(formatBrokerActivity(data, code, config.modeLabel, brokerCodes));
      }),
  );
}
