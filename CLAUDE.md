# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Read-only MCP server (stdio transport by default; opt-in Streamable HTTP mode for
claude.ai custom connectors) exposing the Kiwoom Securities REST API to Claude
Desktop/Code: market data (search/quote/chart/orderbook/index/ranking/movers/investor trend/ETF/
theme/short-selling/foreign-holding) + HTS watchlist (read-only) + account inquiry (balance/holdings/
transactions/pending orders/trading journal) + an ISA tax-allowance calculator.
Built to be reusable by third parties; the ISA tool is an optional extra on top of the
generic core, **gated behind `ISA_ENABLED` (general-account-first by default; ISA is opt-in
via env)**. **Order execution (buy/sell/modify/cancel) is out of scope by design** — do
not add trading tools; that requires a separately designed confirmation flow to be
discussed with the owner first. This connects to a real brokerage account: prioritize
error handling, and ask the owner before proceeding on ambiguous API behavior.

## Commands

```sh
npm run build        # tsc → dist/
npm run dev          # run src/index.ts directly via tsx
npm run typecheck    # tsc --noEmit
npm test             # vitest run (unit tests, no network)
npx vitest run tests/<file>.test.ts   # single test file
python3 scripts/sweep.py   # full read-only tool sweep over stdio vs live API (needs .env;
                           # VIRTUAL by default, --real to allow REAL; exit 0 = all expected)
```

End-to-end smoke test without an MCP client (initialize → tools/list → tools/call):

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ping","arguments":{}}}' \
  | node dist/index.js
```

## Development vs production (VIRTUAL/REAL split)

Keep the **production install** (REAL account, used daily from an MCP client) decoupled
from the **development copy** (VIRTUAL/모의투자, where features are built and broken). Do
**not** fork the repo to separate them — split by **env + install source** so there is one
source of truth (this repo → npm):

- **Production** = the **published npm package**, version-pinned, wired into the MCP client
  with a REAL app key in the client's `env` block. It is immune to working-tree edits and
  rebuilds. Upgrade it deliberately by bumping the pinned version after a new publish.
- **Development** = this git working tree, run against VIRTUAL (`KIWOOM_MODE=VIRTUAL` + a
  VIRTUAL app key) via `npm run dev` / `npm test` / the offline smoke test. Break things
  here freely.

Both can be registered in Claude Desktop at once under distinct names — e.g. `kiwoom`
(prod: `command: npx`, `args: ["-y", "kiwoom-mcp-server@<pinned>"]`, REAL env block) and
`kiwoom-dev` (dev: `command: node`, `args: ["<abs>/dist/index.js"]`, `env:
{"KIWOOM_MODE":"VIRTUAL"}`). Every tool output is prefixed `[실전투자]`/`[모의투자]`, so the two
are unambiguous inside one Claude session. GUI apps don't inherit shell `PATH` → use
**absolute** `command` paths (`which npx`/`which node`). Requires a full ⌘Q relaunch of
Claude Desktop to pick up config changes (it does not hot-reload).

**Env precedence:** an MCP client `env` block sets real `process.env`, which **overrides**
the repo `.env` (Node `--env-file`/`loadEnvFile` semantics — the environment wins over the
file). So `kiwoom-dev`'s `KIWOOM_MODE=VIRTUAL` pins the mode regardless of the repo `.env`;
keys not set in the block fall through to the repo `.env`. Convention: keep REAL creds in a
gitignored **`.env.real`** (never `.env`) so `.env` stays VIRTUAL-by-default; swap
`.env.real`→`.env` only for the brief REAL verification probe below, then swap back.

**Feature dev loop** (this is exactly how the v1.1 tool round was built):

1. **Mock (VIRTUAL):** build the plumbing on mock — zod schema (consumed subset), fetch fn,
   `format*` function, `register*Tool`, and unit tests off captured fixtures.
2. **REAL read-only probe (one-shot):** ⚠️ **VIRTUAL is not a substitute for REAL
   verification.** A mock account has little or no holdings/transaction history, and a few
   TRs are mock-unsupported outright. So the **field shape and real values of market-data
   and account TRs must be confirmed with a single REAL read-only call** before shipping.
   Read-only means this is safe on a live account.

**Mock (VIRTUAL) TR coverage — probed 2026-07-08, 46 read-only TRs.** Far better than
feared: **43/46 respond with `return_code 0`**, and market-data TRs return real-looking
production-mirrored rows (ka10099 ~2475 rows, charts full-length, rankings/theme/short/
foreign all populated). Mock-**unsupported** (do not develop against mock for these):
**kt00015 위탁종합거래내역** (RC9000 "모의투자에서는 해당업무가 제공되지 않습니다" → `get_transactions`
and `calc_isa_tax_status` are dead on mock; **confirmed working on REAL 2026-07-08** —
the owner's GUI test returned real transaction rows), **kt00010 주문인출가능금액** (RC7006 조회실패),
**ka01690 일별잔고수익률** (8104 지원하지 않는 API), **kt00002 일별추정예탁자산현황 + kt00016
일별계좌수익률상세현황** (RC9000, probed 2026-07-23 → `get_account_trend` is dead on mock;
**both confirmed working on REAL 2026-07-23** — the contract source for that tool).
Account TRs respond but with empty/zero
data on a fresh mock account (kt00018 0 holdings, ka10075 empty `oso`, ka10170 blank row);
the mock HTS watchlist starts with 2 default groups. Full results:
`mock-probe-results.json` in the 2026-07-08 session scratchpad (re-probe with a one-off
script when in doubt — token + 46 calls at 1.1s spacing ≈ 60s).
3. **Honest provenance:** record per-TR whether fields are live-verified (REAL) vs
   wrapper/mock-sourced, the way the "Live verification status" section below already does.
   Never claim REAL-verified from a mock-only run.
4. **Publish → bump:** `npm publish` a new version (owner-run), then bump the production
   install's pinned version. `prepublishOnly` (typecheck + test + build) gates the publish.

Read-only stays a hard boundary in both modes: VIRTUAL makes order execution *safe to
experiment with*, but "no trading tools" is a **design decision** (needs a separate
confirmation flow + owner sign-off), not merely a safety guard — see the Project section.

## Architecture

- `src/index.ts` — entry point; loads `.env` (real env wins), then `chooseTransport`
  picks stdio (default, zero-arg — unchanged for existing installs) or HTTP (`--http` /
  `MCP_TRANSPORT=http`). **stdout is reserved for MCP protocol frames in stdio mode; all
  logging must use `console.error` (stderr)** or the client breaks.
- `src/http.ts` — opt-in Streamable HTTP mode (v0.17.0) for claude.ai custom connectors:
  `node:http` server (no new deps), `/mcp` endpoint + unauthenticated `/healthz`,
  **stateless** SDK transport (`sessionIdGenerator: undefined`) with a fresh
  `McpServer`+transport per request (module-level Kiwoom token/master-list caches are
  shared, so per-request server build is cheap). **Bearer auth is required by default**:
  HTTP mode refuses to start without `MCP_AUTH_TOKEN` (env-only — a CLI flag would leak
  to `ps`) unless `--no-auth` is explicit; token check is timing-safe (sha256 +
  `timingSafeEqual`). Default bind `127.0.0.1:8000` (tunnel-first; `--host 0.0.0.0` to
  expose directly). Remote-exposure caveat: Kiwoom API calls originate wherever the
  server runs — REAL mode's 8050 지정단말기 IP binding makes cloud hosting fail auth, so
  remote setups run from a registered IP (e.g. home + Cloudflare Tunnel) or VIRTUAL.
- `src/oauth.ts` — minimal built-in OAuth 2.0 authorization server (v0.18.0) so
  claude.ai custom connectors authenticate natively (personal-plan claude.ai has NO
  request-header field — OAuth is the only connector auth path; discovered 2026-07-12).
  Implements the MCP auth spec chain: 401 + `WWW-Authenticate resource_metadata` →
  RFC 9728 `/.well-known/oauth-protected-resource` → RFC 8414
  `/.well-known/oauth-authorization-server` → RFC 7591 `/register` (DCR, https-or-loopback
  redirect URIs only) → `/authorize` (Korean consent page; **the pre-shared
  MCP_AUTH_TOKEN doubles as the consent password** — one secret, two auth paths) →
  `/token` (PKCE S256 enforced, single-use 5-min codes, opaque hex tokens, 1h access /
  rotating refresh). Tokens+clients persist to `<cwd>/.oauth-state.json` (0600,
  gitignored) so launchd restarts don't drop connectors. Consent brute-force guard:
  10 failures / 10 min → 429. `/mcp` accepts static bearer OR OAuth access token;
  issuer/base URL derives from Host + X-Forwarded-Proto (funnel/tunnel-friendly),
  `MCP_PUBLIC_URL` overrides. `--no-auth` disables OAuth endpoints entirely.
- `src/server.ts` — `createServer()` builds the `McpServer` and is the single registration
  hub: every tool module exports a `register<Name>Tool(server)` function called from here.
- `src/context.ts` — lazy singleton for config + `KiwoomClient`. Config/credential errors
  are thrown at tool-call time (inside `runTool`), never at startup, so the server always
  starts and `ping` works without a `.env`.
- `src/kiwoom/` — REST layer: `auth.ts` (`TokenManager`: cached token, 60s expiry margin,
  shared in-flight issuance), `client.ts` (`KiwoomClient.call`: retries, error
  translation, pagination headers), `api.ts` (one function per TR, returns zod-parsed
  responses), `types.ts` (loose zod schemas — only consumed fields declared, spec-verbatim
  snake_case names), `errors.ts`. **Tools never call `fetch` directly.**
- `src/tools/` — each tool = a pure `format*(data, modeLabel)` function (unit-tested) + a
  `register*Tool(server)` wrapper whose handler is wrapped in `runTool` (converts throws
  into `isError` MCP results with Korean user-facing messages).

## Kiwoom REST API contract (verified against community wrappers, 2026-07)

- Base URLs: REAL `https://api.kiwoom.com`, VIRTUAL `https://mockapi.kiwoom.com`. All
  calls are POST JSON. Auth: `authorization: Bearer <token>` + `api-id: <TR>` headers.
