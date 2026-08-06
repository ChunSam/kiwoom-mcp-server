---
name: release
description: kiwoom-mcp-server를 npm·MCP 레지스트리·GitHub Release에 발행한다. 사용자가
  배포·발행을 지시했을 때 실행한다. 버전 범프나 PR 머지까지만 하는 경우는 해당 없다 —
  발행은 항상 별도 지시다.
---

# release

발행은 되돌리기 어렵다(npm unpublish 72시간 제한, 레지스트리는 버전 단위 append).
**순서와 사전 검사를 지킨다.**

## 절차

1. 버전 5곳 범프 — lockfile은 `npm install --package-lock-only`. `npm run check`로 확인.
2. 게이트: `npm run check && npm run typecheck && npm test && npm run build`.
3. **`! npm publish`** — 브라우저 OTP가 필요하니 사용자에게 넘긴다. 위임할 때
   **"npm만 해 주세요, 레지스트리는 이어서 제가 합니다"**를 명시한다(아래 gotcha).
4. **`mcp-publisher publish`** — 3번을 위임한 뒤라면 **먼저 레지스트리를 조회**해
   이미 올라가 있는지 본다. 토큰이 만료됐으면 `! mcp-publisher login github`을 위임.
5. `git tag vX.Y.Z && git push --tags` → `gh release create`.
6. 표면 확인 → `references/surfaces.md`.

## Gotchas

- **순서 고정: npm → 레지스트리.** 레지스트리가 발행된 npm 버전을 검증한다.
- **npm publish를 위임하면 사용자가 레지스트리까지 돌려 놓는다** — 2회 연속 `duplicate
  version` 400을 받았다. 실패가 아니지만 오독하기 쉬우니 위임 범위를 말로 못박는다.
- **레지스트리 조회에 `&version=latest`를 빼지 말 것** — 기본 응답은 낡은 버전을 준다.
- **npm 페이지 README는 publish 시점 스냅샷** — 문서만 고친 커밋은 안 보인다.
- **lockfile은 손범프에서 빠진다** — 9개 마이너 동안 어긋나 있었다.
- **마이너를 묶어 발행해도 된다** — 노트 제목에 "누적 발행"을 밝힌다.
- **크롤 표면(Glama·Changefeed·mcp.so)에는 손대지 않는다** — 재론 금지 결정.

각 항목의 실측 근거는 `references/gotchas.md`.
