import { z } from "zod";

/**
 * Field names follow the Kiwoom REST API spec verbatim (snake_case, Korean
 * abbreviations). Only fields this server consumes are declared; every schema
 * is loose so unknown fields pass through untouched.
 */

const envelope = {
  return_code: z.union([z.string(), z.number()]).optional(),
  return_msg: z.string().optional(),
};

const str = () => z.string().default("");

// ── au10001: 접근토큰 발급 ──

export const tokenResponseSchema = z.looseObject({
  ...envelope,
  token: z.string().optional(),
  token_type: z.string().optional(),
  /** yyyyMMddHHmmss, KST */
  expires_dt: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// ── ka10001: 주식기본정보 (subset) ──

export const stockInfoResponseSchema = z.looseObject({
  ...envelope,
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 접두 가능)
  pred_pre: str(), // 전일대비
  pre_sig: str(), // 대비기호 1상한 2상승 3보합 4하한 5하락
  flu_rt: str(), // 등락률(%)
  trde_qty: str(), // 거래량
  open_pric: str(),
  high_pric: str(),
  low_pric: str(),
  base_pric: str(), // 기준가(전일종가)
  "250hgst": str(), // 250일 최고
  "250lwst": str(), // 250일 최저
  per: str(),
  eps: str(),
  pbr: str(),
  bps: str(),
  mac: str(), // 시가총액(억원)
});

export type StockInfoResponse = z.infer<typeof stockInfoResponseSchema>;

// ── kt00001: 예수금상세현황 (subset) ──

export const depositResponseSchema = z.looseObject({
  ...envelope,
  entr: str(), // 예수금
  d1_entra: str(), // D+1 추정예수금
  d2_entra: str(), // D+2 추정예수금
  ord_alow_amt: str(), // 주문가능금액
  pymn_alow_amt: str(), // 출금가능금액
});

export type DepositResponse = z.infer<typeof depositResponseSchema>;

// ── kt00018: 계좌평가잔고내역 ──

export const holdingItemSchema = z.looseObject({
  stk_cd: str(), // 종목코드 — "A005930"처럼 A 접두가 붙어 올 수 있음
  stk_nm: str(),
  rmnd_qty: str(), // 보유수량
  trde_able_qty: str(), // 매매가능수량
  pur_pric: str(), // 매입가(평균단가)
  cur_prc: str(), // 현재가
  pur_amt: str(), // 매입금액
  evlt_amt: str(), // 평가금액
  evltv_prft: str(), // 평가손익 (부호 유의미)
  prft_rt: str(), // 수익률(%)
  poss_rt: str(), // 보유비중(%)
  pred_close_pric: str(), // 전일종가
});

export type HoldingItem = z.infer<typeof holdingItemSchema>;

export const accountEvaluationResponseSchema = z.looseObject({
  ...envelope,
  tot_pur_amt: str(), // 총매입금액
  tot_evlt_amt: str(), // 총평가금액
  tot_evlt_pl: str(), // 총평가손익 (부호 유의미)
  tot_prft_rt: str(), // 총수익률(%)
  prsm_dpst_aset_amt: str(), // 추정예탁자산
  acnt_evlt_remn_indv_tot: z.array(holdingItemSchema).default([]),
});

export type AccountEvaluationResponse = z.infer<typeof accountEvaluationResponseSchema>;

// ── kt00015: 위탁종합거래내역 (subset) ──
// NOTE: trde_dt is the settlement date (D+2), not the trade date.

export const transactionRowSchema = z.looseObject({
  trde_dt: str(), // 거래일자(결제 기준, yyyyMMdd)
  cntr_dt: str(), // 체결일자(실제 매매일, yyyyMMdd) — live-verified 2026-07
  trde_unit: str(), // 단가 — 쉼표 포함 포맷("20,190")으로 옴
  trde_no: str(),
  trde_kind_nm: str(), // 거래종류명 — "매매" 등
  rmrk_nm: str(), // 적요명 — "장내매수"/"장내매도" 등
  io_tp_nm: str(), // 입출구분명 — "매수"/"매도" 등
  stk_cd: str(),
  stk_nm: str(),
  trde_qty_jwa_cnt: str(), // 거래수량(좌수)
  trde_amt: str(), // 거래금액
  exct_amt: str(), // 정산금액 (수수료 반영된 실제 입출금액)
  cmsn: str(), // 수수료
});

export type TransactionRow = z.infer<typeof transactionRowSchema>;

export const transactionsResponseSchema = z.looseObject({
  ...envelope,
  trst_ovrl_trde_prps_array: z.array(transactionRowSchema).default([]),
});

// ── ka10074: 일자별실현손익 (subset — summary only) ──

export const realizedPnlResponseSchema = z.looseObject({
  ...envelope,
  tot_buy_amt: str(),
  tot_sell_amt: str(),
  rlzt_pl: str(), // 기간 실현손익 합계 (수수료·세금 반영)
  trde_cmsn: str(),
  trde_tax: str(),
});

export type RealizedPnlResponse = z.infer<typeof realizedPnlResponseSchema>;

// ── ka10075: 미체결 주문 (미체결요청) ──
// The array key `oso` is live-verified (2026-07-07 — an empty array, since the
// verification account had no open orders). The item fields are wrapper-sourced
// (dongbin300 KiwoomRestApi.Net model) and NOT live-verified, because no pending
// order existed to observe — treat the item shape as provisional, like dividends.
// Only the consumed subset is declared. `cur_prc`/`ord_pric` encode direction in
// their sign → read magnitude via parseKiwoomPrice.

export const pendingOrderItemSchema = z.looseObject({
  ord_no: str(), // 주문번호
  stk_cd: str(), // 종목코드 ("A005930"처럼 접두 가능)
  stk_nm: str(), // 종목명
  ord_stt: str(), // 주문상태 ("접수"/"확인" 등)
  io_tp_nm: str(), // 주문구분 ("매수"/"매도"/"정정" 등)
  ord_qty: str(), // 주문수량
  ord_pric: str(), // 주문가격
  oso_qty: str(), // 미체결수량
  cntr_qty: str(), // 체결량
  cur_prc: str(), // 현재가 (부호 유의미)
  tm: str(), // 시간 (HHmmss)
  trde_tp: str(), // 매매구분
});

export type PendingOrderItem = z.infer<typeof pendingOrderItemSchema>;

export const pendingOrdersResponseSchema = z.looseObject({
  ...envelope,
  oso: z.array(pendingOrderItemSchema).default([]),
});

export type PendingOrdersResponse = z.infer<typeof pendingOrdersResponseSchema>;

// ── ka10099: 종목정보요약 — NOTE: this TR answers in camelCase (live-verified) ──

export const stockListItemSchema = z.looseObject({
  code: str(),
  name: str(),
  lastPrice: str(), // 전일종가, zero-padded
  marketName: str(), // "거래소" | "코스닥" | "ETF" | ...
  upName: str(), // 업종명 (ETF/ETN은 빈 값)
  upSizeName: str(), // 대형주/중형주/소형주
  state: str(), // "증거금20%|담보대출|신용가능"
  auditInfo: str(), // "정상" 등
  orderWarning: str(), // "0"=정상
});

export type StockListItem = z.infer<typeof stockListItemSchema>;

export const stockListResponseSchema = z.looseObject({
  ...envelope,
  list: z.array(stockListItemSchema).default([]),
});

// ── ka10081/ka10082/ka10083: 일/주/월봉 차트 (same item shape, different array key) ──

export const dailyChartItemSchema = z.looseObject({
  dt: str(), // yyyyMMdd
  open_pric: str(),
  high_pric: str(),
  low_pric: str(),
  cur_prc: str(), // 종가
  trde_qty: str(),
  trde_prica: str(), // 거래대금(백만원)
  pred_pre: str(),
  pred_pre_sig: str(),
});

export type DailyChartItem = z.infer<typeof dailyChartItemSchema>;

// ── ka10080: 분봉 차트 ──

export const minuteChartItemSchema = z.looseObject({
  cntr_tm: str(), // yyyyMMddHHmmss
  open_pric: str(),
  high_pric: str(),
  low_pric: str(),
  cur_prc: str(),
  trde_qty: str(), // 해당 분봉 거래량
  acc_trde_qty: str(),
});

export type MinuteChartItem = z.infer<typeof minuteChartItemSchema>;

// ── ka10004: 주식호가 — level 1 uses *_fpr_* keys, levels 2-10 use sel_/buy_Nth_pre_* ──
// (live-verified key shapes; levels 2-10 are read via the loose passthrough)

export const orderbookResponseSchema = z.looseObject({
  ...envelope,
  bid_req_base_tm: str(), // 호가 기준시각 HHmmss
  sel_fpr_bid: str(), // 매도최우선호가
  sel_fpr_req: str(), // 매도최우선잔량
  buy_fpr_bid: str(),
  buy_fpr_req: str(),
  tot_sel_req: str(),
  tot_buy_req: str(),
});

export type OrderbookResponse = z.infer<typeof orderbookResponseSchema>;

// ── ka20003: 전업종지수 (inds_cd 001=코스피 그룹, 101=코스닥 그룹) ──

export const indexItemSchema = z.looseObject({
  stk_cd: str(), // 업종코드 ("001" 종합 등)
  stk_nm: str(),
  cur_prc: str(), // 지수 (소수점 포함)
  pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  trde_qty: str(), // 천주
  trde_prica: str(), // 백만원
  rising: str(),
  stdns: str(), // 보합
  fall: str(),
});

export type IndexItem = z.infer<typeof indexItemSchema>;

export const allIndexResponseSchema = z.looseObject({
  ...envelope,
  all_inds_idex: z.array(indexItemSchema).default([]),
});

// ── ka20001: 업종현재가 (subset) ──

/** 시간대별 행 (`*_n` suffix). tm_n "999999"/"888888"은 장마감 집계 센티널 — 표시 시 필터. */
export const sectorTimeRowSchema = z.looseObject({
  tm_n: str(),
  cur_prc_n: str(),
  pred_pre_n: str(),
  flu_rt_n: str(),
  acc_trde_qty_n: str(), // 누적 거래량 (천주)
});

export type SectorTimeRow = z.infer<typeof sectorTimeRowSchema>;

export const sectorPriceResponseSchema = z.looseObject({
  ...envelope,
  cur_prc: str(), // 지수 (소수점, 부호 접두)
  pred_pre: str(),
  flu_rt: str(),
  trde_qty: str(), // 천주 (ka20003과 동일 단위)
  trde_prica: str(), // 백만원
  trde_frmatn_stk_num: str(), // 거래형성 종목수
  trde_frmatn_rt: str(), // 거래형성 비율(%), 부호 접두
  open_pric: str(),
  high_pric: str(),
  low_pric: str(),
  upl: str(), // 상한 종목수
  rising: str(),
  stdns: str(), // 보합
  fall: str(),
  lst: str(), // 하한 종목수
  "52wk_hgst_pric": str(),
  "52wk_hgst_pric_dt": str(), // yyyyMMdd
  "52wk_hgst_pric_pre_rt": str(), // 현재가의 52주 최고 대비 등락률
  "52wk_lwst_pric": str(),
  "52wk_lwst_pric_dt": str(),
  "52wk_lwst_pric_pre_rt": str(),
  inds_cur_prc_tm: z.array(sectorTimeRowSchema).default([]),
});

export type SectorPriceResponse = z.infer<typeof sectorPriceResponseSchema>;

// ── ka20002: 업종별주가 (subset) ──

export const sectorStockItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  now_trde_qty: str(),
  open_pric: str(),
  high_pric: str(),
  low_pric: str(),
});

