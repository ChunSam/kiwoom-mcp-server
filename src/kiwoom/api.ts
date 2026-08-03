import { z } from "zod";

import { sleep } from "../utils/sleep.js";
import { toUnifiedCode } from "../utils/stock-code.js";
import type { KiwoomClient } from "./client.js";
import { KiwoomApiError } from "./errors.js";
import {
  accountEvaluationResponseSchema,
  accountPeriodPlResponseSchema,
  accountReturnSummarySchema,
  accountTodayStatusSchema,
  afterHoursQuoteResponseSchema,
  afterHoursRankItemSchema,
  allIndexResponseSchema,
  batchQuoteItemSchema,
  bidBalanceResponseSchema,
  bidRatioSurgeResponseSchema,
  bidSurgeResponseSchema,
  brokerActivityResponseSchema,
  creditTrendResponseSchema,
  dailyAssetItemSchema,
  dailyChartItemSchema,
  dailyFlowResponseSchema,
  dailySessionResponseSchema,
  depositResponseSchema,
  etfAllPriceResponseSchema,
  etfInfoResponseSchema,
  etfNavItemSchema,
  etfReturnItemSchema,
  executionStrengthDailyResponseSchema,
  executionStrengthIntradayResponseSchema,
  executionsResponseSchema,
  expectedExecutionResponseSchema,
  foreignHoldingResponseSchema,
  institutionTrendResponseSchema,
  investorDailyItemSchema,
  investorRankDailyItemSchema,
  investorStreakItemSchema,
  investorTotalItemSchema,
  lendingTrendResponseSchema,
  limitStockItemSchema,
  minuteChartItemSchema,
  newHighLowItemSchema,
  orderbookResponseSchema,
  pendingOrdersResponseSchema,
  priceChangeRankItemSchema,
  priceJumpItemSchema,
  programTradeItemSchema,
  programTrendItemSchema,
  realizedPnlResponseSchema,
  sectorCodeListResponseSchema,
  sectorNetBuyResponseSchema,
  sectorPriceResponseSchema,
  sectorStocksResponseSchema,
  shortSellingResponseSchema,
  stockInfoResponseSchema,
  stockListResponseSchema,
  stockProgramTrendItemSchema,
  themeGroupsResponseSchema,
  tradingJournalResponseSchema,
  themeStocksResponseSchema,
  transactionsResponseSchema,
  supplyConcentrationResponseSchema,
  valuationRankResponseSchema,
  valueRankItemSchema,
  viStockItemSchema,
  volumeRankItemSchema,
  volumeSurgeItemSchema,
  watchlistGroupDetailResponseSchema,
  watchlistGroupsResponseSchema,
  type AccountEvaluationResponse,
  type AccountPeriodPlResponse,
  type AccountReturnSummary,
  type AccountTodayStatus,
  type AfterHoursQuoteResponse,
  type AfterHoursRankItem,
  type BatchQuoteItem,
  type BidBalanceItem,
  type BidRatioSurgeItem,
  type BidSurgeItem,
  type BrokerActivityResponse,
  type CreditTrendResponse,
  type DailyAssetItem,
  type DailyChartItem,
  type DailyFlowItem,
  type DailySessionItem,
  type DepositResponse,
  type EtfAllPriceItem,
  type EtfInfoResponse,
  type EtfNavItem,
  type EtfReturnItem,
  type ExecutionItem,
  type ExecutionStrengthItem,
  type ExpectedExecutionItem,
  type ForeignHoldingItem,
  type InstitutionTrendResponse,
  type IndexItem,
  type InvestorDailyItem,
  type InvestorRankDailyItem,
  type InvestorStreakItem,
  type InvestorTotalItem,
  type LendingTrendItem,
  type LimitStockItem,
  type MinuteChartItem,
  type NewHighLowItem,
  type OrderbookResponse,
  type PendingOrderItem,
  type PriceChangeRankItem,
  type PriceJumpItem,
  type ProgramTradeItem,
  type ProgramTrendItem,
  type RealizedPnlResponse,
  type SectorCodeItem,
  type SectorNetBuyItem,
  type SectorPriceResponse,
  type SectorStockItem,
  type ShortSellingItem,
  type StockInfoResponse,
  type StockListItem,
  type StockProgramTrendItem,
  type ThemeGroupItem,
  type ThemeStocksResponse,
  type TradingJournalResponse,
  type TransactionRow,
  type SupplyConcentrationItem,
  type ValuationRankItem,
  type ValueRankItem,
  type ViStockItem,
  type VolumeRankItem,
  type VolumeSurgeItem,
  type WatchlistGroupItem,
  type WatchlistStockItem,
} from "./types.js";

const STOCK_INFO_PATH = "/api/dostk/stkinfo";
const ACCOUNT_PATH = "/api/dostk/acnt";
const CHART_PATH = "/api/dostk/chart";
const MRKCOND_PATH = "/api/dostk/mrkcond";
const SECTOR_PATH = "/api/dostk/sect";
const RANK_PATH = "/api/dostk/rkinfo";
const ETF_PATH = "/api/dostk/etf";
const WATCHLIST_PATH = "/api/dostk/watchlist";
const THEME_PATH = "/api/dostk/thme";
const SHORT_PATH = "/api/dostk/shsa";
const FOREIGN_PATH = "/api/dostk/frgnistt";
const SLB_PATH = "/api/dostk/slb";

/** Pulls an array out of an already-envelope-checked response body. */
function parseArray<T extends z.ZodType>(json: unknown, key: string, itemSchema: T): z.infer<T>[] {
  const value = (json as Record<string, unknown>)[key];
  return z.array(itemSchema).parse(Array.isArray(value) ? value : []);
}

/**
 * Safety cap for cont-yn pagination. Bounds worst-case latency (each page is
 * ~1.1s apart, so up to ~22s). A typical retail/ISA account never comes close,
 * but a heavy account could — when the cap is hit, callers surface a
 * "results may be truncated" warning instead of silently dropping data.
 */
const MAX_PAGES = 20;
/** Per-TR rate limit is ~1 req/s — space out continuation pages. */
const PAGE_INTERVAL_MS = 1_100;

/**
 * 시장 전체 TR의 `stex_tp`(거래소구분) — "0"·"1"=KRX 단독, "2"=넥스트레이드(NXT) 단독,
 * "3"=통합(SOR). 실측 2026-08-03 정규장(REAL·VIRTUAL 동일): 같은 종목에 대해
 * **tp1 + tp2 = tp3**이 8/8 종목에서 성립했고, 삼성전자 거래량은 KRX 19.2M / NXT 15.5M /
 * 통합 34.7M이었다 — NXT 거래가능 606종목(대부분 대형주)은 KRX 기준으로 보면 40~45%가
 * 빠진다. 순위 자체도 흔들려 거래대금 top-100이 통합 기준과 13종목 달랐다.
 *
 * 그래서 시장 전체 TR은 전부 통합으로 부른다. 대가로 응답의 코드가 `005930_AL` /
 * `001_AL`로 오는데, 이건 `types.ts`의 `code()` 헬퍼가 파싱 단계에서 떼어낸다.
 *
 * 계좌 TR(ka10075/ka10076)의 `stex_tp: "0"`은 건드리지 않는다 — 그쪽은 체결이 일어난
 * 거래소를 그대로 받아야 하고, 코드도 계좌가 준 것을 쓴다.
 */
const STEX_UNIFIED = "3";

/** ka10001 주식기본정보요청 */
export async function fetchStockInfo(client: KiwoomClient, stockCode: string): Promise<StockInfoResponse> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10001",
    body: { stk_cd: toUnifiedCode(stockCode) },
  });
  const info = stockInfoResponseSchema.parse(res.json);
  if (!info.stk_nm && !info.cur_prc) {
    throw new KiwoomApiError(`종목코드 ${stockCode}에 대한 시세 정보가 없습니다. 코드를 확인해 주세요.`, {
      apiId: "ka10001",
    });
  }
  return info;
}

/**
 * ka10095 관심종목정보요청 — 이름과 달리 임의의 멀티코드 일괄 시세 TR.
 * stk_cd에 `|`로 이어붙인 코드를 넘기면 요청 순서대로 한 코드당 한 행을 돌려준다
 * (30코드 단일 콜 mock-probed 2026-07-22, cont-yn N). 미상장/오타 코드는 rc=0에
 * 전 필드 공백 행으로 오므로 호출부에서 blank stk_cd 행을 걸러낸다.
 */
export async function fetchBatchQuotes(
  client: KiwoomClient,
  stockCodes: string[],
): Promise<BatchQuoteItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10095",
    body: { stk_cd: stockCodes.map(toUnifiedCode).join("|") },
  });
  return parseArray(res.json, "atn_stk_infr", batchQuoteItemSchema);
}

/** kt00001 예수금상세현황요청 (qry_tp: 3=추정조회, 2=일반조회) */
export async function fetchDeposit(client: KiwoomClient, qryTp: "2" | "3" = "3"): Promise<DepositResponse> {
  const res = await client.call({
    path: ACCOUNT_PATH,
    apiId: "kt00001",
    body: { qry_tp: qryTp },
  });
  return depositResponseSchema.parse(res.json);
}

/**
 * kt00018 계좌평가잔고내역요청 (qry_tp: 1=합산, 2=개별).
 * Follows cont-yn/next-key continuation headers and merges all holding rows.
 */
