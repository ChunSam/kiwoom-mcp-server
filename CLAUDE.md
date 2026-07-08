# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Read-only MCP server (stdio transport) exposing the Kiwoom Securities REST API to Claude
Desktop/Code: market data (search/quote/chart/orderbook/index/ranking/investor trend/ETF/theme/
short-selling/foreign-holding) + HTS watchlist (read-only) + account inquiry (balance/holdings/
transactions/pending orders/trading journal) + an ISA tax-allowance calculator.
Built to be reusable by third parties; the ISA tool is an optional extra on top of the
generic core. **Order execution (buy/sell/modify/cancel) is out of scope by design** — do
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

## Architecture

- `src/index.ts` — entry point; connects `StdioServerTransport` only. **stdout is reserved
  for MCP protocol frames; all logging must use `console.error` (stderr)** or the client
  breaks.
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
  (`scanDividends`) is unverified until a real dividend arrives — the tool exposes a
  `dividends_received` manual input for that reason.
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
  kt00001/kt00018 are not ISA-specific. Only `calc_isa_tax_status` needs the ISA envs.
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
  no Kiwoom REST TR; 실시간/조건검색 are WebSocket-only).
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
