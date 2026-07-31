import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchOrderExecutions } from "../kiwoom/api.js";
import { normalizeStockCode, type ExecutionItem } from "../kiwoom/types.js";
import { formatKRW, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { STOCK_CODE_PATTERN } from "../utils/stock-code.js";
import { runTool, textResult } from "./helpers.js";

export type ExecutionSide = "all" | "sell" | "buy";

const SIDE_LABELS: Record<ExecutionSide, string> = {
  all: "전체",
  sell: "매도",
  buy: "매수",
};

/** HHmmss → HH:MM:SS; passes through empty/unknown formats unchanged. */
function formatTime(raw: string): string {
  const t = raw.trim();
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  return t || "-";
}

export function formatOrderExecutions(
  rows: ExecutionItem[],
  modeLabel: string,
  options: { stockCode?: string; side?: ExecutionSide; orderNo?: string } = {},
): string {
  const { stockCode, side = "all", orderNo } = options;

  // 서버(ka10076)에서도 걸리지만, 예상과 다를 때를 대비해 한 번 더 필터한다 (ka10075 선례).
  const filtered = stockCode
    ? rows.filter((r) => normalizeStockCode(r.stk_cd) === stockCode)
    : rows;

  const scopeBits = [
    stockCode ? `종목 ${stockCode}` : null,
    side === "all" ? null : SIDE_LABELS[side],
    orderNo ? `주문번호 ${orderNo}` : null,
  ].filter((s): s is string => s !== null);
  const scope = scopeBits.length > 0 ? ` — ${scopeBits.join(", ")}` : "";

  if (filtered.length === 0) {
    return (
      `[${modeLabel}] 체결 내역이 없습니다${scope ? ` (${scopeBits.join(", ")})` : ""}.\n` +
      "※ 키움 ka10076에는 기간 파라미터가 없어 조회 범위는 키움이 정합니다 — " +
      "당일 집계는 get_trading_journal, 기간 거래내역은 get_transactions를 쓰세요."
    );
  }

  const n = parseKiwoomNumber;
  const lines = [
    `[${modeLabel}] 체결 내역 (${filtered.length}건${scope})`,
    "",
    "| 주문번호 | 종목 | 구분 | 상태 | 주문수량 | 체결수량 | 미체결 | 주문가격 | 체결가격 | 수수료+세금 | 주문시각 |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---|",
  ];

  let totalFee = 0;
  let sawFee = false;

  for (const r of filtered) {
    const code = normalizeStockCode(r.stk_cd);
    const stock = r.stk_nm ? `${r.stk_nm} (${code})` : code || "-";
    const cmsn = n(r.tdy_trde_cmsn);
    const tax = n(r.tdy_trde_tax);
    const fee = cmsn !== null || tax !== null ? (cmsn ?? 0) + (tax ?? 0) : null;
    if (fee !== null) {
      totalFee += fee;
      sawFee = true;
    }

    const cells = [
      r.ord_no || "-",
      stock,
      r.io_tp_nm || r.trde_tp || "-",
      r.ord_stt || "-",
      n(r.ord_qty)?.toLocaleString("ko-KR") ?? "-",
      n(r.cntr_qty)?.toLocaleString("ko-KR") ?? "-",
      n(r.oso_qty)?.toLocaleString("ko-KR") ?? "-",
      formatKRW(parseKiwoomPrice(r.ord_pric)),
      formatKRW(parseKiwoomPrice(r.cntr_pric)),
      fee === null ? "-" : formatKRW(fee),
      formatTime(r.ord_tm),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("");
  if (sawFee) lines.push(`수수료+세금 합계 ${formatKRW(totalFee)}`);

  // 원주문번호는 정정·취소가 섞였을 때만 의미가 있어 각주로만 노출한다.
  // 제로스트립이 세 가지를 한꺼번에 막는다 (negative control로 확인 — 되돌리면 3건 전부 실패):
  //   ① "0000000" 전부-0 센티널 = 원주문 없음  ② 빈 값  ③ "0001234" vs "1234" 패딩 차이.
  const amended = filtered.filter((r) => {
    const orig = r.orig_ord_no.trim().replace(/^0+/, "");
    return orig !== "" && orig !== r.ord_no.trim().replace(/^0+/, "");
  });
  if (amended.length > 0) {
    lines.push(
      `※ ${amended.length}건은 원주문번호가 따로 있습니다 (정정·취소된 주문): ` +
        amended.map((r) => `${r.ord_no}←${r.orig_ord_no}`).join(", "),
    );
  }

  lines.push(
    "※ 체결 = 실제로 체결된 주문. 아직 체결되지 않은 주문은 get_pending_orders를 쓰세요. " +
      "키움 ka10076에는 기간 파라미터가 없어 조회 범위는 키움이 정합니다.",
  );
  return lines.join("\n");
}

export function registerOrderExecutionsTool(server: McpServer): void {
  server.registerTool(
    "get_order_executions",
    {
      title: "체결 내역 조회",
      description:
        "계좌의 체결(실제로 체결된 주문) 내역을 조회합니다 — 주문번호, 종목, 매수/매도 구분, " +
        "주문상태, 주문/체결 수량, 주문/체결 가격, 당일 수수료·세금, 주문시각 (키움 ka10076). " +
        "stock_code·side·order_no로 좁힐 수 있습니다. 아직 체결되지 않은 주문은 get_pending_orders, " +
        "당일 종목별 집계는 get_trading_journal, 기간 거래내역은 get_transactions를 쓰세요. " +
        "조회 전용이며 주문 실행 기능은 제공하지 않습니다.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(STOCK_CODE_PATTERN, "6자리 종목코드여야 합니다")
          .optional()
          .describe("특정 종목만 조회할 때의 6자리 종목코드"),
        side: z
          .enum(["all", "sell", "buy"])
          .optional()
          .describe("매매 구분 — all(기본, 전체) | sell(매도) | buy(매수)"),
        order_no: z
          .string()
          .trim()
          .min(1)
          .max(20)
          .optional()
          .describe("특정 주문번호만 조회할 때의 주문번호"),
      },
    },
    async ({ stock_code, side, order_no }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const code = stock_code?.toUpperCase();
        const rows = await fetchOrderExecutions(client, {
          stockCode: code,
          side,
          orderNo: order_no,
        });
        return textResult(
          formatOrderExecutions(rows, config.modeLabel, {
            stockCode: code,
            side,
            orderNo: order_no,
          }),
        );
      }),
  );
}
