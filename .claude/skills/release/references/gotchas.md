# release — 실측 근거

각 함정마다 "언제 실제로 물렸는지"를 남긴다. 근거 없는 규칙은 다음 라운드에서 다시
논쟁거리가 된다.

## 순서: npm → 레지스트리

MCP 레지스트리는 `server.json`의 `packages[0].version`이 **npm에 실제로 존재하는지**
검증한다. 레지스트리를 먼저 밀면 그 버전이 아직 npm에 없어 거절된다. 되돌릴 수 없는 쪽
(레지스트리는 버전 단위 append)이 뒤에 오는 순서이기도 하다.

## `&version=latest` 없는 레지스트리 조회는 낡은 값을 준다

`/v0/servers?search=kiwoom` 기본 응답은 최신이 아닌 항목을 돌려준다. 2026-08-03에 이걸로
"0.19.1 미발행"이라 오독할 뻔했다. 판정 기준은 응답의
`_meta["io.modelcontextprotocol.registry/official"].isLatest`다.

## npm 페이지 README는 publish 시점에 굳는다

`files: ["dist"]`는 `src/`·`tests/`·`.env`를 막지만 **`README*`·LICENSE·package.json은
막지 못한다** — npm이 항상 tarball에 넣는다(v0.36.0 tarball 실측: 72파일에 `README.md`·
`README.en.md`·`LICENSE` 포함). 예전에 "README는 tarball에 안 들어간다"고 적어 둔 적이
있는데 틀렸다.

결과적으로 **문서만 고친 커밋은 다음 publish 전까지 npm 페이지에 나타나지 않는다.**
v0.36.1(#51)은 코드 변경 없이 이 목적만으로 낸 patch다 — #50(MCP_PUBLIC_URL 문서화)이
v0.36.0 태그 뒤에 머지돼 npm에서 보이지 않았다.

## 게이트는 5종인데 `npm publish`는 4종만 돌린다

CI(`.github/workflows/ci.yml`)는 `check`·`typecheck`·`test`·`build` 뒤에
`npm audit --omit=dev --audit-level=high`를 한 단계 더 돌리지만, `package.json`의
`prepublishOnly`는 앞의 4종뿐이다 — publish 경로에는 audit이 없어, **마지막 CI 이후 새로 뜬
advisory는 발행 시점에 아무도 못 본다.** 발행 직전에 손으로 한 번 돌린다(#72에서 SDK 전이
의존성 high 2건·moderate 1건이 아무도 모르는 채 쌓여 있었다).

**audit이 초록이어도 그건 우리 트리 얘기다.** #72의 수정은 `package-lock.json`에만
들어갔고(fast-uri·hono·ip-address 전이 의존성 범프) `dependencies` range
(`@modelcontextprotocol/sdk: ^1.29.0`)는 그대로다. npm은 lockfile을 tarball에 싣지
않으므로(v0.44.1 `npm pack --dry-run` 실측: 75파일, `package-lock.json` 없음) 사용자는
range로 전이 의존성을 스스로 푼다. 그러니 릴리스 노트에 "취약점 0건"이라고 쓰지 않는다 —
소비자까지 고치려면 range를 올려야 한다.

## lockfile은 손범프 절차에서 빠진다

`package-lock.json`은 `npm install`이 알아서 맞춰 주는 자리라 사람이 올리는 목록에서
빠졌고, **버전만 올리는 커밋은 `npm install`을 돌리지 않아** 값이 그대로 남는다. root
`version`이 0.27.0에 멈춘 채 9개 마이너를 흘렀고(v0.36.1에서 발견), 그때 `version`과
`packages[""].version`이 서로도 어긋나 있었다(0.27.0 / 0.36.1). 그래서 `npm run check`가
**두 필드를 따로** 본다(#52).

## 마이너를 묶어 발행해도 된다

모든 minor가 개별 publish일 필요는 없다. 실제로 v0.35~0.36을 한 번에, v0.37~0.39를 한 번에
냈다. 이때 GitHub Release 제목에 "(v0.37~0.39 누적 발행)"처럼 범위를 밝힌다 — 태그는
버전마다 남지만 Release는 하나뿐이라, 밝히지 않으면 중간 버전이 누락된 것처럼 보인다.

## 크롤 표면에 손대지 않는다 (2026-08-04 결정, 재론 금지)

Glama·MCP Changefeed·mcp.so는 남이 크롤하는 곳이라 발행 완료 조건이 아니다. mcp.so의
`Claim`과 PulseMCP `/submit`은 하지 않기로 했다 — 전자는 재크롤로 따라오고, 후자는 v0beta
API가 2026-09 sunset 예정이라 유입 가치가 낮다. **둘 다 사용자 로그인이 필요해 에이전트가
대신 할 수도 없다.** 상세는 `surfaces.md`.

## npm publish를 위임하면 사용자가 레지스트리까지 돌려 놓는다

**2026-08-05·08-06 두 번 연속**으로 같은 일이 있었다. 절차 3번대로 `! npm publish`를
위임했더니 사용자가 이어서 `mcp-publisher publish`까지 실행했고, 4번에서 부른 레지스트리
발행이 둘 다 이렇게 떨어졌다:

```
Error: publish failed: server returned status 400:
{"errors":[{"message":"invalid version: cannot publish duplicate version"}]}
```

**실패가 아니다** — 레지스트리는 append-only라 덮어쓴 것도 없고, 조회해 보면 이미
`isLatest=true`로 올라가 있다(8/6엔 내 호출 40초 전에 등록돼 있었다). 하지만 400 에러는
실패로 오독하기 쉽고, 매번 "정말 올라갔나" 확인하는 왕복이 붙는다.

처방 두 가지:

1. **위임 문구에 범위를 못박는다** — "`npm publish`만 해 주세요, 레지스트리·태그·Release는
   이어서 제가 합니다". 가장 싸다.
2. **4번 앞에 선조회를 넣는다** — `&version=latest`로 부르고
   `_meta["io.modelcontextprotocol.registry/official"].isLatest`가 이미 목표 버전이면
   publish를 건너뛴다.

어느 쪽이든 **400을 받았다고 발행이 안 된 것으로 보고하지 말 것** — 조회로 확인한 뒤에
판정한다.