export async function fetchAccountEvaluation(
  client: KiwoomClient,
  qryTp: "1" | "2",
): Promise<AccountEvaluationResponse & { truncated: boolean }> {
  const body = { qry_tp: qryTp, dmst_stex_tp: "KRX" };

  let res = await client.call({ path: ACCOUNT_PATH, apiId: "kt00018", body });
  const first = accountEvaluationResponseSchema.parse(res.json);
  const holdings = [...first.acnt_evlt_remn_indv_tot];

  let pages = 1;
  while (res.hasNext && pages < MAX_PAGES) {
    await sleep(PAGE_INTERVAL_MS);
    res = await client.call({ path: ACCOUNT_PATH, apiId: "kt00018", body, contYn: "Y", nextKey: res.nextKey });
    const page = accountEvaluationResponseSchema.parse(res.json);
    holdings.push(...page.acnt_evlt_remn_indv_tot);
    pages += 1;
  }

  // 남은 페이지가 있는데 상한에서 멈췄으면 데이터가 잘렸다는 뜻.
  return { ...first, acnt_evlt_remn_indv_tot: holdings, truncated: res.hasNext };
}

/**
 * kt00004 계좌평가현황요청 — consumed only for the 당일/당월/누적 투자손익 block
 * (기간 손익); the deposit/evaluation scalars and per-stock list duplicate
 * kt00001/kt00018. qry_tp "0" = 상장폐지 포함 전체 (probe-validated body).
 */
export async function fetchAccountPeriodPl(client: KiwoomClient): Promise<AccountPeriodPlResponse> {
  const res = await client.call({
    path: ACCOUNT_PATH,
    apiId: "kt00004",
    body: { qry_tp: "0", dmst_stex_tp: "KRX" },
  });
  return accountPeriodPlResponseSchema.parse(res.json);
}

/**
 * kt00002 일별추정예탁자산현황요청 — [startDt, endDt] (yyyyMMdd) 일별 자산 추이.
 * 모의투자 미지원(RC9000). 행은 주말·휴장일 포함 달력일 단위, 오래된 날짜부터
 * (30일 = 30행, cont-yn N — REAL 프로브 2026-07-23). 페이지 크기가 미문서라
 * 장기 조회 대비 kt00018과 같은 cont-yn 루프를 태운다.
 */
export async function fetchDailyAssetTrend(
  client: KiwoomClient,
  startDt: string,
  endDt: string,
): Promise<{ rows: DailyAssetItem[]; truncated: boolean }> {
  const body = { start_dt: startDt, end_dt: endDt };

  let res = await client.call({ path: ACCOUNT_PATH, apiId: "kt00002", body });
  const rows = parseArray(res.json, "daly_prsm_dpst_aset_amt_prst", dailyAssetItemSchema);

  let pages = 1;
  while (res.hasNext && pages < MAX_PAGES) {
    await sleep(PAGE_INTERVAL_MS);
    res = await client.call({ path: ACCOUNT_PATH, apiId: "kt00002", body, contYn: "Y", nextKey: res.nextKey });
    rows.push(...parseArray(res.json, "daly_prsm_dpst_aset_amt_prst", dailyAssetItemSchema));
    pages += 1;
  }

  return { rows, truncated: res.hasNext };
}

/**
 * kt00016 일별계좌수익률상세현황요청 — 이름과 달리 [frDt, toDt] 기간 요약 FLAT 응답
 * (초/말 쌍 + 수익률/회전율/입출금 집계). 모의투자 미지원(RC9000).
 */
export async function fetchAccountReturnSummary(
  client: KiwoomClient,
  frDt: string,
  toDt: string,
): Promise<AccountReturnSummary> {
  const res = await client.call({
    path: ACCOUNT_PATH,
    apiId: "kt00016",
    body: { fr_dt: frDt, to_dt: toDt },
  });
  return accountReturnSummarySchema.parse(res.json);
}

/**
 * kt00015 위탁종합거래내역요청 — all transactions in [fromDate, toDate] (yyyyMMdd).
 * NOTE (live-verified): only 매매 rows are returned for this account type; cash
 * deposit rows never appeared under any tp/gds_tp combination. Dividend rows
 * are therefore unverified — callers must handle their possible absence.
 */
export async function fetchTransactions(
  client: KiwoomClient,
  fromDate: string,
  toDate: string,
): Promise<{ rows: TransactionRow[]; truncated: boolean }> {
  const body = { strt_dt: fromDate, end_dt: toDate, tp: "0", gds_tp: "0", dmst_stex_tp: "KRX" };

  let res = await client.call({ path: ACCOUNT_PATH, apiId: "kt00015", body });
  const rows = [...transactionsResponseSchema.parse(res.json).trst_ovrl_trde_prps_array];

  let pages = 1;
  while (res.hasNext && pages < MAX_PAGES) {
    await sleep(PAGE_INTERVAL_MS);
    res = await client.call({ path: ACCOUNT_PATH, apiId: "kt00015", body, contYn: "Y", nextKey: res.nextKey });
    rows.push(...transactionsResponseSchema.parse(res.json).trst_ovrl_trde_prps_array);
    pages += 1;
  }

  // 남은 페이지가 있는데 상한에서 멈췄으면 오래된 거래가 잘렸다는 뜻.
  return { rows, truncated: res.hasNext };
}

/** ka10074 일자별실현손익요청 — account-wide realized P&L summary for the period. */
export async function fetchRealizedPnlSummary(
  client: KiwoomClient,
  fromDate: string,
  toDate: string,
): Promise<RealizedPnlResponse> {
  const res = await client.call({
    path: ACCOUNT_PATH,
    apiId: "ka10074",
    body: { strt_dt: fromDate, end_dt: toDate },
  });
  return realizedPnlResponseSchema.parse(res.json);
}

/**
 * ka10075 미체결요청 — currently open (unfilled) orders. Read-only.
 * body: all_stk_tp "0"=전체/"1"=종목, trde_tp "0"=전체, stex_tp "0"=통합.
 * Array key `oso` live-verified 2026-07-07 (empty — no open orders on the
 * verification account); item fields are wrapper-sourced, not live-verified. Open orders are
 * few by nature, so only the first page is fetched (no pagination).
 */
export async function fetchPendingOrders(
  client: KiwoomClient,
  stockCode?: string,
): Promise<PendingOrderItem[]> {
  const res = await client.call({
    path: ACCOUNT_PATH,
    apiId: "ka10075",
    body: {
      all_stk_tp: stockCode ? "1" : "0",
      trde_tp: "0",
      stk_cd: stockCode ?? "",
      stex_tp: "0",
    },
  });
  return pendingOrdersResponseSchema.parse(res.json).oso;
}

/**
 * ka10076 체결요청 — 계좌의 체결 내역 (ka10075 미체결의 반대편).
 *
 * qry_tp/sell_tp/stex_tp are all required; stk_cd/ord_no are optional filters.
 * stex_tp "0"=통합 matches ka10075 in the same account family.
 * Mock-probed 2026-07-31: rc=0 on all five body combinations, array key `cntr`, cont-yn N.
 */
export async function fetchOrderExecutions(
  client: KiwoomClient,
  options: { stockCode?: string; side?: "all" | "sell" | "buy"; orderNo?: string } = {},
): Promise<ExecutionItem[]> {
  const { stockCode, side = "all", orderNo } = options;
  const res = await client.call({
    path: ACCOUNT_PATH,
    apiId: "ka10076",
    body: {
      qry_tp: stockCode ? "1" : "0",
      sell_tp: side === "sell" ? "1" : side === "buy" ? "2" : "0",
      stk_cd: stockCode ?? "",
      ord_no: orderNo ?? "",
      stex_tp: "0",
    },
  });
  return executionsResponseSchema.parse(res.json).cntr;
}

/**
 * ka10099 종목정보요약 — full instrument list for one market (stocks + ETF/ETN).
 * mrkt_tp: "0"=코스피(거래소), "10"=코스닥. Single page (live-verified ~2500 rows).
 */
export async function fetchStockList(client: KiwoomClient, marketCode: "0" | "10"): Promise<StockListItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10099",
    body: { mrkt_tp: marketCode },
  });
  return stockListResponseSchema.parse(res.json).list;
}

export type ChartPeriod = "day" | "week" | "month" | "year";

const CHART_TRS: Record<ChartPeriod, { apiId: string; arrayKey: string }> = {
  day: { apiId: "ka10081", arrayKey: "stk_dt_pole_chart_qry" },
  week: { apiId: "ka10082", arrayKey: "stk_stk_pole_chart_qry" },
  month: { apiId: "ka10083", arrayKey: "stk_mth_pole_chart_qry" },
  year: { apiId: "ka10094", arrayKey: "stk_yr_pole_chart_qry" },
};

/**
 * ka10081/82/83/94 일·주·월·년봉 — same item shape, array key differs per TR
 * (년봉 rows carry no pred_pre — schema defaults cover it). Newest first;
 * first page (년봉 ~30, others 240~600 rows) only, which is plenty for LLM
 * consumption and avoids pagination rate-limit cost. upd_stkpc_tp "1" = 수정주가 반영.
 */
export async function fetchDailyChart(
  client: KiwoomClient,
  stockCode: string,
  period: ChartPeriod,
  baseDate: string,
): Promise<DailyChartItem[]> {
  const { apiId, arrayKey } = CHART_TRS[period];
  const res = await client.call({
    path: CHART_PATH,
    apiId,
    body: { stk_cd: toUnifiedCode(stockCode), base_dt: baseDate, upd_stkpc_tp: "1" },
  });
  return parseArray(res.json, arrayKey, dailyChartItemSchema);
}

/** ka10080 분봉 — tic_scope in minutes ("1"|"3"|"5"|"10"|"15"|"30"|"45"|"60"). */
export async function fetchMinuteChart(
  client: KiwoomClient,
  stockCode: string,
  ticScope: string,
): Promise<MinuteChartItem[]> {
  const res = await client.call({
    path: CHART_PATH,
    apiId: "ka10080",
    body: { stk_cd: toUnifiedCode(stockCode), tic_scope: ticScope, upd_stkpc_tp: "1" },
  });
  return parseArray(res.json, "stk_min_pole_chart_qry", minuteChartItemSchema);
}

