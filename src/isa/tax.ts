import type { TaxType } from "./classify.js";

/** 조특법상 ISA 비과세 한도 (원). */
export const ISA_LIMITS = {
  GENERAL: 2_000_000,
  SEOMIN: 4_000_000,
} as const;

/** 한도 초과분 분리과세율 (지방소득세 포함 9.9%). */
export const ISA_TAX_RATE = 0.099;

export interface ClassifiedAmount {
  code: string;
  name: string;
  amount: number;
  taxType: TaxType;
  confident: boolean;
}

export interface IsaTaxInput {
  limit: number;
  /** 개설 후 수령한 배당·분배금·이자 총액 (자동 감지 + 수동 입력) */
  dividends: number;
  /** 종목별 실현손익 */
  realized: ClassifiedAmount[];
  /** 종목별 미실현 평가손익 (현재 보유분) */
  unrealized: ClassifiedAmount[];
}

export interface IsaTaxStatus {
  limit: number;
  dividends: number;
  /** 과세대상 상품 실현손익 합 (손익 모두 통산 포함) */
  taxableRealized: number;
  /** 국내주식형 실현손익 합 — 이익이면 통산 제외, 순손실이면 차감 */
  domesticRealizedNet: number;
  domesticLossDeduction: number;
  /** 확정 통산 순이익 (실현 기준, 음수 가능) */
  confirmedNet: number;
  remainingAllowance: number;
  /** 지금 해지한다고 가정할 때 한도 초과분에 대한 예상 세금 */
  estimatedTaxNow: number;
  /** 시나리오: 현재 보유분 전량 매도 가정 */
  taxableUnrealized: number;
  domesticUnrealizedNet: number;
  scenarioNet: number;
  scenarioRemaining: number;
  scenarioEstimatedTax: number;
}

function sumByType(items: ClassifiedAmount[], taxType: TaxType): number {
  return items.filter((i) => i.taxType === taxType).reduce((sum, i) => sum + i.amount, 0);
}

function settle(net: number, limit: number): { remaining: number; tax: number } {
  const used = Math.max(0, net);
  return {
    remaining: Math.max(0, limit - used),
    tax: Math.max(0, used - limit) * ISA_TAX_RATE,
  };
}

/**
 * ISA 손익통산 계산.
 *
 * 규칙 (조특법 제91조의18 기준, 단순화):
 * - 과세대상(기타형) 상품의 실현손익은 이익·손실 모두 통산에 포함.
 * - 국내주식형 상품의 실현이익은 애초에 비과세라 통산에서 제외하되,
 *   클래스 합산이 순손실이면 그 손실은 과세소득에서 차감.
 * - 배당·분배금·이자는 전액 통산 포함.
 * - 미실현 손익은 통산에 포함되지 않으며, "전량 매도 시" 시나리오로만 제공.
 */
export function computeIsaTaxStatus(input: IsaTaxInput): IsaTaxStatus {
  const taxableRealized = sumByType(input.realized, "TAXABLE");
  const domesticRealizedNet = sumByType(input.realized, "DOMESTIC_EQUITY");
  const domesticLossDeduction = Math.min(0, domesticRealizedNet);

  const confirmedNet = input.dividends + taxableRealized + domesticLossDeduction;
  const confirmed = settle(confirmedNet, input.limit);

  const taxableUnrealized = sumByType(input.unrealized, "TAXABLE");
  const domesticUnrealizedNet = sumByType(input.unrealized, "DOMESTIC_EQUITY");
  const scenarioNet = confirmedNet + taxableUnrealized + Math.min(0, domesticUnrealizedNet);
  const scenario = settle(scenarioNet, input.limit);

  return {
    limit: input.limit,
    dividends: input.dividends,
    taxableRealized,
    domesticRealizedNet,
    domesticLossDeduction,
    confirmedNet,
    remainingAllowance: confirmed.remaining,
    estimatedTaxNow: confirmed.tax,
    taxableUnrealized,
    domesticUnrealizedNet,
    scenarioNet,
    scenarioRemaining: scenario.remaining,
    scenarioEstimatedTax: scenario.tax,
  };
}
