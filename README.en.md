# kiwoom-mcp-server

[한국어](README.md) · **English**

A **read-only** MCP server that exposes the Kiwoom Securities REST API.
From Claude Desktop / Claude Code you can query Korean stock quotes, charts,
order books, indices, rankings, and investor trends in natural language, along
with your account's balance, holdings, and transaction history. For an ISA
account it also computes your realized-gain aggregation against the tax-free
allowance.

> ⚠️ **Security notice**
>
> - The default run mode is **local stdio**. If you need remote access, expose the
>   server only through the authenticated HTTP mode (see
>   [Remote access](#remote-access-http-mode--claudeai-webmobile)) — never open it
>   to an external network without auth (`--no-auth`).
> - The AppKey/AppSecret in `.env` grant real-account inquiry access. **Never
>   commit them** (`.env` is already in `.gitignore`).
> - Order execution (buy/sell/modify/cancel) is **excluded by design**. This
>   server never changes your account.

## Tools

**Market data** (account-independent — an app key is enough):

| Tool | Description | Kiwoom TR |
|---|---|---|
| `search_stock` | Name → code search (KOSPI/KOSDAQ, incl. ETF/ETN) + trading-caution flags | ka10099 |
| `get_stock_price` | Current price / change rate / volume / basic metrics + sector, listing date, caution flags | ka10001, ka10099 |
| `get_stock_quotes` | Batch quotes for up to 30 stocks in one call — price, change, volume, value, market cap | ka10095, ka10099 |
| `get_stock_chart` | Daily/weekly/monthly/yearly/minute/tick candles (adjusted price) | ka10079~83, ka10094 |
| `get_orderbook` | 10-level ask/bid quotes and sizes | ka10004 |
| `get_market_index` | KOSPI/KOSDAQ composite and sector indices | ka20003 |
| `get_sector_price` | Sector index detail (breadth / 52-week range / intraday trend) | ka20001 |
| `get_sector_stocks` | Member stocks of a sector with quotes | ka20002 |
| `get_sector_chart` | Sector index candles (daily/weekly/monthly/yearly/minute/tick) | ka20004~08, ka20019 |
| `get_ranking` | Top gainers / losers / volume / trading value | ka10027/30/32 |
| `get_market_movers` | New highs / new lows / upper & lower limit / surges / plunges | ka10016/17/19 |
| `get_vi_stocks` | Today's volatility-interruption (VI) triggered stocks (trigger price / disparity / times) | ka10054 |
| `get_investor_trend` | Retail / foreign / institutional net-buy trend (period sum + daily) | ka10059, ka10061 |
| `get_investor_rank` | Top stocks net-bought/sold by foreigners & institutions / N-day buying streaks | ka90009, ka10131 |
| `get_broker_activity` | Per-stock top-5 buying/selling brokers (member firms) | ka10002 |
| `get_etf_info` | ETF tracking index / tax type / quote / NAV & disparity | ka40002, ka10001, ka40009 |
| `get_etf_returns` | ETF period returns (1w/1m/6m/1y) vs a benchmark index | ka40001 |
| `get_short_selling` | Per-stock daily short-selling trend (short volume / weight / avg price) | ka10014 |
| `get_stock_lending` | Securities-lending trend (contracted / repaid / change / balance) — per stock or market-wide | ka10068, ka20068 |
| `get_foreign_holding` | Per-stock foreign holding trend (holdings / holding weight / limit-usage rate) | ka10008 |
| `get_program_trading` | Today's top program-trading net buys / sells (KOSPI/KOSDAQ) | ka90003 |

**Watchlist** (interest-stock groups saved in the 영웅문 HTS client — read-only):

| Tool | Description | Kiwoom TR |
|---|---|---|
| `get_watchlist_groups` | List of saved watchlist groups (code + name) | ka01300 |
| `get_watchlist` | Stocks in a group (enriched with name / prev close / market / caution flags) | ka01301, ka10099 |

> The Kiwoom REST API exposes no watchlist **edit** (add/remove) TR — read-only.

**Theme**:

| Tool | Description | Kiwoom TR |
|---|---|---|
| `get_theme_groups` | Theme groups (change rate / stock count / period return / lead stocks; find a stock's themes) | ka90001 |
| `get_theme_stocks` | Member stocks of one theme with quotes (price / change / volume / period return) | ka90002 |

**Account** (scoped to the account bound to the app key):

| Tool | Description | Kiwoom TR |
|---|---|---|
| `get_account_balance` | Deposit + total valuation / total P&L / estimated deposit assets + day/month/cumulative P&L | kt00001, kt00018, kt00004 |
| `get_account_holdings` | Per-holding quantity / average cost / current price / valuation P&L | kt00018 |
| `get_transactions` | Transaction history for a period (trade date, unit price, settlement amount) | kt00015 |
| `get_pending_orders` | Open/unfilled orders (order no., side, status, ordered/unfilled qty, price) | ka10075 |
| `get_trading_journal` | The day's trading journal (per-stock buy/sell avg price, qty, realized P&L, totals) | ka10170 |
| `calc_isa_tax_status` | ISA aggregated net gain vs. the tax-free allowance (realized + full-liquidation scenario) | kt00015, ka10074, kt00018 |

Plus `ping` (connectivity check, no app key needed). Every response is prefixed
with `[모의투자]` (VIRTUAL) / `[실전투자]` (REAL) so you can tell which server
answered. The first `search_stock` call downloads the stock master (~4,300
symbols), takes a few seconds, and is then cached for 12 hours.

### Notes on `calc_isa_tax_status`

- Aggregation start date: `ISA_OPENED_ON` (account opening date) in `.env` is the
  default; override per call with `from_date`.
- If dividends/distributions are not auto-detected from the transaction history,
  enter them manually via the `dividends_received` argument.
- A stock's tax type (taxable vs. domestic-equity) is classified automatically —
  for ETFs from Kiwoom's own `etftxon_type` (ka40002), otherwise by a name-based
  heuristic. Correct a wrong classification with
  `overrides: [{stock_code, tax_type}]`. Results are for reference only — actual
  taxation follows the broker's settlement.

## Requirements

- **Node.js 20.12 or later** (uses `process.loadEnvFile`)
- A Kiwoom Securities REST API app key — register an app at the
  [Kiwoom Open API portal](https://openapi.kiwoom.com) to obtain one.
  - VIRTUAL (paper trading) and REAL use **separately issued app keys**; the key
    type must match `KIWOOM_MODE`.
  - The account is bound to the app key, so no account number is required.

## Install

The package is published to npm, so you can **run it with `npx` — no clone
required**; just use the npx config in "Connecting Claude Desktop" / "Connecting
Claude Code" below. In that case you pass your app key via the **client config's
`env` block** instead of a `.env` file (examples in each connection section).

To build from source or modify the code:

```sh
git clone <this repo URL>    # or copy the source
cd kiwoom-mcp-server
npm install
cp .env.example .env         # fill in the values per the table below
npm run build                # produces dist/
npm test                     # unit tests (no network required)
```

## Environment variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `KIWOOM_APP_KEY` | ✅ | Kiwoom REST API app key |
| `KIWOOM_APP_SECRET` | ✅ | Kiwoom REST API app secret |
| `KIWOOM_MODE` | | `VIRTUAL` (paper trading, default) or `REAL` (live trading) |
| `ISA_ENABLED` | | `true` registers the `calc_isa_tax_status` tool. Default `false` (general-account-first) |
| `ISA_TYPE` | | `GENERAL` (general, 2,000,000 KRW limit, default) or `SEOMIN` (low-income/farmer-fisher, 4,000,000 KRW). Only used when `ISA_ENABLED=true` |
| `ISA_OPENED_ON` | | ISA account opening date `yyyy-MM-dd` — default aggregation start for `calc_isa_tax_status`. Only used when `ISA_ENABLED=true` |
| `MCP_TRANSPORT` | | `stdio` (default) or `http` — see [Remote access](#remote-access-http-mode--claudeai-webmobile) |
| `MCP_AUTH_TOKEN` | HTTP mode ✅ | Bearer token every `/mcp` request must present in HTTP mode |
| `MCP_HTTP_PORT` | | HTTP-mode port (default `8000`) |
| `MCP_HTTP_HOST` | | HTTP-mode bind address (default `127.0.0.1`) |
| `MCP_HTTP_NO_AUTH` | | `true` allows starting HTTP mode without auth (discouraged — see the security notes below) |

The default is **general-account-first**: without extra config, only the market-data
and account-inquiry tools are exposed. To use the tax-free-limit tool on an ISA
account, set `ISA_ENABLED=true` and fill in `ISA_TYPE`/`ISA_OPENED_ON`. When off,
`calc_isa_tax_status` is not registered and every other tool still works.

`.env` is resolved from the project root first, so the server works even when
launched from an arbitrary working directory (as Claude Desktop does).

## Connecting Claude Desktop

Config file location:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**npx (published) — no clone; pass your app key via the `env` block:**

```json
{
  "mcpServers": {
    "kiwoom": {
      "command": "npx",
      "args": ["-y", "kiwoom-mcp-server"],
      "env": {
        "KIWOOM_APP_KEY": "…",
        "KIWOOM_APP_SECRET": "…",
        "KIWOOM_MODE": "REAL"
      }
    }
  }
}
```

**From source — run `dist/index.js` directly; app key from the project-root `.env`:**

```json
{
  "mcpServers": {
    "kiwoom": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/kiwoom-mcp-server/dist/index.js"]
    }
  }
}
```

> **Prefer the absolute path to the executable** (find it with `which node` or
> `which npx`). GUI apps do not inherit your shell `PATH`, so a bare `"node"` /
> `"npx"` can make the server silently fail to start — the single most common
> failure.

After saving, fully quit Claude Desktop (⌘Q on macOS) and relaunch to see the
tools. **After every `npm run build` rebuild you must fully quit and relaunch
again** for the change to take effect.

## Connecting Claude Code

npx (published) — pass your app key via `-e` flags:

```sh
claude mcp add kiwoom \
  -e KIWOOM_APP_KEY=… -e KIWOOM_APP_SECRET=… -e KIWOOM_MODE=REAL \
  -- npx -y kiwoom-mcp-server
```

From source — app key from the project-root `.env`:

```sh
claude mcp add kiwoom -- node /absolute/path/kiwoom-mcp-server/dist/index.js
```

## Remote access (HTTP mode) — claude.ai web/mobile

claude.ai **custom connectors** (web/mobile) cannot attach to a local stdio server;
they need a **Streamable HTTP** MCP server reachable over public HTTPS. Start this
server in HTTP mode with the `--http` flag (or `MCP_TRANSPORT=http`):

```sh
MCP_AUTH_TOKEN="$(openssl rand -hex 32)" npx -y kiwoom-mcp-server --http --port 8000
# endpoint: http://127.0.0.1:8000/mcp · health check: /healthz
```

- **Auth is required by default.** Without `MCP_AUTH_TOKEN` the server refuses to
  start — every `/mcp` request must carry `Authorization: Bearer <token>`. To run
  without auth you must pass `--no-auth` explicitly; the account-inquiry tools are
  then exposed as-is, so do that only on a trusted network or with a paper-trading
  key (`KIWOOM_MODE=VIRTUAL`).
- The default bind is `127.0.0.1`, assuming a tunnel in front. To expose directly
  (container/VPS), opt in with `--host 0.0.0.0`.
- Get a public HTTPS URL with e.g. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):
  `cloudflared tunnel --url http://localhost:8000` (ephemeral URL — use a named
  tunnel for anything permanent).
- Register on claude.ai under **Settings → Connectors → Add custom connector** with
  `https://<your-domain>/mcp` (leave the OAuth fields in Advanced settings empty).
  On connect, a browser **consent page** opens — enter your `MCP_AUTH_TOKEN` as the
  access password and you are done: the server implements the MCP authorization spec
  (OAuth 2.0 + PKCE with dynamic client registration), so no header configuration is
  needed. A connector added once is available across the web, mobile, and desktop
  clients. Header-capable clients (e.g. Claude Code `--header`) can still use the
  static `Authorization: Bearer <MCP_AUTH_TOKEN>` path. OAuth tokens are persisted
  to `.oauth-state.json` (0600) in the working directory, so restarts don't drop
  the connection.
- ⚠️ **Kiwoom API calls originate from wherever this server runs.** REAL mode is
  bound to Kiwoom's designated-terminal (8050) IP registration, so running it
  outside a registered IP (e.g. in the cloud) can fail auth. Validate remote
  setups with a VIRTUAL key first.

The stdio behavior (Claude Desktop/Code) is unchanged when run without arguments.

## Smoke test

You can verify over stdio without an MCP client:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}' \
  | node dist/index.js
```

`ping` responds without a `.env`. Market-data and account tools need an app key.

## Troubleshooting

| Symptom | Check |
|---|---|
| Tools don't appear in Desktop | Is `command` an **absolute** node path? Did you run `npm run build`? Did you fully quit and relaunch Desktop? |
| `환경설정이 없거나 잘못되었습니다` (config missing/invalid) | Is `.env` in the project root, with the required variables filled in? |
| `키움 인증에 실패했습니다` (auth failed) | Does the app-key type (paper/live) match `KIWOOM_MODE`? Is the app active on the portal? |
| `요청 한도를 초과했습니다` (rate limit) | Kiwoom rate limit (~1 req/s per TR). This means it was still exceeded after the server's automatic retry — wait a moment and retry. |
| Deposit differs from the D+2 estimated deposit | Normal when there are unsettled (D+2) trades. |

## Development

```sh
npm run dev        # run the source directly with tsx
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # tsc → dist/
```

Structure: `src/kiwoom/` (auth / HTTP / TR layer) → `src/tools/` (MCP tools with
formatters split out) → `src/isa/` (tax-type classification / realized-P&L
reconstruction / gain aggregation). See `CLAUDE.md` for detailed rules and the
verified API contract.

## License

[MIT](LICENSE)
