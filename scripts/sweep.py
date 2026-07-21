#!/usr/bin/env python3
"""Full read-only tool-layer regression sweep over stdio.

Spawns the built server (`node dist/index.js`) once and calls every registered
tool through the MCP tool layer — including signal/period variants and
response-chained calls (watchlist group, theme code) — with per-call
rate-limit spacing. Prints a result matrix.

This is a manual regression check for after adding/changing tools. It is NOT
wired into CI (it needs live credentials in `.env` and hits the Kiwoom API).
Every call is read-only in both modes.

Usage:
    npm run build && python3 scripts/sweep.py     # VIRTUAL only (default)
    python3 scripts/sweep.py --real               # explicitly allow REAL mode

Exit code: 0 when every call matches expectation (ok, or a known mock
limitation like kt00015 on VIRTUAL), 1 on any unexpected error.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

PROJ = Path(__file__).resolve().parents[1]
DIST = PROJ / "dist" / "index.js"
CALL_INTERVAL_S = 1.2  # Kiwoom rate limit is ~1 req/s per TR; stay under it

# Tools whose failure is EXPECTED on VIRTUAL (mockapi does not serve kt00015).
EXPECTED_MOCK_ERRORS = {"get_transactions"}


def read_mode() -> str:
    """KIWOOM_MODE from the environment, falling back to the project .env."""
    mode = os.environ.get("KIWOOM_MODE", "")
    if not mode:
        env_file = PROJ / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.strip().startswith("KIWOOM_MODE="):
                    mode = line.split("=", 1)[1].strip()
    return mode or "VIRTUAL"  # server default


def main() -> int:
    if not DIST.exists():
        print(f"dist/index.js not found — run `npm run build` first ({DIST})")
        return 1

    mode = read_mode()
    if mode == "REAL" and "--real" not in sys.argv:
        print("KIWOOM_MODE=REAL — refusing to sweep a live account without --real.")
        print("(All calls are read-only, but be deliberate: rerun with --real.)")
        return 1
    print(f"mode: {mode}")

    proc = subprocess.Popen(
        ["node", str(DIST)],
        cwd=PROJ,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )
    next_id = 0

    def rpc(method: str, params=None):
        nonlocal next_id
        next_id += 1
        msg = {"jsonrpc": "2.0", "id": next_id, "method": method}
        if params is not None:
            msg["params"] = params
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        while True:
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError("server closed stdout")
            try:
                m = json.loads(line)
            except json.JSONDecodeError:
                continue
            if m.get("id") == next_id:
                return m

    rpc("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "sweep", "version": "0"},
    })
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    proc.stdin.flush()

    tools = [t["name"] for t in rpc("tools/list")["result"]["tools"]]
    has_isa = "calc_isa_tax_status" in tools
    print(f"tools/list: {len(tools)} tools | ISA tool registered: {has_isa}")
    print("(calc_isa_tax_status is never called by the sweep — kt00015-dependent and heavy)\n")

    results = []  # (tool, expected, first_line)
    ctx = {}

    def call(name: str, args: dict):
        r = rpc("tools/call", {"name": name, "arguments": args})["result"]
        text = r["content"][0]["text"] if r.get("content") else ""
        is_err = bool(r.get("isError"))
        first = text.splitlines()[0][:90] if text else "(empty)"
        expected = (not is_err) or (mode == "VIRTUAL" and name in EXPECTED_MOCK_ERRORS)
        results.append((name, is_err, expected, first))
        time.sleep(CALL_INTERVAL_S)
        return text, is_err

    # (tool, args) — None args are filled from earlier responses (chaining).
    plan = [
        ("ping", {}),
        ("search_stock", {"query": "삼성전자"}),
        ("get_stock_price", {"stock_code": "005930"}),
        ("get_stock_chart", {"stock_code": "005930", "period": "day"}),
        ("get_stock_chart", {"stock_code": "005930", "period": "minute", "minute_scope": "5"}),
        ("get_stock_chart", {"stock_code": "005930", "period": "year"}),
        ("get_stock_chart", {"stock_code": "005930", "period": "tick", "tick_scope": "30"}),
        ("get_orderbook", {"stock_code": "005930"}),
        ("get_market_index", {"market": "kospi"}),
        ("get_sector_price", {"sector_code": "001"}),
        ("get_sector_stocks", {"sector_code": "101", "limit": 5}),
        ("get_sector_chart", {"sector_code": "001"}),  # ka20006 일봉
        ("get_sector_chart", {"sector_code": "101", "period": "minute", "count": 5}),  # ka20005
        ("get_ranking", {"type": "volume", "top": 5}),
        ("get_market_movers", {"signal": "new_high", "top": 3}),
        ("get_market_movers", {"signal": "new_low", "top": 3}),
        ("get_market_movers", {"signal": "upper_limit", "top": 3}),
        ("get_market_movers", {"signal": "lower_limit", "top": 3}),
        ("get_market_movers", {"signal": "surge", "top": 3}),
        ("get_market_movers", {"signal": "plunge", "top": 3}),
        ("get_vi_stocks", {"top": 5}),  # ka10054
        ("get_investor_trend", {"stock_code": "005930"}),
        ("get_investor_rank", {"limit": 5}),  # ka90009 최근 거래일
        ("get_investor_rank", {"view": "streak", "limit": 5}),  # ka10131 코스피 5일
        ("get_broker_activity", {"stock_code": "005930"}),  # ka10002
        ("get_etf_info", {"stock_code": "069500"}),
        ("get_etf_info", {"stock_code": "005930"}),  # non-ETF guard path (shared ka40002 discriminator)
        ("get_etf_returns", {"stock_code": "069500"}),
        ("get_etf_returns", {"stock_code": "005930"}),  # non-ETF guard path (ka40002 gate)
        ("get_short_selling", {"stock_code": "005930"}),
        ("get_stock_lending", {}),  # ka10068 market-wide
        ("get_stock_lending", {"stock_code": "005930"}),  # ka20068 per-stock
        ("get_foreign_holding", {"stock_code": "005930", "limit": 5}),
        ("get_program_trading", {"top": 5}),  # ka90003 — pre-market may be an empty-state ok
        ("get_watchlist_groups", {}),
        ("get_watchlist", None),
        ("get_theme_groups", {"limit": 5}),
        ("get_theme_stocks", None),
        ("get_account_balance", {}),
        ("get_account_holdings", {}),
        ("get_transactions", {}),
        ("get_pending_orders", {}),
        ("get_trading_journal", {}),
    ]

    for name, args in plan:
        if name == "get_watchlist" and args is None:
            group = ctx.get("group")
            if not group:
                results.append((name, False, True, "SKIPPED: no watchlist group to chain"))
                continue
            args = {"group": group}
        if name == "get_theme_stocks" and args is None:
            args = {"theme_code": ctx.get("theme", "100")}
        try:
            text, is_err = call(name, args)
        except Exception as exc:  # noqa: BLE001 — report and continue the sweep
            results.append((name, True, False, f"EXCEPTION {exc}"))
            continue
        if name == "get_watchlist_groups" and not is_err:
            m = re.search(r"\b(\d{1,4})\b", text.replace("[모의투자]", "").replace("[실전투자]", ""))
            if m:
                ctx["group"] = m.group(1)
        if name == "get_theme_groups" and not is_err:
            m = re.search(r"\b(\d{3})\b", text)
            if m:
                ctx["theme"] = m.group(1)

    print(f"{'tool':26s} {'result':10s} first line")
    print("-" * 110)
    unexpected = 0
    for name, is_err, expected, first in results:
        if is_err and expected:
            flag = "err(exp)"
        elif is_err:
            flag = "ERR"
            unexpected += 1
        else:
            flag = "ok"
        print(f"{name:26s} {flag:10s} {first}")
    print(f"\ncalls={len(results)} unexpected_errors={unexpected}")

    proc.stdin.close()
    proc.terminate()
    return 1 if unexpected else 0


if __name__ == "__main__":
    sys.exit(main())
