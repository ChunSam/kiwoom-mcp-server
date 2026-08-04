# CLAUDE.md

키움증권 REST API를 **읽기 전용**으로 노출하는 MCP 서버. TypeScript(ESM, NodeNext) + `@modelcontextprotocol/sdk` + zod. 기본 47개 tool, ISA 세금 tool 1개는 opt-in.

## 명령어

```sh
npm run dev        # tsx로 src 직접 실행
npm run typecheck  # tsc --noEmit
npm test           # vitest run (네트워크 없음, 오프라인 통과)
npm run build      # tsc → dist/

python3 scripts/sweep.py          # 전체 tool 실전 스윕 (VIRTUAL 기본, .env 필요)
python3 scripts/sweep.py --real    # REAL 모드 명시 허용
```

`npm run check && npm run typecheck && npm test && npm run build` 네 가지가 로컬 게이트이자 CI(Node 20/22 매트릭스, `.github/workflows/ci.yml`)에서 도는 전부. `check`는 버전 5곳 동기화와 아래 실측 카운트가 어긋났는지 본다 — 둘 다 손으로 맞춰야 해서 조용히 드리프트한다. `git config core.hooksPath .githooks`를 한 번 걸어 두면 pre-commit에서도 돈다(카운트는 경고, 버전은 차단). sweep은 라이브 크리덴셜이 필요해 CI에 없고, tool을 추가·변경한 뒤 수동으로 돌린다 (`npm run build` 후 `dist/index.js`를 띄움). 기대값: `unexpected_errors=0`, 모의투자에서는 `get_transactions`(kt00015)·`get_account_trend`(kt00002)·`get_account_today`(kt00017) 세 개만 `err(exp)`(전부 RC9000).

## 아키텍처

```
index.ts        stdio/HTTP 전송 선택 → server 연결. stdout은 MCP 프레임 전용
 └ http.ts      Streamable HTTP (opt-in) + oauth.ts (claude.ai 커넥터용 OAuth 2.0 서버)
server.ts       McpServer 생성 + 모든 register*Tool 호출 (SERVER_VERSION 여기 있음)
config.ts       .env → AppConfig (zod). 크리덴셜 검증은 지연 → .env 없어도 서버 기동 + ping 동작
context.ts      getKiwoomContext(): 지연 생성되는 { config, client } 싱글턴
kiwoom/
  auth.ts       TokenManager — 토큰 캐시(만료 60초 전 갱신), 동시요청 1건 공유, 401 시 invalidate
  client.ts     TR 1회 호출. 10s 타임아웃, 429/5xx/네트워크 재시도, return_code≠0 → KiwoomApiError
  api.ts        TR별 fetch* 함수 (경로·api-id·body·페이지네이션). 도메인 계층의 중심
  types.ts      키움 응답 zod 스키마 + 타입
  master-list.ts ka10099 종목 마스터 인프로세스 캐시 (12h TTL)
tools/*.ts      MCP tool 등록 + 포맷터. 파일당 register<X>Tool + export된 순수 format 함수
isa/            ISA 전용: 과세유형 분류, 실현손익 재구성, 손익통산
utils/          num/date/redact/sleep/stock-code
```

의존 방향은 `tools → kiwoom/api → kiwoom/client → auth`. tool이 `client.call`을 직접 부르지 않고 항상 `api.ts`의 `fetch*`를 거친다.

## 절대 규칙

