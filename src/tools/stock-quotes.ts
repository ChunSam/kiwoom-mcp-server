import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchBatchQuotes } from "../kiwoom/api.js";
import { loadMasterList, masterItemWarnings } from "../kiwoom/master-list.js";
import type { BatchQuoteItem, StockListItem } from "../kiwoom/types.js";
import {
  formatKRW,
  formatNumber,
  formatPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const MAX_CODES = 30;

export function formatBatchQuotes(
  items: BatchQuoteItem[],
  requestedCodes: string[],
  modeLabel: string,
  nameIndex?: Map<string, StockListItem>,
): string {
  // 미상장/오타 코드는 rc=0 + 전 필드 공백 행으로 온다 — 걸러내고 코드 목록으로 안내.
  const rows = items.filter((r) => r.stk_cd !== "");
  const returned = new Set(rows.map((r) => r.stk_cd));
  const missing = requestedCodes.filter((c) => !returned.has(c));

  if (rows.length === 0) {
    const missingNote = missing.length > 0 ? ` (조회 실패: ${missing.join(", ")})` : "";
    return `[${modeLabel}] 조회된 종목이 없습니다${missingNote}. 종목코드를 확인해 주세요.`;
  }

  const lines = [
    `[${modeLabel}] 종목 일괄 시세 (${rows.length}종목)`,
    "",
    "| 종목명 | 코드 | 현재가 | 전일대비 | 등락률 | 거래량 | 거래대금(백만원) | 시가총액(억원) | 비고 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const r of rows) {
    const master = nameIndex?.get(r.stk_cd);
    const flags = master ? masterItemWarnings(master).join("·") : "";
    lines.push(
      `| ${r.stk_nm || "-"} | ${r.stk_cd} | ${formatKRW(parseKiwoomPrice(r.cur_prc))} | ` +
        `${formatSigned(parseKiwoomNumber(r.pred_pre), 0)} | ${formatPercent(parseKiwoomNumber(r.flu_rt))} | ` +
        `${formatNumber(parseKiwoomNumber(r.trde_qty), 0)} | ${formatNumber(parseKiwoomNumber(r.trde_prica), 0)} | ` +
        `${formatNumber(parseKiwoomNumber(r.mac), 0)} | ${flags || "-"} |`,
    );
  }

  if (missing.length > 0) {
    lines.push("", `⚠️ 조회되지 않은 코드: ${missing.join(", ")} — 종목코드를 확인해 주세요.`);
  }
  lines.push("", "※ 종목별 상세 지표(시가/고저/PER 등)는 get_stock_price로 조회하세요.");
  return lines.join("\n");
}

export function registerStockQuotesTool(server: McpServer): void {
  server.registerTool(
    "get_stock_quotes",
    {
      title: "여러 종목 일괄 시세 조회",
      description:
        "여러 종목의 현재가·등락률·거래량·거래대금·시가총액을 한 번의 호출로 조회합니다 (키움 ka10095). " +
        `보유 종목이나 관심 종목처럼 2개 이상 종목의 시세가 필요할 때 get_stock_price를 반복 호출하는 대신 사용하세요 (최대 ${MAX_CODES}종목). ` +
        "거래정지/관리종목/투자경고 같은 투자유의 상태도 비고에 표시됩니다.",
      inputSchema: {
        stock_codes: z
          .array(z.string().regex(/^\d{6}$/, "6자리 숫자 종목코드여야 합니다 (예: 005930)"))
          .min(1)
          .max(MAX_CODES)
          .describe(`조회할 6자리 종목코드 목록 (1~${MAX_CODES}개, 예: ["005930", "000660"])`),
      },
    },
    async ({ stock_codes }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const codes = [...new Set(stock_codes)];
        // 마스터 조회는 best-effort 부가정보(비고) — 실패해도 시세 응답은 그대로 나간다.
        // 캐시가 따뜻하면 추가 API 콜 없음(12h TTL), 콜드면 ka10099 2콜이 병렬로 얹힌다.
        const [items, nameIndex] = await Promise.all([
          fetchBatchQuotes(client, codes),
          loadMasterList(client)
            .then((list) => new Map(list.map((i) => [i.code, i])))
            .catch(() => undefined),
        ]);
        return textResult(formatBatchQuotes(items, codes, config.modeLabel, nameIndex));
      }),
  );
}
