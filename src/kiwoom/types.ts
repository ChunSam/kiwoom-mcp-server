import { stripExchangeSuffix } from "../utils/stock-code.js";
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

/**
 * 종목·업종 코드 필드. 통합(SOR) 조회로 바꾼 뒤부터 키움은 `005930_AL` / `001_AL`처럼
 * 거래소 접미사를 붙여 답한다 — 파싱 단계에서 떼어내 서버 바깥에는 순수 코드만 나가게
 * 한다. 접미사가 없는 응답에는 아무 영향이 없으므로 코드 필드에는 `str()` 대신 이걸 쓴다.
 */
const code = () => str().transform(stripExchangeSuffix);

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
  stk_cd: code(),
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

// ── ka10095: 관심종목정보 = 멀티코드 일괄 시세 (subset) ──
// Despite the "관심종목" name this TR quotes ARBITRARY codes: stk_cd takes
// pipe-joined codes ("005930|000660", 30 codes mock-probed in one call,
// cont-yn N) and returns one row per code in request order (array key
// `atn_stk_infr`). An unknown code still gives rc=0 plus an ALL-BLANK row
// (blank stk_cd) — callers filter blank rows (ka10170 precedent). Units
// cross-checked on mock 2026-07-22: trde_prica 백만원, mac 억원.

export const batchQuoteItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 접두)
  pred_pre: str(), // 전일대비
  flu_rt: str(), // 등락률(%)
  trde_qty: str(), // 거래량(주)
  trde_prica: str(), // 거래대금(백만원)
  mac: str(), // 시가총액(억원)
});

export type BatchQuoteItem = z.infer<typeof batchQuoteItemSchema>;

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
  stk_cd: code(), // 종목코드 — "A005930"처럼 A 접두가 붙어 올 수 있음
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

// ── kt00004: 계좌평가현황 (subset — 당일/당월/누적 기간 손익 필드만 소비) ──
// 예수금/평가액 계열과 종목별 리스트(stk_acnt_evlt_prst)는 kt00001/kt00018과
// 중복이라 소비하지 않는다. 필드명은 스펙 그대로(lspft 계열 명명이 뒤섞여 있음).

export const accountPeriodPlResponseSchema = z.looseObject({
  ...envelope,
  tdy_lspft_amt: str(), // 당일투자원금
  invt_bsamt: str(), // 당월투자원금
  lspft_amt: str(), // 누적투자원금
  tdy_lspft: str(), // 당일투자손익 (부호 유의미)
  lspft2: str(), // 당월투자손익 (부호 유의미)
  lspft: str(), // 누적투자손익 (부호 유의미)
  tdy_lspft_rt: str(), // 당일손익율(%)
  lspft_ratio: str(), // 당월손익율(%)
  lspft_rt: str(), // 누적손익율(%)
});

export type AccountPeriodPlResponse = z.infer<typeof accountPeriodPlResponseSchema>;

// ── kt00002: 일별추정예탁자산현황 (subset) ──
// 모의투자 미지원(RC9000) — 계약은 REAL 프로브(2026-07-23)로 확정. 행은 주말·휴장일을
// 포함한 달력일 단위로 오래된 날짜부터 오며, 값은 12자리 zero-padded 무부호 문자열.
// 신용 계열(grnt_use_amt/crd_loan/ls_grnt)은 현금계좌에서 전부 0이라 소비하지 않는다
// (ka10085 스킵과 같은 근거 — 신용거래는 범위 밖).

export const dailyAssetItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  entr: str(), // 예수금
  repl_amt: str(), // 대용금
  prsm_dpst_aset_amt: str(), // 추정예탁자산
});

export type DailyAssetItem = z.infer<typeof dailyAssetItemSchema>;

// ── kt00016: 일별계좌수익률상세현황 (subset) ──
// 이름과 달리 배열이 아닌 FLAT 기간 요약(초/말 쌍 + 기간 집계). 모의투자 미지원(RC9000).
// prft_rt는 evltv_prft ÷ invt_bsamt × 100과 정확히 일치함을 REAL에서 확인(2026-07-23)
// — 수익률 산출 기준은 투자원금평잔. 관리자/지점 필드(mang_empno 등)는 표시하지 않는다.

export const accountReturnSummarySchema = z.looseObject({
  ...envelope,
  entr_fr: str(), // 예수금_초
  entr_to: str(), // 예수금_말
  scrt_evlt_amt_fr: str(), // 유가증권평가금액_초
  scrt_evlt_amt_to: str(), // 유가증권평가금액_말
  tot_amt_fr: str(), // 순자산액계_초
  tot_amt_to: str(), // 순자산액계_말
  invt_bsamt: str(), // 투자원금평잔
  evltv_prft: str(), // 평가손익 (부호 유의미)
  prft_rt: str(), // 수익률(%) (부호 유의미)
  tern_rt: str(), // 회전율(%)
  termin_tot_trns: str(), // 기간내총입금
  termin_tot_pymn: str(), // 기간내총출금
  termin_tot_inq: str(), // 기간내총입고
  termin_tot_outq: str(), // 기간내총출고
});

export type AccountReturnSummary = z.infer<typeof accountReturnSummarySchema>;

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
  stk_cd: code(),
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
  stk_cd: code(), // 종목코드 ("A005930"처럼 접두 가능)
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

// ── ka10076: 체결요청 — 계좌의 체결 내역 (ka10075 미체결의 반대편) ──
// Envelope + the `cntr` array key are live-verified (mock 2026-07-31, 5 bodies, rc=0, cont-yn N).
// Item VALUES are unobservable without placing an order (out of scope by design), so the field
// set below is spec-sourced — the same provisional status ka10075's `oso` item has carried
// since v0.6.0. Treat row shape as provisional until a real fill is observed.

export const executionItemSchema = z.looseObject({
  ord_no: str(), // 주문번호
  orig_ord_no: str(), // 원주문번호 (정정·취소의 원주문)
  stk_cd: code(), // 종목코드 ("A005930"처럼 접두 가능)
  stk_nm: str(), // 종목명
  ord_stt: str(), // 주문상태 ("체결"/"확인" 등)
  io_tp_nm: str(), // 주문구분 ("매수"/"매도"/"정정" 등)
  trde_tp: str(), // 매매구분
  ord_qty: str(), // 주문수량
  ord_pric: str(), // 주문가격
  cntr_qty: str(), // 체결수량
  cntr_pric: str(), // 체결가격
  oso_qty: str(), // 미체결수량
  tdy_trde_cmsn: str(), // 당일매매수수료
  tdy_trde_tax: str(), // 당일매매세금
  ord_tm: str(), // 주문시각 (HHmmss)
  stop_pric: str(), // 스톱가
  sor_yn: str(), // SOR 여부 ("Y"/"N")
  stex_tp: str(), // 거래소구분 코드
  stex_tp_txt: str(), // 거래소구분 표기
});

export type ExecutionItem = z.infer<typeof executionItemSchema>;

export const executionsResponseSchema = z.looseObject({
  ...envelope,
  cntr: z.array(executionItemSchema).default([]),
});

export type ExecutionsResponse = z.infer<typeof executionsResponseSchema>;

// ── ka10099: 종목정보요약 — NOTE: this TR answers in camelCase (live-verified) ──

