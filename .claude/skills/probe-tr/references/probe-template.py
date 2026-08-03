"""<TR코드> <TR명> 프로브 템플릿 — REAL + VIRTUAL.

스크래치패드에 복사해 CANDIDATES/PATHS만 채워 쓴다. 크리덴셜은 .env/.env.real에서
읽되 **절대 출력하지 않는다**. 라운드가 끝나면 plans/tools/ 에 남긴다.
"""

import json, os, time
from pathlib import Path
import urllib.request

GAP = 1.2  # 레이트리밋 ~1 req/s per TR


def find_proj() -> Path:
    """`.env`를 읽어야 하는데 프로브는 스크래치패드에서 돌아간다 — 저장소 경로를 찾는다.

    저장소 안에서 실행하면 cwd 상위에서 자동으로 잡히고, 밖에서 돌릴 때는
    `KIWOOM_PROJ=/path/to/kiwoom-mcp-server python3 probe.py`로 지정한다.
    """
    override = os.environ.get("KIWOOM_PROJ")
    if override:
        return Path(override).expanduser()
    for p in (Path.cwd(), *Path.cwd().parents):
        if (p / "package.json").exists() and (p / "src" / "kiwoom").is_dir():
            return p
    raise SystemExit("저장소를 못 찾았다 — KIWOOM_PROJ 환경변수로 경로를 지정할 것")


PROJ = find_proj()

API = "ka00000"  # ← 조사할 TR
PATHS = ["/api/dostk/stkinfo", "/api/dostk/mrkcond", "/api/dostk/rkinfo",
         "/api/dostk/sect", "/api/dostk/acnt", "/api/dostk/slb",
         "/api/dostk/shsa", "/api/dostk/frgnistt", "/api/dostk/etf",
         "/api/dostk/chart", "/api/dostk/thme", "/api/dostk/watchlist"]
CANDIDATES = [
    ("bare", {}),
    ("stk_cd", {"stk_cd": "005930"}),
    # ("full", {...}),  ← rc=2 메시지가 알려주는 필수 필드를 하나씩 채워 넣는다
]


def env(p):
    d = {}
    for l in (PROJ / p).read_text().splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            d[k.strip()] = v.strip().strip('"').strip("'")
    return d


def post(base, path, api, body, tok, cont=None, key=None):
    h = {"Content-Type": "application/json;charset=UTF-8",
         "authorization": f"Bearer {tok}", "api-id": api}
    if cont:
        h["cont-yn"], h["next-key"] = cont, key or ""
    r = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                               headers=h, method="POST")
    with urllib.request.urlopen(r, timeout=40) as x:
        return json.loads(x.read().decode()), dict(x.headers)


def arrays_of(res):
    return {k: v for k, v in res.items() if isinstance(v, list)}


def dump(res, hdr, show=3):
    top = {k: v for k, v in res.items() if not isinstance(v, list)}
    # 메시지는 자르지 않는다 — rc=2 전문에 필수 파라미터 이름이 찍힌다
    print(f"    rc={res.get('return_code')} msg={res.get('return_msg')!r} "
          f"cont-yn={hdr.get('cont-yn')}")
    print(f"    최상위 스칼라({len(top)}): {json.dumps(top, ensure_ascii=False)[:900]}")
    for k, v in arrays_of(res).items():
        print(f"    배열 `{k}` {len(v)}행")
        for i, row in enumerate(v[:show]):
            print(f"      [{i}] {json.dumps(row, ensure_ascii=False)[:500]}")
        if v:
            blank = [f for f in v[0] if all(str(r.get(f, "")).strip() == "" for r in v)]
            if blank:
                print(f"      ⚠️ 전 행 공백 필드({len(blank)}): {blank}")


for envfile, base, label in ((".env.real", "https://api.kiwoom.com", "REAL"),
                             (".env", "https://mockapi.kiwoom.com", "VIRTUAL")):
    e = env(envfile)
    try:
        tok = post(base, "/oauth2/token", "au10001",
                   {"grant_type": "client_credentials",
                    "appkey": e["KIWOOM_APP_KEY"],
                    "secretkey": e["KIWOOM_APP_SECRET"]}, "")[0]["token"]
    except Exception as ex:
        print(f"[{label}] 토큰 실패: {ex}\n")
        continue

    print("=" * 88)
    print(f"[{label}] {API} — path × body 탐색")
    print("=" * 88)
    hit = None
    for path in PATHS:
        for name, body in CANDIDATES:
            time.sleep(GAP)
            try:
                res, hdr = post(base, path, API, body, tok)
            except Exception as ex:
                print(f"  {path:<24} {name:<12} ERR {str(ex)[:50]}")
                continue
            rc, arr = res.get("return_code"), arrays_of(res)
            rows = max((len(v) for v in arr.values()), default=0)
            scalars = len([k for k, v in res.items() if not isinstance(v, list)])
            # rc=1 → 경로가 틀림 / rc=2 → 경로는 맞고 파라미터가 틀림
            print(f"  {path:<24} {name:<12} rc={rc} 배열={list(arr)} 행={rows} "
                  f"스칼라={scalars} msg={str(res.get('return_msg'))[:70]!r}")
            # 계좌 TR처럼 배열 없이 스칼라만 주는 응답도 성공으로 잡는다
            if rc == 0 and (rows > 0 or scalars > 3) and hit is None:
                hit = (path, name, body)
        if hit:
            break

    if not hit:
        print(f"  ❌ {API}: 성공 조합 없음\n")
        continue

    path, name, body = hit
    print(f"\n  ✅ 채택: path={path} body={json.dumps(body, ensure_ascii=False)}\n")
    time.sleep(GAP)
    dump(*post(base, path, API, body, tok))

    if label != "REAL":
        continue

    # 파라미터가 실제로 결과를 바꾸는지 — 효과 없는 필수 파라미터 탐지
    for key, vals in ():  # 예: (("qry_tp", ("1", "2", "3")),)
        sigs = []
        for v in vals:
            time.sleep(GAP)
            r2, _ = post(base, path, API, dict(body, **{key: v}), tok)
            a2 = next(iter(arrays_of(r2).values()), [])
            sigs.append((v, r2.get("return_code"), len(a2),
                         json.dumps(a2[0], ensure_ascii=False)[:120] if a2 else "-"))
        distinct = len({s[3] for s in sigs})
        print(f"  {key}: 갈래 {distinct}/{len(vals)}"
              f"{'  ⚠️ 효과 없음' if distinct == 1 else ''}")
        for s in sigs:
            print(f"    {key}={s[0]:<5} rc={s[1]} 행={s[2]} 첫행={s[3]}")

    # 통합(_AL)이 어느 필드까지 바꾸는가 — 종목 단위 TR일 때만
    if "stk_cd" in body:
        time.sleep(GAP)
        krx, _ = post(base, path, API, body, tok)
        time.sleep(GAP)
        uni, _ = post(base, path, API,
                      dict(body, stk_cd=body["stk_cd"] + "_AL"), tok)
        a = next(iter(arrays_of(krx).values()), [])
        b = next(iter(arrays_of(uni).values()), [])
        if a and b:
            for f in a[0]:
                mark = "≠ 바뀜" if str(a[0][f]) != str(b[0][f]) else "= 동일"
                print(f"    {f:<16} KRX {str(a[0][f]):>14}  통합 {str(b[0][f]):>14}  {mark}")