/**
 * ka10079 틱차트 — tic_scope = 캔들당 틱 수 ("1"|"3"|"5"|"10"|"30"). Row shape는
 * ka10080 분봉과 동일(cntr_tm 포함; top-level last_tic_cnt는 미소비). Newest first,
 * first page (900 rows) only.
 */
export async function fetchTickChart(
  client: KiwoomClient,
  stockCode: string,
  ticScope: string,
): Promise<MinuteChartItem[]> {
  const res = await client.call({
    path: CHART_PATH,
    apiId: "ka10079",
    body: { stk_cd: toUnifiedCode(stockCode), tic_scope: ticScope, upd_stkpc_tp: "1" },
  });
  return parseArray(res.json, "stk_tic_chart_qry", minuteChartItemSchema);
}

const SECTOR_CHART_TRS: Record<ChartPeriod, { apiId: string; arrayKey: string }> = {
  day: { apiId: "ka20006", arrayKey: "inds_dt_pole_qry" },
  week: { apiId: "ka20007", arrayKey: "inds_stk_pole_qry" },
  month: { apiId: "ka20008", arrayKey: "inds_mth_pole_qry" },
  year: { apiId: "ka20019", arrayKey: "inds_yr_pole_qry" },
};

/**
 * ka20006/07/08/19 업종 일·주·월·년봉 — row shape matches the stock chart TRs
 * (dt/OHLC/trde_qty/trde_prica) so the schemas are shared. Index values arrive
 * ×100 as integers ("674795" = 6747.95 — mock-verified against ka20001/ka20003);
 * callers divide by 100 for display. No upd_stkpc_tp (indices have no 수정주가).
 * Newest first, first page only (일 600 / 주 300 / 월 240 / 년 ~40 rows).
 */
export async function fetchSectorChart(
  client: KiwoomClient,
  indsCd: string,
  period: ChartPeriod,
  baseDate: string,
): Promise<DailyChartItem[]> {
  const { apiId, arrayKey } = SECTOR_CHART_TRS[period];
  const res = await client.call({
    path: CHART_PATH,
    apiId,
    body: { inds_cd: indsCd, base_dt: baseDate },
  });
  return parseArray(res.json, arrayKey, dailyChartItemSchema);
}

/**
 * ka20005 업종 분봉 / ka20004 업종 틱차트 — cntr_tm rows like the stock
 * minute/tick TRs (values ×100 like the other sector charts). ka20005의
 * tic_scope는 분 단위, ka20004는 캔들당 틱 수 (doc labels both "틱범위").
 * Newest first, first page (900 rows) only.
 */
export async function fetchSectorIntradayChart(
  client: KiwoomClient,
  indsCd: string,
  kind: "minute" | "tick",
  ticScope: string,
): Promise<MinuteChartItem[]> {
  const isTick = kind === "tick";
  const res = await client.call({
    path: CHART_PATH,
    apiId: isTick ? "ka20004" : "ka20005",
    body: { inds_cd: indsCd, tic_scope: ticScope },
  });
  return parseArray(res.json, isTick ? "inds_tic_chart_qry" : "inds_min_pole_qry", minuteChartItemSchema);
}

/** ka10004 주식호가 — 10-level orderbook; levels 2-10 live in the loose passthrough. */
export async function fetchOrderbook(client: KiwoomClient, stockCode: string): Promise<OrderbookResponse> {
  const res = await client.call({
    path: MRKCOND_PATH,
    apiId: "ka10004",
    body: { stk_cd: stockCode },
  });
  return orderbookResponseSchema.parse(res.json);
}

/** ka20003 전업종지수 — inds_cd "001"=코스피 그룹(31개), "101"=코스닥 그룹(34개). */
export async function fetchAllIndices(client: KiwoomClient, indsCd: "001" | "101"): Promise<IndexItem[]> {
  const res = await client.call({
    path: SECTOR_PATH,
    apiId: "ka20003",
    body: { inds_cd: indsCd },
  });
  return allIndexResponseSchema.parse(res.json).all_inds_idex;
}

/**
 * ka20001/ka20002의 mrkt_tp는 inds_cd 선행 자리에서 유도한다
 * (0xx→"0" 코스피, 1xx→"1" 코스닥, 2xx→"2" 코스피200; mock-probed 2026-07-09).
 * inds_cd 자체는 ka20003의 업종코드 공간을 그대로 쓴다.
 */
function sectorMarketType(indsCd: string): string {
  return indsCd.startsWith("1") ? "1" : indsCd.startsWith("2") ? "2" : "0";
}

/** ka20001 업종현재가 — 업종 지수 스냅샷 + 시간대별 추이. */
export async function fetchSectorPrice(client: KiwoomClient, indsCd: string): Promise<SectorPriceResponse> {
  const res = await client.call({
    path: SECTOR_PATH,
    apiId: "ka20001",
    body: { mrkt_tp: sectorMarketType(indsCd), inds_cd: indsCd },
  });
  return sectorPriceResponseSchema.parse(res.json);
}

/**
 * ka20002 업종별주가 — 업종 구성 종목의 시세. 100행/페이지(종목코드순)이며
 * 첫 페이지만 가져온다; 남은 페이지가 있으면 truncated로 알린다.
 */
export async function fetchSectorStocks(
  client: KiwoomClient,
  indsCd: string,
): Promise<{ items: SectorStockItem[]; truncated: boolean }> {
  const res = await client.call({
    path: SECTOR_PATH,
    apiId: "ka20002",
    body: { mrkt_tp: sectorMarketType(indsCd), inds_cd: indsCd, stex_tp: STEX_UNIFIED },
  });
  return { items: sectorStocksResponseSchema.parse(res.json).inds_stkpc, truncated: res.hasNext };
}

export type InvestorUnit = "amount" | "quantity";

/** amt_qty_tp: "1"=금액(백만원), "2"=수량(주) — 순매수(trde_tp "0") 기준. */
const INVESTOR_UNIT_CODES: Record<InvestorUnit, string> = { amount: "1", quantity: "2" };

/** ka10061 종목별투자자기관종합 — investor net-buy totals over a date range. */
export async function fetchInvestorTotal(
  client: KiwoomClient,
  stockCode: string,
  fromDate: string,
  toDate: string,
  unit: InvestorUnit,
): Promise<InvestorTotalItem | undefined> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10061",
    body: {
      stk_cd: stockCode,
      strt_dt: fromDate,
      end_dt: toDate,
      amt_qty_tp: INVESTOR_UNIT_CODES[unit],
      trde_tp: "0",
      unit_tp: "1",
    },
  });
  return parseArray(res.json, "stk_invsr_orgn_tot", investorTotalItemSchema)[0];
}

/** ka10059 종목별투자자기관 — daily investor net-buy rows, newest first from `date`. */
export async function fetchInvestorDaily(
  client: KiwoomClient,
  stockCode: string,
  date: string,
  unit: InvestorUnit,
): Promise<InvestorDailyItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10059",
    body: {
      dt: date,
      stk_cd: stockCode,
      amt_qty_tp: INVESTOR_UNIT_CODES[unit],
      trde_tp: "0",
      unit_tp: "1",
    },
  });
  return parseArray(res.json, "stk_invsr_orgn", investorDailyItemSchema);
}

/**
 * ka90009 외국인기관매매상위 — one row = rank i of four side-by-side lists
 * (외인 순매도/순매수, 기관 순매도/순매수; 25 rows). amt_qty_tp "1"=금액(천만원),
 * "2"=수량(천주). date 미지정(qry_dt_tp "0") = 최근 거래일.
 */
export async function fetchInvestorRankDaily(
  client: KiwoomClient,
  market: RankingMarket,
  unit: InvestorUnit,
  date?: string,
): Promise<InvestorRankDailyItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka90009",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      amt_qty_tp: unit === "amount" ? "1" : "2",
      qry_dt_tp: date ? "1" : "0",
      ...(date ? { date } : {}),
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "frgnr_orgn_trde_upper", investorRankDailyItemSchema);
}

/**
 * ka10131 기관외국인연속매매현황 — 순매수 상위 100행/page (page 1 only).
 * mrkt_tp에 전체(000)가 없다 (001/101만). amt_qty_tp 코드가 다른 TR과 반대
 * ("0"=금액, "1"=수량)이며 정렬 기준만 바꾼다 — 행에는 금액/수량이 항상 둘 다 온다.
 * dt: 1/3/5/10/20/120일 (netslmt_tp "2"=순매수 고정, stk_inds_tp "0"=종목).
 */
export async function fetchInvestorStreak(
  client: KiwoomClient,
  market: "kospi" | "kosdaq",
  days: string,
  unit: InvestorUnit,
): Promise<InvestorStreakItem[]> {
  const res = await client.call({
    path: FOREIGN_PATH,
    apiId: "ka10131",
    body: {
      dt: days,
      strt_dt: "",
      end_dt: "",
      mrkt_tp: market === "kospi" ? "001" : "101",
      netslmt_tp: "2",
      stk_inds_tp: "0",
      amt_qty_tp: unit === "amount" ? "0" : "1",
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "orgn_frgnr_cont_trde_prst", investorStreakItemSchema);
}

export type RankingMarket = "all" | "kospi" | "kosdaq";

/** mrkt_tp codes shared by the rank TRs (live-verified 000/001; 101 per legacy convention). */
const RANKING_MARKET_CODES: Record<RankingMarket, string> = {
  all: "000",
  kospi: "001",
  kosdaq: "101",
};

/** ka10027 전일대비상위 — sort_tp "1"=상승률, "3"=하락률 (live-verified). */
export async function fetchPriceChangeRanking(
  client: KiwoomClient,
  market: RankingMarket,
  direction: "rise" | "fall",
): Promise<PriceChangeRankItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10027",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      sort_tp: direction === "rise" ? "1" : "3",
      trde_qty_cnd: "0000",
      stk_cnd: "0",
      crd_cnd: "0",
      updown_incls: "1",
      pric_cnd: "0",
      trde_prica_cnd: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "pred_pre_flu_rt_upper", priceChangeRankItemSchema);
}

