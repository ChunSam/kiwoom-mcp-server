import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchAfterMarketInvestors,
  type InvestorUnit,
  type NetBuyMarket,
  type NetBuySide,
} from "../kiwoom/api.js";
import type { AfterMarketInvestorItem } from "../kiwoom/types.js";
import { formatKRW, formatPercent, formatSigned, parseKiwoomNumber, parseKiwoomPrice } from "../utils/num.js";
import { runTool, textResult, UNIFIED_EXCHANGE_NOTE } from "./helpers.js";

const DEFAULT_TOP = 20;
const MAX_TOP = 50;

/**
 * ka10066이 주는 12주체. ka10059(get_investor_trend)와 같은 필드명이지만 이 TR에는
 * natfor(내외국인)가 없다. `orgn`(기관계)은 그 아래 7개(금융투자~기타금융)의 합이다.
 */
const SUBJECTS = {
  individual: { key: "ind_invsr", label: "개인" },
  foreign: { key: "frgnr_invsr", label: "외국인" },
  institution: { key: "orgn", label: "기관계" },
  financial_inv: { key: "fnnc_invt", label: "금융투자" },
  insurance: { key: "insrnc", label: "보험" },
  trust: { key: "invtrt", label: "투신" },
  bank: { key: "bank", label: "은행" },
  pension: { key: "penfnd_etc", label: "연기금등" },
  private_fund: { key: "samo_fund", label: "사모펀드" },
  etc_finance: { key: "etc_fnnc", label: "기타금융" },
  nation: { key: "natn", label: "국가" },
  etc_corp: { key: "etc_corp", label: "기타법인" },
} as const satisfies Record<string, { key: keyof AfterMarketInvestorItem; label: string }>;

export type NetBuySubject = keyof typeof SUBJECTS;

const SUBJECT_NAMES = Object.keys(SUBJECTS) as [NetBuySubject, ...NetBuySubject[]];

const UNIT_LABELS: Record<InvestorUnit, string> = { amount: "백만원", quantity: "주" };
const MARKET_LABELS: Record<NetBuyMarket, string> = { kospi: "코스피", kosdaq: "코스닥" };
const SIDE_LABELS: Record<NetBuySide, string> = { net: "순매수", buy: "매수", sell: "매도" };

export interface NetBuyRankOptions {
  subject: NetBuySubject;
  market: NetBuyMarket;
  unit: InvestorUnit;
  side: NetBuySide;
  direction: "top" | "bottom";
}

/**
 * 정렬 키가 없는 행은 순위 싸움에서 빠지도록 항상 뒤로 보낸다 (get_etf_rank와 같은 규칙).
 * direction "bottom"은 순매도 상위 — 매도(side "sell")와는 다르다. 매도는 매도 체결량
 * 자체가 큰 종목이고, 순매도 상위는 매수를 뺀 결과가 가장 음수인 종목이다.
 */
function compare(direction: "top" | "bottom", a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return direction === "top" ? b - a : a - b;
}