- Token (au10001): `POST /oauth2/token` body `{grant_type:"client_credentials", appkey,
  secretkey}` → `{token, expires_dt(yyyyMMddHHmmss, KST), return_code, return_msg}`.
  **The account is bound to the app key** — no account-number parameter anywhere.
- Response envelope: `return_code` (0 = success) + `return_msg` in the JSON body even on
  HTTP 200. Pagination via `cont-yn`/`next-key` **response headers**, echoed back as
  request headers to continue.
- TRs used: ka10001 (주식기본정보, `/api/dostk/stkinfo`, body `{stk_cd}`); kt00018
  (계좌평가잔고내역, `/api/dostk/acnt`, body `{qry_tp: 1|2, dmst_stex_tp: "KRX"}` — both
  required); kt00001 (예수금상세현황, same path, body `{qry_tp: 2|3}`); ka10075
  (미체결요청, `/api/dostk/acnt`, body `{all_stk_tp: "0"전체|"1"종목, trde_tp: "0"전체,
  stk_cd, stex_tp: "0"통합}` → array key **`oso`**). **`oso` array key is live-verified
  (2026-07-07, empty — no open orders on the verification account); its item fields
  (`ord_no`/`ord_stt`/`ord_qty`/`oso_qty`/`io_tp_nm`/`cur_prc`/`tm` …) are
  wrapper-sourced (dongbin300 .NET model) and NOT live-verified — order execution is
  out of scope so no pending order could be generated to observe. Treat the item shape
  as provisional (like dividend rows).**
- More TRs used by `calc_isa_tax_status` (both on `/api/dostk/acnt`): ka10074
  (일자별실현손익, body `{strt_dt, end_dt}` yyyyMMdd — `rlzt_pl` total used as a
  cross-check); kt00015 (위탁종합거래내역, body `{strt_dt, end_dt, tp: "0", gds_tp: "0",
  dmst_stex_tp: "KRX"}` — all five required). **kt00015 `trde_dt` is the settlement date
  (D+2); `cntr_dt` carries the actual trade date** (live-verified 2026-07-06). `trde_unit`
  (단가) arrives comma-grouped (`"20,190"`) — `parseKiwoomNumber` strips commas.
- kt00004 계좌평가현황 (`/api/dostk/acnt`, body `{qry_tp: "0"전체|"1"상장폐지제외,
  dmst_stex_tp: "KRX"}` — spec from the official `Kiwoom-Securities/Kiwoom-REST-API`
  kiwoom_docs; mock-probed 2026-07-13, 18 scalars + `stk_acnt_evlt_prst[]` all match).
  **Consumed ONLY for the 기간 손익 block in `get_account_balance`** (best-effort third
  parallel call since v0.19.0): 당일/당월/누적 투자원금·투자손익·손익율 9 fields —
  `tdy_lspft_amt/invt_bsamt/lspft_amt` (원금), `tdy_lspft/lspft2/lspft` (손익, 부호),
  `tdy_lspft_rt/lspft_ratio/lspft_rt` (손익율 %) — **the lspft naming is shuffled
  spec-verbatim** (lspft2=당월손익, lspft=누적손익, lspft_amt=누적원금). The deposit/
  evaluation scalars and per-stock list duplicate kt00001/kt00018 → not consumed;
  계좌명/지점명 deliberately not displayed. Fresh mock account returns all zeros +
  return_msg "모의투자 해당조회내역이 없습니다" (rc=0). **Live-verified on REAL 2026-07-13**
  (owner-run one-shot read-only probe, Mon 11:45 KST DURING market hours: rc=0, zero
  consumed-field gaps, holdings rows + deposit/evaluation scalars fully populated) — **BUT
  all 9 period-P&L fields returned ZERO on an account with live holdings and known Jan-2026
  realized P&L**, so an all-zero response does NOT mean the account earned nothing. The
  intraday-timing hypothesis is eliminated (probe ran mid-session). **RESOLVED 2026-07-14
  (owner GUI cross-check): 영웅문 also shows 당월/누적 손익 = 0 for this account** — the
  zeros are Kiwoom's own aggregation output (NOT a REST-dead field, unlike ka40009 NAV);
  Kiwoom's period-P&L counters simply exclude this account's known realized history
  (산출 기준/기산점 소관, exact rule unknown). The all-zero guard stays as shipped: the
  zeros are Kiwoom-truthful yet still ambiguous per-account, so the hedged notice
  ("실제 손익이 0이라는 뜻은 아닐 수 있습니다") remains the right wording.
  `formatBalance` therefore renders the 기간 손익 numbers **only when at least one field is
  non-zero**; all-zero → an honest one-line notice instead (ka40009 NAV dormant-block
  precedent, adapted for LLM consumers: explicit beats silent omission).
- **계좌 TR 3종 검토 (2026-07-13) — ka10077/ka10085 deliberately NOT exposed** (tool-count
  restraint, ka40010/ka10069/ka10100 precedent): ka10077 당일실현손익상세 (`{stk_cd}` →
  `tdy_rlzt_pl_dtl[]` 체결 단위) loses to ka10170 당일매매일지 (whole-account per-stock
  aggregates, no code required; ka10077 adds only execution-level rows + 수수료/세금 split,
  and shows the same all-blank placeholder-row quirk on an empty day). ka10085 계좌수익률
  (`{stex_tp:"0"}` → `acnt_prft_rt[]`) **despite its name carries NO 수익률 field** — rows
  are {현재가/매입가/매입금액/보유수량} + 신용거래 5종 (crd_tp/loan_dt/crd_amt/crd_int/
  expr_dt) + 결제잔고/청산가능수량; kt00018 already gives the same axis WITH 평가금액/
  평가손익/수익률/비중. Credit fields are blank for cash accounts and margin trading is
  out of scope. Revisit ka10085 only if margin-account support is ever requested.
- 계좌 시계열 TRs (both `/api/dostk/acnt`; **mock-UNSUPPORTED — RC9000** on all tried
  bodies, so unlike every prior round the contract was established by an EARLY owner-run
  REAL probe, **live-verified 2026-07-23**: rc=0, zero consumed-field gaps, 3 calls):
  kt00002 일별추정예탁자산현황 (body `{start_dt, end_dt}` yyyyMMdd → array
  `daly_prsm_dpst_aset_amt_prst[]` of `{dt, entr 예수금, grnt_use_amt 담보대출금,
  crd_loan 신용융자금, ls_grnt 대주담보금, repl_amt 대용금, prsm_dpst_aset_amt 추정예탁자산,
  prsm_dpst_aset_amt_bncr_skip 수익증권제외}` — **행은 주말·휴장일 포함 달력일 단위,
  오래된 날짜부터** (30일 조회 = 정확히 30행, cont-yn N; end_dt에 오늘을 넣어도 당일 행은
  아직 없음), 값은 12자리 zero-padded 무부호; 신용 3필드는 현금계좌에서 전부 0이라 미소비
  (ka10085 근거), page size 미문서라 kt00018식 cont-yn 루프 + truncated 플래그).
  kt00016 일별계좌수익률상세현황 (body `{fr_dt, to_dt}` yyyyMMdd → **이름과 달리 배열이
  없는 FLAT 기간 요약**: `_fr`/`_to` 초·말 쌍 13종 + `invt_bsamt 투자원금평잔,
  evltv_prft 평가손익(부호), prft_rt 수익률(%), tern_rt 회전율(%), termin_tot_trns/pymn/
  inq/outq 기간내총입금·출금·입고·출고` + 미소비 관리자 필드(mang_empno/mngr_nm/dept_nm —
  계좌명/지점명 비표시 선례). **prft_rt == evltv_prft ÷ invt_bsamt × 100 정확 일치** (REAL
  실측 — 수익률 산출 기준은 투자원금평잔). **kt00004의 all-zero 기간손익과 달리 kt00016은
  살아있다**: 같은 계좌에서 30일 -5.56%/YTD -0.38% 등 실값 반환 — 계좌 기간손익 축은
  kt00016으로 커버). Both wrapped by `get_account_trend` (days 2~90, 기본 30; 병렬 호출,
  kt00016은 best-effort).