/** ka10030 당일거래량상위. */
export async function fetchVolumeRanking(
  client: KiwoomClient,
  market: RankingMarket,
): Promise<VolumeRankItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10030",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      sort_tp: "1",
      mang_stk_incls: "0",
      crd_tp: "0",
      trde_qty_tp: "0",
      pric_tp: "0",
      trde_prica_tp: "0",
      mrkt_open_tp: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "tdy_trde_qty_upper", volumeRankItemSchema);
}

/** ka10032 거래대금상위. */
export async function fetchValueRanking(
  client: KiwoomClient,
  market: RankingMarket,
): Promise<ValueRankItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10032",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      mang_stk_incls: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "trde_prica_upper", valueRankItemSchema);
}

/** ka40002 ETF종목정보 — 추적지수·과세유형 등 ETF 기본정보. */
export async function fetchEtfInfo(client: KiwoomClient, stockCode: string): Promise<EtfInfoResponse> {
  const res = await client.call({
    path: ETF_PATH,
    apiId: "ka40002",
    body: { stk_cd: stockCode },
  });
  return etfInfoResponseSchema.parse(res.json);
}

/** ka40001의 dt(기간) 코드 — 조회 순서대로 4행 테이블을 만든다. */
export const ETF_RETURN_PERIODS = [
  { dt: "0", label: "1주" },
  { dt: "1", label: "1개월" },
  { dt: "2", label: "6개월" },
  { dt: "3", label: "1년" },
] as const;

/**
 * ka40001 ETF수익율 — 기간(dt)별 ETF 수익률 + 대상지수 수익률. mock-probed
 * 2026-07-09: etfobjt_idex_cd는 필수(빈값 → 1511 오류)지만 ETF와 대조 검증되지
 * 않는 "벤치마크 지수 선택자"다 — cntr_prft_rt가 그 지수의 기간 수익률로 채워진다.
 * 4개 dt를 순차 호출(같은 TR — 레이트리밋 1.1s 간격)해 기간 순서대로 돌려준다.
 */
export async function fetchEtfReturns(
  client: KiwoomClient,
  stockCode: string,
  benchmarkIndexCode: string,
): Promise<(EtfReturnItem | null)[]> {
  const rows: (EtfReturnItem | null)[] = [];
  for (const [i, period] of ETF_RETURN_PERIODS.entries()) {
    if (i > 0) await sleep(PAGE_INTERVAL_MS);
    const res = await client.call({
      path: ETF_PATH,
      apiId: "ka40001",
      body: { stk_cd: stockCode, etfobjt_idex_cd: benchmarkIndexCode, dt: period.dt },
    });
    rows.push(parseArray(res.json, "etfprft_rt_lst", etfReturnItemSchema)[0] ?? null);
  }
  return rows;
}

/**
 * ka40009 ETF NAV 추이 — 최신순 배열(etfnavarray)이지만 행에 시각 필드가 없다.
 * mock에서는 NAV 관련 필드가 전부 빈 문자열 — 호출부는 빈값을 허용해야 한다.
 */
export async function fetchEtfNav(client: KiwoomClient, stockCode: string): Promise<EtfNavItem[]> {
  const res = await client.call({
    path: ETF_PATH,
    apiId: "ka40009",
    body: { stk_cd: stockCode },
  });
  return parseArray(res.json, "etfnavarray", etfNavItemSchema);
}

/**
 * ka40004의 `txon_type` — ETF 과세유형 필터. ka40002의 `etftxon_type` 문자열과 1:1로
 * 대조 검증했다(실측 2026-08-03): 1→"비과세", 2→"보유기간과세", 4→"배당소득세(부동산)",
 * 5→"배당소득세(해외)". "3"은 어떤 값으로도 0행이라 노출하지 않는다.
 * 갈래별 건수 286/834/14/21 = 1,155로 전체와 정확히 맞아떨어진다.
 */
const ETF_TAX_TYPE_CODES = {
  all: "0",
  tax_free: "1",
  holding_period: "2",
  reit: "4",
  overseas: "5",
} as const;

export type EtfTaxType = keyof typeof ETF_TAX_TYPE_CODES;

/**
 * ka40004 ETF전체시세 — 상장 ETF 전 종목의 종가·NAV·추적오차 스냅샷.
 *
 * 실측 2026-08-03 (REAL·VIRTUAL 응답 동일): 배열 키 `etfall_mrpr`, 100행/page,
 * 전체 1,155종목 = 12페이지. 종가·거래량을 ka10001과 대조해 원/주 단위임을 확인했다.
 *
 * 파라미터 6개가 전부 필수인데 **쓸 수 있는 건 `txon_type`뿐**이다:
 * - `mngmcomp`(운용사)는 3020 KODEX·3191 TIGER·3023 RISE·3027 KIWOOM·3228 ACE·3022 PLUS·
 *   3040 파워·9999 기타까지 확인했지만 코드표가 불완전하다. 종목명이 전 행 "브랜드 공백
 *   이름" 꼴이라 호출부가 접두어로 거르는 편이 전 운용사를 빠짐없이 덮는다.
 * - `navpre`는 결과를 455/700으로 완전 분할하지만 **의미를 확정하지 못했다** — nav 부호,
 *   괴리 방향, 등락 방향 어느 것과도 일치하지 않는다. 설명할 수 없는 필터는 노출하지 않는다.
 * - `txon_yn`은 1=과세(869)/2=비과세(300)인데 부동산 리츠 14종목이 양쪽에 모두 들어가
 *   분할이 깨진다. 같은 축을 `txon_type`이 더 정확히 덮는다.
 *
 * `stex_tp`는 관례대로 통합으로 부르지만, 이 TR은 **통합과 KRX가 1,155종목 전 필드
 * 동일**했다(거래량 총합 차이 0.0%, NXT 단독 "2"는 0행). ETF가 NXT에서 거래되지 않기
 * 때문으로 보인다 — 통합을 주면 코드에 `_AL`만 붙고, 그건 `code()`가 떼어낸다.
 */
export async function fetchEtfAllPrices(
  client: KiwoomClient,
  taxType: EtfTaxType,
): Promise<{ rows: EtfAllPriceItem[]; truncated: boolean }> {
  const body = {
    txon_type: ETF_TAX_TYPE_CODES[taxType],
    navpre: "0",
    mngmcomp: "0000",
    txon_yn: "0",
    trace_idex: "0",
    stex_tp: STEX_UNIFIED,
  };

  let res = await client.call({ path: ETF_PATH, apiId: "ka40004", body });
  const rows = [...etfAllPriceResponseSchema.parse(res.json).etfall_mrpr];

  let pages = 1;
  while (res.hasNext && pages < MAX_PAGES) {
    await sleep(PAGE_INTERVAL_MS);
    res = await client.call({ path: ETF_PATH, apiId: "ka40004", body, contYn: "Y", nextKey: res.nextKey });
    rows.push(...etfAllPriceResponseSchema.parse(res.json).etfall_mrpr);
    pages += 1;
  }

  return { rows, truncated: res.hasNext };
}

/**
 * ka01300 관심종목 그룹 리스트 조회 — HTS에 저장된 관심종목 그룹 목록 (읽기 전용).
 * 응답 배열 키는 nofi. 편집(추가/삭제) TR은 키움 REST에 존재하지 않는다.
 */
export async function fetchWatchlistGroups(client: KiwoomClient): Promise<WatchlistGroupItem[]> {
  const res = await client.call({ path: WATCHLIST_PATH, apiId: "ka01300", body: {} });
  return watchlistGroupsResponseSchema.parse(res.json).nofi;
}

/**
 * ka01301 관심종목 그룹 상세 조회 — 그룹(arn_grp_id = ka01300의 gcod) 내 종목 목록.
 * 응답 배열 키는 nofj (종목코드 cod2 + 북마크 필드만 반환; 종목명/시세는 미포함).
 */
export async function fetchWatchlistGroupDetail(
  client: KiwoomClient,
  groupCode: string,
): Promise<WatchlistStockItem[]> {
  const res = await client.call({
    path: WATCHLIST_PATH,
    apiId: "ka01301",
    body: { arn_grp_id: groupCode },
  });
  return watchlistGroupDetailResponseSchema.parse(res.json).nofj;
}

/**
 * ka90001 테마그룹별요청 — theme groups (all fields live-verified 2026-07-07).
 * `stockCode` set → qry_tp "2" (themes the stock belongs to); else qry_tp "0"
 * (all themes, sorted by change rate). First page only (100/page); open-ended
 * "all" mode paginates but page-1 top rows are what a caller wants.
 * date_tp = 기간수익률 산정 일수, flu_pl_amt_tp "1" = 등락률 상위순.
 */
export async function fetchThemeGroups(
  client: KiwoomClient,
  stockCode?: string,
): Promise<ThemeGroupItem[]> {
  const res = await client.call({
    path: THEME_PATH,
    apiId: "ka90001",
    body: {
      qry_tp: stockCode ? "2" : "0",
      stk_cd: stockCode ?? "",
      date_tp: "10",
      flu_pl_amt_tp: "1",
      stex_tp: STEX_UNIFIED,
    },
  });
  return themeGroupsResponseSchema.parse(res.json).thema_grp;
}

