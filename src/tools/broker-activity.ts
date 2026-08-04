import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchBrokerActivity } from "../kiwoom/api.js";
import { brokerIndexByName, isForeignBroker, loadBrokerCodes } from "../kiwoom/broker-list.js";
import type { BrokerActivityResponse, BrokerCodeItem } from "../kiwoom/types.js";
import { formatKRW, formatNumber, formatPercent, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { KRX_ONLY_NOTE, runTool, textResult } from "./helpers.js";

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

export function registerBrokerActivityTool(server: McpServer): void {
  server.registerTool(
    "get_broker_activity",
    {
      title: "거래원 동향 조회",
      description:
        "특정 종목의 당일 거래원(증권사)별 매수/매도 상위 5개사를 조회합니다 (키움 ka10002, ka10102). " +
        "어느 증권사 창구에서 많이 사고팔았는지 보여주고, 외국계 창구에는 🌐를 붙입니다. " +
        "창구 단위 집계라 투자자 주체별 순매수와는 다릅니다 — 외국인 순매수 자체를 보려면 " +
        "get_investor_trend나 get_foreign_intraday를 쓰세요. " +
        "종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .describe("조회할 6자리 종목코드"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
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
