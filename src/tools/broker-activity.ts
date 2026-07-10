import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchBrokerActivity } from "../kiwoom/api.js";
import type { BrokerActivityResponse } from "../kiwoom/types.js";
import { formatKRW, formatNumber, formatPercent, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

export function formatBrokerActivity(data: BrokerActivityResponse, stockCode: string, modeLabel: string): string {
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

  filled.forEach(([buyNm, buyQty, selNm, selQty], i) => {
    // 수량 부호는 매수/매도 방향 중복이라 절대값으로 표시.
    const cells = [
      String(i + 1),
      buyNm || "-",
      formatNumber(parseKiwoomPrice(buyQty)),
      selNm || "-",
      formatNumber(parseKiwoomPrice(selQty)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push("", "※ 당일 거래원(증권사)별 누적 매수/매도 수량 상위 5개사입니다.");
  return lines.join("\n");
}

export function registerBrokerActivityTool(server: McpServer): void {
  server.registerTool(
    "get_broker_activity",
    {
      title: "거래원 동향 조회",
      description:
        "특정 종목의 당일 거래원(증권사)별 매수/매도 상위 5개사를 조회합니다 (키움 ka10002). " +
        "어느 증권사 창구에서 많이 사고팔았는지 보여줍니다. 종목코드를 모르면 search_stock으로 먼저 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .describe("조회할 6자리 종목코드"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const data = await fetchBrokerActivity(client, stock_code);
        return textResult(formatBrokerActivity(data, stock_code, config.modeLabel));
      }),
  );
}
