#!/usr/bin/env python3
"""라우팅 감사 — 모델이 카탈로그만 보고 옳은 tool을 고르는가.

이 저장소의 다른 감시는 전부 **"tool이 옳은 답을 내는가"**를 본다. 스윕(`sweep.py`)은
tool을 이름으로 직접 부르고, 포맷터 테스트는 description을 렌더조차 하지 않는다. 그래서
**모델이 tool을 고르는 근거**(description·`.describe()`)는 어느 게이트에도 안 걸린다 —
문구가 통째로 틀려도 넷 다 초록이다.

2026-08-19에 처음 쟀다(모델 3종 × 사용자 질문 52개, Opus·Sonnet 51/52 · Haiku 46/52).
**오답 2건이 둘 다 "없는 것을 없다고 안 적어서"**였다 — 배당수익률이 없다는 사실이
`get_stock_price` description에 없었고, `get_order_executions`의 조회 범위 제한은
**빈 결과 각주에만** 있어 모델이 볼 수 없었다(v0.52.4에서 고쳤다). 그때는 손 절차라
카탈로그 변환도 채점도 매번 즉석이었고 결과가 `plans/`(gitignore)에만 남았다.
이 스크립트가 그 절차다.

무엇을 재고 무엇을 안 재나 — **적용 범위를 좁혀 적는다**:
  - 잰다: `tools/list` 응답만 보고 고른 **tool 이름**과, 정답표가 지목한 **파라미터 몇 개**.
  - 안 잰다: 그 tool이 실제로 옳은 값을 내는지(그건 `sweep.py`), 응답 렌더(그건 포맷터 테스트),
    여러 tool을 엮는 다단 계획. 질문 하나당 호출 하나가 이 시험의 단위다.

사용:
    npm run build && python3 scripts/routing.py            # haiku·sonnet·opus 세 등급
    python3 scripts/routing.py --models haiku              # 빠른 회귀 — 결함은 여기서 먼저 드러난다
    python3 scripts/routing.py --grade-only <dir>          # 저장된 답안 재채점 (모델을 안 부른다)
    python3 scripts/routing.py --catalog-only              # 카탈로그만 뜬다 (시험지 눈으로 볼 때)

산출물은 `plans/testing/routing_<날짜>/`(gitignore)에 남고, 되풀이에 필요한 것
(질문·정답표)만 `scripts/routing/`에 커밋돼 있다.

exit code: **MISS(다른 tool을 골랐다) + PARAM(정답표가 지목한 파라미터가 어긋남) +
PRE(측정 불가)가 0이면 0**, 하나라도 있으면 1. PARAM도 회귀로 세는 이유는 정답표가 **파라미터 선택 자체가 쟁점인 자리에만**
`param_check`를 달아 두기 때문이다 — q20의 `to_date: __ABSENT__`는 v0.52.3이 describe로 고친
바로 그 자리라, 여기가 다시 깨지면 그건 관찰이 아니라 회귀다.
낮은 confidence·alternative는 회귀가 아니라 **다음 라운드의 후보 목록**이다 —
2026-08-19에 실제로 고친 description 9곳 중 7곳이 오답이 아니라 거기서 나왔다.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJ = Path(__file__).resolve().parents[1]
DIST = PROJ / "dist" / "index.js"
DATA = PROJ / "scripts" / "routing"
KST = timezone(timedelta(hours=9))

# 정답표가 "이 서버로는 못 한다"를 뜻할 때 쓰는 가짜 tool 이름. 카탈로그에 없는 게 정상이다.
NONE_TOOL = "NONE"

DEFAULT_MODELS = ["haiku", "sonnet", "opus"]

# 시험지를 푸는 쪽은 **소스를 못 보는 별도 프로세스**여야 한다 — 소스를 읽은 사람(또는
# 이 저장소를 cwd로 둔 에이전트)이 고르면 시험이 자기를 채점한다. 빈 임시 디렉터리를
# cwd로 주고(프로젝트 CLAUDE.md 자동 로드까지 끊긴다), 파일 도구와 MCP 서버를 전부 막는다.
BLOCKED_TOOLS = "Bash Read Write Edit Glob Grep WebFetch WebSearch Task NotebookEdit"


def die(msg):
    print(f"✗ {msg}", file=sys.stderr)
    raise SystemExit(1)


# ── 카탈로그 ───────────────────────────────────────────────────────────────


def newest_src_mtime():
    return max((p.stat().st_mtime for p in (PROJ / "src").rglob("*.ts")), default=0)


def dump_catalog():
    """`dist/index.js`를 stdio로 띄워 `tools/list` 응답을 그대로 받는다.

    **모델이 실제로 보는 것과 같은 카탈로그**여야 시험이 의미가 있다 — description을
    소스에서 긁어 오면 zod가 붙이는 파라미터 스키마가 빠져 시험지가 실물과 달라진다.
    """
    if not DIST.exists():
        die("dist/index.js가 없습니다 — `npm run build` 먼저")
    if newest_src_mtime() > DIST.stat().st_mtime:
        # description을 고치고 빌드를 잊으면 **옛 문구로 시험을 봐 놓고 초록**이 된다.
        # 고친 자리를 재는 게 목적인 검사라 이건 조용한 오판정이다.
        die("src가 dist보다 새롭습니다 — `npm run build` 먼저 (낡은 카탈로그로 채점하면 고친 문구가 아니라 옛 문구를 잽니다)")

    env = dict(os.environ)
    env["KIWOOM_MODE"] = "VIRTUAL"  # 크리덴셜은 필요 없다 — tools/list는 지연 검증 앞이다
    env["ISA_ENABLED"] = "false"  # 시험지가 로컬 .env에 따라 달라지면 안 된다(ISA tool은 opt-in)

    proc = subprocess.Popen(
        ["node", str(DIST)],
        cwd=PROJ,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
        env=env,
    )

    def send(obj):
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()

    def read_id(want):
        while True:
            line = proc.stdout.readline()
            if not line:
                die("서버가 응답 없이 닫혔습니다")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue  # stdout은 MCP 프레임 전용이지만 방어적으로 흘린다
            if msg.get("id") == want:
                return msg

    try:
        send(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "routing-audit", "version": "0"},
                },
            }
        )
        read_id(1)
        send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        tools = read_id(2)["result"]["tools"]
    finally:
        proc.stdin.close()
        proc.terminate()
    return tools


def param_type(spec):
    """JSON Schema 조각을 사람이 읽는 타입 한 조각으로. enum은 값 목록이 곧 타입이다."""
    if "enum" in spec:
        return "|".join(str(v) for v in spec["enum"])
    if "anyOf" in spec:
        return "|".join(param_type(s) for s in spec["anyOf"])
    return spec.get("type", "?")


def render_catalog_md(tools):
    out = [
        f"# Kiwoom MCP 서버 tool 카탈로그 ({len(tools)}개)",
        "",
        "MCP `tools/list`가 실제로 내보내는 것 그대로다. 이 문서 밖의 정보는 없다.",
        "",
    ]
    for t in tools:
        out += [f"## {t['name']}", "", t.get("description", "").strip(), ""]
        schema = t.get("inputSchema") or {}
        props = schema.get("properties") or {}
        required = set(schema.get("required") or [])
        if props:
            out.append("입력 파라미터:")
            for name, spec in props.items():
                flag = "필수" if name in required else "선택"
                desc = (spec.get("description") or "").strip()
                out.append(f"- `{name}` ({flag}) ({param_type(spec)}): {desc}")
            out.append("")
    return "\n".join(out).rstrip() + "\n"


# ── 시험지 ─────────────────────────────────────────────────────────────────

# `pre`를 따로 받는 이유: 종목명만 준 질문에서 `search_stock`만 답하면 **정작 재려던 2차
# 선택이 통째로 안 잡힌다.** 2026-08-19 채점기는 그걸 "선행(허용)"으로 넘겼는데, 그러면
# 모든 종목명 질문에 search_stock을 답한 모델이 **MISS 0으로 초록**이 된다 — 시험이
# 조용히 15문항 작아지는 가짜 감시다. 선행은 `pre`에 적고 답은 반드시 `tool`에 적게 한다.
PROMPT = """너는 MCP 클라이언트의 라우터다. 아래 카탈로그에 있는 tool만 부를 수 있고,
카탈로그 밖의 지식(이 서버의 소스 코드·내부 구현)은 없다고 가정한다.