/**
 * ka90002 테마구성종목요청 — member stocks of one theme group (live-verified).
 * Returns the full response so the theme's aggregate flu_rt/dt_prft_rt (top-level
 * fields) are available to the caller. themeCode = ka90001 `thema_grp_cd`.
 */
export async function fetchThemeStocks(
  client: KiwoomClient,
  themeCode: string,
): Promise<ThemeStocksResponse> {
  const res = await client.call({
    path: THEME_PATH,
    apiId: "ka90002",
    body: { date_tp: "2", thema_grp_cd: themeCode, stex_tp: STEX_UNIFIED },
  });
  return themeStocksResponseSchema.parse(res.json);
}

/**
 * ka10014 공매도추이요청 — per-stock daily short-selling trend over [fromDate, toDate].
 * All fields live-verified 2026-07-07. tm_tp "1" = 일별. Rows newest-first.
 */
/**
 * ka10046 체결강도 시간별 / ka10047 체결강도 일별 (둘 다 `/api/dostk/mrkcond`,
 * body는 `{stk_cd}` 하나뿐). Mock-probed 2026-07-29: rc=0, 배열 키·필드가 스펙과
 * 정확히 일치(누락·초과 0), 각 60행 최신순, `cont-yn=Y`.
 *
 * **페이지 1만 조회**한다 — 시간별은 최근 60분, 일별은 최근 60거래일이면 충분하고,
 * 이건 ka10008(외국인)/ka90013(프로그램 종목별)과 같은 판단이다.
 *
 * 없는 종목코드는 rc=0 + 빈 배열로 온다 (실측) → 호출부에서 빈 목록 안내.
 * 시간외 단일가 TR(ka10087/ka10098)과 달리 **NXT 종목도 정상 제공**한다 (005930으로 실측).
 */
export type ExecutionStrengthView = "intraday" | "daily";

export async function fetchExecutionStrength(
  client: KiwoomClient,
  stockCode: string,
  view: ExecutionStrengthView,
): Promise<ExecutionStrengthItem[]> {
  const res = await client.call({
    path: MRKCOND_PATH,
    apiId: view === "intraday" ? "ka10046" : "ka10047",
    body: { stk_cd: toUnifiedCode(stockCode) },
  });
  return view === "intraday"
    ? executionStrengthIntradayResponseSchema.parse(res.json).cntr_str_tm
    : executionStrengthDailyResponseSchema.parse(res.json).cntr_str_daly;
}

export async function fetchShortSelling(
  client: KiwoomClient,
  stockCode: string,
  fromDate: string,
  toDate: string,
): Promise<ShortSellingItem[]> {
  const res = await client.call({
    path: SHORT_PATH,
    apiId: "ka10014",
    body: { stk_cd: toUnifiedCode(stockCode), tm_tp: "1", strt_dt: fromDate, end_dt: toDate },
  });
  return shortSellingResponseSchema.parse(res.json).shrts_trnsn;
}

/**
 * ka10045 종목별기관매매추이요청 — 기관·외국인의 **추정평균단가**와 일별/기간누적 순매수.
 *
 * 실측 2026-08-03 (REAL·VIRTUAL 동일): 경로는 `/api/dostk/mrkcond`(종목정보 아님),
 * 배열 키 `stk_orgn_trde_trnsn`, 최신 일자가 먼저 온다. 5개 파라미터가 **전부 필수**로,
 * `orgn_prsm_unp_tp`/`for_prsm_unp_tp`를 빼면 rc=2로 거절당한다.
 *
 * 그런데 그 두 구분값은 **결과를 바꾸지 않는다** — "0"~"4"를 모두 넣어봤지만 추정평균단가가
 * 동일했다. 형식상 요구될 뿐이라 "1"로 고정하고, 값을 tool 입력으로 노출하지 않는다.
 *
 * 추정평균단가는 거래소별로 갈린다(KRX 264,195 vs 통합 264,002) — 서버의 다른 시세와
 * 기준을 맞추려면 `toUnifiedCode`가 필요하다.
 */
export async function fetchInstitutionTrend(
  client: KiwoomClient,
  stockCode: string,
  fromDate: string,
  toDate: string,
): Promise<InstitutionTrendResponse> {
  const res = await client.call({
    path: MRKCOND_PATH,
    apiId: "ka10045",
    body: {
      stk_cd: toUnifiedCode(stockCode),
      strt_dt: fromDate,
      end_dt: toDate,
      orgn_prsm_unp_tp: "1",
      for_prsm_unp_tp: "1",
    },
  });
  return institutionTrendResponseSchema.parse(res.json);
}

/**
 * ka10008 주식외국인종목별매매동향 — per-stock daily foreign holding trend
 * (보유주식수/보유비중/한도소진률). Live-verified 2026-07-07. Paginates (50/page,
 * `hasNext`); first page only — recent days are what a caller wants.
 */
export async function fetchForeignHolding(
  client: KiwoomClient,
  stockCode: string,
): Promise<ForeignHoldingItem[]> {
  const res = await client.call({
    path: FOREIGN_PATH,
    apiId: "ka10008",
    body: { stk_cd: toUnifiedCode(stockCode) },
  });
  return foreignHoldingResponseSchema.parse(res.json).stk_frgnr;
}

export type ViDirection = "all" | "up" | "down";
export type ViType = "all" | "static" | "dynamic";

const VI_DIRECTION_CODES: Record<ViDirection, string> = { all: "0", up: "1", down: "2" };
const VI_TYPE_CODES: Record<ViType, string> = { all: "0", static: "1", dynamic: "2" };

/**
 * ka10054 변동성완화장치(VI) 발동종목 — mock-probed 2026-07-10. 필터 12종 중
 * 거래량/거래대금 필터는 미사용("0"), skip_stk "000000000" = 전종목 포함.
 * stockCode 지정 시 해당 종목의 당일 발동 내역만 (미발동이면 빈 배열).
 */
export async function fetchViStocks(
  client: KiwoomClient,
  market: RankingMarket,
  direction: ViDirection,
  viType: ViType,
  stockCode?: string,
): Promise<ViStockItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10054",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      bf_mkrt_tp: "0",
      stk_cd: stockCode ?? "",
      motn_tp: VI_TYPE_CODES[viType],
      skip_stk: "000000000",
      trde_qty_tp: "0",
      min_trde_qty: "0",
      max_trde_qty: "0",
      trde_prica_tp: "0",
      min_trde_prica: "0",
      max_trde_prica: "0",
      motn_drc: VI_DIRECTION_CODES[direction],
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "motn_stk", viStockItemSchema);
}

/** ka10002 주식거래원 — 상위 5 매도/매수 거래원 (flat 37 fields, mock-probed 2026-07-10). */
export async function fetchBrokerActivity(
  client: KiwoomClient,
  stockCode: string,
): Promise<BrokerActivityResponse> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10002",
    body: { stk_cd: stockCode },
  });
  return brokerActivityResponseSchema.parse(res.json);
}

/**
 * ka10068(전체)/ka20068(종목별) 대차거래추이 — securities-lending daily trend.
 * 두 TR은 배열 키(dbrt_trde_trnsn)와 행 구조가 동일하다 (mock-probed 2026-07-10).
 * stockCode 지정 시 ka20068 (all_tp "0" = 입력종목만), 미지정 시 ka10068 시장 전체
 * (all_tp "1" = 전체표시). Rows newest-first.
 */
export async function fetchLendingTrend(
  client: KiwoomClient,
  stockCode: string | undefined,
  fromDate: string,
  toDate: string,
): Promise<LendingTrendItem[]> {
  const res = await client.call(
    stockCode
      ? {
          path: SLB_PATH,
          apiId: "ka20068",
          body: { stk_cd: stockCode, all_tp: "0", strt_dt: fromDate, end_dt: toDate },
        }
      : {
          path: SLB_PATH,
          apiId: "ka10068",
          body: { all_tp: "1", strt_dt: fromDate, end_dt: toDate },
        },
  );
  return lendingTrendResponseSchema.parse(res.json).dbrt_trde_trnsn;
}

export type ProgramMarket = "kospi" | "kosdaq";

/** ka90003만 쓰는 P-접두 시장코드 — 전체(all) 옵션이 없는 TR이다. */
const PROGRAM_MARKET_CODES: Record<ProgramMarket, string> = {
  kospi: "P00101",
  kosdaq: "P10102",
};

/**
 * ka90003 프로그램순매수상위50 — program-trading net buy/sell top-50 for the day.
 * trde_upper_tp "1"=순매도, "2"=순매수; amt_qty_tp는 투자자 TR과 동일 코드
 * (1=금액 백만원, 2=수량 주)이며 prm_* 필드의 단위가 이를 따른다. 장 시작 전에는
 * rc=0 + 빈 배열이 온다 (mock-probed 2026-07-10 08:30 KST).
 */
export async function fetchProgramTrades(
  client: KiwoomClient,
  direction: "net_buy" | "net_sell",
  unit: InvestorUnit,
  market: ProgramMarket,
): Promise<ProgramTradeItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka90003",
    body: {
      trde_upper_tp: direction === "net_sell" ? "1" : "2",
      amt_qty_tp: INVESTOR_UNIT_CODES[unit],
      mrkt_tp: PROGRAM_MARKET_CODES[market],
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "prm_netprps_upper_50", programTradeItemSchema);
}

export type ProgramTrendGranularity = "daily" | "intraday";

/**
 * ka90010 (일자별) / ka90005 (시간대별) 프로그램매매추이 — market-wide program-trading
 * trend. Both TRs share body + array key (`prm_trde_trnsn`); only the row axis
 * differs (see programTrendItemSchema). date = 기준일 (rows run backwards from it;
 * on ka90005 it selects the session day). amt_qty_tp fixed "1" — rows carry both
 * 금액/수량 fields regardless; min_tic_tp "1"=분 (tick mode adds nothing for display).
 * Page-1 only: ka90005 fits one page intraday (cont-yn N mid-session), ka90010 is
 * 100 rows/page cont-yn Y → truncated flag.
 */