export type SectorStockItem = z.infer<typeof sectorStockItemSchema>;

export const sectorStocksResponseSchema = z.looseObject({
  ...envelope,
  inds_stkpc: z.array(sectorStockItemSchema).default([]),
});

// ── ka10059/ka10061: 종목별 투자자·기관 (13-field investor breakdown) ──
// amt_qty_tp "1"=금액(백만원), "2"=수량(주) — cross-checked live against volume.

const investorFields = {
  ind_invsr: str(), // 개인
  frgnr_invsr: str(), // 외국인
  orgn: str(), // 기관계
  fnnc_invt: str(), // 금융투자
  insrnc: str(), // 보험
  invtrt: str(), // 투신
  etc_fnnc: str(), // 기타금융
  bank: str(),
  penfnd_etc: str(), // 연기금등
  samo_fund: str(), // 사모펀드
  natn: str(), // 국가
  etc_corp: str(), // 기타법인
  natfor: str(), // 내외국인
};

export const investorTotalItemSchema = z.looseObject(investorFields);
export type InvestorTotalItem = z.infer<typeof investorTotalItemSchema>;

export const investorDailyItemSchema = z.looseObject({
  dt: str(),
  cur_prc: str(),
  pre_sig: str(),
  pred_pre: str(),
  acc_trde_qty: str(),
  ...investorFields,
});
export type InvestorDailyItem = z.infer<typeof investorDailyItemSchema>;

