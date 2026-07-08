/**
 * kt00015 매매 내역으로 종목별 실현손익을 이동평균 원가법으로 재구성한다.
 *
 * 배경(라이브 검증): 키움 REST의 종목별 실현손익 TR(ka10072/ka10073)이 이 계좌
 * 유형에서 빈 결과만 반환해, 계좌 전체 합계 TR(ka10074)을 검증값으로 두고 거래
 * 내역에서 직접 재구성한다. 매수 정산금액(exct_amt)은 수수료 포함 원가, 매도
 * 정산금액은 수수료 차감 후 실수령액이므로 증권사 정산과 같은 기준이 된다.
 */

export interface TradeEvent {
  /** normalized stock code (no asset-class prefix) */
  code: string;
  name: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** 정산금액 — buy: total paid incl. fees / sell: net proceeds after fees+tax */
  netAmount: number;
  /** settlement date yyyyMMdd — used only for ordering */
  date: string;
  /** tie-breaker within a date */
  seq: number;
}

export interface StockRealized {
  code: string;
  name: string;
  /** realized P&L, fees/taxes reflected */
  realized: number;
  soldQuantity: number;
  /** true when sells exceeded the tracked position (history窓 밖 매수분 존재) */
  incompleteHistory: boolean;
}

export interface RealizedReconstruction {
  perStock: StockRealized[];
  total: number;
  warnings: string[];
}

interface Position {
  quantity: number;
  cost: number;
}

export function reconstructRealizedPnl(events: TradeEvent[]): RealizedReconstruction {
  const ordered = [...events].sort((a, b) =>
    a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date),
  );

  const positions = new Map<string, Position>();
  const results = new Map<string, StockRealized>();
  const warnings: string[] = [];

  const resultOf = (event: TradeEvent): StockRealized => {
    let r = results.get(event.code);
    if (!r) {
      r = { code: event.code, name: event.name, realized: 0, soldQuantity: 0, incompleteHistory: false };
      results.set(event.code, r);
    }
    return r;
  };

  for (const event of ordered) {
    if (event.quantity <= 0) continue;

    const position = positions.get(event.code) ?? { quantity: 0, cost: 0 };
    positions.set(event.code, position);

    if (event.side === "BUY") {
      position.quantity += event.quantity;
      position.cost += event.netAmount;
      continue;
    }

    // SELL
    const result = resultOf(event);
    const covered = Math.min(event.quantity, position.quantity);

    if (covered < event.quantity) {
      result.incompleteHistory = true;
      warnings.push(
        `${event.name}(${event.code}): 집계 시작일 이전 취득분 매도가 감지되어 실현손익이 불완전합니다. ` +
          `from_date가 계좌 개설일을 포함하는지 확인하세요.`,
      );
    }

    if (covered > 0) {
      const avgCost = position.cost / position.quantity;
      const coveredProceeds = event.netAmount * (covered / event.quantity);
      result.realized += coveredProceeds - avgCost * covered;
      result.soldQuantity += covered;
      position.quantity -= covered;
      position.cost -= avgCost * covered;
    }
  }

  const perStock = [...results.values()];
  return {
    perStock,
    total: perStock.reduce((sum, r) => sum + r.realized, 0),
    warnings,
  };
}