- **읽기 전용.** 주문·정정·취소 등 상태를 바꾸는 TR은 추가하지 않는다. `client.call`의 재시도 로직이 안전한 것도 모든 TR이 조회라는 전제 위에 있다.
- **stdout 금지.** stdio 전송에서 stdout은 MCP 프레임 전용. 모든 로그는 `console.error`.
- **시크릿 노출 금지.** 에러 메시지에 응답 본문이나 예외 텍스트를 실을 때는 반드시 `redactSecrets(text, [appKey, appSecret, token])`를 통과시킨다. `.env`/`.env.real`은 커밋 금지(gitignore됨), 내용을 컨텍스트로 읽어 오지 않는다 — 필요하면 키 *이름*만 확인.
- **거래소는 통합(KRX+NXT) 기준.** 시장 전체 TR은 `stex_tp: STEX_UNIFIED`("3"), 종목 단위 TR은 `toUnifiedCode(code)`로 `_AL`을 붙여 부른다. KRX 단독("1")로 되돌리면 NXT 거래가능 606종목의 거래량이 40~45% 적게 나온다(삼성전자 실측 19.2M vs 34.7M). 응답에 붙어 오는 `_AL`/`_NX` 접미사는 `types.ts`의 `code()` 헬퍼가 뗀다 — 코드 필드는 `str()`이 아니라 `code()`를 쓴다. **예외 2건**: ka10087(시간외단일가)은 접미사를 주면 빈 껍데기로 답하고, ka10002(거래원)은 통합을 제공하지 않아 KRX로 남는다. 호가는 v0.37.0에서 통합으로 넘어왔다 — ka10004는 `_AL`을 무시하지만 ka10007(시세표성정보)이 통합 잔량을 준다(실측 005930 매수1 KRX 18,421 + NXT 17,081 ≈ 통합 36,319). 계좌 TR(ka10075/76)의 `stex_tp: "0"`도 건드리지 않는다.
- **레이트리밋 ~1 req/s per TR.** 연속 호출 간격은 리터럴로 쓰지 말고 각 모듈의 명명 상수를 재사용한다 — `api.ts` `PAGE_INTERVAL_MS`, `master-list.ts` `MARKET_FETCH_GAP_MS`, `isa/classify-etf.ts` `ETF_FETCH_GAP_MS`(모두 1,100ms), `client.ts` `RETRY_429_BASE_MS`(1,300ms — 429 백오프는 1초를 **넘겨야** 해서 일부러 더 길다). 값이 같아도 이유가 달라 공유 상수로 묶지 않는다. 페이지네이션은 `MAX_PAGES=20` 상한이 있고, 상한에 걸리면 "결과가 잘렸을 수 있음"을 사용자에게 알린다.

## 새 tool 추가 절차

계약이 확정되기 전에는 코드를 쓰지 않는다 — 새 TR은 `/probe-tr` 스킬로 모의·실전 양쪽을 먼저 찍는다.

1. `kiwoom/types.ts` — 응답 zod 스키마. **`z.looseObject` + `const str = () => z.string().default("")` 헬퍼**가 예외 없는 관례다(현재 looseObject 102개, `z.object` 0개). 미선언 필드는 그냥 통과하므로 **서버가 실제로 쓰는 필드만** 선언하고, 문자열 필드는 새 헬퍼를 만들지 말고 `str()`을 쓴다. `...envelope`로 `return_code`/`return_msg`를 포함시킨다. `.optional()`은 값이 **정말 없을 수 있는** 응답(토큰 발급 실패 등)에만 쓴다 — 키움이 미제공 필드를 빈 문자열로 주는 케이스는 `str()`이 이미 흡수한다.
2. `kiwoom/api.ts` — `fetch<X>()` 추가. JSDoc 첫 줄은 `/** ka10046 체결강도요청 */`처럼 **TR 코드 + 키움 공식 TR명**.
3. `tools/<name>.ts` — `register<X>Tool(server)` + `export function format<X>(...)`. 핸들러는 얇게(입력 정규화 → fetch → format), 렌더링은 전부 순수 포맷터에.
4. `server.ts`에 등록 (해당 섹션 주석 아래).
5. `tests/<name>.test.ts` — 포맷터 단위 테스트.
6. `README.md` / `README.en.md`의 tool 표에 행 추가.
7. 버전 범프(아래).

tool 작성 관례:

- 핸들러 본문은 `runTool(async () => { ... })`로 감싼다 → 예외가 `isError: true` + `⚠️ 메시지`로 변환된다.
- 반환은 `textResult(...)` — 사람이 읽는 Markdown 텍스트. 첫 줄은 `[모의투자]`/`[실전투자]` 접두어(`config.modeLabel`)로 시작해 어느 서버가 답했는지 밝힌다.
- 빈 결과는 에러가 아니라 "…이 없습니다" + 원인 힌트 한 줄.
- `description`은 한국어로, **언제 이 tool을 쓰는지 + 인접 tool과의 구분**까지 적는다(모델이 고르는 근거). `title`도 한국어.
- 입력 스키마는 `.describe()` 필수. 종목코드는 항상 `z.string().regex(STOCK_CODE_PATTERN)` — 6자리지만 숫자 전용이 아니다(`0156T0`, `33626K` 같은 실제 코드 존재). 핸들러에서 `.toUpperCase()`.
- 숫자/날짜 파싱·포맷은 `utils/num.ts` / `utils/date.ts`(`todayInKst`, `kstDaysAgo`, `assertDateRange`)만 쓴다. 직접 파싱 금지 — `parseKiwoomNumber`가 부호 접두사, 이중부호(`--23722054`, ka10061 실측), 콤마(`20,190`, kt00015)를 이미 흡수한다.
- **가격 필드(`cur_prc`, `open_pric`, …)는 반드시 `parseKiwoomPrice`.** 키움은 가격 문자열의 `+`/`-`를 값의 부호가 아니라 **전일대비 방향**으로 쓴다 — 실제 가격은 절대값이고, 방향은 `pre_sig`/`pred_pre`에서 읽어야 한다. 여기에 `parseKiwoomNumber`를 쓰면 하락 종목의 가격이 음수로 렌더된다.
- 표 아래 `※` 주석으로 지표 해석(무엇이 기준값인지, 최신 행이 위인지 등)을 덧붙인다.
- 배열의 첫 원소는 `const [latest] = rows`로 꺼내고 그 falsy 검사로 빈 배열 가드를 겸한다. `rows[0]`은 `noUncheckedIndexedAccess`에 걸려 `possibly undefined`로 typecheck를 깬다.