// ── ka10027/ka10030/ka10032: 순위 TR item shapes ──

export const priceChangeRankItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  now_trde_qty: str(),
});
export type PriceChangeRankItem = z.infer<typeof priceChangeRankItemSchema>;

export const volumeRankItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  trde_qty: str(), // NOTE: Kiwoom caps this at uint32 max (4294967295) — live-observed
  trde_amt: str(), // 백만원
});
export type VolumeRankItem = z.infer<typeof volumeRankItemSchema>;

export const valueRankItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  now_trde_qty: str(),
  trde_prica: str(), // 백만원
});
export type ValueRankItem = z.infer<typeof valueRankItemSchema>;

// ── ka40002: ETF종목정보 (flat) ──

export const etfInfoResponseSchema = z.looseObject({
  ...envelope,
  stk_nm: str(),
  etfobjt_idex_nm: str(), // 추적지수명
  etftxon_type: str(), // ETF 과세유형 ("비과세" 등)
  etntxon_type: str(),
});

export type EtfInfoResponse = z.infer<typeof etfInfoResponseSchema>;

// ── ka40001: ETF수익율 (array key etfprft_rt_lst; mock-probed 2026-07-09) ──
// NOTE: cntr_prft_rt is the period return of the index selected by the
// etfobjt_idex_cd REQUEST field (not validated against the ETF) — probed:
// same code → same value regardless of stk_cd; bogus code → "0.00".