- Market-data TRs (all live-verified 2026-07-06 with the exact bodies in
  `src/kiwoom/api.ts`): ka10099 종목마스터 (`{mrkt_tp: "0"코스피|"10"코스닥}`, single page
  ~2500 rows incl. ETF/ETN, **response fields are camelCase** — the only such TR);
  ka10080 분봉 (`tic_scope` minutes) / ka10081~83 일·주·월봉 (`base_dt`, `upd_stkpc_tp:
  "1"`=수정주가; identical item shape, array key differs per TR); ka10004 호가 (level 1
  = `sel_fpr_*`/`buy_fpr_*`, levels 2-10 = `sel_{n}th_pre_*`/`buy_{n}th_pre_*` — note the
  underscore before `{n}`, community docs get this wrong); ka20003 전업종지수 (`inds_cd
  "001"`=코스피 그룹 31개, `"101"`=코스닥 그룹 34개); ka10027 등락률순위 (`sort_tp`
  1=상승률/2=상승폭/3=하락률/4=하락폭, `mrkt_tp` 000=전체/001=코스피/101=코스닥);
  ka10030 거래량순위 / ka10032 거래대금순위 (same mrkt_tp codes); ka10059/ka10061
  투자자별 매매동향 (`amt_qty_tp` **1=금액(백만원), 2=수량(주)** — cross-checked against
  volume; ka10061 doubles the sign: `"--23722054"` = negative); ka40002 ETF종목정보
  (returns `etftxon_type` e.g. "비과세"/"보유기간과세" — Kiwoom's own taxation type!).
- ka10030 caps `trde_qty` at uint32 max (4294967295) — display verbatim, don't "fix".
- Chart-extension TRs (both `/api/dostk/chart`; **live-verified on REAL 2026-07-09** —
  owner-authorized one-shot read-only probe: rc=0, zero consumed-field gaps, responses
  byte-identical mock==REAL, fourth TR family confirming mock mirrors production):
  ka10079 틱차트 (body `{stk_cd, tic_scope: "1"|"3"|"5"|"10"|"30" 캔들당 틱 수, upd_stkpc_tp: "1"}`
  → `stk_tic_chart_qry[]` 900 rows newest-first — **row shape identical to ka10080 분봉** incl.
  `cntr_tm` yyyyMMddHHmmss but WITHOUT `acc_trde_qty` (schema default covers it); top-level
  `last_tic_cnt` unconsumed); ka10094 년봉 (body `{stk_cd, base_dt, upd_stkpc_tp: "1"}` →
  `stk_yr_pole_chart_qry[]` ~30 rows — **row shape identical to ka10081 일봉** minus the pred_pre
  fields; `dt` = 연초 첫 거래일). Both absorbed into `get_stock_chart` as `period` values
  (`tick`/`year`) — no new tool; tick_scope defaults to "30".
- Market-movers TRs (all `/api/dostk/stkinfo`, **live-verified on REAL 2026-07-08** — same
  bodies re-probed read-only; array keys + all consumed fields matched the VIRTUAL rows
  byte-for-byte, confirming mock mirrors production for market TRs): ka10016 신고저가 (`{mrkt_tp, ntl_tp: "1"신고가|"2"신저가, high_low_close_tp: "1",
  stk_cnd: "0", trde_qty_tp: "00000", crd_cnd: "0", updown_incls: "0", dt: 5|10|20|60|250,
  stex_tp: "1"}` → `ntl_pric[]` incl. `high_pric`/`low_pric` 기간 고저가); ka10017 상하한가
  (`{mrkt_tp, updown_tp: "1"상한|"4"하한, sort_tp: "3"등락률순, …, trde_gold_tp: "0", stex_tp: "1"}`
  → `updown_pric[]` incl. `cnt` 연속횟수); ka10019 가격급등락 (`{mrkt_tp, flu_tp: "1"급등|"2"급락,
  tm_tp: "2", tm: "1"(전일 기준), …, updown_incls: "1", stex_tp: "1"}` → `pric_jmpflu[]` incl.
  `base_pric`/`jmp_rt` 기준가 대비 급등락률). mrkt_tp shares the ranking codes (000/001/101).
  All three wrapped by the single `get_market_movers` tool (signal enum, get_ranking pattern).
  Fourth signal (v0.23.0): ka10023 거래량급증 — **`/api/dostk/rkinfo`, NOT stkinfo** (body
  `{mrkt_tp 랭킹 코드, sort_tp: "1"급증량|"2"급증률|"3"급감량|"4"급감률, tm_tp: "1"분|"2"전일,
  trde_qty_tp: "5"~"1000" 최소 거래량 필터 (**"전체" 옵션 없음 — "5"(5천주)가 최소**), tm(분
  모드 전용), stk_cnd: "0", pric_tp: "0", stex_tp: "1"}` → `trde_qty_sdnin[]` of {stk_cd,
  stk_nm, cur_prc, pred_pre(_sig), flu_rt, prev/now_trde_qty, sdnin_qty 급증량(부호),
  sdnin_rt 급증률%(부호)}; 200행/page cont-yn Y — page-1 only, `top` 표시 제한). **툴은
  sort "1" 급증량순 고정** — 급증률 정렬은 prev 극소 행이 상위를 도배 (mock 실측: 이전거래량
  11주 → +49,709%); 급증률은 컬럼으로만 표시. mock-probed 2026-07-23 (4콜 전부 rc=0, 문서
  10필드 전부 일치·초과 필드 없음); REAL probe pending pre-publish.
- Sector TRs (both `/api/dostk/sect` like ka20003; **live-verified on REAL 2026-07-09** —
  owner-authorized one-shot read-only probe, both kospi/kosdaq variants: rc=0, array keys OK,
  zero consumed-field gaps, rows byte-identical to mock): ka20001 업종현재가 (body `{mrkt_tp, inds_cd}` → 22 flat fields — cur_prc/
  open/high/low (지수, 부호 접두 소수), trde_qty 천주 / trde_prica 백만원 (ka20003과 동일 단위),
  등락 구성 `upl 상한/rising/stdns/fall/lst 하한`, `trde_frmatn_*` 거래형성, 6 `52wk_*` fields
  (**keys start with a digit** — quote them in TS) — plus `inds_cur_prc_tm[]` 시간대별
  (`*_n`-suffixed fields; `tm_n "999999"/"888888"` are close-of-day sentinel rows → filter
  before display)); ka20002 업종별주가 (body `{mrkt_tp, inds_cd, stex_tp: "1"}` →
  `inds_stkpc[]`, 100/page **code-ordered**, page-1 only + truncated flag). **mrkt_tp is
  derived from the inds_cd leading digit** (0xx→"0" 코스피, 1xx→"1" 코스닥, 2xx→"2" 코스피200);
  inds_cd shares ka20003's code space, so `get_market_index` now shows a 코드 column for
  chaining into `get_sector_price`/`get_sector_stocks`.
- ETF detail TRs (both `/api/dostk/etf` like ka40002; **live-verified on REAL 2026-07-09** —
  owner-authorized one-shot read-only probe, 4 calls: rc=0, zero consumed-field gaps):
  ka40001 ETF수익율 (body `{stk_cd, etfobjt_idex_cd, dt: "0"1주|"1"1개월|"2"6개월|"3"1년}`
  → `etfprft_rt_lst[]` of `{etfprft_rt, cntr_prft_rt, for_netprps_qty, orgn_netprps_qty}`).
  **`etfobjt_idex_cd` is REQUIRED (blank → 1511 입력 값 오류) but NOT validated against the ETF —
  it is a benchmark-index selector: `cntr_prft_rt` is that index's period return** (holds on
  REAL: two ETFs @ idex 201 → identical cntr_prft_rt; bogus code on mock → "0.00").
  `for_netprps_qty` carries real values on REAL (mock: "0"); `orgn_netprps_qty` blank on both.
  **Erratum to seq-11 Appendix B: ka40002 does NOT return `etfobjt_idex_cd`** (full response =
  5 scalars, index NAME only), so `get_etf_returns` exposes `benchmark_index_code` (default
  "201" KOSPI200, ka20003 code space) instead of chaining; it fetches all 4 dt values
  sequentially (same TR, 1.1s spacing). ka40009 ETF NAV (`{stk_cd}` → `etfnavarray[]`
  newest-first; **rows carry NO time field, and NAV/괴리율/추적오차 fields arrive ALL BLANK on
  BOTH mock and REAL** (probed intraday, 2 ETFs; responses byte-identical mock==REAL — third
  TR family confirming mock mirrors production) — only stkcnt/base_pric populated; `get_etf_info`
  renders the NAV block only if Kiwoom ever populates the values). **ka40010 deliberately NOT
  exposed**: its `etftisl_trnsn[]` rows also lack a time field and carry only cur_prc/pred_pre/
  trde_qty/for_netprps — strictly inferior to ka10008 (`get_foreign_holding`, dated rows).
  **ka40001 computes rates for ANY code, non-ETF included** (owner GUI finding 2026-07-10) —
  `get_etf_returns` guards via a sequential ka40002 pre-check: **non-ETF = `stk_nm` present +
  `etfobjt_idex_nm` blank; unknown code = both blank** (mock-probed 2026-07-10; NOT `!stk_nm`,
  which ka40002 fills even for 삼성전자). Guard is best-effort — a failed ka40002 lookup does
  not block. `get_etf_info` applies the SAME discriminator since v0.16.0 (inside `formatEtfInfo`,
  zero extra calls — ka40002 is its primary TR): non-ETF → named notice via the generalized
  `formatNonEtfNotice(…, featurePhrase)`, unknown code → "찾을 수 없습니다" notice.