export async function fetchProgramTrend(
  client: KiwoomClient,
  granularity: ProgramTrendGranularity,
  market: ProgramMarket,
  baseDate: string,
): Promise<{ items: ProgramTrendItem[]; truncated: boolean }> {
  const res = await client.call({
    path: MRKCOND_PATH,
    apiId: granularity === "intraday" ? "ka90005" : "ka90010",
    body: {
      date: baseDate,
      amt_qty_tp: "1",
      mrkt_tp: PROGRAM_MARKET_CODES[market],
      min_tic_tp: "1",
      stex_tp: STEX_UNIFIED,
    },
  });
  return {
    items: parseArray(res.json, "prm_trde_trnsn", programTrendItemSchema),
    truncated: res.hasNext,
  };
}

/**
 * ka90013 종목일별프로그램매매추이 — per-stock daily program-trading trend.
 * date = 기준일 (rows run backwards; blank = 최근일). amt_qty_tp fixed "1"
 * (no effect on row content — mock-probed 2026-07-24). 20 rows/page cont-yn Y →
 * page-1 only + truncated flag (ka10008 foreign-holding precedent).
 */
export async function fetchStockProgramTrend(
  client: KiwoomClient,
  stockCode: string,
  baseDate: string,
): Promise<{ items: StockProgramTrendItem[]; truncated: boolean }> {
  const res = await client.call({
    path: MRKCOND_PATH,
    apiId: "ka90013",
    body: { amt_qty_tp: "1", stk_cd: stockCode, date: baseDate },
  });
  return {
    items: parseArray(res.json, "stk_daly_prm_trde_trnsn", stockProgramTrendItemSchema),
    truncated: res.hasNext,
  };
}

/**
 * ka10170 당일매매일지요청 — the day's trading journal (per-stock realized P&L). Account-scoped.
 * Returns the full response (period totals + return_msg) so callers can surface the
 * "최근 2개월 이내" notice. base_dt yyyyMMdd; ottks_tp "1" = 단주 포함, ch_crd_tp "0" = 전체.
 * NOTE: an empty day returns one all-blank row — callers must filter blank rows.
 */
export async function fetchTradingJournal(
  client: KiwoomClient,
  baseDate: string,
): Promise<TradingJournalResponse> {
  const res = await client.call({
    path: ACCOUNT_PATH,
    apiId: "ka10170",
    body: { base_dt: baseDate, ottks_tp: "1", ch_crd_tp: "0" },
  });
  return tradingJournalResponseSchema.parse(res.json);
}

/**
 * ka10016 신고저가요청 — stocks marking a new period high/low (mock-verified
 * 2026-07-08; REAL not yet probed). ntl_tp "1"=신고가, "2"=신저가; dt = lookback
 * days (5/10/20/60/250); array key `ntl_pric`. Filter params fixed to "all".
 */
export async function fetchNewHighLow(
  client: KiwoomClient,
  market: RankingMarket,
  direction: "high" | "low",
  days: string,
): Promise<NewHighLowItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10016",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      ntl_tp: direction === "high" ? "1" : "2",
      high_low_close_tp: "1",
      stk_cnd: "0",
      trde_qty_tp: "00000",
      crd_cnd: "0",
      updown_incls: "0",
      dt: days,
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "ntl_pric", newHighLowItemSchema);
}

/**
 * ka10017 상하한가요청 — stocks at the daily upper/lower price limit
 * (mock-verified 2026-07-08; REAL not yet probed). updown_tp "1"=상한, "4"=하한;
 * sort_tp "3"=등락률순; array key `updown_pric`. `cnt` = 연속 도달 횟수.
 */
export async function fetchLimitStocks(
  client: KiwoomClient,
  market: RankingMarket,
  direction: "upper" | "lower",
): Promise<LimitStockItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10017",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      updown_tp: direction === "upper" ? "1" : "4",
      sort_tp: "3",
      stk_cnd: "0",
      trde_qty_tp: "00000",
      crd_cnd: "0",
      trde_gold_tp: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "updown_pric", limitStockItemSchema);
}

/**
 * ka10019 가격급등락요청 — sharp movers vs the previous day (mock-verified
 * 2026-07-08; REAL not yet probed). flu_tp "1"=급등, "2"=급락; tm_tp "2"/tm "1"
 * fixes the baseline to 1 trading day ago; array key `pric_jmpflu`.
 * `jmp_rt` = 기준가(base_pric) 대비 급등/급락률.
 */
export async function fetchPriceJumps(
  client: KiwoomClient,
  market: RankingMarket,
  direction: "surge" | "plunge",
): Promise<PriceJumpItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10019",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      flu_tp: direction === "surge" ? "1" : "2",
      tm_tp: "2",
      tm: "1",
      trde_qty_tp: "00000",
      stk_cnd: "0",
      crd_cnd: "0",
      pric_cnd: "0",
      updown_incls: "1",
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "pric_jmpflu", priceJumpItemSchema);
}

/**
 * ka10023 거래량급증요청 — volume surges vs the previous day (mock-verified +
 * live-verified on REAL 2026-07-23). Path is /api/dostk/rkinfo (NOT stkinfo like
 * the other movers TRs). sort_tp "1"=급증량순 — 급증률(2) sort surfaces degenerate
 * micro-base rows (prev 11주 → +49709%). tm_tp "2"=전일 기준 (tm은 분 모드 전용).
 * trde_qty_tp "5"=5천주 이상 — 이 TR엔 "전체" 옵션이 없어 "5"가 최소 필터.
 * Array key `trde_qty_sdnin`, 200 rows/page (cont-yn Y) — page-1 only (movers 패턴).
 */
export async function fetchVolumeSurge(
  client: KiwoomClient,
  market: RankingMarket,
): Promise<VolumeSurgeItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10023",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      sort_tp: "1",
      tm_tp: "2",
      trde_qty_tp: "5",
      tm: "",
      stk_cnd: "0",
      pric_tp: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return parseArray(res.json, "trde_qty_sdnin", volumeSurgeItemSchema);
}

/**
 * ka10087 시간외단일가요청 — after-hours single-price session (16:00~18:00 KST)
 * quote + 5-level book for one stock (mock-probed 2026-07-26). Flat response,
 * no array. 시간외 단일가 체결이 없는 종목은 rc=0에 호가·거래량이 전부 0으로 온다
 * (현재가에는 당일 종가가 실림).
 */
export async function fetchAfterHoursQuote(
  client: KiwoomClient,
  stockCode: string,
): Promise<AfterHoursQuoteResponse> {
  const res = await client.call({
    path: MRKCOND_PATH,
    apiId: "ka10087",
    // 여기만 `toUnifiedCode`를 쓰지 않는다 — 이 TR은 `_AL`을 붙이면 rc=0에 값이 전부
    // 빈 껍데기로 온다(실측 2026-08-03, REAL·VIRTUAL 동일). 애초에 NXT 거래가능 종목을
    // 통째로 누락하는 TR이라 통합 개념이 성립하지 않는다.
    body: { stk_cd: stockCode },
  });
  return afterHoursQuoteResponseSchema.parse(res.json);
}

export type AfterHoursSort = "up_rate" | "up_amount" | "down_rate" | "down_amount" | "unchanged";

const AFTER_HOURS_SORT_CODES: Record<AfterHoursSort, string> = {
  up_rate: "1",
  up_amount: "2",
  down_rate: "3",
  down_amount: "4",
  unchanged: "5",
};

/** trde_qty_cnd 코드 — 시간외 단일가는 1주짜리 체결이 상위를 차지해 필터가 유용하다. */
export type AfterHoursMinVolume = "all" | "100" | "500" | "1000" | "5000" | "10000" | "50000" | "100000";

const AFTER_HOURS_VOLUME_CODES: Record<AfterHoursMinVolume, string> = {
  all: "0",
  "100": "10",
  "500": "50",
  "1000": "100",
  "5000": "500",
  "10000": "1000",
  "50000": "5000",
  "100000": "10000",
};

/**
 * ka10098 시간외단일가등락율순위요청 — after-hours single-price movers
 * (mock-probed 2026-07-26; path /api/dostk/rkinfo). All six body fields are
 * required. 정렬은 당일 종가 대비 등락률/등락폭 기준이며, 행의 flu_rt도 같은 기준이다
 * (전일 대비 등락률은 tdy_close_pric_flu_rt 쪽). Array key `ovt_sigpric_flu_rt_rank`,
 * 100 rows/page (cont-yn Y) — page-1 only (movers 패턴).
 */
export async function fetchAfterHoursRank(
  client: KiwoomClient,
  market: RankingMarket,
  sort: AfterHoursSort,
  minVolume: AfterHoursMinVolume,
): Promise<AfterHoursRankItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10098",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      sort_base: AFTER_HOURS_SORT_CODES[sort],
      stk_cnd: "0",
      trde_qty_cnd: AFTER_HOURS_VOLUME_CODES[minVolume],
      crd_cnd: "0",
      trde_prica: "0",
    },
  });
  return parseArray(res.json, "ovt_sigpric_flu_rt_rank", afterHoursRankItemSchema);
}

export type DailyTradingView = "flow" | "session";

/** indc_tp: "0"=수량(주), "1"=금액(백만원) — 순위 TR의 amt_qty_tp와 코드가 반대다. */
const DAILY_FLOW_UNIT_CODES: Record<InvestorUnit, string> = { quantity: "0", amount: "1" };