export const etfReturnItemSchema = z.looseObject({
  etfprft_rt: str(), // ETF 기간 수익률(%)
  cntr_prft_rt: str(), // 대상지수(etfobjt_idex_cd) 기간 수익률(%)
  for_netprps_qty: str(), // 외인 순매수량
  orgn_netprps_qty: str(), // 기관 순매수량 (mock: blank)
});

export type EtfReturnItem = z.infer<typeof etfReturnItemSchema>;

// ── ka40009: ETF NAV 추이 (array key etfnavarray, newest first, no time field) ──
// Rows carry NO timestamp; NAV/괴리율/추적오차 fields arrive blank on mock —
// only stkcnt/base_pric are populated there. Callers must tolerate blanks.

export const etfNavItemSchema = z.looseObject({
  nav: str(),
  navpred_pre: str(), // NAV 전일대비
  navflu_rt: str(), // NAV 등락률(%)
  trace_eor_rt: str(), // 추적오차율(%)
  dispty_rt: str(), // 괴리율(%)
});

export type EtfNavItem = z.infer<typeof etfNavItemSchema>;

// ── ka01300/ka01301: 관심종목 그룹 (HTS 저장 그룹, live-verified 2026-07-06) ──
// NOTE: array keys are nofi(그룹)/nofj(종목); item fields are terse (gcod/name,
// cod2/bgb) and differ from the usual snake_case TRs. The response also carries
// a legacy `rtcd:"S"` flag alongside the standard return_code envelope.

export const watchlistGroupItemSchema = z.looseObject({
  gcod: str(), // 그룹코드 (예: "000")
  name: str(), // 그룹명
});

export type WatchlistGroupItem = z.infer<typeof watchlistGroupItemSchema>;

export const watchlistGroupsResponseSchema = z.looseObject({
  ...envelope,
  nofi: z.array(watchlistGroupItemSchema).default([]),
});

export const watchlistStockItemSchema = z.looseObject({
  cod2: str(), // 종목코드
  bgb: str(), // 북마크 구분 ("0"=없음)
  bgb_clr: str(), // 북마크 컬러
});

export type WatchlistStockItem = z.infer<typeof watchlistStockItemSchema>;

export const watchlistGroupDetailResponseSchema = z.looseObject({
  ...envelope,
  nofj: z.array(watchlistStockItemSchema).default([]),
});

