---
name: release
description: kiwoom-mcp-server를 npm·MCP 레지스트리·GitHub Release에 발행한다. 사용자가
  배포·발행을 지시했을 때 실행한다. 버전 범프나 PR 머지까지만 하는 경우는 해당 없다 —
  발행은 항상 별도 지시다.
---

# release

발행은 되돌리기 어렵다(npm unpublish 72시간, 레지스트리는 append).
**순서와 사전 검사를 지킨다.**

## 절차

1. 버전 5곳 범프 — lockfile은 `npm install --package-lock-only`. `npm run check`로 확인.
2. 게이트 4종: `check && typecheck && test && build`.
3. **`! npm publish`** — 브라우저 OTP라 위임한다. **"npm만"이라고 범위를 못박을 것.**
4. 레지스트리 **선조회 후** `mcp-publisher publish`. 토큰 만료면 `! ... login github`.
5. `git tag -a vX.Y.Z` → push → `gh release create`.
6. 표면 확인 → `references/surfaces.md`.

## 함정

**순서 고정: npm → 레지스트리.**
나머지 6건은 `references/gotchas.md`를 **발행 전에 읽는다** — duplicate 400 오독,
`&version=latest`, npm README 스냅샷, lockfile 누락, 묶음 발행, 크롤 표면.
