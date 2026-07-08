import { sleep } from "../utils/sleep.js";
import { fetchStockList } from "./api.js";
import type { KiwoomClient } from "./client.js";
import type { StockListItem } from "./types.js";

/**
 * Shared in-process cache of the ka10099 종목 마스터 list (KOSPI + KOSDAQ,
 * ETF/ETN included). Both `search_stock` and the watchlist tools read it to
 * resolve a bare 종목코드 to a name/전일종가 without extra per-stock API calls.
 * The list changes at most daily (listings/delistings), so a 12h TTL is ample.
 */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** ka10099 is one TR — space the two market calls to respect the ~1 req/s limit. */
const MARKET_FETCH_GAP_MS = 1_100;

let cache: { fetchedAt: number; items: StockListItem[] } | null = null;

export async function loadMasterList(client: KiwoomClient): Promise<StockListItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.items;
  const kospi = await fetchStockList(client, "0");
  await sleep(MARKET_FETCH_GAP_MS);
  const kosdaq = await fetchStockList(client, "10");
  cache = { fetchedAt: Date.now(), items: [...kospi, ...kosdaq] };
  return cache.items;
}

/** Test hook — clears the module-level master-list cache. */
export function clearMasterListCache(): void {
  cache = null;
}
