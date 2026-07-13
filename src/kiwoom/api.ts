import { z } from "zod";

import { sleep } from "../utils/sleep.js";
import type { KiwoomClient } from "./client.js";
import { KiwoomApiError } from "./errors.js";
import {
  accountEvaluationResponseSchema,
  accountPeriodPlResponseSchema,
  allIndexResponseSchema,
  brokerActivityResponseSchema,
  dailyChartItemSchema,
  depositResponseSchema,
  etfInfoResponseSchema,
  etfNavItemSchema,
  etfReturnItemSchema,
  foreignHoldingResponseSchema,
  investorDailyItemSchema,
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
  realizedPnlResponseSchema,
  sectorPriceResponseSchema,
  sectorStocksResponseSchema,
  shortSellingResponseSchema,
  stockInfoResponseSchema,
  stockListResponseSchema,
  themeGroupsResponseSchema,
  tradingJournalResponseSchema,
  themeStocksResponseSchema,
  transactionsResponseSchema,
  valueRankItemSchema,
  viStockItemSchema,
  volumeRankItemSchema,
  watchlistGroupDetailResponseSchema,
  watchlistGroupsResponseSchema,
  type AccountEvaluationResponse,
  type AccountPeriodPlResponse,
  type BrokerActivityResponse,
  type DailyChartItem,
  type DepositResponse,
  type EtfInfoResponse,
  type EtfNavItem,
  type EtfReturnItem,
  type ForeignHoldingItem,
  type IndexItem,
  type InvestorDailyItem,
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
  type RealizedPnlResponse,
  type SectorPriceResponse,
  type SectorStockItem,
  type ShortSellingItem,
  type StockInfoResponse,
  type StockListItem,
  type ThemeGroupItem,
  type ThemeStocksResponse,
  type TradingJournalResponse,
  type TransactionRow,
  type ValueRankItem,
  type ViStockItem,
  type VolumeRankItem,
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

/** ka10001 주식기본정보요청 */
export async function fetchStockInfo(client: KiwoomClient, stockCode: string): Promise<StockInfoResponse> {
  const res = await client.call({
    path: STOCK_INFO_PATH,
    apiId: "ka10001",
    body: { stk_cd: stockCode },
  });
  const info = stockInfoResponseSchema.parse(res.json);
  if (!info.stk_nm && !info.cur_prc) {
    throw new KiwoomApiError(`종목코드 ${stockCode}에 대한 시세 정보가 없습니다. 코드를 확인해 주세요.`, {
      apiId: "ka10001",
    });
  }
  return info;
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
    body: { stk_cd: stockCode, base_dt: baseDate, upd_stkpc_tp: "1" },
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
    body: { stk_cd: stockCode, tic_scope: ticScope, upd_stkpc_tp: "1" },
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
    body: { stk_cd: stockCode, tic_scope: ticScope, upd_stkpc_tp: "1" },
  });
  return parseArray(res.json, "stk_tic_chart_qry", minuteChartItemSchema);
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
    body: { mrkt_tp: sectorMarketType(indsCd), inds_cd: indsCd, stex_tp: "1" },
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
      stex_tp: "1",
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
      stex_tp: "1",
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
      stex_tp: "1",
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
 * date_tp = 기간수익률 산정 일수, flu_pl_amt_tp "1" = 등락률 상위순, stex_tp "1" = KRX.
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
      stex_tp: "1",
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
    body: { date_tp: "2", thema_grp_cd: themeCode, stex_tp: "1" },
  });
  return themeStocksResponseSchema.parse(res.json);
}

/**
 * ka10014 공매도추이요청 — per-stock daily short-selling trend over [fromDate, toDate].
 * All fields live-verified 2026-07-07. tm_tp "1" = 일별. Rows newest-first.
 */
export async function fetchShortSelling(
  client: KiwoomClient,
  stockCode: string,
  fromDate: string,
  toDate: string,
): Promise<ShortSellingItem[]> {
  const res = await client.call({
    path: SHORT_PATH,
    apiId: "ka10014",
    body: { stk_cd: stockCode, tm_tp: "1", strt_dt: fromDate, end_dt: toDate },
  });
  return shortSellingResponseSchema.parse(res.json).shrts_trnsn;
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
    body: { stk_cd: stockCode },
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
      stex_tp: "1",
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
      stex_tp: "1",
    },
  });
  return parseArray(res.json, "prm_netprps_upper_50", programTradeItemSchema);
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
      stex_tp: "1",
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
      stex_tp: "1",
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
      stex_tp: "1",
    },
  });
  return parseArray(res.json, "pric_jmpflu", priceJumpItemSchema);
}