export const stockListItemSchema = z.looseObject({
  code: str(),
  name: str(),
  lastPrice: str(), // 전일종가, zero-padded
  marketName: str(), // "거래소" | "코스닥" | "ETF" | ...
  nxtEnable: str(), // 넥스트레이드 거래가능 "Y"/"N" — 시간외 단일가 TR의 사각지대 판별에 사용
  upName: str(), // 업종명 (ETF/ETN은 빈 값)
  upSizeName: str(), // 대형주/중형주/소형주 (우선주/ETF 등은 빈 값)
  state: str(), // "증거금20%|담보대출|신용가능"
  auditInfo: str(), // "정상"/"거래정지"/"관리종목"/"투자주의환기종목"/"단기과열"/"투자경고" 등
  orderWarning: str(), // 투자유의: "0"=해당없음, 나머지는 master-list.ts ORDER_WARNING_LABELS
  regDay: str(), // 상장일 yyyyMMdd
  companyClassName: str(), // 코스닥 전용 기업분류: 벤처기업/우량기업/스팩 등 (그 외 빈 값)
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

// ── ka10007: 시세표성정보 — 10단계 호가 + 시세 요약 (스칼라 126개 중 쓰는 것만) ──
//
// v0.37.0에서 ka10004(주식호가)를 이 TR로 갈아탔다. **통합(_AL)을 받는 유일한 호가 TR**이라
// 그렇다 — ka10004는 `_AL`을 줘도 KRX 값만 돌려준다. 실측 2026-08-04 13:56 005930:
// 매수1 잔량이 KRX 18,421 / NXT 17,081 / 통합 36,319으로, 통합 = KRX + NXT다(10단계 전부
// 확인, 오차는 초 단위 스냅샷 차이 수준). KRX로 부르면 잔량이 ka10004와 그대로 일치한다.
//
// 선언하지 않은 필드와 그 이유:
//  - `pred_close_pric` — 통합/NXT로 부르면 233,500이 오는데 같은 응답의 `flu_rt`는 KRX
//    전일종가 239,500 기준이다(−3.34% 역산 확인). 한 응답 안에서 기준이 갈려 못 쓴다.
//  - `sel_1~5bid_cnt`·`buy_1~5bid_cnt`·`tot_buy_cnt` 호가건수 — 005930·069500·247540
//    전부 빈 문자열. 키움이 안 채운다(ka10015 수급 컬럼과 같은 부류).
//  - `hgst_pric`·`lwst_pric`(+`_dt`), `cntr_qty` — 전 종목 빈 문자열.
//  - `exp_cntr_pric`·`exp_cntr_qty` 예상체결 — 정규장 중에는 그날 시가 동시호가 결과에
//    멈춰 있다(13:56에 3회 연속 244,500 / 561,409 = 시가·시가 체결량).
//  - `lpsel_*`·`lpbuy_*` LP호가 — KRX로 부를 때만 채워지고 통합에서는 빈 문자열이라,
//    통합 기준을 유지하는 한 렌더할 수 없다.

export const quoteTableResponseSchema = z.looseObject({
  ...envelope,
  stk_cd: code(), // 통합 조회는 "005930_AL"로 돌아온다
  stk_nm: str(), // 없는 코드는 rc=0 + 전 필드 공백 → 빈 문자열이 "못 찾음" 신호
  tm: str(), // 조회 시각 HHmmss
  cur_prc: str(), // 부호는 전일대비 방향 (parseKiwoomPrice)
  smbol: str(), // 대비기호 1상한 2상승 3보합 4하한 5하락 (ka10001 pre_sig와 같은 코드계)
  flu_rt: str(), // 등락률(%) — KRX 전일종가 기준
  trde_qty: str(),
  sel_1bid: str(),
  sel_2bid: str(),
  sel_3bid: str(),
  sel_4bid: str(),
  sel_5bid: str(),
  sel_6bid: str(),
  sel_7bid: str(),
  sel_8bid: str(),
  sel_9bid: str(),
  sel_10bid: str(),
  sel_1bid_req: str(),
  sel_2bid_req: str(),
  sel_3bid_req: str(),
  sel_4bid_req: str(),
  sel_5bid_req: str(),
  sel_6bid_req: str(),
  sel_7bid_req: str(),
  sel_8bid_req: str(),
  sel_9bid_req: str(),
  sel_10bid_req: str(),
  buy_1bid: str(),
  buy_2bid: str(),
  buy_3bid: str(),
  buy_4bid: str(),
  buy_5bid: str(),
  buy_6bid: str(),
  buy_7bid: str(),
  buy_8bid: str(),
  buy_9bid: str(),
  buy_10bid: str(),
  buy_1bid_req: str(),
  buy_2bid_req: str(),
  buy_3bid_req: str(),
  buy_4bid_req: str(),
  buy_5bid_req: str(),
  buy_6bid_req: str(),
  buy_7bid_req: str(),
  buy_8bid_req: str(),
  buy_9bid_req: str(),
  buy_10bid_req: str(),
  tot_sel_req: str(),
  tot_buy_req: str(),
});

export type QuoteTableResponse = z.infer<typeof quoteTableResponseSchema>;

// ── ka20003: 전업종지수 (inds_cd 001=코스피 그룹, 101=코스닥 그룹) ──

export const indexItemSchema = z.looseObject({
  stk_cd: code(), // 업종코드 ("001" 종합 등)
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
  stk_cd: code(),
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

// ── ka90009: 외국인·기관 매매 상위 ──
// One row = rank i of FOUR independent lists side by side (외인 순매도/순매수,
// 기관 순매도/순매수 — different stocks per column group). 순매도 amounts arrive
// sign-prefixed negative. amt_qty_tp "1"=금액(천만원), "2"=수량(천주) — units
// cross-checked on mock (금액≈수량×주가). Undocumented pipe1~3 separator fields
// ride along; the loose schema ignores them.

export const investorRankDailyItemSchema = z.looseObject({
  for_netslmt_stk_cd: code(),
  for_netslmt_stk_nm: str(),
  for_netslmt_amt: str(),
  for_netslmt_qty: str(),
  for_netprps_stk_cd: code(),
  for_netprps_stk_nm: str(),
  for_netprps_amt: str(),
  for_netprps_qty: str(),
  orgn_netslmt_stk_cd: code(),
  orgn_netslmt_stk_nm: str(),
  orgn_netslmt_amt: str(),
  orgn_netslmt_qty: str(),
  orgn_netprps_stk_cd: code(),
  orgn_netprps_stk_nm: str(),
  orgn_netprps_amt: str(),
  orgn_netprps_qty: str(),
});
export type InvestorRankDailyItem = z.infer<typeof investorRankDailyItemSchema>;

// ── ka10131: 기관·외국인 연속매매현황 ──
// Every row carries BOTH 금액(백만원) and 수량(주) fields regardless of
// amt_qty_tp (it only picks the ranking metric; units cross-checked on mock —
// amt/qty ≈ 주가). Doubles the sign like ka10061 ("--234680" = negative);
// 연속일수 can be negative = 연속 순매도 streak.

export const investorStreakItemSchema = z.looseObject({
  rank: str(),
  stk_cd: code(),
  stk_nm: str(),
  prid_stkpc_flu_rt: str(), // 기간중 주가 등락률(%)
  orgn_nettrde_amt: str(), // 기관 순매매금액(백만원)
  orgn_cont_netprps_dys: str(), // 기관 연속 순매수일수 (음수=연속 순매도)
  frgnr_nettrde_amt: str(), // 외국인 순매매금액(백만원)
  frgnr_cont_netprps_dys: str(),
  tot_cont_netprps_dys: str(), // 합계 연속 순매수일수
});
export type InvestorStreakItem = z.infer<typeof investorStreakItemSchema>;

// ── ka10066: 장마감후투자자별매매 (전 종목 × 12주체 순매수) ──
// **한 행에 두 시점이 섞인다.** cur_prc/pred_pre/flu_rt/trde_qty는 당일 실시간이고,
// 투자자 12필드는 **직전 완료 세션의 확정치**다. 2026-08-04 실측: 08:25 장전과
// 09:41 장중 두 번 모두 005930의 투자자 12필드가 ka10059 dt=20260803과 정확히
// 일치했고, 같은 행의 trde_qty만 당일(20260804) 값이었다. 장중에도 넘어가지 않는다.
//
// ka10059의 13필드와 달리 natfor(내외국인)가 없다 — 12주체다.

export const afterMarketInvestorItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  trde_qty: str(),
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
});
export type AfterMarketInvestorItem = z.infer<typeof afterMarketInvestorItemSchema>;

export const afterMarketInvestorResponseSchema = z.looseObject({
  ...envelope,
  opaf_invsr_trde: z.array(afterMarketInvestorItemSchema).default([]),
});

// ── ka10063: 장중투자자별매매 (전 종목 외국인 순매수, 실시간) ──
// invsr은 13개 값을 찍어 **"6"만 행을 준다**(나머지는 rc=0 + 0행). "6"이 외국인임은
// ka10059의 장중 frgnr_invsr과 대조해 확정했다 (2026-08-04 09:43 실측, 수량 기준
// 005930 -90,000 / 000660 +1,000 / 035420 -23,000 세 종목 전부 일치).
//
// 장중 값은 **1,000주 단위로 반올림된 잠정치**다 — 전 행이 1,000의 배수인 반면
// 완료 세션값(ka10059 dt=20260803 005930 = 12,731,078)은 주 단위로 정확하다.
//
// 금액 필드는 백만원 (수량 × 당일 평균단가로 역산: 035420 -23,000주 / -5,279백만원
// = 229,522원, 당시 현재가 227,000과 부합). 부호는 이중부호(`--21796`)로 올 수 있다.

export const intradayForeignItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  acc_trde_qty: str(),
  netprps_amt: str(), // 순매수금액(백만원)
  netprps_qty: str(), // 순매수수량(주, 1,000주 단위 잠정치)
  buy_amt: str(),
  buy_qty: str(),
  sell_amt: str(),
  sell_qty: str(),
});
export type IntradayForeignItem = z.infer<typeof intradayForeignItemSchema>;

export const intradayForeignResponseSchema = z.looseObject({
  ...envelope,
  opmr_invsr_trde: z.array(intradayForeignItemSchema).default([]),
});

// ── ka10065: 장중투자자별매매상위 (ka10063의 "상위" 판, 주체 6개) ──
// 배열 키가 `opmr_invsr_trde_upper`로 ka10063(`opmr_invsr_trde`)의 상위 변형임이 드러난다.
// 실제로 orgn_tp="9000"(외국인)의 값은 ka10063과 **교집합 49종목이 한 자리도 다르지 않다**
// (2026-08-06 12:20 정규장 실측) — 같은 잠정 시리즈에 주체만 넓힌 것이다.
//
// **`netslmt`는 이름이 "순매도"인데 값은 순매수 방향이다.** 키움 어휘로 netslmt=순매도,
// netprps=순매수인데(ka90009의 for_netslmt/for_netprps 대조) 이 TR의 값은
// `|buy_qty| - |sel_qty|`와 정확히 맞고 trde_tp=1(순매수)에서 양수다 — 6개 orgn_tp
// 전 행에서 산술이 성립했다. 이름을 믿지 말 것.
//
// `sel_qty`의 `-`는 값의 부호가 아니라 방향 표기다(ka10002·ka10037과 같은 규약) —
// 수량은 절대값으로 읽는다.
//
// 값은 ka10063과 같은 **1,000주 단위 반올림 잠정치**이고, 마감 후에도 응답은 오지만
// 확정치로 갱신되지 않는다 — 2026-08-06 16:35 실측에서 005935가 ka10065 +261,000인데
// ka10059 확정치는 **-99,219로 부호까지 반대**였다. 마감 후 값을 확정치로 읽지 말 것.

