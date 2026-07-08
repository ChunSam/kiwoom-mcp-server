import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchPendingOrders } from "../kiwoom/api.js";
import { normalizeStockCode, type PendingOrderItem } from "../kiwoom/types.js";
import { formatKRW, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

/** HHmmss → HH:MM:SS; passes through empty/unknown formats unchanged. */
function formatTime(raw: string): string {
  const t = raw.trim();
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  return t || "-";
}

export function formatPendingOrders(
  rows: PendingOrderItem[],
  modeLabel: string,
  stockCode?: string,
): string {
  const scope = stockCode ? `, 종목 ${stockCode}` : "";
  // stock_code는 서버(ka10075)에서도 걸리지만, 예상과 다를 때를 대비해 한 번 더 필터한다.
  const filtered = stockCode
    ? rows.filter((r) => normalizeStockCode(r.stk_cd) === stockCode)
    : rows;

  if (filtered.length === 0) {
    return `[${modeLabel}] 미체결 주문이 없습니다${stockCode ? ` (종목 ${stockCode})` : ""}.`;
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 미체결 주문 (${filtered.length}건${scope})`,
    "",
    "| 주문번호 | 종목 | 구분 | 상태 | 주문수량 | 미체결수량 | 주문가격 | 현재가 | 시간 |",
    "|---|---|---|---|---:|---:|---:|---:|---|",
  ];

  for (const r of filtered) {
    const code = normalizeStockCode(r.stk_cd);
    const stock = r.stk_nm ? `${r.stk_nm} (${code})` : code || "-";
    const cells = [
      r.ord_no || "-",
      stock,
      r.io_tp_nm || r.trde_tp || "-",
      r.ord_stt || "-",
      n(r.ord_qty)?.toLocaleString("ko-KR") ?? "-",
      n(r.oso_qty)?.toLocaleString("ko-KR") ?? "-",
      formatKRW(parseKiwoomPrice(r.ord_pric)),
      formatKRW(parseKiwoomPrice(r.cur_prc)),
      formatTime(r.tm),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    "※ 미체결 = 아직 체결되지 않은 주문(정정·부분체결 포함). 주문가격 0원은 시장가 주문일 수 있습니다.",
  );
  return lines.join("\n");
}

export function registerPendingOrdersTool(server: McpServer): void {
  server.registerTool(
    "get_pending_orders",
    {
      title: "미체결 주문 조회",
      description:
        "계좌의 미체결(아직 체결되지 않은) 주문 목록을 조회합니다 — 주문번호, 종목, 매수/매도 구분, " +
        "주문상태, 주문수량, 미체결수량, 주문가격, 현재가 (키움 ka10075). stock_code로 특정 종목만 " +
        "필터링할 수 있습니다. 조회 전용이며 주문 실행 기능은 제공하지 않습니다.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 종목코드여야 합니다")
          .optional()
          .describe("특정 종목만 조회할 때의 6자리 종목코드"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const rows = await fetchPendingOrders(client, stock_code);
        return textResult(formatPendingOrders(rows, config.modeLabel, stock_code));
      }),
  );
}