- 대차/프로그램 TRs (v0.13.0 batch; **live-verified on REAL 2026-07-10** — owner-authorized
  one-shot read-only probe, 4 calls: rc=0, zero consumed-field gaps; **대차 responses
  byte-identical mock==REAL** (5th TR family confirming mock mirrors production), ka90003
  structurally identical — same 15-row shape/필드명/rank universe — with intraday values
  differing only by capture timing): ka10068 대차거래추이 전체 + ka20068 대차거래추이 종목별 (both `/api/dostk/slb`;
  bodies `{all_tp: "1"전체표시, strt_dt, end_dt}` / `{stk_cd, all_tp: "0"입력종목만, strt_dt,
  end_dt}`) — **두 TR은 배열 키(`dbrt_trde_trnsn`)와 행 구조가 동일**: `{dt, dbrt_trde_cntrcnt
  체결(주), dbrt_trde_rpy 상환(주), dbrt_trde_irds 증감(주, 부호 — 실측으로 체결−상환과 일치),
  rmnd 잔고(주), remn_amt 잔고금액(백만원 — 005930 잔고×주가로 교차검증)}`. 날짜 생략 시 100행;
  **당일 행은 집계 확정 전이라 전부 "0"** (푸터로 안내). Both wrapped by `get_stock_lending`
  (stock_code optional → TR switch, get_short_selling과 동일한 30일 기본 기간). **ka10069
  대차상위10 / ka90012 대차내역(일자별)도 mock rc=0이지만 의도적 미노출**: 상위10은 mock에서
  코스피 rmnd가 전부 0(품질 의심)이고, ka90012는 50행/page 페이지네이션에 행 필드가 ka20068과
  동일해 열세 — 툴 수 절제(ka40010 선례). ka90003 프로그램순매수상위50 (`/api/dostk/stkinfo`,
  body `{trde_upper_tp: "1"순매도|"2"순매수, amt_qty_tp: "1"금액|"2"수량 (투자자 TR과 동일 코드
  — prm_* 필드 단위가 백만원/주로 바뀜), mrkt_tp: "P00101"코스피|"P10102"코스닥 (**P-접두 코드,
  전체(all) 없음**), stex_tp: "1"}` → `prm_netprps_upper_50[]` of `{rank, stk_cd, stk_nm,
  cur_prc, flu_sig, pred_pre, flu_rt, acc_trde_qty, prm_sell_amt, prm_buy_amt,
  prm_netprps_amt}`) — **장 시작 전에는 rc=0 + 빈 배열, 개장 직후부터 15행** (08:30 KST probe
  3개 조합 전부 빈 배열 → 09:01 KST 재프로브 15행, 행 필드명 11개 전부 openapi 스펙과 일치;
  빈 상태 문구가 장전 케이스를 안내). **"상위50"이라는 이름과 달리 15행만 반환** (mock·REAL
  양쪽 동일, 09:10 KST 관측 — 장 후반 증가 여부는 미확인). prm_* 값은 amt_qty_tp에 따라
  백만원/주 — 수량 모드도 필드명은 그대로 `prm_*_amt`다. Wrapped by `get_program_trading`
  (direction/unit/market enum, get_ranking 패턴).
- VI/거래원 TRs (v0.14.0 batch, both `/api/dostk/stkinfo`; **live-verified on REAL 2026-07-10** —
  owner-authorized one-shot read-only probe, 2 calls: rc=0, zero consumed-field gaps; REAL VI
  rows included a 동적 행 with static_* fields zeroed — the mirror image of mock's 정적 rows,
  confirming the 괴리율-picker both ways; intraday data so byte-comparison not applicable):
  ka10054 변동성완화장치발동종목 (body: mrkt_tp
  000/001/101 랭킹 코드 공유, `bf_mkrt_tp: "0"`, `stk_cd` 옵션(빈값=전체, 지정 시 해당 종목만 —
  미발동이면 빈 배열), `motn_tp: "0"전체|"1"정적|"2"동적`, `skip_stk: "000000000"` 9자리
  제외마스크=전종목 포함, 거래량/거래대금 필터 6종 미사용 "0", `motn_drc: "0"전체|"1"상승|"2"하락`,
  `stex_tp: "1"` → `motn_stk[]` of `{stk_cd, stk_nm, acc_trde_qty, motn_pric 발동가,
  dynm_dispty_rt/static_dispty_rt 동적·정적 괴리율, trde_cntr_proc_time 발동시각 HHmmss,
  virelis_time 해제시각(**"000000"=미해제 → "-"**), viaplc_tp "정적"/"동적", dynm_stdpc/
  static_stdpc, open_pric_pre_flu_rt 시가대비, vimotn_cnt 발동횟수, stex_tp "KRX"}` — **정적 VI
  행은 dynm_* 필드가 "0"** 이므로 괴리율 컬럼은 viaplc_tp로 선택). Wrapped by `get_vi_stocks`.
  ka10002 주식거래원 (body `{stk_cd}` → flat 37 fields: 시세 헤더 + `sel/buy_trde_ori_nm_1~5`
  거래원명, `sel/buy_trde_ori_1~5` 거래원코드(미소비), `sel/buy_trde_qty_1~5` 수량 — **부호
  접두(매도 음수/매수 양수), 방향 중복이라 절대값 표시**). Wrapped by `get_broker_activity`.
  **ka10100 종목정보조회는 스킵 확정**: 응답이 ka10099 마스터 리스트의 행과 **완전히 동일한
  camelCase 레코드** (code/name/listCount/auditInfo/regDay/lastPrice/state/marketCode/marketName/
  upName/upSizeName/companyClassName/orderWarning/nxtEnable/kind — 005930으로 실측 대조) — 이미
  12h 캐시하는 마스터의 단건 조회일 뿐. 부수 발견: 마스터 행에 업종명(upName)/상장일(regDay)/
  감리구분/투자유의(orderWarning) 필드가 있어 search_stock/get_stock_price를 API 콜 없이 보강할
  여지가 있다 — **v0.15.0에서 구현 완료** (아래 마스터리스트 보강 불릿 참조).
- 수급 랭킹/업종 차트 TRs (v0.20.0 batch; mock-probed 2026-07-21 — 10콜 전부 rc=0, 배열 키
  전부 스펙 일치; **live-verified on REAL 2026-07-22** — owner-authorized one-shot read-only
  probe 08:13 KST, 6콜 전부 rc=0, consumed-field gaps/blanks ZERO; **÷100 스케일 REAL 확정**
  (ka20001 지수 6747.95 == ka20006 최신봉 674795÷100), **ka90009 단위 REAL 확정** (외인
  순매수 1위 삼성전자 66,821천만/2,580천주 → 암시 주가 258,996원 ≈ 실제 주가); ka90009 REAL
  행 값이 mock과 동일 — mock-mirrors-production 재확인; ka10131은 REAL에서 이중부호가 표시
  필드(frgnr_nettrde_amt `"--25292"`)에도 나타남 — parseKiwoomNumber가 이미 처리):
  ka90009 외국인기관매매상위
  (`/api/dostk/rkinfo`, body `{mrkt_tp: 000/001/101 랭킹 코드, amt_qty_tp: "1"금액|"2"수량,
  qry_dt_tp: "0"최근|"1"일자, date(옵션 yyyyMMdd), stex_tp: "1"}` → `frgnr_orgn_trde_upper[]`
  25행) — **한 행 = 외인 순매도/순매수·기관 순매도/순매수 4개 독립 리스트의 같은 랭크가 나란히**
  (4×{stk_cd,stk_nm,amt,qty} + 문서에 없는 `pipe1~3` 구분 필드; 순매도 값은 음수 부호 → 절대값
  표시). **단위가 투자자 TR과 다르다: 금액 천만원/수량 천주** (mock에서 금액≈수량×주가 삼각
  교차검증) — `get_investor_rank`가 천만원→억원(÷10) 환산 표시. ka10131 기관외국인연속매매현황
  (`/api/dostk/frgnistt`, body `{dt: "1"|"3"|"5"|"10"|"20"|"120", strt_dt:"", end_dt:"",
  mrkt_tp: "001"|"101" (**전체 000 없음** → 툴은 all이면 코스피 폴백+안내), netslmt_tp: "2"고정,
  stk_inds_tp: "0"종목, amt_qty_tp: **"0"금액|"1"수량 — 코드가 다른 TR(1=금액)과 반대**,
  stex_tp: "1"}` → `orgn_frgnr_cont_trde_prst[]` 100행/page, 1페이지만) — **amt_qty_tp는 정렬
  기준일 뿐, 행에는 금액(백만원)/수량(주)이 항상 둘 다 온다** (역시 amt≈qty×주가로 단위 확정);
  ka10061식 이중부호(`"--234680"`) 존재, **연속일수 음수 = 연속 순매도**. 업종 차트 6종 (모두
  `/api/dostk/chart`; `upd_stkpc_tp` 없음 — 지수엔 수정주가 개념 없음): ka20004 틱/ka20005 분
  (`{inds_cd, tic_scope}` — ka20005의 tic_scope는 분 단위 1/3/5/10/30, 문서 라벨은 둘 다 "틱범위"),
  ka20006 일/ka20007 주/ka20008 월/ka20019 년 (`{inds_cd, base_dt}`) → 배열 키
  `inds_{tic_chart,min_pole,dt_pole,stk_pole,mth_pole,yr_pole}_qry`, 행 구조가 주식 차트 TR과
  동일해 `dailyChartItemSchema`/`minuteChartItemSchema` 재사용 (분봉 행은 문서에 없는
  acc_trde_qty/pred_pre(_sig) 동반, 부호 접두). **지수값은 ×100 정수로 온다** ("674795" =
  6747.95 — mock에서 ka20001/ka20003 현재가·시가·전일대비와 대조해 확정) → 표시 시 ÷100.
  `get_sector_chart` 1개 툴이 6종 흡수 (get_stock_chart 패턴, 일/주/월/년은 첫 페이지
  600/300/240/~40행).