질문 각각에 대해 **어느 tool을 부를지**와 **넘길 파라미터**를 정한다.

규칙:
- 파라미터는 실제로 넘길 것만 적는다. **기본값을 그대로 쓸 거면 생략**한다.
- 종목코드를 몰라 `search_stock`을 먼저 불러야 하면 그 이름을 `pre`에 적고,
  **`tool`에는 코드를 얻은 뒤 부를 tool**을 적는다. `tool`을 `search_stock`으로 채우지 않는다
  (질문 자체가 종목코드를 묻는 경우만 예외다).
- 카탈로그로 답할 수 없는 질문이면 `tool`에 "NONE"을 적는다.
- 질문 하나당 tool 하나. 여러 개가 필요하면 가장 중심이 되는 하나를 고르고 나머지는 why에 적는다.

출력은 **JSON 배열 하나만**. 설명 문장도 코드펜스도 붙이지 않는다. 형식:
[{{"q":1,"tool":"get_stock_price","params":{{"stock_code":"005930"}},"pre":null,"confidence":"high","alternative":null,"why":"한 줄 근거"}}]

confidence는 high|medium|low 셋 중 하나. 진짜로 갈리는 다른 후보가 있으면 그 tool 이름을
alternative에, 없으면 null.

---

{catalog}

