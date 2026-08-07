import { sleep } from "../utils/sleep.js";
import { fetchSectorCodes, SECTOR_CODE_MARKETS } from "./api.js";
import type { KiwoomClient } from "./client.js";
import { KiwoomApiError } from "./errors.js";
import type { SectorCodeItem } from "./types.js";

/**
 * Shared in-process cache of the ka10101 업종 코드 마스터 (코스피·코스닥·KOSPI200·
 * KOSPI100·KRX100 = 124행 실측). 업종 tool들이 사용자가 넘긴 업종명을 코드로 바꾸고,
 * 포맷터가 코드에 이름을 붙이는 데 쓴다. 목록은 거의 바뀌지 않으므로 12h TTL이면 충분하다.
 */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** ka10101은 한 TR이라 5개 시장구분 호출을 ~1 req/s 제한에 맞춰 띄운다. */
const SECTOR_FETCH_GAP_MS = 1_100;

const MARKET_LABELS: Record<string, string> = {
  "0": "코스피",
  "1": "코스닥",
  "2": "KOSPI200",
  "4": "KOSPI100",
  "7": "KRX100",
};

let cache: { fetchedAt: number; items: SectorCodeItem[] } | null = null;
/** 5콜짜리 적재라 중복이 특히 비싸다 — 진행 중인 것을 공유한다 (TokenManager와 같은 패턴). */
let inflight: Promise<SectorCodeItem[]> | null = null;

async function fetchAllMarkets(client: KiwoomClient): Promise<SectorCodeItem[]> {
  const items: SectorCodeItem[] = [];
  for (const [index, marketTp] of SECTOR_CODE_MARKETS.entries()) {
    if (index > 0) await sleep(SECTOR_FETCH_GAP_MS);
    items.push(...(await fetchSectorCodes(client, marketTp)));
  }
  cache = { fetchedAt: Date.now(), items };
  return items;
}

export async function loadSectorList(client: KiwoomClient): Promise<SectorCodeItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.items;
  inflight ??= fetchAllMarkets(client).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Test hook — clears the module-level sector-list cache. */
export function clearSectorListCache(): void {
  cache = null;
  inflight = null;
}

/**
 * 캐시가 이미 채워져 있으면 코드의 업종명을 준다. 순수 포맷터에서 호출하려고
 * **동기**로 두었다 — 캐시가 비어 있으면 null이고, 호출부는 기존 하드코딩 라벨로
 * 폴백한다. 핸들러가 resolveSectorCode를 먼저 거치므로 실제로는 거의 항상 따뜻하다.
 */
export function sectorNameFromCache(code: string): string | null {
  if (!cache) return null;
  return cache.items.find((item) => item.code === code)?.name ?? null;
}

const marketLabel = (item: SectorCodeItem): string =>
  MARKET_LABELS[item.marketCode] ?? `시장 ${item.marketCode}`;

const candidateList = (items: SectorCodeItem[]): string =>
  items.map((item) => `${item.code}(${marketLabel(item)} ${item.name})`).join(", ");

/** 공백·대소문자 차이를 무시한 비교용 키 ("IT 서비스" ↔ "it서비스"). */
const normalize = (value: string): string => value.replace(/\s+/g, "").toLowerCase();

/**
 * 3자리 업종 코드는 그대로, 그 밖의 입력은 업종명으로 보고 ka10101 마스터에서 찾는다.
 *
 * 이름은 시장 간에 자주 겹친다 — 실측 124행 중 20개 이름이 중복이고 "화학"만 해도
 * 코스피 008 / 코스닥 119다. 그래서 후보가 둘 이상이면 **고르지 않고** 코드 목록을
 * 담은 에러를 던진다. 조용히 하나를 집으면 사용자가 의도한 시장이 아닌 값을 그럴듯한
 * 표로 돌려주게 된다.
 */
export async function resolveSectorCode(client: KiwoomClient, input: string): Promise<string> {
  const query = input.trim();
  if (/^\d{3}$/.test(query)) {
    // 캐시를 데워 두면 포맷터가 코드에 실제 업종명을 붙일 수 있다. 12시간에 한 번
    // ka10101 5콜(간격 1.1초)이 붙는 비용을 "업종 024" 대신 "증권"으로 읽히는 것과
    // 맞바꾼 선택이다. 실패는 치명적이지 않다 — 폴백 라벨로 렌더된다.
    await loadSectorList(client).catch(() => undefined);
    return query;
  }

  const items = await loadSectorList(client);
  const key = normalize(query);

  const exact = items.filter((item) => normalize(item.name) === key);
  const matches = exact.length > 0 ? exact : items.filter((item) => normalize(item.name).includes(key));

  if (matches.length === 1) return matches[0]!.code;
  if (matches.length === 0) {
    throw new KiwoomApiError(
      `'${query}'에 해당하는 업종을 찾지 못했습니다. 업종 코드 3자리를 넣거나 ` +
        "get_market_index로 코드 목록을 확인해 주세요.",
      { apiId: "ka10101" },
    );
  }
  throw new KiwoomApiError(
    `'${query}'은(는) 여러 업종에 해당합니다: ${candidateList(matches)}. ` +
      "원하는 업종 코드를 직접 넣어 주세요.",
    { apiId: "ka10101" },
  );
}