- ka10095 관심종목정보 = 멀티코드 일괄 시세 (v0.21.0; `/api/dostk/stkinfo`; **mock-probed
  2026-07-22 6콜 전부 rc=0, live-verified on REAL 2026-07-22** — owner-run one-shot
  read-only probe 2콜: rc=0, consumed gaps/blanks ZERO, 무효 코드 공백 행 shape REAL에서도
  동일, REAL row 값이 mock과 동일 — mock-mirrors-production 재확인): 이름과
  달리 HTS 관심종목과 무관한 **임의 코드 배치 시세 TR** — body `{stk_cd: "005930|000660|…"}`
  (`|` 구분, 공식 문서 명시; **30코드 단일 콜 실측 OK**, cont-yn N, 응답은 요청 순서 보존) →
  `atn_stk_infr[]` 60+필드 풀 시세 행 (호가 5단/예상체결/ELW 그리스 포함 — ELW 필드는 일반
  종목에서 빈 값/0). **미상장·오타 코드는 rc=0 + 전 필드 공백 행** (ka10170 빈 행 선례 —
  blank stk_cd 필터 후 "조회되지 않은 코드"로 안내). 단위 삼각검증 (mock): `trde_prica`
  백만원 (거래량×주가 대조), `mac` 시가총액 억원, `stkcnt` 천주 — 삼성전자 mac 15,229,556억
  == 5,846,279천주 × 260,500원. 소비 서브셋 8필드 (stk_cd/stk_nm/cur_prc/pred_pre/flu_rt/
  trde_qty/trde_prica/mac); cntr_str 체결강도는 미소비 (niche). `get_stock_quotes` 툴로 노출
  (zod array 1~30, 6자리 검증, 중복 제거; 비고 열은 get_stock_price와 동일한 best-effort
  병렬 마스터 조회 — masterItemWarnings). (v0.15.0; **mock 실측 2026-07-11, 4,294행 전수 서베이**):
  `regDay` 상장일 = 전 행 예외 없이 yyyyMMdd. `auditInfo` 감리/상태 자유텍스트 — 실측값
  "정상"(4056)/"거래정지"(119)/"투자주의환기종목"(37)/"관리종목"(29)/"투자주의"(29)/
  "단기과열"(12)/"투자경고"(12); ETF/ETN도 "정상"으로 채워짐. `orderWarning` 투자유의 코드
  (KKimj openapi 응답 스키마) = **0 해당없음, 1 ETF투자주의요망(ETF만), 2 정리매매, 3 단기과열,
  4 투자위험, 5 투자경고** — 스펙 원문의 "투자경과"는 오타 (실측: auditInfo "투자경고" 행들이
  정확히 orderWarning "5", "단기과열"이 "3"). 둘은 상관되지만 동일하지 않아
  `masterItemWarnings()` (master-list.ts)가 중복 제거해 합친다. `companyClassName` 코스닥 전용
  (중견/우량/벤처/신성장기업/스팩/외국기업; 그 외 빈 값), `upSizeName`은 우선주/ETF에서 빈 값.
  `state`(증거금|담보대출|신용가능 파이프 문자열)는 **표시 안 함** (거래정지/관리종목이 auditInfo와
  중복, 증거금은 브로커 설정 노이즈). get_stock_price는 ka10001과 **병렬로 best-effort 마스터
  조회** (warm 캐시 = 추가 콜 0, cold = ka10099 2콜이 얹힘; 실패 시 보강 블록만 조용히 생략).
- Watchlist TRs (both `/api/dostk/watchlist`, read-only, live-verified 2026-07-06):
  ka01300 관심종목 그룹 리스트 (empty body → `nofi[]` of `{gcod 그룹코드, name 그룹명}`);
  ka01301 관심종목 그룹 상세 (body `{arn_grp_id: <gcod>}` → `nofj[]` of `{cod2 종목코드,
  bgb 북마크구분, bgb_clr}`). **Item fields are terse** (not the usual snake_case) and a
  legacy `rtcd:"S"` flag rides alongside the standard `return_code` envelope. ka01301
  returns only codes — names/전일종가 are enriched from the ka10099 master list. **Kiwoom
  REST exposes no watchlist-edit TR** (only 주문 writes exist), so this is read-only by
  nature, not merely by our design. These were the ONLY new REST endpoints for watchlists
  as of the dongbin300 .NET wrapper v0.8.0 (2026-06-29); older wrappers lack them.
- Theme TRs (both `/api/dostk/thme`, read-only, **all fields live-verified 2026-07-07**):
  ka90001 테마그룹별 (body `{qry_tp: "0"전체|"2"종목검색, stk_cd, date_tp: "10", flu_pl_amt_tp:
  "1"등락률상위, stex_tp: "1"KRX}` → `thema_grp[]` of `{thema_grp_cd, thema_nm, stk_num,
  flu_rt, rising_stk_num, fall_stk_num, dt_prft_rt 기간수익률(date_tp일), main_stk 주요종목}`;
  **`hasNext:true`, 100/page — page 1 only, display capped by `limit`**); ka90002 테마구성종목
  (body `{date_tp: "2", thema_grp_cd: <ka90001 코드>, stex_tp: "1"}` → top-level `flu_rt`/
  `dt_prft_rt` 테마 집계 + `thema_comp_stk[]` of `{stk_cd, stk_nm, cur_prc, pred_pre, flu_rt,
  acc_trde_qty, dt_prft_rt_n, sel_bid/sel_req/buy_bid/buy_req}`). **`qry_tp:"1"(테마명검색,
  thema_nm)` returns EMPTY for a substring (live-tested "반도체"→0 rows) — NOT exposed; only
  qry_tp 0/2 work.** date_tp differs per TR (10 vs 2) so the same theme's 기간수익률 differs
  between the two calls — expected, not a bug.
- v1.1 batch TRs (all fields **live-verified 2026-07-07**): ka10014 공매도추이 (`/api/dostk/shsa`,
  body `{stk_cd, tm_tp: "1"일별, strt_dt, end_dt}` → `shrts_trnsn[]` of `{dt, close_pric, flu_rt,
  trde_qty, shrts_qty 공매도량, ovr_shrts_qty 누적, trde_wght 공매도비중(%), shrts_trde_prica,
  shrts_avg_pric}`); ka10008 주식외국인종목별매매동향 (`/api/dostk/frgnistt`, body `{stk_cd}` →
  `stk_frgnr[]` of `{dt, close_pric, trde_qty, chg_qty 외국인순변동, poss_stkcnt 보유주식수,
  wght 보유비중(%), gain_pos_stkcnt, frgnr_limit, limit_exh_rt 한도소진률(%)}`; **paginates
  50/page, page-1 only**); ka10170 당일매매일지 (`/api/dostk/acnt`, body `{base_dt, ottks_tp: "1",
  ch_crd_tp: "0"}` → top-level totals `tot_{sell,buy}_amt`/`tot_cmsn_tax`/`tot_pl_amt`/`tot_prft_rt`
  + `tdy_trde_diary[]` of `{stk_cd, stk_nm, buy_avg_pric, buy_qty, sel_avg_pric, sell_qty,
  cmsn_alm_tax, pl_amt, sell_amt, buy_amt, prft_rt}`). **ka10170 quirks: an empty trading day
  returns ONE all-blank row (filter blank `stk_cd`), and a base_dt beyond ~2 months returns
  `return_code:0` + a "최근 2개월 이내" notice in `return_msg` with blank data (surface it). Its item
  VALUES are wrapper-sourced (no day-trade to observe), field NAMES live-confirmed.** 공매도비중/
  보유비중/한도소진률 are non-directional ratios → `formatRatioPercent` (no forced + sign), unlike
  directional `flu_rt`.
- Dead ends (live-tested, do not retry blindly): ka10072/ka10073 (종목별 실현손익) return
  empty rows for this account regardless of code format — per-stock realized P&L is
  instead reconstructed from kt00015 trades (`src/isa/realized.ts`, moving-average cost,
  validated within tens of KRW of ka10074). Cash deposit rows never appear in kt00015
  under any tried tp/gds_tp combination, so dividend auto-detection
  (`scanDividends` — in `src/tools/isa-tax-status.ts`, NOT realized.ts) is unverified until
  a real dividend arrives — the tool exposes a `dividends_received` manual input for that
  reason.
- Rate limit: **~1 req/s per TR, burst 2**, HTTP 429 on overage. Client retries 429/5xx
  with backoff; continuation pages are spaced 1.1s apart.
- Numeric values arrive as strings, zero-padded and/or sign-prefixed (`"+61300"`,
  `"-00013000"`). Price fields encode direction-vs-yesterday in the sign — use
  `parseKiwoomPrice` (abs) for prices, `parseKiwoomNumber` (sign kept) for P&L. Holding
  `stk_cd` may carry an asset-class prefix (`"A005930"`) — strip via `normalizeStockCode`.

## Settled design decisions

- MCP SDK ^1.29 with **zod v4** (`z.looseObject` for API responses; raw shapes for tool
  inputs).
- **No `dotenv`** — Node's built-in `process.loadEnvFile()`; `.env` resolved relative to
  the project root first (Claude Desktop launches with arbitrary cwd).
- Money arithmetic in plain `number` (KRW magnitudes are far below 2^53); `decimal.js`
  deliberately not used.
- `KIWOOM_MODE=VIRTUAL|REAL` switches base URLs; VIRTUAL/REAL need separately issued app
  keys. Develop and test against VIRTUAL; touch REAL only when explicitly asked. Every
  tool output is prefixed `[모의투자]`/`[실전투자]` so the user can tell which server answered.
- Kiwoom raw responses are translated to human-readable Korean errors; secrets are
  scrubbed from any error text that may include response snippets (`utils/redact.ts`).
- `search_stock` caches the ka10099 master list in-process for 12h (two markets fetched
  1.1s apart — same TR, rate limit). Chart tools fetch the first page only (240~900 rows).
- Account tools are named generically (`get_account_balance`/`get_account_holdings`) —
  kt00001/kt00018 are not ISA-specific. **The server is general-account-first: the
  `calc_isa_tax_status` tool is registered only when `ISA_ENABLED=true`, checked at
  startup in `createServer()` via `isIsaEnabled()` (loads `.env`, no credential
  validation, defaults false). A general/non-ISA account never sees the tool.** `ISA_TYPE`
  / `ISA_OPENED_ON` are consulted only when enabled; all three are the only ISA envs.
