---
name: release
description: kiwoom-mcp-server를 npm·MCP 레지스트리·GitHub Release에 발행한다. 사용자가
  배포·발행을 지시했을 때 실행한다. 버전 범프나 PR 머지까지만 하는 경우는 해당 없다 —
  발행은 항상 별도 지시다.
---

# release

되돌리기 어렵다. **CI가 발행한다** — 손으로 publish 하지 않는다.

## 절차

1. 버전 5곳 범프 (lockfile은 `npm install --package-lock-only`) → `check`.
2. 게이트: `check && typecheck && test && build`.
3. 노트를 파일로 쓰고 주석 태그에 싣는다(첫 줄=제목):
   `git tag -a vX.Y.Z --cleanup=verbatim -F notes.md`
4. `git push origin vX.Y.Z` → `release.yml`이 세 표면을 발행한다. `gh run watch`.
5. 표면 확인 → `references/surfaces.md`.

실패해도 재실행이 안전하다 — 셋 다 선조회 후 있으면 건너뛴다.

## 함정

`references/gotchas.md`를 **발행 전에 읽는다**.