/**
 * ka10086 일별주가요청 — 일자별 OHLC + 개인/기관/외국인 순매수 + 외국계·프로그램 +
 * 신용비율을 **한 행에** 담아 주는 유일한 TR. mock/REAL 실측 2026-08-03 (005930):
 * rc=0, 배열 키 `daly_stkpc`, 22필드 전부 채워짐, 20행/page, cont-yn=Y.
 *
 * `unit`은 개인/기관/외국계/프로그램 열의 단위만 바꾼다 — **외국인 순매수는 두 모드에서
 * 값이 같다**. 키움 스펙의 주의사항("외국인순매수 데이터는 거래소로부터 금액데이터가
 * 제공되지 않고 수량으로만 조회됩니다")을 양 환경에서 실측 확인했다.
 *
 * 20행/page라 30일치도 2페이지가 필요하다 → 필요한 행 수를 채울 때까지만 이어 받는다.
 */
export async function fetchDailyFlow(
  client: KiwoomClient,
  stockCode: string,
  baseDate: string,
  unit: InvestorUnit,
  minRows: number,
): Promise<{ rows: DailyFlowItem[]; truncated: boolean }> {
  const body = { stk_cd: toUnifiedCode(stockCode), qry_dt: baseDate, indc_tp: DAILY_FLOW_UNIT_CODES[unit] };

  let res = await client.call({ path: MRKCOND_PATH, apiId: "ka10086", body });
  const rows = [...dailyFlowResponseSchema.parse(res.json).daly_stkpc];

  let pages = 1;
  while (rows.length < minRows && res.hasNext && pages < MAX_PAGES) {
    await sleep(PAGE_INTERVAL_MS);
    res = await client.call({ path: MRKCOND_PATH, apiId: "ka10086", body, contYn: "Y", nextKey: res.nextKey });
    rows.push(...dailyFlowResponseSchema.parse(res.json).daly_stkpc);
    pages += 1;
  }

  // 요청한 행 수를 못 채우고 상한에서 멈춘 경우에만 잘렸다고 본다.
  return { rows, truncated: rows.length < minRows && res.hasNext };
}

/**
 * ka10015 일별거래상세요청 — 일자별 거래량을 **장전/장중/장후로 쪼개서** 주는 TR.
 * mock/REAL 실측 2026-08-03 (005930): rc=0, 배열 키 `daly_trde_dtl`, 100행/page.
 *
 * 스펙상 이 TR에도 체결강도·투자자 순매수·프로그램·신용잔고율 컬럼이 있지만 **모의·실전
 * 양쪽 모두 전 행이 공백**이다 (ka40009 blank-NAV와 같은 부류). 그 축은 ka10086이
 * 채워서 주므로 여기서는 세션별 분포만 소비한다.
 *
 * 100행이면 어떤 기본값보다 넉넉해 페이지 1만 조회한다.
 */
export async function fetchDailySession(
  client: KiwoomClient,
  stockCode: string,
  baseDate: string,
): Promise<DailySessionItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10015",
    body: { stk_cd: toUnifiedCode(stockCode), strt_dt: baseDate },
  });
  return dailySessionResponseSchema.parse(res.json).daly_trde_dtl;
}

/** ka10051 amt_qty_tp: "0"=금액, "1"=수량 — ka10086(indc_tp)과도, 순위 TR(amt_qty_tp)과도 코드가 다르다. */
const SECTOR_NET_BUY_UNIT_CODES: Record<InvestorUnit, string> = { amount: "0", quantity: "1" };

export type SectorMarket = "kospi" | "kosdaq";

const SECTOR_MARKET_CODES: Record<SectorMarket, string> = { kospi: "0", kosdaq: "1" };

/**
 * ka10051 업종별투자자순매수요청 — 한 콜로 시장 전체 업종의 투자자 주체별 순매수를
 * 준다. mock/REAL 실측 2026-08-03: rc=0, 배열 키 `inds_netprps`, 코스피 28행 /
 * 코스닥 32행, cont-yn=N(단일 페이지), 20필드 전부 값 있음.
 *
 * `stex_tp`는 다른 시장 TR과 함께 통합(STEX_UNIFIED)으로 부른다. 그러면 `inds_cd`가
 * `001_AL` 꼴로 오는데(v0.30까지 KRX로 부른 이유가 이것이었다), 지금은 `code()` 헬퍼가
 * 접미사를 떼므로 업종 코드는 그대로 3자리로 다뤄진다.
 *
 * `base_dt`는 빈 문자열이면 최근 거래일. 값을 넣으면 그 날짜 기준으로 바뀐다(실측).
 */
export async function fetchSectorNetBuy(
  client: KiwoomClient,
  market: SectorMarket,
  unit: InvestorUnit,
  baseDate: string,
): Promise<SectorNetBuyItem[]> {
  const res = await client.call({
    path: SECTOR_PATH,
    apiId: "ka10051",
    body: {
      mrkt_tp: SECTOR_MARKET_CODES[market],
      amt_qty_tp: SECTOR_NET_BUY_UNIT_CODES[unit],
      base_dt: baseDate,
      stex_tp: STEX_UNIFIED,
    },
  });
  return sectorNetBuyResponseSchema.parse(res.json).inds_netprps;
}

/** ka10101 업종코드 리스트의 mrkt_tp — 5개 그룹을 합쳐야 전체 업종 코드가 된다. */
export const SECTOR_CODE_MARKETS = ["0", "1", "2", "4", "7"] as const;

/**
 * ka10101 업종코드 리스트요청 — 시장구분 하나당 업종 코드/이름 목록.
 * ka10099처럼 **camelCase로 답한다**. 실측 2026-08-03: 코스피 31 / 코스닥 34 /
 * KOSPI200 28 / KOSPI100 2 / KRX100 29행, 모두 cont-yn=N.
 */
export async function fetchSectorCodes(
  client: KiwoomClient,
  marketTp: string,
): Promise<SectorCodeItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10101",
    body: { mrkt_tp: marketTp },
  });
  return sectorCodeListResponseSchema.parse(res.json).list;
}

/** 호가잔량 TR(ka10020/21/22)의 시장구분 — 이 셋만은 "000"(전체)을 받지 않는다. */
export type BidMarket = "kospi" | "kosdaq";

const BID_MARKET_CODES: Record<BidMarket, string> = { kospi: "001", kosdaq: "101" };

export type ExpectedExecutionSort = "rise" | "fall" | "volume";

/** ka10029 sort_tp — 1:상승률, 4:하락률, 6:체결량 (스펙; 2/5 등락폭·3 보합·7/8 상하한은 미노출). */
const EXPECTED_SORT_CODES: Record<ExpectedExecutionSort, string> = {
  rise: "1",
  fall: "4",
  volume: "6",
};

/**
 * ka10029 예상체결등락률상위요청 — 동시호가의 예상체결가 기준 순위.
 *
 * **예상체결은 장 시작 동시호가(08:30~09:00)와 장 마감 동시호가(15:20~15:30)에만
 * 존재한다.** 그 밖의 시간에는 rc=0에 0행으로 온다 (mock·REAL 실측 2026-08-03 07:45)
 * — 실패가 아니라 시간대 문제이므로 호출부에서 그렇게 안내한다.
 *
 * 조건 인자(stk_cnd/crd_cnd/pric_cnd/trde_qty_cnd)는 전부 필수라 "전체조회"로 고정한다.
 */
export async function fetchExpectedExecution(
  client: KiwoomClient,
  market: RankingMarket,
  sort: ExpectedExecutionSort,
): Promise<ExpectedExecutionItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10029",
    body: {
      mrkt_tp: RANKING_MARKET_CODES[market],
      sort_tp: EXPECTED_SORT_CODES[sort],
      trde_qty_cnd: "0",
      stk_cnd: "0",
      crd_cnd: "0",
      pric_cnd: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return expectedExecutionResponseSchema.parse(res.json).exp_cntr_flu_rt_upper;
}

export type BidBalanceSort = "net_buy" | "net_sell" | "buy_ratio" | "sell_ratio";

/** ka10020 sort_tp — 1:순매수잔량순, 2:순매도잔량순, 3:매수비율순, 4:매도비율순. */
const BID_BALANCE_SORT_CODES: Record<BidBalanceSort, string> = {
  net_buy: "1",
  net_sell: "2",
  buy_ratio: "3",
  sell_ratio: "4",
};

/**
 * ka10020 호가잔량상위요청 — 총매도/매수 잔량과 순매수 잔량 기준 순위.
 * 200행/page (cont-yn Y) — 순위 TR 관례대로 page 1만 쓴다.
 *
 * **장 시작 전에는 200행이 오되 잔량·거래량이 전 행 0**이고 정렬도 무의미해져
 * 종목코드순으로 온다 (mock·REAL 실측 2026-08-03 07:45).
 */
export async function fetchBidBalance(
  client: KiwoomClient,
  market: BidMarket,
  sort: BidBalanceSort,
): Promise<BidBalanceItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10020",
    body: {
      mrkt_tp: BID_MARKET_CODES[market],
      sort_tp: BID_BALANCE_SORT_CODES[sort],
      trde_qty_tp: "0000",
      stk_cnd: "0",
      crd_cnd: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return bidBalanceResponseSchema.parse(res.json).bid_req_upper;
}

/** ka10021/ka10022의 거래량 하한 — 두 TR이 같은 코드 체계를 쓴다. */
export type BidSurgeMinVolume = "1000" | "5000" | "10000" | "50000" | "100000";

const BID_SURGE_VOLUME_CODES: Record<BidSurgeMinVolume, string> = {
  "1000": "1",
  "5000": "5",
  "10000": "10",
  "50000": "50",
  "100000": "100",
};

/**
 * ka10021 호가잔량급증요청 — `minutes` 동안 매수(또는 매도) 잔량이 급증한 종목.
 * 장중에만 의미가 있고 그 밖의 시간에는 0행이다 (실측 2026-08-03 07:45).
 */