- **Version policy** (de facto since v0.5.x, codified 2026-07-09): new tool(s)/feature =
  **minor bump IN the feature PR**, updating `package.json` AND `src/server.ts`
  `SERVER_VERSION` together (`npm version <v> --no-git-tag-version` keeps the lockfile in
  sync); fixes-only = patch; docs/CI/build-infra/dev-tooling = **no bump**. The file version
  advances independently of npm publish timing (0.6.0/0.7.0 were never published; npm went
  0.8.0 → 0.9.0). A 0.x minor MAY change behavior, but its release notes must **lead with a
  migration block** (v0.9.0 `ISA_ENABLED` precedent). Tag + GitHub Release at publish
  decision points. Publish gates: `prepublishOnly` (typecheck+test+build) + a one-shot REAL
  read-only probe for any new TR before its first publish; `npm publish` is owner-run at a
  real TTY (passkey flow — no npm token exists).
- License **MIT** (`LICENSE`, © ChunSam); README is bilingual (`README.md` 한국어 /
  `README.en.md` English). **Distribution is publish-enabled: `package.json` `"private":
  false`** (flipped from `true` at go-live — the owner's deliberate go/no-go was taken).
  Before it was flipped, `private: true` acted as an accidental-`npm publish` guard (real
  publish refuses on it; `npm publish --dry-run` skips that check, so dry-run stays safe for
  inspecting the tarball). `files: ["dist"]` scopes the tarball to `dist/` +
  README/LICENSE/package.json (verified: no `.env`/`src`/`tests`/`CLAUDE.md`). The build
  emits **no source maps** (`tsconfig` `sourceMap: false`) — the tarball ships transpiled
  `dist/**/*.js` only; maps would point at `src/` (not shipped) so they're dead weight to
  consumers and only leak source structure (dev debugging uses `npm run dev`/tsx, not built
  `dist`). The first published version is `0.8.0`. `npm publish` requires the owner's
  authenticated npm session (`npm login`) and is run by the owner, never the agent.

## Live verification status (2026-07-05~06, REAL mode)

- ka10001 / kt00001(qry_tp="3") / kt00018 / ka10074 / kt00015 all confirmed working
  against a live account in REAL mode. Retrospective queries back to at least 6 months
  work (kt00015 returned Jan-2026 rows).
- All 13 tools (v0.4.0) smoke-tested live over stdio 2026-07-06 — market-data TRs
  (ka10099/10080~83/10004/20003/10027/10030/10032/10059/10061/40002) returned correct
  data on the first verified parameter set.
- ka01300/ka01301 관심종목 그룹 조회 added as 2 read-only tools
  (`get_watchlist_groups`/`get_watchlist`), live-verified over stdio 2026-07-06 against
  a live account in REAL mode (4 groups; ETF group enriched with names/전일종가 via the shared
  ka10099 master list). **Server exposed 15 tools at v0.5.1.**
- **v0.6.0 (2026-07-07) — v1.1 read-only feature round begins.** Added `get_pending_orders`
  (ka10075 미체결요청) as the first of the deferred v1.1 tools. Contract researched from the
  younghwan91/dongbin300 wrappers, then live-probed on REAL: the `oso` array key + envelope
  are live-verified (returned `return_code:0`, empty `oso[]` — no open orders), but the
  item-field shape stays wrapper-sourced (no pending order to observe; order placement is out
  of scope). Empty-list path smoke-tested live over stdio. **Server exposed 16 tools at v0.6.0.**
- **v0.7.0 (2026-07-07) — 테마 tools.** Added `get_theme_groups` (ka90001) + `get_theme_stocks`
  (ka90002), both on `/api/dostk/thme`. **All fields live-verified on REAL** (chained probe:
  ka90001 → first `thema_grp_cd` → ka90002; groups page returned 100 rows, member quotes
  resolved). `get_theme_groups` defaults to 등락률 상위 (limit 30, max 100, page 1) and takes an
  optional `stock_code` (qry_tp 2 = 편입 테마 검색, live-verified — 005930→반도체_생산).
  Name-substring search (qry_tp 1) was live-tested and returns empty, so it is deliberately not
  exposed. All 3 live paths (groups / stock-scoped groups / member stocks) smoke-tested over
  stdio. **Server exposed 18 tools at v0.7.0.**
- **v0.8.0 (2026-07-07) — v1.1 batch (final 3 read-only tools).** Added `get_short_selling`
  (ka10014), `get_foreign_holding` (ka10008), `get_trading_journal` (ka10170). **All fields
  live-verified on REAL** (공매도/외국인 returned real 삼성전자 rows; 당일매매일지 today returned the
  all-blank placeholder + zero totals, so its item VALUES stay wrapper-sourced). Live smoke over
  stdio: short-selling 22-day trend, foreign-holding with `limit`, trading-journal empty-day path
  (`isError:false`, "당일 매매 내역이 없습니다" after blank-row filtering). **Server now exposes
  21 tools.** This completes the v1.1 read-only tool round (미체결/테마/공매도/외국인/당일매매일지);
  no further read-only market/account TRs remain worth adding (재무/배당캘린더/공시/뉴스/환율/파생 have
  no Kiwoom REST TR; 실시간/조건검색 are WebSocket-only). **Erratum (2026-07-08): the KKimj
  openapi comparison surfaced ~20 genuinely-new read-only TRs after all** (screening/sector/
  ETF-detail/tick·yearly-chart/program-trade/대차 — see the market-movers batch below);
  "no further TRs" was too strong.
- **v0.9.0 (2026-07-08) — general-account-first + `get_market_movers`.** The ISA tool became
  opt-in via `ISA_ENABLED` (PR #2 on the recreated public repo; server = 21 always-on tools
  + 1 ISA opt-in). Added `get_market_movers`: ka10016 신고저가 / ka10017 상하한가 / ka10019
  가격급등락 behind one signal-enum tool (get_ranking pattern). Developed on VIRTUAL
  (fixtures in `tests/market-movers.test.ts` captured from mockapi 2026-07-08; live mock
  stdio smoke on 3 signal paths), then **live-verified on REAL 2026-07-08** (owner-authorized
  one-shot read-only probe: rc=0, array keys OK, zero consumed-field gaps, rows identical to
  mock — first confirmation that mockapi mirrors production for market-data TRs).
  **Server exposes 22 tools with ISA enabled (21 without).**
- **v0.10.0 (2026-07-09) — 업종 drill-down.** Added `get_sector_price` (ka20001 업종현재가)
  + `get_sector_stocks` (ka20002 업종별주가), both on `/api/dostk/sect`; `get_market_index`
  gained a 코드 column + chaining hint so the sector code flows into both new tools.
  Developed on VIRTUAL per the dev loop (fixtures in `tests/sector.test.ts` captured from
  mockapi 2026-07-09), then **live-verified on REAL 2026-07-09** (owner-authorized one-shot
  read-only probe, 4 calls across kospi/kosdaq: rc=0, array keys OK, zero consumed-field
  gaps, rows byte-identical to mock — mock-mirrors-production reconfirmed, and the
  inds_cd→mrkt_tp derivation holds on REAL). Also codified the version policy (above), promoted
  the two owner test docs from `.git/info/exclude` to tracked `.gitignore`, and extended
  `scripts/sweep.py` to 29 calls. **Server exposes 23 always-on tools (24 with ISA).**
- **v0.11.0 (2026-07-09) — ETF detail.** Added `get_etf_returns` (ka40001: 4개 dt를 순차 호출해
  기간별 수익률 테이블 + `benchmark_index_code` 옵션, 기본 201 KOSPI200) and enriched
  `get_etf_info` with ka40009 NAV/괴리율/추적오차율 (best-effort third parallel call,
  blank-tolerant — mock returns blanks). ka40010 skipped by design (see the ETF detail TR
  bullet above). Developed on VIRTUAL per the dev loop (fixtures in `tests/etf-returns.test.ts`
  + NAV cases in `tests/market.test.ts`, captured from mockapi 2026-07-09), then **live-verified
  on REAL 2026-07-09** (owner-authorized one-shot read-only probe, 4 calls: rc=0, zero
  consumed-field gaps; benchmark-selector semantics hold; for_netprps_qty real-valued;
  **NAV fields blank on REAL too — the NAV block stays dormant until Kiwoom populates them**;
  ka40009 responses byte-identical mock==REAL). Probe was first blocked by **Kiwoom 8050
  지정단말기 인증** (recurred on IP change — owner re-registered the terminal to clear it).
  139 tests. `scripts/sweep.py` = 30 calls. **Server exposes 24 always-on tools (25 with ISA).**
- **v0.12.0 (2026-07-09) — chart extensions.** `get_stock_chart` absorbed ka10079 틱봉
  (`period: "tick"` + `tick_scope`, default 30) and ka10094 년봉 (`period: "year"`) — **no new
  tool**: year rides the existing CHART_TRS map/`formatDailyChart`, tick reuses the minute row
  schema and `formatMinuteChart` (generalized to a `scopeLabel` like "5분"/"30틱"). Developed on
  VIRTUAL per the dev loop (fixtures in `tests/market.test.ts` captured from mockapi 2026-07-09),
  then **live-verified on REAL 2026-07-09** (owner-authorized one-shot read-only probe, 2 calls:
  rc=0, zero consumed-field gaps, responses byte-identical mock==REAL). 142 tests.
  `scripts/sweep.py` = 32 calls. **Server still exposes 24 always-on tools (25 with ISA).**
- **v0.12.1 (2026-07-10) — get_etf_returns non-ETF guard** (fixes-only patch; owner GUI test
  found ka40001 returning a "수익률" table for 삼성전자). Sequential ka40002 pre-check refuses
  non-ETFs with a named notice and skips the 4 ka40001 calls (see the ETF detail TR bullet for
  the discriminator). 144 tests. `scripts/sweep.py` = 33 calls (guard path included).
  npm `kiwoom-mcp-server@0.12.0` was published 2026-07-10 KST (tag v0.12.0 + Release batching
  0.10.0~0.12.0; Desktop prod pin bumped) — 0.12.1 rides the next publish.
- **v0.13.0 (2026-07-10) — 대차거래 + 프로그램 매매.** Added `get_stock_lending` (ka10068 전체 /
  ka20068 종목별 — 하나의 툴, stock_code로 TR 스위치) and `get_program_trading` (ka90003 순매수/
  순매도 상위, direction/unit/market enum). ka10069/ka90012 probed but deliberately NOT exposed
  (see the 대차/프로그램 TR bullet). Developed on VIRTUAL per the dev loop (fixtures in
  `tests/lending-program.test.ts` captured verbatim from mockapi 2026-07-10 — 대차 rows pre-market,
  ka90003 rows via a post-open 09:01 KST re-probe after the pre-market probe returned empty
  arrays), then **live-verified on REAL 2026-07-10** (owner-authorized one-shot read-only probe,
  4 calls: rc=0, zero consumed-field gaps; 대차 byte-identical mock==REAL — 5th family; ka90003
  structurally identical, intraday values differ by timing only; no 8050 recurrence). 150 tests.
  `scripts/sweep.py` = 36 calls. **Server exposes 26 always-on tools (27 with ISA).**
- **v0.14.0 (2026-07-10) — VI + 거래원.** Added `get_vi_stocks` (ka10054 변동성완화장치 발동종목 —
  market/direction/vi_type enum + optional stock_code) and `get_broker_activity` (ka10002 거래원
  상위 5 매수/매도). **ka10100 skipped** — response is byte-for-byte a ka10099 master-list row
  (see the VI/거래원 TR bullet). Developed on VIRTUAL per the dev loop (fixtures in
  `tests/vi-broker.test.ts` captured verbatim from mockapi 2026-07-10; one synthetic 동적-VI row
  for the 괴리율-picker branch, later observed live on both mock and REAL), then **live-verified
  on REAL 2026-07-10** (owner-authorized one-shot read-only probe, 2 calls: rc=0, zero
  consumed-field gaps; REAL first VI row was 동적 with static_* zeroed — picker confirmed both
  ways; no 8050). 155 tests. `scripts/sweep.py` = 38 calls. **Server exposes 28 always-on tools
  (29 with ISA).**
- **v0.15.0 (2026-07-11) — hardening/UX pivot begins: master-list enrichment.** The zero-cost
  idea recorded at the ka10100 skip is now shipped: `search_stock` gained a 비고 column
  (거래정지/관리종목/단기과열/투자경고 등), `get_stock_price` gained 시장/업종(+대형주·코스닥
  기업분류)/상장일/⚠️투자유의 lines via a best-effort parallel master lookup. New shared helper
  `masterItemWarnings()` in `master-list.ts` (auditInfo + orderWarning 라벨, deduped);
  `stockListItemSchema` +regDay/+companyClassName. **No new tool, no new TR** — ka10099 was
  live-verified long ago, so no REAL probe needed; developed and verified on mock only (4,294-row
  field survey + abnormal-row fixtures captured verbatim 2026-07-11). 161 tests.
  `scripts/sweep.py` unchanged (38 calls — both tools already swept). **Server still exposes
  28 always-on tools (29 with ISA).**
- **v0.16.0 (2026-07-11) — UX batch #2: get_etf_info non-ETF guard + watchlist 투자유의.**
  `get_etf_info` now refuses non-ETF codes with the same ka40002 discriminator as
  `get_etf_returns` (checked inside `formatEtfInfo` — zero extra calls; previously rendered a
  degenerate "-" card, the carried 2026-07-10 watch item, now RESOLVED); `formatNonEtfNotice`
  generalized with a `featurePhrase` param. `get_watchlist` gained a 비고 column via
  `masterItemWarnings()` on the master rows it already loads. No new tool/TR, no REAL probe
  needed; mock-only per the dev loop. 162 tests. `scripts/sweep.py` = 39 calls (+get_etf_info
  guard path). **Server still exposes 28 always-on tools (29 with ISA).**
- **v0.17.0 (2026-07-12) — remote access: opt-in Streamable HTTP transport.** Path A
  (supergateway stdio→HTTP bridge + Cloudflare quick tunnel, VIRTUAL) was owner-verified
  end-to-end on claude.ai web AND mobile first; then the native mode shipped as
  `src/http.ts` (see Architecture). No new TR, no Kiwoom-layer change → no REAL probe
  needed; stdio behavior byte-identical for existing installs. 188 tests (+26 in
  tests/http.test.ts incl. an in-process HTTP round-trip on an ephemeral port — offline,
  ping/tools-list only). `scripts/sweep.py` unchanged (39 calls, stdio). README (ko/en)
  gained a "원격 연결 (HTTP 모드)" section + 5 MCP_* env rows. **Server still exposes 28
  always-on tools (29 with ISA).**
- **v0.18.0 (2026-07-12) — built-in OAuth for claude.ai connectors.** Driven by a live
  finding: the owner's personal-plan claude.ai connector dialog exposes ONLY OAuth
  client-ID/secret fields (no request-header input), so the v0.17.0 static-bearer path
  cannot authenticate there; claude.ai auto-started an OAuth flow against the nonexistent
  `/authorize` (404 screenshot). Options weighed: URL-secret path + `--no-auth` (plan B,
  blocked by the auto-mode classifier as a safety bypass and rightly so) vs implementing
  the MCP auth spec — owner chose OAuth. See the `src/oauth.ts` Architecture bullet for
  the full design. No new TR/Kiwoom-layer change → no REAL probe; stdio and `--no-auth`
  behavior unchanged. 205 tests (+17 in tests/oauth.test.ts incl. an in-process
  register→consent→token→/mcp round-trip). `scripts/sweep.py` unchanged (39 calls).
  **Server still exposes 28 always-on tools (29 with ISA).**
- **v0.19.0 (2026-07-13) — 계좌 TR 검토 + 기간 손익 흡수.** The carried 계좌 TR redundancy
  review (ka10085/kt00004/ka10077) concluded: ka10077/ka10085 skipped (see the 검토 bullet
  in the API-contract section), kt00004's 당일/당월/누적 투자손익·손익율 absorbed into
  `get_account_balance` as a best-effort third parallel call — the "내 계좌 오늘/이번달/
  누적 얼마 벌었어?" question was previously unanswerable (journal = realized-only today;
  kt00018 = unrealized snapshot). **No new tool.** Spec source: official
  `Kiwoom-Securities/Kiwoom-REST-API` kiwoom_docs (first TR work on the new authority).
  Developed on VIRTUAL per the dev loop (3-TR mock probe 2026-07-13: all rc=0; kt00004
  shape captured verbatim, values synthetic — fresh mock account is all zeros), then
  **live-verified on REAL 2026-07-13** (owner-run one-shot probe: contract confirmed, but
  the 9 period-P&L fields came back ALL-ZERO on a populated account → all-zero guard added,
  see the kt00004 contract bullet; owner GUI cross-check 2026-07-14 confirmed 영웅문 shows
  the same zeros — Kiwoom-side truth). 209 tests. `scripts/sweep.py` unchanged (39 calls —
  get_account_balance already swept; it now exercises kt00004 internally). npm 0.19.0
  published 2026-07-13 (shasum `a074a5f9…`==local; clean-room npx from a NEUTRAL cwd —
  running `npx kiwoom-mcp-server@<v>` from the repo root 127s when the spec matches the
  local project's own name@version); tag v0.19.0 + Release; Desktop pin @0.19.0 (⌘Q'd
  2026-07-14 — process current for the first time since @0.14.0); `~/kiwoom-remote`
  deployed @0.19.0 (owner-run install+kickstart after a [Production Deploy] classifier
  block; OAuth state survived the restart). **Server still exposes 28 always-on tools
  (29 with ISA).**