## 테스트

- vitest, `tests/*.test.ts`. **네트워크를 타지 않는다** — 포맷터·파서·설정·전송선택 같은 순수 로직만 검증.
- fixture는 mockapi/실계좌에서 **실측한 응답을 그대로** 넣고, 언제 어느 TR/종목에서 땄는지 주석으로 남긴다. 빈 문자열·이상한 값도 손대지 않는다 — 그 이상함이 보통 테스트의 이유다.
- TR 응답 fixture는 **반드시** `types.ts`의 스키마로 `.parse()`해서 넣는다 — 현재 TR 응답을 다루는 31개 파일 전부가 예외 없이 이렇게 한다. 스키마와 fixture가 같이 어긋나는 걸 막는 장치다. (순수 유틸·전송·OAuth 테스트는 애초에 TR 응답을 다루지 않으므로 해당 없음.)
- "왜 이 폴백이 필요한가"를 아는 테스트는 그 근거를 주석에 남긴다 (예: ka10047은 `trde_qty`가 전 행 공백이라 `acc_trde_qty`로 폴백).

## 버전 / 릴리스

버전 문자열은 **5곳**이 동기화되어야 한다:

- `package.json` `version`
- `server.json` `version`, `packages[0].version`
- `src/server.ts` `SERVER_VERSION`
- `package-lock.json` `version`, `packages[""].version` — `npm install --package-lock-only`로 맞춘다

tool 추가 = minor 범프. 커밋/PR 제목은 `feat(tools): 체결 내역 — get_order_executions (ka10076), v0.27.0` 형식(타입 영어, 본문 한국어, 관련 TR과 버전 명시). 수정은 `fix(...)`, 문서 `docs:`, 의존성 `chore(deps):`. main 직접 커밋 대신 PR을 거친다.

배포 표면: npm(`kiwoom-mcp-server`), MCP 레지스트리(`server.json`), git 태그 + GitHub Release. npm 패키지는 `files: ["dist"]`라 `src/`·`tests/`·`.env`는 절대 포함되지 않는다 — 발행 후 tarball 내용을 확인할 것.

- **npm → 레지스트리 순서**를 지킨다. 레지스트리는 발행된 npm 버전을 참조하므로 뒤집으면 검증에 걸린다.
- **레지스트리 확인은 `&version=latest`로 한다.** `/v0/servers?search=...` 기본 응답은 낡은 버전을 돌려준다 — 그것만 보고 미발행으로 오독한 적이 있다. `isLatest`가 판정 기준.
- **대화형 인증은 사용자에게 넘긴다** — `npm publish`는 브라우저 OTP, `mcp-publisher`는 토큰 만료 시 `login github` 디바이스 플로우가 필요하다. `! <command>`로 위임한다.

## 설정 / 모드

- `KIWOOM_MODE=VIRTUAL`(mockapi.kiwoom.com) / `REAL`(api.kiwoom.com). **앱키가 모드별로 별도 발급**되므로 모드만 바꾸면 인증이 깨진다.
- 모의투자에서 제공되지 않는 TR이 있다(kt00015, kt00002/kt00016 → RC9000). 실패가 아니라 mock 한계로 취급.
- ISA tool은 `ISA_ENABLED=true`일 때만 등록된다 — 일반계좌 우선(general-account-first)이 기본.
- HTTP 모드는 opt-in이며 `MCP_AUTH_TOKEN` 없이는 기동을 거부한다(`--no-auth`로만 명시적 예외). 실계좌를 앞에 두는 서버이므로 인증 없는 공개 엔드포인트는 반드시 의도된 행위여야 한다.
- 변수별 상세 설명은 `.env.example`에 있다.

## 기타

- 과거 라운드의 맥락이 필요하면 `plans/`(로컬 전용 핸드오프·플랜·테스트 로그)를 참고한다.
- 소스 주석은 "무엇"이 아니라 **"왜 이렇게 했는지 / 어떻게 실측했는지"**를 적는 스타일이다(예: `mock 실측 2026-07-29`). 새 코드도 이 톤을 유지한다.
