---
name: pr-cycle
description: 이 저장소에서 코드·문서를 고쳐 PR로 올리고 머지까지 끝낸다. "진행해"의 범위가
  이것이다. 발행(npm·레지스트리)은 `/release`가 맡으므로 해당 없다.
---

# pr-cycle

main은 브랜치 보호가 걸려 있다 — 직접 push 불가, PR 필수, 선형 히스토리.

## 절차

1. main에서 `git checkout -b <type>/<slug>`.
2. 게이트: `check && typecheck && test && build`.
   카운트가 어긋나면 손으로 세지 말고 **`npm run check:write`**.
3. tool·모드를 늘렸으면 버전 5곳 범프(minor) → `npm install --package-lock-only`.
4. 커밋 제목 `type(scope): 한국어 요약, vX.Y.Z`. 본문은 **무엇이 아니라 왜**.
5. `gh pr create` → **`gh pr merge --auto --squash`**.
6. `gh pr checks <n> --watch` → `MERGED` 확인 → main 동기화 → 브랜치 삭제.

## 함정

`references/gotchas.md`를 **PR 올리기 전에 읽는다** — `--auto` 누락, 낡은 원격 ref,
카운트 수기 계산, 스윕 육안 확인, 요청 body 테스트.