- **v0.19.1 (2026-07-14) — MCP Registry distribution metadata (visibility round begins).**
  No behavior change → patch per version policy. package.json gains **`mcpName:
  "io.github.ChunSam/kiwoom-mcp-server"`** — required by the official MCP Registry
  (registry.modelcontextprotocol.io) npm ownership validation, which fetches the
  PUBLISHED package.json of the exact version in server.json and EXACT-matches `mcpName`
  against the server name (case-sensitive: namespace permission is a
  `strings.HasPrefix` on `io.github.<GitHub login>/*` with the login's canonical casing
  `ChunSam` — all three verified in registry source 2026-07-14). The field is permanent:
  every future registry-published version needs it in that npm version too. New repo-root
  **`server.json`** (schema 2025-12-11 — registry is PREVIEW, schema churned 5×/year;
  description capped at 100 chars): npm stdio package + 4 env vars
  (KIWOOM_APP_KEY/APP_SECRET secret+required, KIWOOM_MODE choices, ISA_ENABLED boolean).
  **`remotes` deliberately NOT declared** — the registry requires remote URLs to be
  publicly accessible services; the personal Tailscale funnel is a single-account
  instance, and BYO-app-key stdio install is the honest representation. Not in the npm
  tarball (`files: ["dist"]` unchanged) — the registry stores it from `mcp-publisher
  publish`, git is just provenance. Publish chain (owner-gated): npm publish 0.19.1 →
  `mcp-publisher login github` (device flow) → `mcp-publisher publish`. Directory-round
  facts (researched 2026-07-14): **Glama already auto-lists this server unclaimed**
  (glama.ai/mcp/servers/ChunSam/kiwoom-mcp-server, grades A/A/A, stale "local-only"
  blurb — **ownership = repo-root `glama.json` `{maintainers: ["ChunSam"]}`, shipped
  2026-07-15; the research-round "claim button" does NOT exist on the live page**, the
  glama.json crawl is the documented mechanism); PulseMCP ingests the
  official registry daily (also has /submit form); mcp.so = self-service form
  (Cloudflare-blocked for bots — human clicks); Smithery needs an MCPB bundle (deferred;
  avoid its Hosted flow — 2025-06 security incident + architecture mismatch). Name
  collision: an unrelated trading-capable "Kiwoom Securities" (kwonsw812) is on
  PulseMCP — listing copy must lead with read-only/28 tools to differentiate.
