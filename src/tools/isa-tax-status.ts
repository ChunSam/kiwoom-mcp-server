import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { classifyInstrument, type TaxType } from "../isa/classify.js";
import { classifyInstruments } from "../isa/classify-etf.js";
import { reconstructRealizedPnl, type TradeEvent } from "../isa/realized.js";
import { computeIsaTaxStatus, ISA_LIMITS, type ClassifiedAmount, type IsaTaxStatus } from "../isa/tax.js";
import { fetchAccountEvaluation, fetchRealizedPnlSummary, fetchTransactions } from "../kiwoom/api.js";
import type { KiwoomClient } from "../kiwoom/client.js";
import { loadMasterList } from "../kiwoom/master-list.js";
import { normalizeStockCode, type TransactionRow } from "../kiwoom/types.js";
import { assertDateRange, formatDateDashed, todayInKst } from "../utils/date.js";
import { formatKRW, formatSignedKRW, parseKiwoomNumber } from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DIVIDEND_PATTERN = /배당|분배|이자/;

interface DividendScan {
  total: number;
  rows: Array<{ date: string; label: string; amount: number }>;
  otherNonTradeRows: number;
}

export function scanDividends(rows: TransactionRow[]): DividendScan {
  const scan: DividendScan = { total: 0, rows: [], otherNonTradeRows: 0 };
  for (const row of rows) {
    if (row.trde_kind_nm === "매매") continue;
    const label = `${row.trde_kind_nm} ${row.rmrk_nm}`.trim();
    if (DIVIDEND_PATTERN.test(label)) {
      const amount = parseKiwoomNumber(row.exct_amt) ?? parseKiwoomNumber(row.trde_amt) ?? 0;
      scan.total += amount;
      scan.rows.push({ date: row.trde_dt, label, amount });
    } else {
      scan.otherNonTradeRows += 1;
    }
  }
  return scan;
}

export function toTradeEvents(rows: TransactionRow[]): { events: TradeEvent[]; skipped: string[] } {
  const events: TradeEvent[] = [];
  const skipped: string[] = [];
  rows.forEach((row, index) => {
    if (row.trde_kind_nm !== "매매") return;
    const side = row.io_tp_nm.includes("매수") ? "BUY" : row.io_tp_nm.includes("매도") ? "SELL" : null;
    const quantity = parseKiwoomNumber(row.trde_qty_jwa_cnt);
    const netAmount = parseKiwoomNumber(row.exct_amt);
    if (!side || quantity === null || netAmount === null) {
      skipped.push(`${row.trde_dt} ${row.stk_nm} (${row.io_tp_nm || "구분 불명"})`);
      return;
    }
    events.push({
      code: normalizeStockCode(row.stk_cd),
      name: row.stk_nm,
      side,
      quantity,
      netAmount,
      date: row.trde_dt,
      seq: parseKiwoomNumber(row.trde_no) ?? index,
    });
  });
  return { events, skipped };
}

interface ClassifiedEntry extends ClassifiedAmount {
  reason: string;
  incomplete?: boolean;
}

interface TaxReport {
  modeLabel: string;
  isaTypeLabel: string;
  fromDate: string;
  toDate: string;
  status: IsaTaxStatus;
  realizedEntries: ClassifiedEntry[];
  unrealizedEntries: ClassifiedEntry[];
  dividendScan: DividendScan;
  manualDividends: number | undefined;
  kiwoomRealizedTotal: number | null;
  reconstructedTotal: number;
  warnings: string[];
}

function entryLines(entries: ClassifiedEntry[]): string[] {
  return entries.map(
    (e) =>
      `  · ${e.name} (${e.code}): ${formatSignedKRW(Math.round(e.amount))}` +
      `${e.incomplete ? " ⚠️이력 불완전" : ""}${e.confident ? "" : " ※분류 추정"}`,
  );
}

