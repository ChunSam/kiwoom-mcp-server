import { todayInKst } from "../utils/date.js";
import { sleep } from "../utils/sleep.js";
import { fetchStockList } from "./api.js";
import type { KiwoomClient } from "./client.js";
import type { StockListItem } from "./types.js";

/**
 * Shared in-process cache of the ka10099 종목 마스터 list (KOSPI + KOSDAQ,
 * ETF/ETN included). Both `search_stock` and the watchlist tools read it to
 * resolve a bare 종목코드 to a name/전일종가 without extra per-stock API calls.
 * The list changes at most daily (listings/delistings), so a 12h TTL is ample.
 *
 * **TTL만으로는 부족하다** — 같은 행에 매 거래일 바뀌는 `lastPrice`(전일종가)가 실려 있는데
 * 경과시간 TTL은 KST 날짜 경계를 모른다. 23:00에 채운 캐시는 다음 날 11:00까지 살아남아
 * 하루 묵은 종가를 준다. 그래서 TTL과 **KST 날짜**를 함께 본다.
 */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** ka10099 is one TR — space the two market calls to respect the ~1 req/s limit. */
const MARKET_FETCH_GAP_MS = 1_100;

let cache: { fetchedAt: number; fetchedOn: string; items: StockListItem[] } | null = null;
/**
 * 진행 중인 적재를 공유한다. 캐시가 콜드일 때 tool 두 개가 동시에 들어오면 각자 ka10099
 * 2콜을 처음부터 돌아 레이트리밋을 밀어붙인다 — TokenManager가 토큰 발급에 쓰는 것과 같은
 * 패턴으로 한 건만 나가게 한다.
 */
let inflight: Promise<StockListItem[]> | null = null;

async function fetchBothMarkets(client: KiwoomClient): Promise<StockListItem[]> {
  const kospi = await fetchStockList(client, "0");
  await sleep(MARKET_FETCH_GAP_MS);
  const kosdaq = await fetchStockList(client, "10");
  const items = [...kospi, ...kosdaq];
  cache = { fetchedAt: Date.now(), fetchedOn: todayInKst(), items };
  return items;
}

export async function loadMasterList(client: KiwoomClient): Promise<StockListItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS && cache.fetchedOn === todayInKst()) {
    return cache.items;
  }
  inflight ??= fetchBothMarkets(client).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Test hook — clears the module-level master-list cache. */
export function clearMasterListCache(): void {
  cache = null;
  inflight = null;
}

/**
 * ka10099 orderWarning(투자유의종목여부) codes. "5" arrives on rows whose
 * auditInfo is 투자경고 (mock-probed 2026-07-11), so the openapi description's
 * "투자경과" is read as a typo for 투자경고. "1" is ETF-only.
 */
const ORDER_WARNING_LABELS: Record<string, string> = {
  "1": "ETF투자주의요망",
  "2": "정리매매",
  "3": "단기과열",
  "4": "투자위험",
  "5": "투자경고",
};

/**
 * Abnormal-status labels for a master-list row — 감리구분(auditInfo)이 "정상"이
 * 아니면 그 값을, orderWarning이 "0"이 아니면 라벨을 모은다. 둘이 같은 상태를
 * 가리키는 경우(예: auditInfo "단기과열" + orderWarning "3")는 한 번만 담는다.
 * 정상 종목은 빈 배열.
 */
export function masterItemWarnings(item: StockListItem): string[] {
  const warnings: string[] = [];
  if (item.auditInfo && item.auditInfo !== "정상") warnings.push(item.auditInfo);
  const orderLabel = ORDER_WARNING_LABELS[item.orderWarning];
  if (orderLabel && !warnings.includes(orderLabel)) warnings.push(orderLabel);
  return warnings;
}
