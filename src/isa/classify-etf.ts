/**
 * ka40002(ETF종목정보)의 `etftxon_type`을 사용한 권위 있는 과세유형 분류.
 *
 * ETF는 키움이 직접 제공하는 과세유형으로 확정하고, 개별주식·브랜드 미매칭·API
 * 실패 시에는 `classifyInstrument`의 종목명 휴리스틱으로 폴백한다. 수동 지정
 * (`overrides`)은 항상 최우선이며 이 경우 API를 호출하지 않는다.
 *
 * ka40002는 동일 TR 기준 ~1 req/s 제한이 있으므로 ETF 코드만 순차 호출하고,
 * 과세유형은 사실상 불변이라 프로세스 내에서 길게 캐시한다.
 */

import { fetchEtfInfo } from "../kiwoom/api.js";
import type { KiwoomClient } from "../kiwoom/client.js";
import { sleep } from "../utils/sleep.js";
import {
  classifyInstrument,
  isLikelyEtf,
  mapEtfTaxonType,
  type Classification,
  type TaxType,
} from "./classify.js";

export interface Instrument {
  code: string;
  name: string;
}

/** 과세유형은 상장 폐지 전까지 바뀌지 않으므로 길게 캐시해도 안전하다. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** ka40002는 동일 TR 1 req/s — 캐시 미스로 연속 호출할 때만 간격을 둔다. */
const ETF_FETCH_GAP_MS = 1_100;

interface CacheEntry {
  fetchedAt: number;
  /** 키움 원문 과세유형; ETF가 아니거나 값이 없으면 null. */
  taxonType: string | null;
}

let cache = new Map<string, CacheEntry>();

/** 테스트 훅 — 모듈 레벨 ka40002 과세유형 캐시를 비운다. */
export function clearEtfTaxonCache(): void {
  cache = new Map();
}

function freshEntry(code: string): CacheEntry | undefined {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  return undefined;
}

/** ka40002 1회 호출; 성공(빈 값 포함)은 캐시하고, 실패는 캐시하지 않는다. */
async function fetchTaxonType(client: KiwoomClient, code: string): Promise<string | null> {
  try {
    const etf = await fetchEtfInfo(client, code);
    // stk_nm이 비면 ETF가 아님(비-ETF 코드) → null로 확정 캐시.
    const taxonType = etf.stk_nm ? etf.etftxon_type.trim() || null : null;
    cache.set(code, { fetchedAt: Date.now(), taxonType });
    return taxonType;
  } catch {
    return null; // API 실패 → 휴리스틱 폴백 (다음 호출에서 재시도되도록 캐시하지 않음)
  }
}

/**
 * 종목 목록을 코드 기준으로 dedup 하여 과세유형을 분류한다. ETF는 ka40002로
 * 확정하고 나머지는 휴리스틱으로 폴백한 `Map<code, Classification>`을 반환한다.
 *
 * @param etfCodes ka10099 마스터리스트에서 `marketName == "ETF"`로 확인된 코드 집합.
 *   브랜드 접두어가 없어 이름만으로는 ETF로 안 보이는 종목도 여기 있으면 ka40002
 *   확정 분류 대상에 포함한다(전달하지 않으면 종목명 브랜드 휴리스틱만 사용).
 */
export async function classifyInstruments(
  client: KiwoomClient,
  instruments: Instrument[],
  overrides?: ReadonlyMap<string, TaxType>,
  etfCodes?: ReadonlySet<string>,
): Promise<Map<string, Classification>> {
  const unique = new Map<string, string>();
  for (const { code, name } of instruments) {
    if (!unique.has(code)) unique.set(code, name);
  }

  const result = new Map<string, Classification>();
  let priorFetch = false;

  for (const [code, name] of unique) {
    // 브랜드 접두어(이름) 또는 마스터리스트 ETF 표시 중 하나라도 맞으면 ETF로 취급.
    const isEtf = isLikelyEtf(name) || (etfCodes?.has(code) ?? false);
    const heuristic = classifyInstrument(code, name, overrides, isEtf);

    // 수동 지정은 최우선, ETF가 아닌 종목은 조회할 것이 없다.
    if (overrides?.get(code) || !isEtf) {
      result.set(code, heuristic);
      continue;
    }

    const cached = freshEntry(code);
    let taxonType: string | null;
    if (cached) {
      taxonType = cached.taxonType;
    } else {
      if (priorFetch) await sleep(ETF_FETCH_GAP_MS);
      priorFetch = true;
      taxonType = await fetchTaxonType(client, code);
    }

    const mapped = taxonType ? mapEtfTaxonType(taxonType) : null;
    result.set(
      code,
      mapped
        ? { taxType: mapped, confident: true, reason: `키움 과세유형: ${taxonType!.trim()}` }
        : heuristic,
    );
  }

  return result;
}