export const intradayInvestorRankItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  sel_qty: str(), // 매도량 (부호는 방향 표기, 수량은 절대값)
  buy_qty: str(),
  netslmt: str(), // 이름과 달리 **순매수 방향** = |buy_qty| - |sel_qty|
});
export type IntradayInvestorRankItem = z.infer<typeof intradayInvestorRankItemSchema>;

export const intradayInvestorRankResponseSchema = z.looseObject({
  ...envelope,
  opmr_invsr_trde_upper: z.array(intradayInvestorRankItemSchema).default([]),
});

// ── ka10027/ka10030/ka10032: 순위 TR item shapes ──

export const priceChangeRankItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  now_trde_qty: str(),
});
export type PriceChangeRankItem = z.infer<typeof priceChangeRankItemSchema>;

export const volumeRankItemSchema = z.looseObject({
  stk_cd: code(),
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
  stk_cd: code(),
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

// ── ka40004: ETF전체시세 (array key etfall_mrpr, REAL·VIRTUAL 실측 2026-08-03) ──
// 전 행 공백 5필드(txbs·dvid_bf_base·pred_dvida·drng·trace_idex_cd)는 1155행 전체에서
// 빈 문자열이라 선언하지 않는다. trace_idex/trace_flu_rt도 뺐다 — 이름과 달리 추적지수가
// 아니라 close_pric/pre_rt의 복제본이었다(1155/1155행 완전 일치).
// stk_cls(19/20/22/23…)는 txon_type 갈래와 동치라 중복이다.
// 괴리율 필드는 없다 — 종가와 NAV가 같은 단위(원)임을 ka10001로 대조 확인했으므로 계산한다.

export const etfAllPriceItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(), // "KODEX 200"처럼 항상 "브랜드 공백 이름" 꼴 (1155/1155행)
  close_pric: str(), // 종가 — 부호는 전일대비 방향, 값은 절대값 (parseKiwoomPrice)
  pre_rt: str(), // 전일대비 등락률(%) — 부호 유의미
  trde_qty: str(), // 거래량(주). 2^32−1 포화값 실재 (KODEX 200선물인버스2X)
  nav: str(), // NAV(원) — close_pric과 같은 부호 규약 (parseKiwoomPrice)
  trace_eor_rt: str(), // 추적오차율(%) — 괴리율이 아니다 (ka40009의 dispty_rt와 별개 지표)
  trace_idex_nm: str(), // 추적지수명. 1155행 중 317행만 채워짐 — 빈 값이 정상
});

export type EtfAllPriceItem = z.infer<typeof etfAllPriceItemSchema>;

export const etfAllPriceResponseSchema = z.looseObject({
  ...envelope,
  etfall_mrpr: z.array(etfAllPriceItemSchema).default([]),
});

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
  stk_cd: code(),
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

// ── ka10046/ka10047: 체결강도 추이 (시간별/일별 — 행 구조가 거의 동일) ──

/**
 * 체결강도 행. 두 TR이 시간축 필드(ka10046 `cntr_tm` HHmmss / ka10047 `dt` yyyyMMdd)와
 * 배열 키만 다르고 나머지는 같아 하나의 스키마를 공유한다 (ka10068/ka20068 선례).
 * `str()` 기본값 `""` 덕에 쓰지 않는 쪽 시간 필드는 자연히 빈 값이 된다.
 *
 * 단위/인코딩 (mock 실측 2026-07-29, 005930/002990/069500):
 * - `cntr_str` 체결강도(%) — 100이 균형, 실측 범위 66~164. 5/20/60 이동평균 동반
 *   (**ka10047에서는 5일/20일/60일**, ka10046에서는 5분/20분/60분 — 필드명은 동일하게 `_5min` 등).
 * - `acc_trde_prica` 백만원 (거래량×주가로 교차검증).
 * - **ka10047은 `trde_qty`가 전 행 공백**이고 그날 거래량은 `acc_trde_qty`에 실린다
 *   (005930 07-29 `65,555,523` == ka10001 당일 거래량 — 정확 일치로 확인). ka10046은
 *   `trde_qty`가 분당 거래량, `acc_trde_qty`가 누적.
 * - 부호는 단일부호 (이중부호 없음 — 실측).
 */
export const executionStrengthItemSchema = z.looseObject({
  cntr_tm: str(), // ka10046 체결시간 HHmmss (ka10047에서는 빈 값)
  dt: str(), // ka10047 일자 yyyyMMdd (ka10046에서는 빈 값)
  cur_prc: str(), // 현재가/종가 (부호는 방향)
  pred_pre: str(), // 전일대비 (부호 유의미)
  flu_rt: str(), // 등락률(%)
  trde_qty: str(), // ka10046 분당 거래량 / **ka10047은 항상 공백**
  acc_trde_prica: str(), // 누적거래대금 (백만원)
  acc_trde_qty: str(), // 누적거래량 — ka10047에서는 그날 총 거래량
  cntr_str: str(), // 체결강도(%)
  cntr_str_5min: str(), // 체결강도 5분(ka10046)/5일(ka10047)
  cntr_str_20min: str(), // 20분/20일
  cntr_str_60min: str(), // 60분/60일
});

export type ExecutionStrengthItem = z.infer<typeof executionStrengthItemSchema>;

export const executionStrengthIntradayResponseSchema = z.looseObject({
  ...envelope,
  cntr_str_tm: z.array(executionStrengthItemSchema).default([]),
});

export const executionStrengthDailyResponseSchema = z.looseObject({
  ...envelope,
  cntr_str_daly: z.array(executionStrengthItemSchema).default([]),
});

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

// ── ka10045: 종목별기관매매추이 — /api/dostk/mrkcond (REAL·VIRTUAL 실측 2026-08-03) ──
// 이 TR만의 정보는 최상위의 **추정평균단가 2개**다 — 기관·외국인이 이 종목을 대략 얼마에
// 담았는지. 나머지 컬럼(일별 순매수·누적)은 ka10059/ka10061과 겹치지만 그쪽은 단가를
// 주지 않는다.
//
// `orgn_dt_acc`/`for_dt_acc`는 **조회 기간 시작일부터의 누적 순매수**다 — 가장 오래된 행의
// 누적값이 그 행의 일별값과 같고, 이후 행은 직전 누적 + 일별로 정확히 이어진다(23행 실측).
// 값이 "5312819.000000" 꼴의 소수 표기로 오는데 `parseKiwoomNumber`가 그대로 흡수한다.

export const institutionTrendItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  close_pric: str(), // 종가 (부호는 전일 대비 방향)
  pre_sig: str(), // 대비기호
  pred_pre: str(), // 전일대비 (부호 유의미)
  flu_rt: str(), // 등락률(%)
  trde_qty: str(), // 거래량
  orgn_dt_acc: str(), // 기관 기간누적 순매수 (소수 표기)
  orgn_daly_nettrde_qty: str(), // 기관 일별 순매수
  for_dt_acc: str(), // 외국인 기간누적 순매수 (소수 표기)
  for_daly_nettrde_qty: str(), // 외국인 일별 순매수
  limit_exh_rt: str(), // 외국인 한도소진률(%) — 비방향성 비율
});

export type InstitutionTrendItem = z.infer<typeof institutionTrendItemSchema>;

export const institutionTrendResponseSchema = z.looseObject({
  ...envelope,
  orgn_prsm_avg_pric: str(), // 기관 추정평균단가
  for_prsm_avg_pric: str(), // 외국인 추정평균단가
  stk_orgn_trde_trnsn: z.array(institutionTrendItemSchema).default([]),
});

export type InstitutionTrendResponse = z.infer<typeof institutionTrendResponseSchema>;

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

// ── ka10054: 변동성완화장치(VI) 발동종목 — /api/dostk/stkinfo ──
// 정적 VI 행은 dynm_* 필드가 "0"/"0.00"으로 온다; virelis_time "000000" = 미해제.

export const viStockItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  acc_trde_qty: str(), // 누적거래량 (주)
  motn_pric: str(), // 발동가격 (원)
  dynm_dispty_rt: str(), // 동적괴리율(%)
  trde_cntr_proc_time: str(), // 매매체결처리시각 HHmmss
  virelis_time: str(), // VI해제시각 HHmmss ("000000" = 미해제)
  viaplc_tp: str(), // VI적용구분 ("정적"/"동적" 등)
  dynm_stdpc: str(), // 동적기준가격 (원)
  static_stdpc: str(), // 정적기준가격 (원)
  static_dispty_rt: str(), // 정적괴리율(%)
  open_pric_pre_flu_rt: str(), // 시가대비등락률(%)
  vimotn_cnt: str(), // VI발동횟수
});

export type ViStockItem = z.infer<typeof viStockItemSchema>;

