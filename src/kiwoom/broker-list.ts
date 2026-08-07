import { fetchBrokerCodes } from "./api.js";
import type { KiwoomClient } from "./client.js";
import type { BrokerCodeItem } from "./types.js";

/**
 * ka10102 거래원(회원사) 코드표의 인프로세스 캐시 — master-list.ts와 같은 꼴이다.
 *
 * 73행짜리 표이고 증권사 인가·합병이 있을 때나 바뀌므로 12h TTL로 충분하다. 실제 쓰임은
 * `get_broker_activity`가 거래원명 옆에 외국계 표시를 붙이는 것 하나뿐이지만, `code`는
 * 거래원 계열 TR(ka10039/10052/10078 등)이 요구하는 `mmcm_cd`라 그쪽을 열 때 그대로 쓴다.
 */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let cache: { fetchedAt: number; items: BrokerCodeItem[] } | null = null;
/** 진행 중인 적재를 공유한다 — master-list·sector-list와 같은 꼴 (TokenManager 패턴). */
let inflight: Promise<BrokerCodeItem[]> | null = null;

async function fetchAndCache(client: KiwoomClient): Promise<BrokerCodeItem[]> {
  const items = await fetchBrokerCodes(client);
  cache = { fetchedAt: Date.now(), items };
  return items;
}

export async function loadBrokerCodes(client: KiwoomClient): Promise<BrokerCodeItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.items;
  inflight ??= fetchAndCache(client).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Test hook — clears the module-level 거래원 코드표 캐시. */
export function clearBrokerCodeCache(): void {
  cache = null;
  inflight = null;
}

/** ka10102 `gb` — 0=국내, 1=외국계, 2=현재 거래에 나타나지 않는 옛 거래원. */
const FOREIGN_GB = "1";
const RETIRED_GB = "2";

/**
 * 거래원명 → 코드표 행. ka10002가 코드 없이 이름만 주기 때문에 이름이 결합 키다
 * (12종목 120슬롯에서 표에 없는 이름 0건, 2026-08-04 실측).
 *
 * 이름 중복은 "미래에셋"(005 gb=0 / 049 gb=2) 하나뿐이라 **gb="2" 행은 덮어쓰지 않는다** —
 * 먼저 온 행이 폐지 코드였다면 현행 행으로 교체한다.
 */
export function brokerIndexByName(items: BrokerCodeItem[]): Map<string, BrokerCodeItem> {
  const index = new Map<string, BrokerCodeItem>();
  for (const item of items) {
    const key = item.name.trim();
    if (!key) continue;
    const existing = index.get(key);
    if (!existing || existing.gb === RETIRED_GB) index.set(key, item);
  }
  return index;
}

/** 이 거래원이 외국계인가. 표에 없는 이름은 false — 모르는 걸 외국계로 부르지 않는다. */
export function isForeignBroker(index: Map<string, BrokerCodeItem>, name: string): boolean {
  return index.get(name.trim())?.gb === FOREIGN_GB;
}