export function formatNetBuyRank(
  rows: AfterMarketInvestorItem[],
  options: NetBuyRankOptions,
  top: number,
  truncated: boolean,
  modeLabel: string,
): string {
  const subject = SUBJECTS[options.subject];
  const unitLabel = UNIT_LABELS[options.unit];
  const scope =
    `${MARKET_LABELS[options.market]} · ${subject.label} ${SIDE_LABELS[options.side]} ` +
    `${options.direction === "top" ? "상위" : "하위"} · 단위 ${unitLabel}`;

  if (rows.length === 0) {
    return (
      `[${modeLabel}] 투자자별 매매 데이터가 없습니다 (${scope}). ` +
      "직전 거래일이 없는 연휴 직후이거나 키움이 아직 집계를 올리지 않았을 수 있습니다."
    );
  }

  const scored = rows
    .map((row) => ({ row, value: parseKiwoomNumber(row[subject.key]) }))
    .sort((a, b) => compare(options.direction, a.value, b.value));
  const shown = scored.slice(0, top);

  const lines = [
    `[${modeLabel}] 투자자 주체별 매매 (${scope}) — ${rows.length}종목 중 ${shown.length}종목`,
    "",
    `| 순위 | 종목명 | 코드 | 현재가 | 등락률 | ${subject.label} | 개인 | 외국인 | 기관계 |`,
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  shown.forEach((s, index) => {
    const cells = [
      String(index + 1),
      s.row.stk_nm || "-",
      s.row.stk_cd,
      formatKRW(parseKiwoomPrice(s.row.cur_prc)),
      formatPercent(parseKiwoomNumber(s.row.flu_rt)),
      formatSigned(s.value),
      formatSigned(parseKiwoomNumber(s.row.ind_invsr)),
      formatSigned(parseKiwoomNumber(s.row.frgnr_invsr)),
      formatSigned(parseKiwoomNumber(s.row.orgn)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  lines.push(
    "",
    `※ 순매수·매수·매도 수치는 **직전 완료 거래일**의 확정치입니다 — 같은 행의 현재가·등락률은 ` +
      "당일 실시간 값이라 두 시점이 섞여 있습니다. 장중 흐름은 get_foreign_intraday(외국인 한정)를 쓰세요.",
    `※ 기관계는 금융투자·보험·투신·은행·연기금등·사모펀드·기타금융의 합입니다 — 세부 주체는 subject로 골라 보세요.`,
  );
  if (options.side === "net") {
    lines.push("※ 순매수 = 매수 − 매도. 음수는 순매도입니다 (side로 매수·매도 총량을 따로 볼 수 있습니다).");
  }
  if (rows.length > shown.length) {
    lines.push(`※ ${rows.length}종목 중 ${shown.length}종목만 표시했습니다 (top으로 조정).`);
  }
  if (truncated) {
    lines.push(
      "※ 페이지 상한에 걸려 **일부 종목이 빠졌습니다** — 이 TR은 종목코드 순으로 오기 때문에 " +
        "뒤쪽 코드가 순위에서 통째로 누락됐을 수 있습니다.",
    );
  }
  lines.push("", UNIFIED_EXCHANGE_NOTE);
  return lines.join("\n");
}

export function registerNetBuyRankTool(server: McpServer): void {
  server.registerTool(
    "get_net_buy_rank",
    {
      title: "투자자 주체별 순매수 상위 (시장 전체)",
      description:
        "시장 전 종목을 훑어 **투자자 주체별 순매수 상위**를 뽑습니다 (키움 ka10066). " +
        "'연기금이 어제 뭘 담았나', '투신 순매도 상위', '사모펀드가 산 코스닥 종목'처럼 " +
        "**주체를 정하고 종목을 찾을 때** 쓰세요. 개인·외국인·기관계 외에 금융투자·보험·투신·은행· " +
        "연기금등·사모펀드·기타금융·국가·기타법인까지 12주체를 고를 수 있습니다. " +
        "종목을 이미 정했다면 get_investor_trend(종목 1개의 주체별 시계열)가 낫고, " +
        "외국인·기관만 빠르게 보려면 get_investor_rank(상위 25종목)가 가볍습니다. " +
        "수치는 직전 완료 거래일 기준이며, 장중 실시간은 get_foreign_intraday(외국인 한정)를 쓰세요.",
      inputSchema: {
        subject: z
          .enum(SUBJECT_NAMES)
          .describe(
            "투자자 주체. individual=개인, foreign=외국인, institution=기관계, financial_inv=금융투자, " +
              "insurance=보험, trust=투신, bank=은행, pension=연기금등, private_fund=사모펀드, " +
              "etc_finance=기타금융, nation=국가, etc_corp=기타법인",
          ),
        market: z
          .enum(["kospi", "kosdaq"])
          .describe(
            "시장 (필수). 키움이 종목코드 순으로만 주기 때문에 전 종목을 받아 서버가 정렬합니다 — " +
              "코스피 약 1,320종목, 코스닥 약 1,820종목이라 조회에 15~20초 걸립니다",
          ),
        side: z
          .enum(["net", "buy", "sell"])
          .optional()
          .describe("net=순매수(기본), buy=매수 총량, sell=매도 총량"),
        direction: z
          .enum(["top", "bottom"])
          .optional()
          .describe("top=큰 순(기본), bottom=작은 순. side=net에서 bottom이 순매도 상위입니다"),
        unit: z.enum(["amount", "quantity"]).optional().describe("단위 (기본값: amount=백만원)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP)
          .optional()
          .describe(`표시할 종목 수 (기본값 ${DEFAULT_TOP}, 최대 ${MAX_TOP})`),
      },
    },
    async ({ subject, market, side, direction, unit, top }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const options: NetBuyRankOptions = {
          subject,
          market,
          unit: unit ?? "amount",
          side: side ?? "net",
          direction: direction ?? "top",
        };

        const { rows, truncated } = await fetchAfterMarketInvestors(
          client,
          options.market,
          options.unit,
          options.side,
        );
        return textResult(formatNetBuyRank(rows, options, top ?? DEFAULT_TOP, truncated, config.modeLabel));
      }),
  );
}