// ── ka90001/ka90002: 테마 (테마그룹별 / 테마구성종목) — /api/dostk/thme ──
// All fields live-verified 2026-07-07 on REAL. ka90001 paginates (100/page,
// sorted by flu_pl_amt_tp); this server reads page 1 only. flu_rt/dt_prft_rt are
// sign-prefixed percentages; cur_prc/pred_pre sign-encode direction. Counts
// (stk_num/rising/fall) arrive as plain numeric strings.

export const themeGroupItemSchema = z.looseObject({
  thema_grp_cd: str(), // 테마그룹코드
  thema_nm: str(), // 테마명
  stk_num: str(), // 종목수
  flu_sig: str(), // 등락기호 (1상한 2상승 3보합 4하한 5하락)
  flu_rt: str(), // 등락률(%)
  rising_stk_num: str(), // 상승종목수
  fall_stk_num: str(), // 하락종목수
  dt_prft_rt: str(), // 기간수익률(%) — date_tp 일수 기준
  main_stk: str(), // 주요종목 (쉼표 구분)
});

export type ThemeGroupItem = z.infer<typeof themeGroupItemSchema>;

export const themeGroupsResponseSchema = z.looseObject({
  ...envelope,
  thema_grp: z.array(themeGroupItemSchema).default([]),
});

export const themeStockItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 유의미)
  flu_sig: str(),
  pred_pre: str(), // 전일대비 (부호 유의미)
  flu_rt: str(), // 등락률(%)
  acc_trde_qty: str(), // 누적거래량
  dt_prft_rt_n: str(), // 기간수익률(%)
});

export type ThemeStockItem = z.infer<typeof themeStockItemSchema>;

export const themeStocksResponseSchema = z.looseObject({
  ...envelope,
  flu_rt: str(), // 테마 전체 등락률(%)
  dt_prft_rt: str(), // 테마 전체 기간수익률(%)
  thema_comp_stk: z.array(themeStockItemSchema).default([]),
});

export type ThemeStocksResponse = z.infer<typeof themeStocksResponseSchema>;

// ── ka10014: 공매도추이 — /api/dostk/shsa (all fields live-verified 2026-07-07) ──

export const shortSellingItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  close_pric: str(), // 종가 (부호 방향)
  pred_pre: str(), // 전일대비 (부호 유의미)
  flu_rt: str(), // 등락률(%)
  trde_qty: str(), // 거래량
  shrts_qty: str(), // 공매도량
  ovr_shrts_qty: str(), // 누적공매도량
  trde_wght: str(), // 공매도 비중(%) — 비방향성 비율
  shrts_trde_prica: str(), // 공매도 거래대금
  shrts_avg_pric: str(), // 공매도 평균가
});

export type ShortSellingItem = z.infer<typeof shortSellingItemSchema>;

export const shortSellingResponseSchema = z.looseObject({
  ...envelope,
  shrts_trnsn: z.array(shortSellingItemSchema).default([]),
});

// ── ka10008: 주식외국인 종목별 매매동향 — /api/dostk/frgnistt (live-verified) ──

export const foreignHoldingItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  close_pric: str(), // 종가 (부호)
  pred_pre: str(), // 전일대비 (부호)
  trde_qty: str(), // 거래량
  chg_qty: str(), // 외국인 변동수량 (부호)
  poss_stkcnt: str(), // 외국인 보유주식수
  wght: str(), // 외국인 보유비중(%) — 비방향성 비율
  gain_pos_stkcnt: str(), // 취득가능주식수
  frgnr_limit: str(), // 외국인 한도
  limit_exh_rt: str(), // 한도소진률(%) — 비방향성 비율
});

export type ForeignHoldingItem = z.infer<typeof foreignHoldingItemSchema>;

export const foreignHoldingResponseSchema = z.looseObject({
  ...envelope,
  stk_frgnr: z.array(foreignHoldingItemSchema).default([]),
});

// ── ka10068(전체)/ka20068(종목별): 대차거래추이 — /api/dostk/slb ──
// Both TRs share the array key AND the row shape (mock-probed 2026-07-10).
// 당일 행은 집계 전이라 전부 "0"으로 올 수 있다.