export function formatTaxReport(report: TaxReport): string {
  const s = report.status;
  const round = Math.round;
  const usedPct = s.limit > 0 ? Math.max(0, s.confirmedNet) / s.limit : 0;

  const lines: string[] = [
    `[${report.modeLabel}] ISA 비과세 한도 현황 — ${report.isaTypeLabel} (한도 ${formatKRW(s.limit)})`,
    `집계 기간: ${formatDateDashed(report.fromDate)} ~ ${formatDateDashed(report.toDate)}`,
    "",
    "■ 확정 손익통산 (실현 기준)",
    `- 과세대상 실현손익: ${formatSignedKRW(round(s.taxableRealized))}`,
    ...entryLines(report.realizedEntries.filter((e) => e.taxType === "TAXABLE")),
    `- 국내주식형 실현손익: ${formatSignedKRW(round(s.domesticRealizedNet))} → ` +
      (s.domesticLossDeduction < 0
        ? `순손실 ${formatKRW(round(-s.domesticLossDeduction))} 통산 차감`
        : "이익은 비과세라 통산 제외 (차감 0원)"),
    ...entryLines(report.realizedEntries.filter((e) => e.taxType === "DOMESTIC_EQUITY")),
    `- 배당·분배금·이자: ${formatKRW(round(s.dividends))}` +
      ` (자동 감지 ${report.dividendScan.rows.length}건` +
      `${report.manualDividends !== undefined ? ` + 수동 입력 ${formatKRW(report.manualDividends)}` : ""})`,
    ...report.dividendScan.rows.map((d) => `  · ${formatDateDashed(d.date)} ${d.label}: ${formatKRW(round(d.amount))}`),
    `= 통산 순이익(확정): ${formatSignedKRW(round(s.confirmedNet))}`,
    "",
    "■ 비과세 한도",
  ];

  if (s.confirmedNet < 0) {
    lines.push(
      `- 현재 순손실 상태 — 한도 ${formatKRW(s.limit)} 전액 잔여. ` +
        `손실 ${formatKRW(round(-s.confirmedNet))}은 만기까지 발생하는 이익과 상계됩니다.`,
    );
  } else {
    lines.push(
      `- 사용: ${formatKRW(round(s.confirmedNet))} / ${formatKRW(s.limit)} (${(usedPct * 100).toFixed(1)}%)`,
      `- 잔여: ${formatKRW(round(s.remainingAllowance))}`,
      `- 한도 초과분 예상 세금(9.9%): ${formatKRW(round(s.estimatedTaxNow))}`,
    );
  }

  lines.push(
    "",
    "■ 시나리오: 현재 보유분 전량 매도 가정 (미실현 포함)",
    `- 과세대상 미실현: ${formatSignedKRW(round(s.taxableUnrealized))}`,
    ...entryLines(report.unrealizedEntries.filter((e) => e.taxType === "TAXABLE")),
    `- 국내주식형 미실현: ${formatSignedKRW(round(s.domesticUnrealizedNet))}` +
      (Math.min(0, s.domesticUnrealizedNet) < 0 ? " (순손실만 차감 반영)" : " (이익은 비과세 — 미반영)"),
    ...entryLines(report.unrealizedEntries.filter((e) => e.taxType === "DOMESTIC_EQUITY")),
    `= 시나리오 통산 순이익: ${formatSignedKRW(round(s.scenarioNet))}`,
    `- 시나리오 잔여 한도: ${formatKRW(round(s.scenarioRemaining))} / 예상 세금: ${formatKRW(round(s.scenarioEstimatedTax))}`,
  );

  const kiwoom = report.kiwoomRealizedTotal;
  if (kiwoom !== null) {
    const diff = round(report.reconstructedTotal - kiwoom);
    const tolerance = Math.max(1_000, Math.abs(kiwoom) * 0.01);
    lines.push(
      "",
      `※ 검증: 자체 재구성 실현손익 합계 ${formatSignedKRW(round(report.reconstructedTotal))} vs ` +
        `키움 실현손익 TR 합계 ${formatSignedKRW(round(kiwoom))} (차이 ${formatSignedKRW(diff)}` +
        `${Math.abs(diff) > tolerance ? " — ⚠️ 허용 오차 초과, 결과 신뢰도 주의" : " — 정상 범위"})`,
    );
  }

  for (const warning of report.warnings) {
    lines.push(`⚠️ ${warning}`);
  }

  lines.push(
    "",
    "※ 이 계산은 참고용입니다. 배당 자동 감지는 아직 실데이터로 검증되지 않았고(미수령), " +
      "과세유형 분류는 ETF는 키움 과세유형 기준이고 그 외(개별주식 등)는 종목명 기반 추정이며, " +
      "손익통산 세부 규정(국내주식형 손실 차감 방식 등)은 " +
      "증권사 정산과 다를 수 있습니다. 실제 과세는 만기·해지 시점에 확정되므로 정확한 금액은 " +
      "증권사 안내를 기준으로 하세요.",
  );

  return lines.join("\n");
}