- **v0.20.0 (2026-07-22) — 수급 랭킹 + 업종 차트 (feature pipeline resumes).** Owner
  declined the PulseMCP escalation email (등재 재촉 안 함) and picked feature work; the
  kiwoom_docs discovery diff (official repo, 16 category files, ~60 unreviewed read-only
  TRs catalogued) selected this batch. Added `get_investor_rank` (ka90009 일자별 외인·기관
  순매매 상위 + ka10131 연속매매현황 — view enum daily/streak; "오늘 외국인이 뭘 샀나"
  질문 축을 처음으로 커버) and `get_sector_chart` (ka20004~08/ka20019 업종 틱/분/일/주/월/
  년봉 — 주식 차트 스키마 재사용, ÷100 스케일; "코스피 최근 N개월 추이" 커버). Developed on
  VIRTUAL per the dev loop (fixtures in `tests/investor-rank.test.ts` +
  `tests/sector-chart.test.ts` captured verbatim from mockapi 2026-07-21 incl. the pipe1~3
  separators and double-sign rows; 4-call stdio smoke + full sweep green), then
  **live-verified on REAL 2026-07-22** (owner-authorized one-shot read-only probe, 6 calls:
  rc=0, zero consumed-field gaps; ÷100 scale and 천만원/천주 units both CONFIRMED on REAL —
  see the TR bullet above. Process note: the owner's first `!` line silently didn't execute
  — no output, no result file — and the agent-side retry was classifier-blocked
  [Production Reads] as the convention intends; owner re-ran from the bash-mode prompt).
  227 tests / 21 files. `scripts/sweep.py` = 43 calls. **Server exposes
  30 always-on tools (31 with ISA).** README(ko/en) tool tables updated (+2 rows, and the
  get_account_balance row belatedly gained kt00004 — missed in v0.19.0).
- **v0.21.0 (2026-07-22) — 배치 시세.** Added `get_stock_quotes` (ka10095 관심종목정보 —
  이름과 달리 임의 멀티코드 배치 시세; 상세는 위 TR 불릿): 최대 30종목을 한 콜로 조회해
  종목당 1콜(1.1s) 레이트리밋 병목을 제거. 포트폴리오/관심종목류 질문의 LLM-UX 개선이 목적.
  Developed on VIRTUAL per the dev loop (fixtures in `tests/stock-quotes.test.ts` captured
  verbatim from mockapi 2026-07-22 incl. the unknown-code all-blank row; 2-call stdio smoke
  + full sweep green), then **live-verified on REAL 2026-07-22** (owner-run one-shot
  read-only probe, 2 calls: rc=0, zero consumed-field gaps/blanks; unknown-code blank-row
  shape confirmed on REAL; REAL rows identical to mock — mirror re-confirmed).
  232 tests / 22 files. `scripts/sweep.py` = 45 calls (+2: 멀티코드 + unknown-code 필터
  경로). **Server exposes 31 always-on tools (32 with ISA).**
- **v0.22.0 (2026-07-23) — 계좌 자산 추이 (마지막 strong-tier 항목).** Added
  `get_account_trend` (kt00002 일별추정예탁자산 + kt00016 기간 수익률 요약 — 상세는 위
  계좌 시계열 TR 불릿): "내 계좌가 지난 한 달간 어떻게 변했나" 축을 처음 커버. **두 TR 모두
  mock-미지원(RC9000)이라 통상의 mock-first 루프를 뒤집어 EARLY owner REAL 프로브(3콜,
  2026-07-23)로 계약을 먼저 확정** — kt00016이 kt00004의 all-zero 기간손익을 회복함을 확인
  (30일 -5.56% 실값). Fixtures는 shape-true·value-synthetic (실계좌 잔고는 레포에 넣지
  않음 — raw 캡처는 로컬 스크래치패드만; prft_rt와 evltv_prft÷invt_bsamt 관계는 fixture에서도
  유지). 237 tests / 23 files. `scripts/sweep.py` = 46 calls (get_account_trend는 mock에서
  err(exp) — get_transactions RC9000과 같은 클래스). **Server exposes 32 always-on tools
  (33 with ISA).**
- **v0.23.0 (2026-07-23) — 거래량급증 시그널.** `get_market_movers`가 ka10023 거래량급증을
  `volume_surge` 시그널로 흡수 (**no new tool** — v0.12.0 차트 확장 선례; 상세는 위
  Market-movers TR 불릿). "오늘 거래량 터진 종목" 질문 축 커버. Developed on VIRTUAL per
  the dev loop (fixtures in `tests/market-movers.test.ts` captured verbatim from mockapi
  2026-07-23; 급증량순 정렬 결정도 mock 실측 근거). 239 tests / 23 files. `scripts/sweep.py`
  = 47 calls. **Server still exposes 32 always-on tools (33 with ISA).**
- 과세유형 분류가 실제로 필요한 이유: a SEOMIN ISA (한도 400만원) can hold a mix of
  taxable-type ETFs (해외지수형/채권형) and 국내주식형 ETFs, so realized history mixes
  과세대상 (해외지수 ETF 매도차익) and 비과세/손실차감 (국내주식형 ETF 매도차익) — each
  entry must be classified rather than treated uniformly.

## ISA tax computation (`src/isa/`)

- `classify.ts` — 과세유형 heuristic (ETF brand prefix + name keywords; taxable keywords
  win over domestic ones; unknown ETFs default to TAXABLE with `confident: false`). Also
  exports `isLikelyEtf()` (brand-prefix gate) and the pure `mapEtfTaxonType()` (키움
  과세유형 → TaxType). Owner-facing overrides come through the tool's `overrides` argument.
- `classify-etf.ts` — authoritative classification: it calls ka40002 for any code gated as
  an ETF (brand prefix via `isLikelyEtf`, **OR** the ka10099 master-list `marketName == "ETF"`
  set passed in as `etfCodes` — so brand-unmatched ETFs are covered too) and maps
  `etftxon_type` (비과세→DOMESTIC_EQUITY, 보유기간과세→TAXABLE), **falling back to the
  `classify.ts` heuristic** for individual stocks, unrecognized taxon values, or API
  failures. `classifyInstrument(code, name, overrides?, isEtfHint?)` takes the master-list
  ETF signal so the heuristic fallback also treats it as an ETF (not an individual stock).
  Overrides win outright (no API call). Codes are deduped across realized+unrealized; ETF
  calls are sequential (~1.1s apart, same-TR rate limit) and cached in-process 12h
  (`clearEtfTaxonCache()` test hook). `calc_isa_tax_status` builds the `etfCodes` set via a
  best-effort `loadMasterList` (empty set on failure → heuristic fallback) and runs this as
  a pre-pass, so ETF entries are 확정(키움 기준) and non-ETF entries stay 추정.
- `realized.ts` — per-stock realized P&L reconstructed from kt00015 trades
  (moving-average cost, fees included via `exct_amt`). Cross-checked against ka10074 in
  the tool output; sells exceeding the tracked position set `incompleteHistory`.
- `tax.ts` — 손익통산: 과세대상 실현손익(±) + 배당 + 국내주식형 **순손실만** 차감; 국내
  주식형 이익은 통산 제외. 시나리오(전량 매도)는 미실현을 같은 규칙으로 더한다. 한도는
  `ISA_LIMITS`(GENERAL 200만/SEOMIN 400만), 초과분 9.9%.
- Aggregation start date is **never hardcoded**: `ISA_OPENED_ON` env (per-installation)
  → `from_date` tool argument (per-call override) → otherwise a readable error. Keep it
  that way — this server is meant to be reusable by other people/accounts.

## Open questions / known limitations

- **Dividend/분배금 rows never observed in kt00015** (none received on this account) — the
  exact `trde_kind_nm`/`rmrk_nm` labels for 배당 rows are unknown, so `scanDividends`
  keyword matching (배당|분배|이자) is unverified. `dividends_received` is the manual
  fallback. Revisit when the first 분배금 arrives.
- **Brand-unmatched ETFs — RESOLVED (v0.5.1).** `classify-etf.ts` now also gates its
  ka40002 call on the ka10099 master-list `marketName == "ETF"` set (`etfCodes`), so an
  ETF whose brand prefix isn't in `ETF_BRANDS` still gets authoritative classification
  instead of defaulting to a confident `DOMESTIC_EQUITY`. Residual edge: a code absent
  from the KOSPI+KOSDAQ master list (e.g. a fetch failure → empty `etfCodes`) falls back to
  the brand-prefix heuristic as before.
- **Pagination truncation is now surfaced (v0.5.1).** `fetchTransactions` /
  `fetchAccountEvaluation` return a `truncated` flag when they stop at `MAX_PAGES=20`
  (~22s cap); `get_transactions`, `get_account_holdings`, and `calc_isa_tax_status` render
  a ⚠️ "results may be incomplete — narrow the date range" warning instead of silently
  dropping rows. `get_account_balance` is unaffected (its totals are page-1 account-wide
  fields, not sums of the paginated array).