export const lendingTrendItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  dbrt_trde_cntrcnt: str(), // 대차거래 체결주수 (주)
  dbrt_trde_rpy: str(), // 대차거래 상환주수 (주)
  dbrt_trde_irds: str(), // 대차거래 증감 (주, 부호) = 체결 − 상환
  rmnd: str(), // 잔고주수 (주)
  remn_amt: str(), // 잔고금액 (백만원)
});

export type LendingTrendItem = z.infer<typeof lendingTrendItemSchema>;

export const lendingTrendResponseSchema = z.looseObject({
  ...envelope,
  dbrt_trde_trnsn: z.array(lendingTrendItemSchema).default([]),
});

// ── ka90003: 프로그램순매수상위50 — /api/dostk/stkinfo ──
// prm_* 필드의 단위는 요청의 amt_qty_tp를 따른다 (1=금액 백만원, 2=수량 주).

export const programTradeItemSchema = z.looseObject({
  rank: str(), // 순위
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 방향)
  flu_rt: str(), // 등락률(%)
  acc_trde_qty: str(), // 누적거래량 (주)
  prm_sell_amt: str(), // 프로그램 매도
  prm_buy_amt: str(), // 프로그램 매수
  prm_netprps_amt: str(), // 프로그램 순매수 (부호)
});

export type ProgramTradeItem = z.infer<typeof programTradeItemSchema>;

// ── ka10170: 당일매매일지 — /api/dostk/acnt (live-verified 2026-07-07) ──
// NOTE: an empty trading day returns ONE all-blank row (not an empty array) — callers
// must filter blank rows (empty stk_cd/stk_nm). A base_dt beyond ~2 months returns
// return_code 0 with a "최근 2개월 이내" notice in return_msg and blank data. Item field
// NAMES are live-confirmed (blank-row keys + dongbin300 .NET model); non-empty item VALUES
// were NOT observable (no day-trade on this account), so treat them as provisional.

export const tradingJournalItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  buy_avg_pric: str(), // 매수평균가
  buy_qty: str(), // 매수수량
  sel_avg_pric: str(), // 매도평균가
  sell_qty: str(), // 매도수량
  cmsn_alm_tax: str(), // 수수료+제세금
  pl_amt: str(), // 손익금액 (부호)
  sell_amt: str(), // 매도금액
  buy_amt: str(), // 매수금액
  prft_rt: str(), // 수익률(%)
});

export type TradingJournalItem = z.infer<typeof tradingJournalItemSchema>;

export const tradingJournalResponseSchema = z.looseObject({
  ...envelope,
  tot_sell_amt: str(), // 총매도금액
  tot_buy_amt: str(), // 총매수금액
  tot_cmsn_tax: str(), // 총수수료+세금
  tot_exct_amt: str(), // 총정산금액
  tot_pl_amt: str(), // 총손익금액 (부호)
  tot_prft_rt: str(), // 총수익률(%)
  tdy_trde_diary: z.array(tradingJournalItemSchema).default([]),
});

export type TradingJournalResponse = z.infer<typeof tradingJournalResponseSchema>;

// ── ka10016/ka10017/ka10019: 신고저가/상하한가/가격급등락 (mock-verified 2026-07-08) ──

export const newHighLowItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(), // 부호 포함
  pred_pre: str(), // 전일대비 (부호)
  flu_rt: str(), // 등락률 (부호)
  trde_qty: str(), // 거래량
  high_pric: str(), // 기간 고가
  low_pric: str(), // 기간 저가
});
export type NewHighLowItem = z.infer<typeof newHighLowItemSchema>;

export const limitStockItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre: str(),
  flu_rt: str(),
  trde_qty: str(),
  cnt: str(), // 연속 횟수
});
export type LimitStockItem = z.infer<typeof limitStockItemSchema>;

export const priceJumpItemSchema = z.looseObject({
  stk_cd: str(),
  stk_nm: str(),
  cur_prc: str(),
  flu_rt: str(), // 전일 대비 등락률 (부호)
  base_pric: str(), // 기준가 (급등락 산정 기준시점 가격)
  jmp_rt: str(), // 기준 대비 급등/급락률 (부호)
  trde_qty: str(),
});
export type PriceJumpItem = z.infer<typeof priceJumpItemSchema>;

/** Strips Kiwoom's asset-class prefix (e.g. "A005930" → "005930"). */
export function normalizeStockCode(code: string): string {
  return code.replace(/^[A-Z]/, "");
}