---

{questions}
"""


def build_prompt(catalog_md, questions_md):
    return PROMPT.format(catalog=catalog_md, questions=questions_md)


def extract_json_array(text):
    """모델이 코드펜스나 인사말을 붙여도 배열만 건져 낸다. 실패하면 None."""
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.S)
    body = fenced.group(1) if fenced else text
    start, end = body.find("["), body.rfind("]")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(body[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


def exam_model_id(model_usage, requested):
    """실제로 시험을 본 모델을 `modelUsage`에서 고른다.

    첫 키를 쓰면 안 된다 — CLI가 제목 생성 같은 곁일에 haiku를 같이 쓰므로 sonnet·opus
    실행에도 haiku가 섞여 들어오고, 2026-08-20 첫 실행에서 세 등급이 전부
    `claude-haiku-4-5`로 찍혔다. 출력 토큰 최대값도 못 쓴다 — 짧은 응답에서는 곁일이
    이긴다(실측: sonnet 3토큰 vs 곁일 haiku 14토큰). 요청한 이름으로 맞추고, 그래도
    안 갈리면 출력이 가장 많은 쪽으로 떨어진다.
    """
    if not model_usage:
        return requested
    matched = [k for k in model_usage if requested.lower() in k.lower()]
    pool = matched or list(model_usage)
    return max(pool, key=lambda k: model_usage[k].get("outputTokens", 0))


def ask_model(model, prompt, workdir, out_dir, timeout_s):
    """소스·MCP·파일 도구를 막은 별도 `claude` 프로세스에 시험지를 준다.

    반환: (답안 리스트, 메타). 파싱이 두 번 다 실패하면 하드 에러다 — 빈 답안을
    조용히 채점하면 무응답이 MISS로 세어져 **문구 회귀와 구분이 안 된다.**
    """
    claude = shutil.which("claude")
    if not claude:
        die("claude CLI를 찾지 못했습니다 — 답안 채점만 하려면 --grade-only를 쓰세요")

    cmd = [
        claude,
        "-p",
        prompt,
        "--model",
        model,
        "--output-format",
        "json",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--disallowed-tools",
        BLOCKED_TOOLS,
        "--no-session-persistence",
    ]

    for attempt in (1, 2):
        proc = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=timeout_s)
        if proc.returncode != 0:
            die(f"{model}: claude가 rc={proc.returncode}로 끝났습니다\n{proc.stderr[-2000:]}")
        try:
            envelope = json.loads(proc.stdout)
        except json.JSONDecodeError:
            die(f"{model}: --output-format json인데 JSON이 아닙니다\n{proc.stdout[:500]}")
        if envelope.get("is_error"):
            die(f"{model}: {envelope.get('result', '')[:500]}")

        # 원문을 먼저 남긴다 — 파싱이 실패해도 무엇을 답했는지 볼 수 있어야 한다.
        (out_dir / f"raw_{model}.json").write_text(json.dumps(envelope, ensure_ascii=False, indent=1), encoding="utf-8")

        answers = extract_json_array(envelope.get("result", ""))
        meta = {
            "model": exam_model_id(envelope.get("modelUsage"), model),
            "cost_usd": envelope.get("total_cost_usd"),
            "duration_ms": envelope.get("duration_ms"),
            # 도구를 막았는데도 뭔가 부르려 했다면 시험 조건이 흔들린 것이다 — 세어서 보고한다.
            "permission_denials": len(envelope.get("permission_denials") or []),
        }
        if answers is not None:
            return answers, meta
        print(f"  ⚠️  {model}: 답안에서 JSON 배열을 못 찾았습니다 (시도 {attempt}/2)", file=sys.stderr)
    die(f"{model}: 두 번 다 JSON 파싱 실패 — 원문은 raw_{model}.json에 있습니다")


# ── 채점 ───────────────────────────────────────────────────────────────────

# "이 파라미터를 넘기면 안 된다"를 뜻한다. 기본값이 있는 자리를 모델이 굳이 채우면
# 동작이 갈리는 tool이 있다(`get_stock_lending`의 to_date는 넘기는 순간 자동 후퇴가 꺼진다).
ABSENT = "__ABSENT__"

# 선행 조회(`search_stock`)로 채워질 자리 — 답안이 `pre`를 선언했으면 **아직 값이 없는 게
# 정상**이다. 2026-08-20 첫 실행에서 q38(삼성전자 거래원)이 이것 때문에 PARAM으로 잡혔다:
# 모델은 `pre="search_stock"` + `params={}`로 옳게 답했는데 정답표는 코드 리터럴을 기대했다.
# 종목 지정(q38)과 시장 전체(q39)의 구분은 그대로 살아 있다 — 후자는 `__ABSENT__`로 재고,
# 선행 선언 없이 코드를 비운 답안은 여기서 걸린다.
PRE_FILLED_PARAMS = {"stock_code"}


def load_key():
    key = json.loads((DATA / "key.json").read_text(encoding="utf-8"))
    questions = {}
    for line in (DATA / "questions.md").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^(\d+)\.\s+(.*)$", line.strip())
        if m:
            questions[m.group(1)] = m.group(2)
    missing = sorted(set(key) - set(questions), key=int)
    extra = sorted(set(questions) - set(key), key=int)
    if missing or extra:
        # 질문만 늘리고 정답표를 안 고치면 그 문항이 채점에서 통째로 빠진다 — 시험이 조용히 작아진다.
        die(f"questions.md와 key.json이 어긋납니다 — 정답표에만 있는 문항 {missing}, 질문에만 있는 문항 {extra}")
    return key, questions


def grade_one(answers, key):
    """판정 넷: OK / PARAM(tool은 맞고 파라미터가 어긋남) / MISS(다른 tool) / PRE(측정 불가)."""
    got_by_q = {str(a.get("q")): a for a in answers if isinstance(a, dict)}
    rows = []
    for q in sorted(key, key=int):
        k, a = key[q], got_by_q.get(q)
        if a is None:
            rows.append({"q": q, "status": "MISS", "note": "무응답", "alt": "", "conf": ""})
            continue
        tool = a.get("tool")
        alt = a.get("alternative") or ""
        conf = a.get("confidence") or ""
        allowed = {k["tool"], *k.get("also_ok", [])}
        if tool != k["tool"] and tool == "search_stock" and k.get("pre_ok"):
            # 2026-08-19 답안 형식(선행을 tool 자리에 적던 시절)과의 호환. 채점은 못 하되
            # OK로 세지 않는다 — 이걸 정답으로 세면 모든 종목명 질문을 search_stock으로
            # 답한 모델이 MISS 0을 받는다.
            rows.append({"q": q, "status": "PRE", "note": "search_stock만 답해 2차 선택을 못 잰다", "alt": alt, "conf": conf})
            continue
        if tool not in allowed:
            rows.append({"q": q, "status": "MISS", "note": f"{tool} (정답 {k['tool']})", "alt": alt, "conf": conf})
            continue
        bad = []
        given = a.get("params") or {}
        declared_pre = bool(a.get("pre"))
        for name, expected in (k.get("param_check") or {}).items():
            if expected == ABSENT:
                if name in given:
                    bad.append(f"{name}를 넘겼다({given[name]}) — 넘기지 말아야 한다")
            elif name in PRE_FILLED_PARAMS and declared_pre and k.get("pre_ok") and name not in given:
                continue
            elif str(given.get(name, "")).strip().lower() != str(expected).lower():
                bad.append(f"{name}={given.get(name, '없음')} (기대 {expected})")
        rows.append({"q": q, "status": "PARAM" if bad else "OK", "note": "; ".join(bad), "alt": alt, "conf": conf})
    return rows


def summarize(rows):
    counts = {"OK": 0, "PARAM": 0, "MISS": 0, "PRE": 0}
    for r in rows:
        counts[r["status"]] += 1
    return counts


def report(graded, questions, metas):
    """모델별 판정을 한 표로. 어긋난 문항은 바로 아래에 사유를 편다."""
    tags = list(graded)
    lines = []
    head = f"{'q':>3} {'질문':38s} " + " ".join(f"{t:22s}" for t in tags)
    lines += [head, "-" * len(head)]
    for i, q in enumerate(sorted(questions, key=int)):
        cells, flagged = [], False
        for t in tags:
            r = graded[t][i]
            if r["status"] != "OK":
                flagged = True
            mark = {"OK": "ok", "MISS": "MISS", "PARAM": "PARAM", "PRE": "pre"}[r["status"]]
            if r["conf"]:
                mark += f"/{r['conf'][:1]}"
            if r["alt"] and r["status"] == "OK":
                mark += f"(alt:{r['alt'].replace('get_', '')[:10]})"
            cells.append(mark[:22].ljust(22))
        lines.append(f"{q:>3} {questions[q][:36]:38s} " + " ".join(cells))
        if flagged:
            for t in tags:
                r = graded[t][i]
                if r["status"] != "OK":
                    lines.append(f"      └ {t}: {r['status']} — {r['note']}")
    lines.append("")

    # PRE도 초록으로 넘기지 않는다 — 지금 시험지는 선행 조회를 `pre`에 적게 하므로 PRE가 뜬다는
    # 건 답안 형식이 어긋났다는 뜻이고, 그만큼 **시험이 조용히 작아진다**(2026-08-19 형식의
    # 답안을 --grade-only로 다시 채점하면 여기서 걸린다 — 숫자는 그대로 찍히니 읽으면 된다).
    regressions = 0
    for t in tags:
        c = summarize(graded[t])
        regressions += c["MISS"] + c["PARAM"] + c["PRE"]
        meta = metas.get(t) or {}
        extra = ""
        if meta.get("cost_usd") is not None:
            extra = f"  cost=${meta['cost_usd']:.2f}  {meta.get('model', '')}"
        if meta.get("permission_denials"):
            extra += f"  ⚠️ 도구 호출 시도 {meta['permission_denials']}건"
        lines.append(
            f"{t:8s} OK {c['OK']}/{len(graded[t])}  PARAM {c['PARAM']}  MISS {c['MISS']}  pre(측정불가) {c['PRE']}{extra}"
        )

    # 다음 라운드의 후보 목록 — 오답이 아니라 "모델이 헷갈린 자리"다. 2026-08-19에 고친
    # description 9곳 중 7곳이 MISS가 아니라 여기서 나왔다.
    shaky = []
    for q in sorted(questions, key=int):
        i = sorted(questions, key=int).index(q)
        marks = [graded[t][i] for t in tags]
        if any(m["conf"] in ("medium", "low") or m["alt"] for m in marks):
            who = ", ".join(f"{t}:{m['conf'] or '?'}{'/alt=' + m['alt'] if m['alt'] else ''}" for t, m in zip(tags, marks))
            shaky.append(f"  q{q} {questions[q][:34]} — {who}")
    if shaky:
        lines += ["", "확신이 낮거나 후보가 갈린 자리 (다음 라운드 후보):", *shaky]
    return "\n".join(lines), regressions


# ── 실행 ───────────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description="라우팅 감사 — 모델이 카탈로그만 보고 옳은 tool을 고르는가")
    ap.add_argument("--models", default=",".join(DEFAULT_MODELS), help="쉼표로 구분 (기본 haiku,sonnet,opus)")
    ap.add_argument("--out", help="산출물 디렉터리 (기본 plans/testing/routing_<날짜>)")
    ap.add_argument("--grade-only", metavar="DIR", help="그 디렉터리의 answers_*.json을 다시 채점한다 (모델을 안 부른다)")
    ap.add_argument("--catalog-only", action="store_true", help="카탈로그만 뜨고 끝낸다")
    ap.add_argument("--timeout", type=int, default=900, help="모델 한 대당 제한 시간(초)")
    args = ap.parse_args()

    key, questions = load_key()

    if args.grade_only:
        out_dir = Path(args.grade_only)
        files = sorted(out_dir.glob("answers_*.json"))
        if not files:
            die(f"{out_dir}에 answers_*.json이 없습니다")
        graded = {f.stem.replace("answers_", ""): grade_one(json.loads(f.read_text(encoding="utf-8")), key) for f in files}
        text, regressions = report(graded, questions, {})
        print(text)
        raise SystemExit(1 if regressions else 0)

    tools = dump_catalog()
    catalog_md = render_catalog_md(tools)

    out_dir = Path(args.out) if args.out else PROJ / "plans" / "testing" / f"routing_{datetime.now(KST):%Y-%m-%d}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "catalog.json").write_text(json.dumps(tools, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "catalog.md").write_text(catalog_md, encoding="utf-8")
    print(f"카탈로그 tool={len(tools)}개 → {out_dir/'catalog.md'}")

    # 정답표가 가리키는 tool이 카탈로그에 실존하는지 — 이름이 바뀌면 전 문항이 MISS로
    # 쏟아져 "라우팅 회귀"로 오독된다. 실제 원인은 정답표가 낡은 것이다.
    names = {t["name"] for t in tools}
    dangling = sorted({k["tool"] for k in key.values()} | {n for k in key.values() for n in k.get("also_ok", [])})
    dangling = [n for n in dangling if n != NONE_TOOL and n not in names]
    if dangling:
        die(f"정답표가 카탈로그에 없는 tool을 가리킵니다: {', '.join(dangling)} — key.json을 고치세요")

    if args.catalog_only:
        return

    prompt = build_prompt(catalog_md, (DATA / "questions.md").read_text(encoding="utf-8"))
    (out_dir / "prompt.md").write_text(prompt, encoding="utf-8")

    exam_room = out_dir / "examroom"  # 빈 cwd — 여기서 풀게 해야 저장소 파일이 안 보인다
    exam_room.mkdir(exist_ok=True)

    graded, metas = {}, {}
    for model in [m.strip() for m in args.models.split(",") if m.strip()]:
        print(f"  {model} 시험 중…", flush=True)
        answers, meta = ask_model(model, prompt, exam_room, out_dir, args.timeout)
        (out_dir / f"answers_{model}.json").write_text(json.dumps(answers, ensure_ascii=False, indent=1), encoding="utf-8")
        graded[model] = grade_one(answers, key)
        metas[model] = meta

    text, regressions = report(graded, questions, metas)
    print()
    print(text)
    (out_dir / "report.md").write_text(text + "\n", encoding="utf-8")
    print(f"\n산출물 → {out_dir}")
    raise SystemExit(1 if regressions else 0)


if __name__ == "__main__":
    main()