// ── ka10102: 거래원(회원사) 코드표 — /api/dostk/stkinfo, 파라미터 없음, 배열 `list` 73행 ──
//
// `mmcm_cd`를 줘도 무시하고 항상 전체를 준다. cont-yn=N(1페이지), 전 행 공백 필드 없음,
// REAL과 VIRTUAL의 표가 완전히 동일하다 (2026-08-04 실측).
//
// `gb`는 거래원 구분이다. 값별로 이름을 훑어 정체를 정했다:
//  - "0" 37개 — 국내 증권사 (교보·신한투자증권·한국투자증권·키움증권·토스·카카오페이 등)
//  - "1" 17개 — **외국계** (골드만삭스·모건스탠리·JP모간서울·씨티그룹·HSBC·CLSA·UBS·
//    메릴린치·노무라·BNP파리바·다이와·SG증권·맥쿼리 등). 17개가 예외 없이 외국계다.
//  - "2" 19개 — 합병·철수한 옛 거래원으로 보인다(아이엠투자·KB투자증권·RBS증권·한맥투자증권·
//    동양오리온 등, 800번대 코드가 여기 몰려 있다). 다만 키움 미문서라 "폐지"로 단정하지
//    않는다 — 확인된 사실은 **12종목 120슬롯의 ka10002 응답에 gb="2"가 한 번도 등장하지
//    않았다**는 것뿐이다.
//
// 거래원 계열 TR(ka10039/10052/10078 등)이 요구하는 `mmcm_cd`가 이 `code`다. 지금은
// ka10002가 코드 없이 **이름만** 주므로 이름으로 결합한다 — 같은 12종목 120슬롯에서
// 표에 없는 이름이 0건이었다. 이름 중복은 "미래에셋"(005 gb=0 / 049 gb=2) 하나뿐이라,
// 결합할 때 gb="2" 행을 뒤로 미뤄야 현행 코드가 이긴다.

export const brokerCodeItemSchema = z.looseObject({
  code: str(), // mmcm_cd — 거래원 계열 TR의 입력값
  name: str(), // "교  보", "H S B C"처럼 공백이 낀 이름이 그대로 온다 (ka10002도 동일 표기)
  gb: str(), // 0=국내, 1=외국계, 2=현재 거래에 나타나지 않는 옛 거래원
});
export type BrokerCodeItem = z.infer<typeof brokerCodeItemSchema>;

export const brokerCodeListResponseSchema = z.looseObject({
  ...envelope,
  list: z.array(brokerCodeItemSchema).default([]),
});

// ── ka10002: 주식거래원 — /api/dostk/stkinfo (flat, 상위 5 매도/매수 거래원) ──
// 수량은 부호 접두 (매도 음수/매수 양수 — 방향 중복이라 표시할 땐 절대값).

export const brokerActivityResponseSchema = z.looseObject({
  ...envelope,
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 방향)
  flu_rt: str(), // 등락률(%)
  sel_trde_ori_nm_1: str(), // 매도거래원명1
  sel_trde_qty_1: str(), // 매도거래량1 (주, 부호 접두)
  sel_trde_ori_nm_2: str(),
  sel_trde_qty_2: str(),
  sel_trde_ori_nm_3: str(),
  sel_trde_qty_3: str(),
  sel_trde_ori_nm_4: str(),
  sel_trde_qty_4: str(),
  sel_trde_ori_nm_5: str(),
  sel_trde_qty_5: str(),
  buy_trde_ori_nm_1: str(), // 매수거래원명1
  buy_trde_qty_1: str(), // 매수거래량1 (주, 부호 접두)
  buy_trde_ori_nm_2: str(),
  buy_trde_qty_2: str(),
  buy_trde_ori_nm_3: str(),
  buy_trde_qty_3: str(),
  buy_trde_ori_nm_4: str(),
  buy_trde_qty_4: str(),
  buy_trde_ori_nm_5: str(),
  buy_trde_qty_5: str(),
});

export type BrokerActivityResponse = z.infer<typeof brokerActivityResponseSchema>;

// ── ka90003: 프로그램순매수상위50 — /api/dostk/stkinfo ──
// prm_* 필드의 단위는 요청의 amt_qty_tp를 따른다 (1=금액 백만원, 2=수량 주).

export const programTradeItemSchema = z.looseObject({
  rank: str(), // 순위
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 방향)
  flu_rt: str(), // 등락률(%)
  acc_trde_qty: str(), // 누적거래량 (주)
  prm_sell_amt: str(), // 프로그램 매도
  prm_buy_amt: str(), // 프로그램 매수
  prm_netprps_amt: str(), // 프로그램 순매수 (부호)
});

export type ProgramTradeItem = z.infer<typeof programTradeItemSchema>;

// ── ka90005/ka90010: 프로그램매매추이 시간대별/일자별 — /api/dostk/mrkcond ──
// (mock-probed 2026-07-24) Both TRs share the SAME body and the SAME array key
// (prm_trde_trnsn) with an identical row shape — only the row axis differs:
// ka90005 = intraday rows CUMULATIVE for the day (cntr_tm HHmmss, newest-first,
// single page while the session runs), ka90010 = daily rows (cntr_tm
// yyyyMMdd000000, 100/page cont-yn Y; today's row is the live running total).
// Sign quirks: ka90005 doubles the sign ("--55456"); ka90010 single-signs and a
// positive all_netprps arrives UNSIGNED. Index quirk: kospi200 is a ×100 integer
// on ka90005 ("+108970" = 1089.70) but a plain decimal on ka90010 ("+1089.70");
// on the kosdaq market the field carries the kosdaq-side index despite its name.
// 차익+비차익 may be ±1 off 전체 (independent rounding) — display verbatim.
export const programTrendItemSchema = z.looseObject({
  cntr_tm: str(), // 체결시간 — ka90005 HHmmss / ka90010 yyyyMMdd000000
  dfrt_trde_netprps: str(), // 차익거래 순매수 (백만원, 부호)
  ndiffpro_trde_netprps: str(), // 비차익거래 순매수 (백만원, 부호)
  all_sel: str(), // 전체 매도 (백만원)
  all_buy: str(), // 전체 매수 (백만원)
  all_netprps: str(), // 전체 순매수 (백만원, 양수는 무부호로 올 수 있음)
  kospi200: str(), // 지수 (ka90005 ×100 정수 / ka90010 소수; 코스닥 시장이면 코스닥 지수)
  basis: str(), // BASIS (소수; 장 시작 직후 빈 값)
});

export type ProgramTrendItem = z.infer<typeof programTrendItemSchema>;

// ── ka90013: 종목일별프로그램매매추이 — /api/dostk/mrkcond (mock-probed 2026-07-24) ──
// amt_qty_tp does NOT change row content (금액/수량 fields are always both present —
// ka10131 class), so it is fixed to "1". 단위 실측: *_amt 백만원, *_qty 주
// (금액÷수량 ≈ 주가 교차검증, 005930). Double-signed values ("--199471").
// base_pric_tm/dbrt_trde_rpy_sum/remn_rcvord_sum arrive blank on mock — unconsumed
// (대차 데이터는 get_stock_lending이 담당). 20 rows/page, cont-yn Y.
export const stockProgramTrendItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  cur_prc: str(), // 종가/현재가 (부호 방향)
  flu_rt: str(), // 등락률(%)
  prm_sell_amt: str(), // 프로그램 매도금액 (백만원)
  prm_buy_amt: str(), // 프로그램 매수금액 (백만원)
  prm_netprps_amt: str(), // 프로그램 순매수금액 (백만원, 부호)
  prm_netprps_amt_irds: str(), // 순매수금액 증감 (백만원, 부호)
});

export type StockProgramTrendItem = z.infer<typeof stockProgramTrendItemSchema>;

// ── ka10170: 당일매매일지 — /api/dostk/acnt (live-verified 2026-07-07) ──
// NOTE: an empty trading day returns ONE all-blank row (not an empty array) — callers
// must filter blank rows (empty stk_cd/stk_nm). A base_dt beyond ~2 months returns
// return_code 0 with a "최근 2개월 이내" notice in return_msg and blank data. Item field
// NAMES are live-confirmed (blank-row keys + dongbin300 .NET model); non-empty item VALUES
// were NOT observable (no day-trade on this account), so treat them as provisional.

export const tradingJournalItemSchema = z.looseObject({
  stk_cd: code(),
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
  stk_cd: code(),
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
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre: str(),
  flu_rt: str(),
  trde_qty: str(),
  cnt: str(), // 연속 횟수
});
export type LimitStockItem = z.infer<typeof limitStockItemSchema>;

export const priceJumpItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  flu_rt: str(), // 전일 대비 등락률 (부호)
  base_pric: str(), // 기준가 (급등락 산정 기준시점 가격)
  jmp_rt: str(), // 기준 대비 급등/급락률 (부호)
  trde_qty: str(),
});
export type PriceJumpItem = z.infer<typeof priceJumpItemSchema>;

// ── ka10023: 거래량급증 (mock- + REAL-verified 2026-07-23) — array key `trde_qty_sdnin`,
// 200 rows/page (cont-yn Y); sdnin_qty/sdnin_rt arrive sign-prefixed ("+8571012");
// now_trde_qty caps at uint32 max like ka10030 (display verbatim) ──

export const volumeSurgeItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(), // 부호 포함
  pred_pre: str(), // 전일대비 (부호)
  flu_rt: str(), // 등락률 (부호)
  now_trde_qty: str(), // 현재거래량 (prev_trde_qty 미소비 — now − sdnin_qty로 유도 가능)
  sdnin_qty: str(), // 급증량 (부호)
  sdnin_rt: str(), // 급증률 % (부호)
});
export type VolumeSurgeItem = z.infer<typeof volumeSurgeItemSchema>;