export async function fetchBidSurge(
  client: KiwoomClient,
  market: BidMarket,
  side: "buy" | "sell",
  minutes: number,
  minVolume: BidSurgeMinVolume,
): Promise<BidSurgeItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10021",
    body: {
      mrkt_tp: BID_MARKET_CODES[market],
      trde_tp: side === "buy" ? "1" : "2",
      sort_tp: "2", // 급증률순 — 급증량순(1)은 대형주만 위로 올라온다
      tm_tp: String(minutes),
      trde_qty_tp: BID_SURGE_VOLUME_CODES[minVolume],
      stk_cnd: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return bidSurgeResponseSchema.parse(res.json).bid_req_sdnin;
}

/**
 * ka10022 잔량율급증요청 — 잔량의 '수량'이 아니라 매수/매도 '비율'이 급증한 종목.
 * 장중 전용인 것은 ka10021과 같다.
 */
export async function fetchBidRatioSurge(
  client: KiwoomClient,
  market: BidMarket,
  side: "buy" | "sell",
  minutes: number,
  minVolume: BidSurgeMinVolume,
): Promise<BidRatioSurgeItem[]> {
  const res = await client.call({
    path: RANK_PATH,
    apiId: "ka10022",
    body: {
      mrkt_tp: BID_MARKET_CODES[market],
      rt_tp: side === "buy" ? "1" : "2",
      tm_tp: String(minutes),
      trde_qty_tp: BID_SURGE_VOLUME_CODES[minVolume],
      stk_cnd: "0",
      stex_tp: STEX_UNIFIED,
    },
  });
  return bidRatioSurgeResponseSchema.parse(res.json).req_rt_sdnin;
}

export type CreditType = "loan" | "short";

/**
 * ka10013의 `qry_tp` — 실측 2026-08-03(005930, REAL·VIRTUAL 동일)으로 **2갈래**임을
 * 확인했다. "1"은 융자, "2"~"5"는 전부 같은 값(대주)을 준다. 문서상 몇 갈래인지와
 * 무관하게 서버는 이 둘만 노출한다.
 */
const CREDIT_TYPE_CODES: Record<CreditType, string> = { loan: "1", short: "2" };

/**
 * ka10013 신용매매동향요청 — 종목의 신용융자/대주 신규·상환·잔고 추이.
 *
 * 실측 2026-08-03 (REAL·VIRTUAL 동일): 경로 `/api/dostk/stkinfo`, 배열 키
 * `crd_trde_trend`, 100행/page(cont-yn=Y), 최신 일자가 먼저. `stk_cd`/`dt`/`qry_tp`
 * 3개가 **전부 필수**로 하나라도 빠지면 rc=2다.
 *
 * `dt`는 시작일이 아니라 **기준일(그 날짜 이하로 거슬러 100행)**이다 — dt=20260710을
 * 주면 20260710 ~ 20260211이 왔다. 신용잔고는 하루 지연 집계라 당일 행은 대개 없다.
 *
 * `_AL`을 붙이면 **시세 컬럼만** 통합으로 바뀐다(cur_prc·pred_pre·trde_qty). 신규·상환·
 * 잔고·공여율·잔고율은 KRX 기준 그대로다 — 신용잔고 자체가 거래소로 갈리지 않기 때문.
 * 그래도 종가·거래량을 서버의 다른 tool과 맞추려면 통합이 맞아서 `toUnifiedCode`를 쓰고,
 * 기준 차이는 포맷터가 각주로 밝힌다.
 */
export async function fetchCreditTrend(
  client: KiwoomClient,
  stockCode: string,
  baseDate: string,
  creditType: CreditType,
): Promise<CreditTrendResponse> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10013",
    body: {
      stk_cd: toUnifiedCode(stockCode),
      dt: baseDate,
      qry_tp: CREDIT_TYPE_CODES[creditType],
    },
  });
  return creditTrendResponseSchema.parse(res.json);
}

export type ValuationMetric = "low_per" | "high_per" | "low_pbr" | "high_pbr" | "low_roe" | "high_roe";

/**
 * ka10026의 `pertp` — 이름은 PER이지만 **PBR·ROE 랭킹도 같은 파라미터로 고른다**.
 * 문서가 없어 ka10001(주식기본정보)의 per/pbr/roe와 교차검증해 확정했다 (실측 2026-08-03):
 * 씨엑스아이 pertp=1 → 0.40 = ka10001 `per`, pertp=3 → 0.01 = ka10001 `pbr`,
 * 비트맥스 pertp=5 → -774.04 = ka10001 `roe`.
 */
const VALUATION_METRIC_CODES: Record<ValuationMetric, string> = {
  low_per: "1",
  high_per: "2",
  low_pbr: "3",
  high_pbr: "4",
  low_roe: "5",
  high_roe: "6",
};

/**
 * ka10026 고저PER요청 — 시장 전체를 PER/PBR/ROE로 줄 세운 100종목.
 *
 * 실측 2026-08-03 (REAL·VIRTUAL 동일): 경로 `/api/dostk/stkinfo`, 배열 키 `high_low_per`,
 * 100행/page(cont-yn=Y). `pertp`·`stex_tp` 둘 다 필수로, `stex_tp`를 빼면 rc=2다.
 * 응답의 값 컬럼 이름이 지표와 무관하게 항상 `per`인 함정은 types.ts 주석 참고.
 *
 * 첫 페이지만 쓴다 — 밸류에이션 스크리닝은 극단값 100종목이면 충분하고, 그 아래는
 * 순위로서 의미가 옅다.
 */
export async function fetchValuationRank(
  client: KiwoomClient,
  metric: ValuationMetric,
): Promise<ValuationRankItem[]> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10026",
    body: {
      pertp: VALUATION_METRIC_CODES[metric],
      stex_tp: STEX_UNIFIED,
    },
  });
  return valuationRankResponseSchema.parse(res.json).high_low_per;
}

export type SupplyMarket = "all" | "kospi" | "kosdaq";

/** ka10025 mrkt_tp — 순위 TR과 달리 "000"(전체)을 받는다 (실측). */
const SUPPLY_MARKET_CODES: Record<SupplyMarket, string> = { all: "000", kospi: "001", kosdaq: "101" };

/**
 * ka10025 매물대집중요청 — 특정 가격대에 거래가 몰린(매물대) 종목 스크리닝.
 *
 * 실측 2026-08-03 (REAL·VIRTUAL 동일): 경로 `/api/dostk/stkinfo`, 배열 키 `prps_cnctr`,
 * 200행/page. 파라미터 6개가 **전부 필수**인데 이름이 `cycl_tp`가 아니라 **`cycle_tp`**다
 * — 틀리면 rc=2와 함께 `필수입력 파라미터=cycle_tp`가 메시지에 찍힌다(이 메시지가 이름을
 * 알려준 단서였다).
 *
 * `prps_cnctr_rt`는 **매물비율 하한(%)**이다 — 결과의 `prps_rt`가 전부 그 값 이상으로 왔다
 * (20→최소 20.00, 50→최소 50.00, 90→최소 90.17). 다만 **20 미만은 빈 결과**다: "0"과 "10"에
 * 0행이 왔다. 데이터가 없는 게 아니라 하한 자체가 먹지 않는 구간이라, tool 입력을 20부터로
 * 막는다.
 *
 * 행 단위가 종목이 아니라 종목 × 매물대 구간이고, 응답은 매물비율 순으로 정렬돼 있지 않다
 * (전 행이 하한 근처부터 섞여 온다). 그래서 페이지를 모두 모은 뒤 포맷터가 정렬한다.
 */
export async function fetchSupplyConcentration(
  client: KiwoomClient,
  market: SupplyMarket,
  minRatio: number,
  zoneCount: number,
  periodDays: number,
  currentPriceOnly: boolean,
): Promise<{ rows: SupplyConcentrationItem[]; truncated: boolean }> {
  const body = {
    mrkt_tp: SUPPLY_MARKET_CODES[market],
    prps_cnctr_rt: String(minRatio),
    cur_prc_entry: currentPriceOnly ? "1" : "0",
    prpscnt: String(zoneCount),
    cycle_tp: String(periodDays),
    stex_tp: STEX_UNIFIED,
  };

  let res = await client.call({ path: STOCK_INFO_PATH, apiId: "ka10025", body });
  const rows = [...supplyConcentrationResponseSchema.parse(res.json).prps_cnctr];

  let pages = 1;
  while (res.hasNext && pages < MAX_PAGES) {
    await sleep(PAGE_INTERVAL_MS);
    res = await client.call({ path: STOCK_INFO_PATH, apiId: "ka10025", body, contYn: "Y", nextKey: res.nextKey });
    rows.push(...supplyConcentrationResponseSchema.parse(res.json).prps_cnctr);
    pages += 1;
  }

  return { rows, truncated: res.hasNext };
}

/**
 * kt00017 계좌별당일현황요청 — 당일 입출금·입출고·매매대금·수수료·세금 + D+2 추정 예수금/평가금액.
 *
 * 실측 2026-08-03: 경로 `/api/dostk/acnt`, **빈 body로 rc=0**이고 배열 없이 스칼라 25필드만
 * 온다. `qry_tp`·`dmst_stex_tp`를 넣어도 응답이 같아 아무것도 보내지 않는다.
 * 모의투자는 RC9000(미제공) — kt00015·kt00002와 같은 부류라 실패가 아니라 mock 한계다.
 */
export async function fetchAccountTodayStatus(client: KiwoomClient): Promise<AccountTodayStatus> {
  const res = await client.call({ path: ACCOUNT_PATH, apiId: "kt00017", body: {} });
  return accountTodayStatusSchema.parse(res.json);
}
