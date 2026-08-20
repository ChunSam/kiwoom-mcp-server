# release — 표면 확인

발행 후 최신화를 확인할 표면은 6곳. 앞 3곳만 우리가 직접 밀어 올리고, 뒤 3곳은 남이 크롤한다.
표면은 아니지만 **발행 뒤 같이 봐야 하는 로컬 커넥터 핀**이 하나 더 있다(맨 아래).

## 우리가 발행하는 곳 (여기까지가 발행 완료 조건)

```sh
curl -s https://registry.npmjs.org/kiwoom-mcp-server | jq '.["dist-tags"]'
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=kiwoom&version=latest"
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=kiwoom&limit=100"
gh release list --limit 5
```

레지스트리는 **두 조회를 다 부른다** — `&version=latest`와 전체 목록이 각자 다른 시점에
낡고, 두 라운드에서 정반대로 물렸다(상세는 `gotchas.md`). 목표 버전이 나온 응답에서
`_meta["io.modelcontextprotocol.registry/official"].isLatest`를 본다. **둘 다 낡았다고
미발행으로 판정하지 않는다** — 1차 근거는 발행 스텝의 성공 여부다.

**레지스트리 응답은 `{_meta, server}` 두 겹이라 버전이 `.server.version`에 있다.**
`.servers[].version`으로 읽으면 조용히 `null`이 나온다(v0.50.0에서 헛짚었다) — 검색어에
남의 서버도 걸리므로 이름까지 같이 찍는다:

```sh
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=kiwoom&version=latest" \
  | jq -r '.servers[]? | "\(.server.name) \(.server.version) isLatest=\(._meta["io.modelcontextprotocol.registry/official"].isLatest)"'
```

`jq .dist-tags`는 `-`를 뺄셈으로 파싱해 컴파일 에러가 난다. `jq '.["dist-tags"]'`로 부른다.

## 남이 크롤하는 곳 (조치하지 않는다)

**2026-08-04에 손대지 않기로 결정했다 — 재론 금지.** mcp.so `Claim`도 PulseMCP `/submit`도
하지 않는다. mcp.so는 재크롤로 언젠가 따라오고, PulseMCP는 v0beta API가 2026-09 sunset
예정이라 유입 가치가 낮다. 둘 다 사용자 로그인이 필요해 에이전트가 대신 할 수도 없다.

- **Glama** — `https://glama.ai/mcp/servers/gi0iibvr9k`. API(`/api/mcp/v1/servers/ChunSam/kiwoom-mcp-server`)에는
  **버전 필드가 아예 없고** `tools`도 빈 배열이라 최신성 판정에 못 쓴다. 웹 페이지를
  WebFetch해 **README 본문의 버전 문구**로 간접 판정한다. curl은 JS 렌더라 빈손이다.
- **MCP Changefeed** — `gh api repos/rogerchappel/mcpchangefeed/contents/site/servers/io-github-chunsam-kiwoom-mcp-server/index.html`.
  리프레시 주기 ~4~5시간이라 **발행 직후 낡아 보이는 건 정상**이다. Stars·Downloads·License가
  0/Unknown으로 뜨는 것도 저장소 문제가 아니다.
- **mcp.so** — `https://mcp.so/servers/kiwoom-mcp-server`. 경로는 `/servers/<repo>`다.
  `/server/<owner>/<repo>`로 404를 보고 "미등재"라 단정한 오독이 있었다.

**PulseMCP는 미등재 확정**(2026-08-04, API·웹 양쪽 확인). "kiwoom"으로 나오는 건 다른
사람의 프로젝트다. `/submit`은 curl에 Cloudflare 403이라 브라우저가 필요하다.

## 발행 뒤 한 번 더 — 로컬 커넥터 핀 (배포 표면은 아니다)

**세 표면이 다 최신이어도 내가 실제로 쓰는 서버는 옛 버전일 수 있다.**
`claude_desktop_config.json`의 `kiwoom`(실계좌·REAL)이 `npx -y kiwoom-mcp-server@X.Y.Z`로
핀돼 있어서, 핀을 안 올리면 방금 발행한 수정이 실계좌 쪽에 영영 안 닿는다. 2026-08-20에
실제로 어긋나 있었다 — npm은 0.52.4인데 핀은 **0.47.1**(다섯 릴리스 뒤처짐).

```sh
grep -o 'kiwoom-mcp-server@[0-9.]*' "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
```

**통째로 출력하지 않는다 — 이 파일에는 앱키·시크릿이 들어 있다**(`npx-cleanup`의 gotchas와
같은 규칙이다). 핀을 올리는 것 자체는 **실계좌 설정 수정이라 지시를 받고** 한다. 올린 직후가
`npx-cleanup`을 돌리기 가장 좋은 시점이다 — 직전 버전 캐시가 그 순간 쓸모없어진다.
`kiwoom-dev`는 로컬 `dist`를 직접 부르므로 해당 없다.