// ── ka10024: 거래량갱신 (배열 `trde_qty_updt`, 200행/page) ──
//
// "직전 N일 최대 거래량을 당일 갱신한 종목"이다. `prev_trde_qty`가 **직전 N일 최대
// 거래량**이라는 건 일봉(ka10081)과 대조해 확정했다 — 251340 KODEX 코스닥150선물인버스의
// prev 63,165,636은 직전 20거래일 중 최대(8/3)와 정확히 같았고, now 77,598,515는 당일
// 거래량과 같았다(2026-08-04 실측). 전 행에서 now > prev다.
//
// 행은 값 순이 아니라 **종목코드 순**이라 정렬은 호출부가 한다. mrkt_tp "000"(전체)은
// 코스피 블록 뒤에 코스닥 블록이 붙는 꼴이라 전역 코드순도 아니다.
// 분량은 가볍다 — 최대 397행 2페이지(cycle 5일, 전체 시장 기준).

export const volumeRenewItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(),
  prev_trde_qty: str(), // 직전 N일 최대 거래량
  now_trde_qty: str(), // 당일 거래량
  sel_bid: str(), // 매도최우선호가
  buy_bid: str(), // 매수최우선호가
});
export type VolumeRenewItem = z.infer<typeof volumeRenewItemSchema>;

export const volumeRenewResponseSchema = z.looseObject({
  ...envelope,
  trde_qty_updt: z.array(volumeRenewItemSchema).default([]),
});

// ── ka10028: 시가대비등락률 (배열 `open_pric_pre_flu_rt`, 100행/page) ──
//
// `open_pric_pre`가 (현재가 − 시가) / 시가 × 100임을 400행 검산해 확인했다(불일치 0건,
// 2026-08-04 실측). `cntr_str`는 체결강도로 ka10046과 같은 척도다(100이 균형).
//
// 필수 파라미터가 9개인데 그중 **`sort_tp`와 `updown_incls`는 무효**다 — 1~5 / 0~1 어느
// 값을 넣어도 응답이 한 행도 안 바뀌고 항상 종목코드 순으로 온다. 정렬은 호출부가 한다.
// `trde_qty_cnd`는 실제로 먹는다(천주 단위 하한, "0100"→최소 100,929주).
//
// 분량이 문제다: 전체(mrkt_tp "000")는 하한 없이 3,000행 30페이지에도 cont-yn=Y로
// **끝이 안 난다**. 코스피 단독도 2,369행 24페이지로 MAX_PAGES(20)를 넘는다. 그래서
// 시장을 쪼개고 거래량 하한을 기본으로 건다 — 1만주 하한이면 코스피 1,493행 15페이지,
// 코스닥 1,486행 15페이지로 상한 안에 들어온다 (ka10066과 같은 처방).

export const openPriceChangeItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre_sig: str(),
  pred_pre: str(),
  flu_rt: str(), // 전일 대비 등락률(%)
  open_pric: str(),
  high_pric: str(),
  low_pric: str(),
  open_pric_pre: str(), // 시가 대비 등락률(%) — (현재가−시가)/시가
  now_trde_qty: str(),
  cntr_str: str(), // 체결강도 (ka10046과 같은 척도, 100이 균형)
});
export type OpenPriceChangeItem = z.infer<typeof openPriceChangeItemSchema>;

export const openPriceChangeResponseSchema = z.looseObject({
  ...envelope,
  open_pric_pre_flu_rt: z.array(openPriceChangeItemSchema).default([]),
});

// ── ka10087: 시간외단일가 (종목별, mock-probed 2026-07-26) — flat 46 fields, no array.
// 시간외 단일가 5단 호가(ovt_sigpric_sel_bid_{n}/_qty_{n}, buy도 동일)는 orderbook 선례대로
// loose passthrough로 읽는다; *_jub_pre(직전대비) 계열 15필드는 미소비.
// 총잔량이 세 쌍으로 온다: ovt_sigpric_* = 시간외 단일가, 무접두 = 정규장, ovt_* = 시간외.
// ovt_sigpric_pred_pre/flu_rt의 기준은 전일이 아니라 **당일 종가** (ka10098 행과
// 정확히 일치함을 실측 — 아래 afterHoursRankItemSchema 주석 참조) ──

export const afterHoursQuoteResponseSchema = z.looseObject({
  ...envelope,
  bid_req_base_tm: str(), // 호가잔량기준시간 HHmmss — 키움 주의사항: 시간외가 아닌 정규장 시각
  ovt_sigpric_cur_prc: str(), // 시간외단일가 현재가 (부호 접두)
  ovt_sigpric_pred_pre: str(), // 당일 종가 대비 (부호)
  ovt_sigpric_flu_rt: str(), // 당일 종가 대비 등락률 (부호)
  ovt_sigpric_acc_trde_qty: str(), // 시간외단일가 누적거래량
  ovt_sigpric_sel_bid_tot_req: str(), // 시간외단일가 매도호가 총잔량
  ovt_sigpric_buy_bid_tot_req: str(),
  sel_bid_tot_req: str(), // 정규장 매도호가 총잔량
  buy_bid_tot_req: str(),
  ovt_sel_bid_tot_req: str(), // 시간외 매도호가 총잔량
  ovt_buy_bid_tot_req: str(),
});

export type AfterHoursQuoteResponse = z.infer<typeof afterHoursQuoteResponseSchema>;

// ── ka10098: 시간외단일가 등락률 순위 (mock-probed 2026-07-26) — array key
// `ovt_sigpric_flu_rt_rank`, 100 rows/page (cont-yn Y), page-1 only.
// 실측 647행 전수 검증: pred_pre == |cur_prc| − tdy_close_pric, flu_rt ==
// pred_pre ÷ tdy_close_pric × 100 → **필드명은 전일대비지만 기준은 당일 종가**.
// tdy_close_pric_flu_rt만 정규장(전일 대비) 등락률. acc_trde_prica 단위는 백만원
// (거래량×주가 교차검증 174/174). pred_pre_sig 미소비 (부호가 값에 이미 있음) ──

export const afterHoursRankItemSchema = z.looseObject({
  rank: str(),
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(), // 시간외 단일가 (부호 접두)
  pred_pre: str(), // 당일 종가 대비 (부호)
  flu_rt: str(), // 당일 종가 대비 등락률 (부호)
  sel_tot_req: str(), // 시간외 매도총잔량
  buy_tot_req: str(),
  acc_trde_qty: str(), // 시간외 누적거래량
  acc_trde_prica: str(), // 시간외 누적거래대금 (백만원)
  tdy_close_pric: str(), // 당일 종가 (정규장)
  tdy_close_pric_flu_rt: str(), // 당일 종가의 전일 대비 등락률
});

export type AfterHoursRankItem = z.infer<typeof afterHoursRankItemSchema>;

// ── ka10086: 일별주가 — /api/dostk/mrkcond (mock + REAL 실측 2026-08-03, 005930).
// 배열 키 `daly_stkpc`, 20행/page (cont-yn Y), 최신 일자가 위. 22필드 전부 값이 온다.
// 중복 컬럼 확인: ind==ind_netprps, orgn==orgn_netprps, for_qty==for_netprps,
// crd_rt==crd_remn_rt, for_rt==for_poss==for_wght (양 환경 동일) → 각 조에서 하나만 쓴다.
// pred_rt는 이름이 '전일비'지만 값은 전일대비 '금액'이라 미소비 (flu_rt로 충분).
// 외인 보유비중(for_wght 조)은 get_foreign_holding(ka10008)이 이미 담당하고,
// 외국계 창구(frgn)는 개인/기관/외국인 3주체 + 프로그램이라는 표의 축과 결이 달라 뺐다 ──

export const dailyFlowItemSchema = z.looseObject({
  date: str(), // 날짜 yyyyMMdd
  open_pric: str(), // 시가 (부호 = 전일대비 방향)
  high_pric: str(),
  low_pric: str(),
  close_pric: str(),
  flu_rt: str(), // 등락률(%)
  trde_qty: str(), // 거래량(주)
  amt_mn: str(), // 거래대금 (백만원)
  crd_rt: str(), // 신용비율(%)
  ind_netprps: str(), // 개인 순매수
  orgn_netprps: str(), // 기관 순매수
  for_netprps: str(), // 외국인 순매수 — indc_tp와 무관하게 항상 수량(주)
  prm: str(), // 프로그램 순매수
});

export type DailyFlowItem = z.infer<typeof dailyFlowItemSchema>;

export const dailyFlowResponseSchema = z.looseObject({
  ...envelope,
  daly_stkpc: z.array(dailyFlowItemSchema).default([]),
});

// ── ka10015: 일별거래상세 — /api/dostk/stkinfo (mock + REAL 실측 2026-08-03, 005930).
// 배열 키 `daly_trde_dtl`, 100행/page, 최신 일자가 위.
// **수급 9필드(cntr_str, for_poss, for_wght, for_netprps, orgn_netprps, ind_netprps,
// frgn, crd_remn_rt, prm)는 모의·실전 양쪽 모두 전 행 공백**이라 선언조차 하지 않는다 —
// 그 축은 ka10086이 제대로 채워서 준다. 여기서 쓰는 건 장전/장중/장후 분포뿐이다.
// trde_prica 단위는 백만원 (같은 날 ka10086 amt_mn과 값이 정확히 일치) ──

export const dailySessionItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  close_pric: str(), // 종가 (부호 = 전일대비 방향)
  flu_rt: str(), // 등락률(%)
  trde_qty: str(), // 거래량(주)
  trde_prica: str(), // 거래대금 (백만원)
  bf_mkrt_trde_qty: str(), // 장전 거래량
  bf_mkrt_trde_wght: str(), // 장전 거래비중(%)
  opmr_trde_qty: str(), // 장중 거래량
  opmr_trde_wght: str(), // 장중 거래비중(%)
  af_mkrt_trde_qty: str(), // 장후 거래량
  af_mkrt_trde_wght: str(), // 장후 거래비중(%)
});

