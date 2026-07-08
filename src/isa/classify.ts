/**
 * ISA 손익통산을 위한 종목 과세유형 분류.
 *
 * - DOMESTIC_EQUITY: 국내 상장주식·국내주식형 ETF — 매매차익은 비과세(통산 이익
 *   미포함), 매매손실은 통산 시 차감.
 * - TAXABLE: 그 외(해외지수·채권·원자재·파생형 ETF 등) — 매매손익이 배당소득으로
 *   과세되어 통산에 포함.
 *
 * 과세유형은 API가 제공하지 않으므로 종목명 휴리스틱으로 추정한다. 분류가 틀릴 수
 * 있으므로 반드시 `confident` 플래그를 함께 전달하고, 호출자(tool)는 overrides로
 * 수동 지정을 받을 수 있어야 한다.
 */

export type TaxType = "TAXABLE" | "DOMESTIC_EQUITY";

export interface Classification {
  taxType: TaxType;
  confident: boolean;
  reason: string;
}

/** 국내 상장 ETF/ETN 브랜드 접두어 (2026 기준 주요 운용사). */
const ETF_BRANDS = [
  "KODEX",
  "TIGER",
  "KIWOOM",
  "RISE",
  "KBSTAR",
  "SOL",
  "ACE",
  "PLUS",
  "ARIRANG",
  "HANARO",
  "KOSEF",
  "WON",
  "1Q",
  "TIMEFOLIO",
  "FOCUS",
  "UNICORN",
  "KTOP",
  "TREX",
  "파워",
  "마이다스",
  "BNK",
  "HK",
  "ITF",
  "KCGI",
  "DAISHIN343",
  "히어로즈",
];

/** 이름에 이 키워드가 있으면 과세대상(기타형)으로 판단. 도메스틱 키워드보다 우선. */
const TAXABLE_KEYWORDS = [
  // 해외 지역/지수
  "미국",
  "나스닥",
  "S&P",
  "다우",
  "필라델피아",
  "글로벌",
  "월드",
  "선진",
  "신흥",
  "차이나",
  "중국",
  "항셍",
  "일본",
  "닛케이",
  "인도",
  "베트남",
  "대만",
  "유럽",
  "유로",
  "독일",
  // 채권/금리/통화
  "채권",
  "국채",
  "국고채",
  "회사채",
  "단기채",
  "종합채",
  "금리",
  "KOFR",
  "SOFR",
  "CD금리",
  "머니마켓",
  "MMF",
  "달러",
  "엔화",
  "엔선물",
  "위안",
  // 원자재/대체
  "골드",
  "금현물",
  "금선물",
  "은현물",
  "은선물",
  "원유",
  "원자재",
  "구리",
  "니켈",
  "리츠",
  "부동산",
  "인프라",
  "하이일드",
  // 파생/구조형 (국내 기초자산이어도 과세대상)
  "레버리지",
  "인버스",
  "커버드콜",
  "합성",
  "(H)",
  "TDF",
  "TRF",
];

/** 국내주식형 ETF로 판단하는 키워드 (TAXABLE 키워드에 안 걸렸을 때만). */
const DOMESTIC_KEYWORDS = [
  "코스피",
  "코스닥",
  "KRX",
  "200",
  "150",
  "100",
  "300",
  "TOP",
  "배당",
  "그룹",
  "밸류",
  "성장",
  "모멘텀",
  "로우볼",
  "삼성",
  "반도체",
  "자동차",
  "은행",
  "증권",
  "보험",
  "바이오",
  "헬스케어",
  "2차전지",
  "소프트웨어",
  "게임",
  "엔터",
  "방산",
  "조선",
];

/**
 * 이름이 국내 상장 ETF/ETN 브랜드로 시작하는지 여부. `classifyInstrument`의 ETF
 * 판정과 동일한 기준이며, ka40002 조회 대상(브랜드 ETF)을 고르는 게이트로도 쓴다.
 */
export function isLikelyEtf(name: string): boolean {
  const upper = name.toUpperCase().trim();
  return ETF_BRANDS.some((brand) => upper.startsWith(brand.toUpperCase()));
}

/**
 * 키움 ka40002 `etftxon_type`(ETF 과세유형)을 ISA 손익통산 분류로 매핑한다.
 * 권위 있는 값이 있을 때만 사용하고, 알 수 없거나 빈 값이면 null을 반환해
 * 호출자가 종목명 휴리스틱으로 폴백하도록 한다.
 *
 * - "비과세" → DOMESTIC_EQUITY (국내주식형 — 매매차익 비과세, 손실만 통산 차감)
 * - "보유기간과세" → TAXABLE (기타형 — 매매손익이 배당소득 과세, 통산 포함)
 */
export function mapEtfTaxonType(raw: string): TaxType | null {
  const t = raw.trim();
  if (t.includes("보유기간과세")) return "TAXABLE";
  if (t.includes("비과세")) return "DOMESTIC_EQUITY";
  return null;
}

/**
 * @param isEtfHint ETF 여부를 외부(ka10099 마스터리스트 `marketName == "ETF"`)에서 알 때
 *   전달한다. 브랜드 접두어가 없는 ETF도 ETF로 취급해 개별주식 오분류를 막는다.
 *   생략하면 종목명 브랜드 접두어(`isLikelyEtf`)로 판정한다.
 */
export function classifyInstrument(
  code: string,
  name: string,
  overrides?: ReadonlyMap<string, TaxType>,
  isEtfHint?: boolean,
): Classification {
  const override = overrides?.get(code);
  if (override) {
    return { taxType: override, confident: true, reason: "수동 지정" };
  }

  const upper = name.toUpperCase().trim();
  const isEtf = isEtfHint ?? isLikelyEtf(name);

  if (!isEtf) {
    return {
      taxType: "DOMESTIC_EQUITY",
      confident: true,
      reason: "국내 개별주식 — 매매차익 비과세, 손실은 통산 차감",
    };
  }

  if (TAXABLE_KEYWORDS.some((k) => upper.includes(k.toUpperCase()))) {
    return {
      taxType: "TAXABLE",
      confident: true,
      reason: "해외/채권/원자재/파생형 ETF — 매매손익 통산 포함",
    };
  }

  if (DOMESTIC_KEYWORDS.some((k) => upper.includes(k.toUpperCase()))) {
    return {
      taxType: "DOMESTIC_EQUITY",
      confident: true,
      reason: "국내주식형 ETF — 매매차익 비과세, 손실은 통산 차감",
    };
  }

  return {
    taxType: "TAXABLE",
    confident: false,
    reason: "유형 미확인 — 보수적으로 과세대상 가정 (overrides로 수정 가능)",
  };
}