const ISA_TYPE_LABELS = { GENERAL: "일반형", SEOMIN: "서민형" } as const;

/**
 * ka10099 마스터리스트에서 ETF(`marketName == "ETF"`)로 표시된 코드 집합을 만든다.
 * 브랜드 접두어가 없는 ETF도 ka40002 확정 분류를 받게 하기 위한 게이트. 마스터리스트
 * 조회가 실패하면 빈 집합을 반환해 종목명 휴리스틱으로 폴백한다(계산은 계속 진행).
 */
async function loadEtfCodeSet(client: KiwoomClient): Promise<ReadonlySet<string>> {
  try {
    const master = await loadMasterList(client);
    return new Set(master.filter((s) => s.marketName === "ETF").map((s) => s.code));
  } catch {
    return new Set();
  }
}

export function registerIsaTaxStatusTool(server: McpServer): void {
  server.registerTool(
    "calc_isa_tax_status",
    {
      title: "ISA 비과세 한도 현황 계산",
      description:
        "ISA 계좌의 손익통산 순이익을 계산해 비과세 한도(일반형 200만원/서민형 400만원) 대비 " +
        "사용량·잔여량을 보여줍니다. 실현손익(거래내역 재구성)과 배당을 확정분으로, 보유 종목 " +
        "미실현 손익을 '전량 매도 가정' 시나리오로 함께 제공합니다. 집계 시작일은 ISA_OPENED_ON " +
        "환경변수(계좌 개설일) 또는 from_date 인자로 지정합니다. 배당 수령액이 거래내역에서 " +
        "감지되지 않으면 dividends_received로 수동 입력하세요.",
      inputSchema: {
        from_date: z
          .string()
          .regex(/^\d{4}-?\d{2}-?\d{2}$/, "yyyy-MM-dd 또는 yyyyMMdd 형식이어야 합니다")
          .optional()
          .describe("집계 시작일 (기본값: ISA_OPENED_ON 환경변수 = 계좌 개설일)"),
        dividends_received: z
          .number()
          .min(0)
          .optional()
          .describe("집계 기간 중 수령한 배당·분배금·이자 총액(원) — 자동 감지분에 더해짐"),
        overrides: z
          .array(
            z.object({
              stock_code: z
                .string()
                .regex(/^\d{6}$/, "6자리 숫자 종목코드여야 합니다")
                .describe("6자리 종목코드"),
              tax_type: z
                .enum(["TAXABLE", "DOMESTIC_EQUITY"])
                .describe("TAXABLE=과세대상(해외/채권형 등), DOMESTIC_EQUITY=국내주식형(매매차익 비과세)"),
            }),
          )
          .optional()
          .describe("자동 과세유형 분류가 틀린 종목의 수동 지정"),
      },
    },
    async ({ from_date, dividends_received, overrides }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();

        const fromDate = (from_date ?? config.isaOpenedOn)?.replaceAll("-", "");
        if (!fromDate) {
          throw new Error(
            "집계 시작일이 없습니다. .env에 ISA_OPENED_ON=yyyy-MM-dd(계좌 개설일)를 설정하거나 " +
              "from_date 인자를 전달해 주세요.",
          );
        }
        const toDate = todayInKst();
        assertDateRange(fromDate, toDate);

        const overrideMap = new Map<string, TaxType>(
          (overrides ?? []).map((o) => [o.stock_code, o.tax_type]),
        );

        // Distinct TRs — per-TR rate limits allow parallel calls. loadEtfCodeSet
        // (ka10099) is best-effort and never rejects, so Promise.all is safe.
        const [transactions, evaluation, realizedSummary, etfCodes] = await Promise.all([
          fetchTransactions(client, fromDate, toDate),
          fetchAccountEvaluation(client, "2"),
          fetchRealizedPnlSummary(client, fromDate, toDate),
          loadEtfCodeSet(client),
        ]);

        const { events, skipped } = toTradeEvents(transactions.rows);
        const reconstruction = reconstructRealizedPnl(events);
        const dividendScan = scanDividends(transactions.rows);

        const holdingCodes = evaluation.acnt_evlt_remn_indv_tot.map((h) => ({
          code: normalizeStockCode(h.stk_cd),
          name: h.stk_nm,
        }));
        // 실현·미실현 종목을 한 번에 dedup 분류: ETF는 ka40002 과세유형으로 확정,
        // 그 외는 종목명 휴리스틱으로 폴백한다.
        const classifications = await classifyInstruments(
          client,
          [...reconstruction.perStock.map((r) => ({ code: r.code, name: r.name })), ...holdingCodes],
          overrideMap,
          etfCodes,
        );
        const classifyOf = (code: string, name: string) =>
          classifications.get(code) ?? classifyInstrument(code, name, overrideMap);

        const realizedEntries: ClassifiedEntry[] = reconstruction.perStock.map((r) => {
          const c = classifyOf(r.code, r.name);
          return {
            code: r.code,
            name: r.name,
            amount: r.realized,
            taxType: c.taxType,
            confident: c.confident,
            reason: c.reason,
            incomplete: r.incompleteHistory,
          };
        });

        const unrealizedEntries: ClassifiedEntry[] = evaluation.acnt_evlt_remn_indv_tot.map((h) => {
          const code = normalizeStockCode(h.stk_cd);
          const c = classifyOf(code, h.stk_nm);
          return {
            code,
            name: h.stk_nm,
            amount: parseKiwoomNumber(h.evltv_prft) ?? 0,
            taxType: c.taxType,
            confident: c.confident,
            reason: c.reason,
          };
        });

        const dividends = dividendScan.total + (dividends_received ?? 0);
        const status = computeIsaTaxStatus({
          limit: ISA_LIMITS[config.isaType],
          dividends,
          realized: realizedEntries,
          unrealized: unrealizedEntries,
        });

        const warnings = [...reconstruction.warnings];
        // 존재 검증: 실현·보유 어디에도 없는 종목의 override는 조용히 무시되므로
        // (오타 가능성) 경고로 표면화한다.
        const knownCodes = new Set([
          ...realizedEntries.map((e) => e.code),
          ...unrealizedEntries.map((e) => e.code),
        ]);
        const unusedOverrides = [...overrideMap.keys()].filter((code) => !knownCodes.has(code));
        if (unusedOverrides.length > 0) {
          warnings.push(
            `overrides에 지정한 종목 ${unusedOverrides.join(", ")}이(가) 집계 기간의 실현손익·보유 ` +
              `내역에 없어 반영되지 않았습니다 — 종목코드를 확인해 주세요.`,
          );
        }
        if (transactions.truncated) {
          warnings.push(
            "거래내역이 조회 상한에 도달해 일부 오래된 거래가 누락되었을 수 있습니다 — " +
              "집계 시작일(from_date)을 좁혀 재확인하세요. 실현손익·배당 집계가 불완전할 수 있습니다.",
          );
        }
        if (evaluation.truncated) {
          warnings.push("보유 종목이 조회 상한에 도달해 일부가 누락되었을 수 있습니다 — 미실현 시나리오가 불완전할 수 있습니다.");
        }
        if (skipped.length > 0) {
          warnings.push(`매수/매도로 분류하지 못해 제외한 거래 ${skipped.length}건: ${skipped.join(", ")}`);
        }
        if (dividendScan.otherNonTradeRows > 0) {
          warnings.push(
            `배당으로 분류되지 않은 비매매 거래 ${dividendScan.otherNonTradeRows}건이 있습니다. ` +
              `필요 시 거래내역을 직접 확인하세요.`,
          );
        }

        const report: TaxReport = {
          modeLabel: config.modeLabel,
          isaTypeLabel: ISA_TYPE_LABELS[config.isaType],
          fromDate,
          toDate,
          status,
          realizedEntries,
          unrealizedEntries,
          dividendScan,
          manualDividends: dividends_received,
          kiwoomRealizedTotal: parseKiwoomNumber(realizedSummary.rlzt_pl),
          reconstructedTotal: reconstruction.total,
          warnings,
        };

        return textResult(formatTaxReport(report));
      }),
  );
}