export type DailySessionItem = z.infer<typeof dailySessionItemSchema>;

export const dailySessionResponseSchema = z.looseObject({
  ...envelope,
  daly_trde_dtl: z.array(dailySessionItemSchema).default([]),
});

// ── ka10051: 업종별투자자순매수 — /api/dostk/sect (mock + REAL 실측 2026-08-03).
// 코스피 28행 / 코스닥 32행, cont-yn=N (단일 페이지). 20필드 전부 값이 온다.
// **cur_prc·pred_pre·flu_rt가 전부 지수 ×100 정수**다 — 같은 시각 ka20003이 준
// 종합(KOSPI) "+6595.45"/"+1001.89"/"+17.91"이 여기서는 659545/100189/1791로 온다.
// trde_qty만 ka20003과 값이 같다(천주). inds_cd는 stex_tp에 따라 접미사가 붙는데
// "3"(통합)이면 `001_AL`, "1"(KRX)이면 `001` — 서버의 다른 업종 TR과 맞춰 "1"을 쓴다.
// natn_netprps(국가)는 전 행 0이지만 그건 실제 매매가 없어서지 미제공이 아니다 ──

export const sectorNetBuyItemSchema = z.looseObject({
  inds_cd: code(), // 업종코드 3자리
  inds_nm: str(), // 업종명
  cur_prc: str(), // 업종 지수 ×100
  flu_rt: str(), // 등락률(%) ×100
  trde_qty: str(), // 거래량 (천주)
  ind_netprps: str(), // 개인
  frgnr_netprps: str(), // 외국인
  orgn_netprps: str(), // 기관계
  sc_netprps: str(), // 증권
  insrnc_netprps: str(), // 보험
  invtrt_netprps: str(), // 투신
  bank_netprps: str(), // 은행
  endw_netprps: str(), // 기금
  samo_fund_netprps: str(), // 사모펀드
  etc_corp_netprps: str(), // 기타법인
});

export type SectorNetBuyItem = z.infer<typeof sectorNetBuyItemSchema>;

export const sectorNetBuyResponseSchema = z.looseObject({
  ...envelope,
  inds_netprps: z.array(sectorNetBuyItemSchema).default([]),
});

// ── ka10101: 업종코드 리스트 — /api/dostk/stkinfo. ka10099와 마찬가지로 **camelCase로
// 답한다**. mrkt_tp 0/1/2/4/7 = 코스피 31 / 코스닥 34 / KOSPI200 28 / KOSPI100 2 /
// KRX100 29행 (실측 2026-08-03, mock·REAL 동일). code는 전부 3자리로 기존 업종 tool이
// 받는 값과 그대로 맞는다. group은 시장 내 일련번호라 소비하지 않는다 ──

export const sectorCodeItemSchema = z.looseObject({
  marketCode: str(),
  code: str(),
  name: str(),
});

export type SectorCodeItem = z.infer<typeof sectorCodeItemSchema>;

export const sectorCodeListResponseSchema = z.looseObject({
  ...envelope,
  list: z.array(sectorCodeItemSchema).default([]),
});

// ── ka10029: 예상체결등락률상위 — /api/dostk/rkinfo. 예상체결은 장 시작 동시호가
// (08:30~09:00)와 장 마감 동시호가(15:20~15:30)에만 존재한다 — 그 밖의 시간에는
// rc=0에 **0행**으로 온다 (mock·REAL 실측 2026-08-03 07:45). 예상체결가는 부호가
// 방향 표시라 parseKiwoomPrice로 읽어야 한다 ──

export const expectedExecutionItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  exp_cntr_pric: str(), // 예상체결가 (부호 = 기준가 대비 방향)
  base_pric: str(), // 기준가 (전일 종가)
  flu_rt: str(), // 등락률(%)
  exp_cntr_qty: str(), // 예상체결량
  sel_req: str(), // 매도잔량
  buy_req: str(), // 매수잔량
});

export type ExpectedExecutionItem = z.infer<typeof expectedExecutionItemSchema>;

export const expectedExecutionResponseSchema = z.looseObject({
  ...envelope,
  exp_cntr_flu_rt_upper: z.array(expectedExecutionItemSchema).default([]),
});

// ── ka10020: 호가잔량상위 — /api/dostk/rkinfo. 200행/page (cont-yn Y), page-1만.
// 장 시작 전에는 rc=0 200행이 오지만 잔량·거래량이 **전 행 0**이고 정렬도 무의미해진다
// (종목코드순으로 온다; mock·REAL 실측 2026-08-03 07:45) → 호출부에서 안내한다 ──

export const bidBalanceItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 = 전일대비 방향)
  pred_pre: str(), // 전일대비
  trde_qty: str(), // 거래량
  tot_sel_req: str(), // 총매도잔량
  tot_buy_req: str(), // 총매수잔량
  netprps_req: str(), // 순매수잔량 (매수 - 매도)
  buy_rt: str(), // 매수비율(%)
});

export type BidBalanceItem = z.infer<typeof bidBalanceItemSchema>;

export const bidBalanceResponseSchema = z.looseObject({
  ...envelope,
  bid_req_upper: z.array(bidBalanceItemSchema).default([]),
});

// ── ka10021: 호가잔량급증 — 배열 키 `bid_req_sdnin`. `int`(기준률)/`now`(현재)는
// 잔량 '수량'이고 sdnin_qty/sdnin_rt가 급증분이다 ──

export const bidSurgeItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre: str(),
  int: str(), // 기준 시점 잔량
  now: str(), // 현재 잔량
  sdnin_qty: str(), // 급증 수량
  sdnin_rt: str(), // 급증률(%)
  tot_buy_qty: str(), // 총매수량
});

export type BidSurgeItem = z.infer<typeof bidSurgeItemSchema>;

export const bidSurgeResponseSchema = z.looseObject({
  ...envelope,
  bid_req_sdnin: z.array(bidSurgeItemSchema).default([]),
});

// ── ka10022: 잔량율급증 — 배열 키 `req_rt_sdnin`. ka10021과 달리 `int`/`now_rt`가
// 잔량 '비율'이다 (키 이름도 now → now_rt로 다르다) ──

export const bidRatioSurgeItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(),
  pred_pre: str(),
  int: str(), // 기준 비율(%)
  now_rt: str(), // 현재 비율(%)
  sdnin_rt: str(), // 급증률(%)
  tot_sel_req: str(), // 총매도잔량
  tot_buy_req: str(), // 총매수잔량
});

export type BidRatioSurgeItem = z.infer<typeof bidRatioSurgeItemSchema>;

export const bidRatioSurgeResponseSchema = z.looseObject({
  ...envelope,
  req_rt_sdnin: z.array(bidRatioSurgeItemSchema).default([]),
});

// ── ka10013: 신용매매동향 — /api/dostk/stkinfo (mock + REAL 실측 2026-08-03, 005930).
// 배열 키 `crd_trde_trend`, 100행/page, 최신 일자가 먼저.
//
// 단위는 실측으로 확정했다: `remn`(잔고)은 **주**다 — 삼성전자 21,607,489주를 상장주식수
// 5,969,782,550으로 나누면 0.36%로 `remn_rt`와 정확히 일치한다. `amt`(잔고금액)는
// **백만원**이다 — amt/remn = 206,616원/주로, 잔고가 쌓인 구간의 주가(207,000원대)와 맞다
// (천원이면 206원/주가 되어 말이 안 된다).

export const creditTrendItemSchema = z.looseObject({
  dt: str(), // 일자 yyyyMMdd
  cur_prc: str(), // 종가 (부호 = 전일대비 방향)
  pred_pre_sig: str(), // 대비기호
  pred_pre: str(), // 전일대비 (부호 유의미)
  trde_qty: str(), // 거래량 (주)
  new: str(), // 신규 (주)
  rpya: str(), // 상환 (주)
  remn: str(), // 잔고 (주)
  amt: str(), // 잔고금액 (백만원)
  pre: str(), // 잔고 전일대비 (주, 부호 유의미)
  shr_rt: str(), // 공여율(%) — 비방향성 비율
  remn_rt: str(), // 잔고율(%) — 잔고/상장주식수
});

export type CreditTrendItem = z.infer<typeof creditTrendItemSchema>;

export const creditTrendResponseSchema = z.looseObject({
  ...envelope,
  crd_trde_trend: z.array(creditTrendItemSchema).default([]),
});

export type CreditTrendResponse = z.infer<typeof creditTrendResponseSchema>;

// ── ka10026: 고저PER — /api/dostk/stkinfo (mock + REAL 실측 2026-08-03).
//
// **값 컬럼은 지표와 무관하게 항상 `per`라는 이름으로 온다.** pertp=3(저PBR)이면 `per`에
// PBR이, pertp=5(저ROE)이면 `per`에 ROE가 담긴다 — ka10001과 교차검증해 확정했다
// (씨엑스아이 pertp=1 → 0.40 = ka10001 per, pertp=3 → 0.01 = ka10001 pbr / 비트맥스
// pertp=5 → -774.04 = ka10001 roe). 필드명만 보고 PER로 렌더하면 전부 틀린다.

export const valuationRankItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  per: str(), // 선택한 지표값 (PER/PBR/ROE — ROE는 음수가 실제로 온다)
  cur_prc: str(), // 현재가 (부호 = 전일대비 방향)
  pred_pre_sig: str(), // 대비기호
  pred_pre: str(), // 전일대비 (부호 유의미)
  flu_rt: str(), // 등락률(%)
  now_trde_qty: str(), // 거래량 (주)
});

export type ValuationRankItem = z.infer<typeof valuationRankItemSchema>;

export const valuationRankResponseSchema = z.looseObject({
  ...envelope,
  high_low_per: z.array(valuationRankItemSchema).default([]),
});

// ── ka10025: 매물대집중 — /api/dostk/stkinfo (mock + REAL 실측 2026-08-03).
// 배열 키 `prps_cnctr`, 200행/page.
//
// 행 단위가 '종목'이 아니라 **종목 × 매물대 구간**이다 — 같은 종목이 서로 다른 가격대로
// 두 번 나올 수 있다(실측 200행 중 1종목). `pric_strt`~`pric_end`가 그 구간이고
// `prps_rt`는 구간에 몰린 매물 비중(%)이다.

export const supplyConcentrationItemSchema = z.looseObject({
  stk_cd: code(),
  stk_nm: str(),
  cur_prc: str(), // 현재가 (부호 = 전일대비 방향)
  pred_pre_sig: str(), // 대비기호
  pred_pre: str(), // 전일대비 (부호 유의미)
  flu_rt: str(), // 등락률(%)
  now_trde_qty: str(), // 거래량 (주)
  pric_strt: str(), // 매물대 구간 시작가 (부호 없음)
  pric_end: str(), // 매물대 구간 종료가 (부호 없음)
  prps_qty: str(), // 매물량 (주)
  prps_rt: str(), // 매물비율(%) — "+50.00"처럼 부호가 붙지만 항상 양수다
});

export type SupplyConcentrationItem = z.infer<typeof supplyConcentrationItemSchema>;

export const supplyConcentrationResponseSchema = z.looseObject({
  ...envelope,
  prps_cnctr: z.array(supplyConcentrationItemSchema).default([]),
});

// ── kt00017: 계좌별당일현황 — /api/dostk/acnt (REAL 실측 2026-08-03).
// **배열이 없는 플랫 응답**(스칼라 25필드)이고, 파라미터도 필요 없다(빈 body로 rc=0).
// 모의투자는 RC9000으로 미제공 — kt00015·kt00002와 같은 부류다.
//
// 금액은 전부 "000000525569"처럼 12자리 zero-pad 문자열로 온다 (원 단위).

export const accountTodayStatusSchema = z.looseObject({
  ...envelope,
  d2_entra: str(), // D+2 추정예수금
  gnrl_stk_evlt_amt_d2: str(), // D+2 일반주식 평가금액
  dpst_grnt_use_amt_d2: str(), // D+2 예탁담보대출금
  crd_stk_evlt_amt_d2: str(), // D+2 신용주식 평가금액
  crd_loan_d2: str(), // D+2 신용융자금
  crd_loan_evlta_d2: str(), // D+2 신용융자 평가금
  crd_ls_grnt_d2: str(), // D+2 신용대주 담보금
  crd_ls_evlta_d2: str(), // D+2 신용대주 평가금
  ina_amt: str(), // 당일 입금금액
  outa: str(), // 당일 출금금액
  inq_amt: str(), // 당일 입고금액
  outq_amt: str(), // 당일 출고금액
  sell_amt: str(), // 당일 매도금액
  buy_amt: str(), // 당일 매수금액
  cmsn: str(), // 당일 수수료
  tax: str(), // 당일 세금
  crd_int_amt: str(), // 당일 신용이자
  crd_int_npay_gold: str(), // 신용이자 미납금
  etc_loana: str(), // 기타 대여금
  stk_pur_cptal_loan_amt: str(), // 주식매입자금 대출금
  sel_prica_grnt_loan_int_amt_amt: str(), // 매도대금 담보대출 이자
  rp_evlt_amt: str(), // RP 평가금액
  bd_evlt_amt: str(), // 채권 평가금액
  elsevlt_amt: str(), // ELS 평가금액
  dvida_amt: str(), // 배당금액
});

export type AccountTodayStatus = z.infer<typeof accountTodayStatusSchema>;

// ── ka10036: 외인한도소진율증가상위 ──

/**
 * 외국인 한도소진율이 기간 대비 가장 많이 오른 종목. `exh_rt_incrs` 내림차순.
 *
 * ka10008(`get_foreign_holding`)의 **시장 전체 스크리너 판**이다 — 1위 KODEX 차이나H의
 * `poss_stkcnt` 837,548 / `gain_pos_stkcnt` 662,452 / `limit_exh_rt` +55.84가 같은 날
 * ka10008 행과 한 자리도 다르지 않다(실측 2026-08-04). 새 데이터가 아니라 새 축이다.
 *
 * `trde_qty`에 32비트 포화값(4294967295, KODEX 200선물인버스2X 실측)이 실재하므로
 * `isSaturatedInt`로 걸러 상한 표기를 한다.
 */
export const foreignLimitSurgeResponseSchema = z.looseObject({
  ...envelope,
  for_limit_exh_rt_incrs_upper: z
    .array(
      z.looseObject({
        rank: str(),
        stk_cd: code(),
        stk_nm: str(),
        cur_prc: str(),
        pred_pre_sig: str(),
        pred_pre: str(),
        trde_qty: str(),
        poss_stkcnt: str(), // 보유주식수
        gain_pos_stkcnt: str(), // 취득가능주식수
        base_limit_exh_rt: str(), // 기준일 한도소진율
        limit_exh_rt: str(), // 현재 한도소진율
        exh_rt_incrs: str(), // 소진율 증가폭 (정렬 기준)
      }),
    )
    .default([]),
});

export type ForeignLimitSurgeItem = z.infer<
  typeof foreignLimitSurgeResponseSchema
>["for_limit_exh_rt_incrs_upper"][number];

// ── ka10034: 외인기간별매매상위 ──

/**
 * 기간 누적 외국인 순매매 상위. **"투자자 외국인"이 아니라 "외국인 보유(한도)" 계열**이다.
 *
 * 005930으로 대조하면 ka10059(투자자별)와는 부호까지 다르고(+846,645) ka10008(보유)의
 * `chg_qty` 누적과 맞는다 — dt 1/10/20 세 구간의 차이가 전부 정확히 −110,784로 같았다
 * (당일분이 ka10008에는 아직 반영되지 않은 몫). 우연으로 세 번 같을 수 없다.
 * ka10066·ka10059와 같은 표에 섞으면 안 된다.
 *
 * `netprps_qty`는 `--19229312`처럼 **이중부호**로 온다 — parseKiwoomNumber가 흡수한다.
 */
export const foreignPeriodTradeResponseSchema = z.looseObject({
  ...envelope,
  for_dt_trde_upper: z
    .array(
      z.looseObject({
        rank: str(),
        stk_cd: code(),
        stk_nm: str(),
        cur_prc: str(),
        pred_pre_sig: str(),
        pred_pre: str(),
        sel_bid: str(),
        buy_bid: str(),
        trde_qty: str(),
        netprps_qty: str(), // 기간 누적 순매매 수량 (이중부호 주의)
        gain_pos_stkcnt: str(),
      }),
    )
    .default([]),
});

export type ForeignPeriodTradeItem = z.infer<
  typeof foreignPeriodTradeResponseSchema
>["for_dt_trde_upper"][number];

// ── ka10035: 외인연속순매매상위 ──

/**
 * 외국인이 **3일 연속** 같은 방향으로 순매매한 종목 상위 100 (REAL 실측 2026-08-07).
 *
 * `dm1`~`dm3`이 3일치 일별 순매매이고 `tot`이 그 합계다. "연속"의 정의가 여기서 확인된다 —
 * 100/100 행에서 `dm1`~`dm3` 부호가 3일 모두 같았다.
 *
 * `pred_pre_1`~`pred_pre_3`은 **전 행 공백**이라 선언하지 않는다.
 * ka10034와 같은 외국인 한도/보유 계열이라 `limit_exh_rt`(한도소진율)가 같이 온다.
 */
export const foreignStreakTradeResponseSchema = z.looseObject({
  ...envelope,
  for_cont_nettrde_upper: z
    .array(
      z.looseObject({
        stk_cd: code(),
        stk_nm: str(),
        cur_prc: str(),
        pred_pre_sig: str(),
        pred_pre: str(),
        dm1: str(), // 1일 전 순매매
        dm2: str(), // 2일 전
        dm3: str(), // 3일 전
        tot: str(), // 3일 합계
        limit_exh_rt: str(), // 한도소진율(%)
      }),
    )
    .default([]),
});

export type ForeignStreakTradeItem = z.infer<
  typeof foreignStreakTradeResponseSchema
>["for_cont_nettrde_upper"][number];

// ── ka10038: 종목별증권사순위 ──

/**
 * 한 종목을 거래한 **전 거래원**의 순위 (REAL 실측 2026-08-07, 005930에서 50행 · cont-yn=N).
 * ka10002(`get_broker_activity` 종목 모드)가 상위 5개만 주는 것과 달리 전체를 준다.
 *
 * 응답 스칼라 `rank_1`/`rank_2`/`rank_3`은 표시된 거래원들의 매수·매도·순매매 **합계**이고,
 * `prid_trde_qty`는 **기간 정의를 확정하지 못해 선언하지 않는다** — 005930 기준 8/4
 * 8,914,099,446 → 8/7 8,937,714,459로 3거래일에 +23.6M인데 일 거래량(19~35M)과 안 맞는다.
 * 단위·기간을 모르는 값은 `※` 각주로도 못 밝히므로 아예 노출하지 않는 쪽이 맞다.
 *
 * `acc_netprps_qty`는 `--34274015`처럼 **이중부호**로 온다 — parseKiwoomNumber가 흡수한다.
 */
export const brokerStockRankResponseSchema = z.looseObject({
  ...envelope,
  stk_sec_rank: z
    .array(
      z.looseObject({
        rank: str(),
        mmcm_nm: str(), // 거래원명 — ka10002·ka10102와 같은 표기(이중 공백 포함)
        buy_qty: str(),
        sell_qty: str(),
        acc_netprps_qty: str(), // 누적 순매매 수량 (이중부호 주의)
      }),
    )
    .default([]),
});

export type BrokerStockRankItem = z.infer<
  typeof brokerStockRankResponseSchema
>["stk_sec_rank"][number];

// ── ka10033: 신용비율상위 ──

/**
 * 신용융자 잔고비율이 높은 종목. `crd_rt` 내림차순.
 *
 * `updown_incls`·`stk_cnd`는 필수인데 **값을 바꿔도 100행 첫 행이 같아** 노출하지 않는다.
 * 실제로 듣는 건 `trde_qty_tp`(거래량 하한)뿐이다 — 0000·0050은 같고 0500에서 모수가 바뀐다.
 * `stk_infr`(종목정보 "28" 등)은 의미를 확정하지 못해 선언하지 않는다.
 */
export const creditRatioRankResponseSchema = z.looseObject({
  ...envelope,
  crd_rt_upper: z
    .array(
      z.looseObject({
        stk_cd: code(),
        stk_nm: str(),
        cur_prc: str(),
        pred_pre_sig: str(),
        pred_pre: str(),
        flu_rt: str(),
        crd_rt: str(), // 신용비율 (정렬 기준)
        sel_req: str(), // 매도잔량
        buy_req: str(), // 매수잔량
        now_trde_qty: str(),
      }),
    )
    .default([]),
});

export type CreditRatioRankItem = z.infer<
  typeof creditRatioRankResponseSchema
>["crd_rt_upper"][number];

// ── ka10062: 동일순매매순위 ──

/**
 * 기관과 외국인이 **동시에** 같은 방향으로 순매매한 종목 + 각각의 추정 평균단가.
 * 두 주체의 방향이 겹치는 지점만 뽑아 주는 건 이 TR뿐이라 단독 tool로 냈다.
 *
 * ⚠️ **한 행 안에서 단위가 갈린다** — 수량은 **천주**, 금액은 **백만원**, 평균단가는 **원**이다.
 * `orgn_nettrde_qty × orgn_nettrde_avg_pric ÷ orgn_nettrde_amt`가 5종목에서 991·987·970·1028로
 * ≈1,000인 반면 같은 행의 `acc_trde_qty`는 주 단위다(파마리서치 251,994주).
 *
 * ⚠️ `orgn_nettrde_avg_pric`에 **32비트 포화값 −2,147,483**(=−2³¹/1000)이 실재한다(효성중공업).
 *
 * ⚠️ `trde_tp`는 0을 노출하지 않는다 — 실측으로 **0과 2는 같은 100종목에 부호만 반대**다
 * (한온시스템 tp0 net=+3195 / tp2 net=--3195, 공통 100/100). 0을 쓰면 순매도 종목이
 * 순매수처럼 양수로 렌더된다. 1(순매수)과 2(순매도)만 쓴다.
 */
export const equalNetTradeRankResponseSchema = z.looseObject({
  ...envelope,
  eql_nettrde_rank: z
    .array(
      z.looseObject({
        rank: str(),
        stk_cd: code(),
        stk_nm: str(),
        cur_prc: str(),
        pre_sig: str(),
        pred_pre: str(),
        flu_rt: str(),
        acc_trde_qty: str(), // 누적 거래량 (주 단위)
        orgn_nettrde_qty: str(), // 기관 순매매 (천주)
        orgn_nettrde_amt: str(), // 기관 순매매 (백만원)
        orgn_nettrde_avg_pric: str(), // 기관 추정 평균단가 (원, 포화값 주의)
        for_nettrde_qty: str(), // 외국인 순매매 (천주)
        for_nettrde_amt: str(), // 외국인 순매매 (백만원)
        for_nettrde_avg_pric: str(),
        nettrde_qty: str(), // 합계 순매매 (천주)
        nettrde_amt: str(), // 합계 순매매 (백만원)
      }),
    )
    .default([]),
});

export type EqualNetTradeRankItem = z.infer<
  typeof equalNetTradeRankResponseSchema
>["eql_nettrde_rank"][number];

// ── ka10037: 외국계창구매매상위 ──

/**
 * 외국계 증권사 창구에서 순매수/순매도가 큰 종목. ka10002(종목별 거래원)의 시장 전체 판이다.
 *
 * ⚠️ **`trde_tp` 의미가 ka10034와 정반대다** (실측 2026-08-04, rank 100행의 순매매 부호로 확정):
 * ka10037은 1=순매수(100/0) · 2=순매도(0/100) · 0=전체(코드순, 39/34 혼재)인데,
 * ka10034는 1=순매도 · 2=순매수다. 두 TR을 같이 만질 때 값을 복사하지 말 것.
 *
 * `netprps_trde_qty`·`netprps_prica`는 `--1073702`처럼 이중부호로 온다.
 * `netprps_prica`는 백만원 단위다(현대차 +59,569 ≈ 151,710주 × 392,500원).
 */
export const foreignBrokerRankResponseSchema = z.looseObject({
  ...envelope,
  frgn_wicket_trde_upper: z
    .array(
      z.looseObject({
        rank: str(),
        stk_cd: code(),
        stk_nm: str(),
        cur_prc: str(),
        pred_pre_sig: str(),
        pred_pre: str(),
        flu_rt: str(),
        sel_trde_qty: str(), // 외국계 창구 매도량
        buy_trde_qty: str(), // 외국계 창구 매수량
        netprps_trde_qty: str(), // 순매매 수량 (이중부호)
        netprps_prica: str(), // 순매매 금액(백만원, 이중부호)
        trde_qty: str(), // 종목 전체 거래량
        trde_prica: str(), // 종목 전체 거래대금(백만원)
      }),
    )
    .default([]),
});

export type ForeignBrokerRankItem = z.infer<
  typeof foreignBrokerRankResponseSchema
>["frgn_wicket_trde_upper"][number];

// ── ka50010: 금현물체결 ──

/**
 * KRX 금시장 체결(틱). 최신 체결이 위이고 `tm`은 HHmmss다.
 *
 * `acc_trde_prica`가 **원 단위**라는 점이 ka50012(백만원)와 다르다 — 같은 종목 같은 날인데
 * 18,154,047,200 vs 18,154로 자릿수가 갈린다(실측 2026-08-04 M04020000).
 * `cntr_trde_qty`에는 `+1`·`-2`처럼 체결 방향 부호가 붙으므로 수량은 절대값으로 읽는다.
 */
export const goldContractResponseSchema = z.looseObject({
  ...envelope,
  gold_cntr: z
    .array(
      z.looseObject({
        cntr_pric: str(), // 체결가
        pred_pre: str(), // 전일대비
        flu_rt: str(), // 등락률
        trde_qty: str(), // 누적 거래량(g)
        acc_trde_prica: str(), // 누적 거래대금(원)
        cntr_trde_qty: str(), // 체결량 — 부호는 방향
        tm: str(), // HHmmss
        pre_sig: str(),
        pri_sel_bid_unit: str(), // 최우선 매도호가
        pri_buy_bid_unit: str(), // 최우선 매수호가
        trde_pre: str(), // 거래비중
        trde_tern_rt: str(), // 회전율
        cntr_str: str(), // 체결강도
      }),
    )
    .default([]),
});

export type GoldContractItem = z.infer<typeof goldContractResponseSchema>["gold_cntr"][number];

// ── ka50012: 금현물일별추이 ──

/**
 * KRX 금시장 일별 시세 + 투자자 3주체 순매수. 최신 일자가 위.
 *
 * `for_netprps`는 30행 내내 `0`이었다(실측 2026-08-04 M04020000·M04020100 양쪽) —
 * 금현물에 외국인 수급이 없다는 뜻인지 미제공인지 확정하지 못했으므로 표기할 때
 * "0"으로 단정하지 않는다. `acc_trde_prica`는 **백만원** 단위다(ka50010은 원).
 */
export const goldDailyResponseSchema = z.looseObject({
  ...envelope,
  gold_daly_trnsn: z
    .array(
      z.looseObject({
        dt: str(), // yyyyMMdd
        cur_prc: str(), // 종가
        pred_pre: str(),
        flu_rt: str(),
        trde_qty: str(), // 거래량(g)
        acc_trde_prica: str(), // 거래대금(백만원)
        open_pric: str(),
        high_pric: str(),
        low_pric: str(),
        pre_sig: str(),
        orgn_netprps: str(), // 기관 순매수
        for_netprps: str(), // 외국인 순매수
        ind_netprps: str(), // 개인 순매수
      }),
    )
    .default([]),
});

export type GoldDailyItem = z.infer<typeof goldDailyResponseSchema>["gold_daly_trnsn"][number];

/** Strips Kiwoom's asset-class prefix (e.g. "A005930" → "005930"). */
export function normalizeStockCode(code: string): string {
  return code.replace(/^[A-Z]/, "");
}
