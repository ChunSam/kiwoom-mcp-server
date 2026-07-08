# kiwoom-mcp-server

**한국어** · [English](README.en.md)

키움증권 REST API를 **조회 전용(read-only)** 으로 노출하는 MCP 서버입니다.
Claude Desktop / Claude Code에서 자연어로 국내 주식 시세·차트·호가·지수·순위·수급과
내 계좌의 잔고·보유 종목·거래내역을 조회할 수 있고, ISA 계좌라면 비과세 한도
대비 손익통산 현황까지 계산해 줍니다.

> ⚠️ **보안 경고**
>
> - 이 서버는 **로컬에서만 실행**하고 절대 외부 네트워크에 노출하지 마세요.
> - `.env`의 AppKey/AppSecret은 실계좌 조회 권한입니다. 절대 커밋하지 마세요
>   (`.gitignore`에 이미 등록되어 있습니다).
> - 주문(매수/매도/정정/취소) 기능은 설계상 제외되어 있습니다. 이 서버가 계좌를
>   변경하는 일은 없습니다.

## 제공 Tool

**시장 데이터** (계좌와 무관, 앱키만 있으면 사용 가능):

| Tool | 설명 | 키움 TR |
|---|---|---|
| `search_stock` | 종목명→코드 검색 (코스피/코스닥, ETF/ETN 포함) | ka10099 |
| `get_stock_price` | 현재가/등락률/거래량/기본지표 | ka10001 |
| `get_stock_chart` | 일/주/월/분봉 캔들 차트 (수정주가 반영) | ka10080~83 |
| `get_orderbook` | 10단계 매도/매수 호가·잔량 | ka10004 |
| `get_market_index` | 코스피/코스닥 종합·업종 지수 | ka20003 |
| `get_sector_price` | 업종 지수 현재가 상세 (등락 구성·52주 고저·시간대별 추이) | ka20001 |
| `get_sector_stocks` | 업종 구성 종목 시세 (현재가·등락률·거래량·고저가) | ka20002 |
| `get_ranking` | 상승률/하락률/거래량/거래대금 상위 | ka10027/30/32 |
| `get_market_movers` | 신고가/신저가/상한가/하한가/급등/급락 특이 종목 | ka10016/17/19 |
| `get_investor_trend` | 개인/외국인/기관 순매수 동향 (기간 합계 + 일별) | ka10059, ka10061 |
| `get_etf_info` | ETF 추적지수·과세유형·시세 | ka40002, ka10001 |
| `get_short_selling` | 종목별 일자별 공매도 추이 (공매도량·비중·평균가) | ka10014 |
| `get_foreign_holding` | 종목별 외국인 보유 추이 (보유주식수·보유비중·한도소진률) | ka10008 |

**관심종목** (영웅문 HTS에 저장한 관심 그룹, 읽기 전용):

| Tool | 설명 | 키움 TR |
|---|---|---|
| `get_watchlist_groups` | HTS 관심종목 그룹 목록 (그룹코드+그룹명) | ka01300 |
| `get_watchlist` | 그룹 내 종목 목록 (종목명·전일종가·시장 보강) | ka01301, ka10099 |

> 키움 REST API에는 관심종목 **편집(추가/삭제)** TR이 없어 조회만 가능합니다.

**테마**:

| Tool | 설명 | 키움 TR |
|---|---|---|
| `get_theme_groups` | 테마 그룹 목록 (등락률·종목수·기간수익률·주요종목; 종목별 편입 테마 검색) | ka90001 |
| `get_theme_stocks` | 특정 테마의 구성종목과 시세 (현재가·등락률·거래량·기간수익률) | ka90002 |

**계좌** (앱키에 귀속된 계좌 기준):

| Tool | 설명 | 키움 TR |
|---|---|---|
| `get_account_balance` | 예수금 + 총평가금액/총평가손익/추정예탁자산 | kt00001, kt00018 |
| `get_account_holdings` | 보유 종목별 수량/평균단가/현재가/평가손익 | kt00018 |
| `get_transactions` | 기간별 거래내역 (체결일·단가·정산금액) | kt00015 |
| `get_pending_orders` | 미체결 주문 (주문번호·구분·상태·주문/미체결수량·주문가격) | ka10075 |
| `get_trading_journal` | 당일매매일지 (종목별 매수/매도 평균가·수량·실현손익, 총손익) | ka10170 |
| `calc_isa_tax_status` | ISA 손익통산 순이익의 비과세 한도 대비 현황 (확정 + 전량매도 시나리오) | kt00015, ka10074, kt00018 |

그 외 `ping`(연결 확인, 앱키 불필요). 모든 응답은 `[모의투자]`/`[실전투자]` 접두어로
어느 서버가 답했는지 표시합니다. `search_stock` 첫 호출은 종목 마스터(~4,300종목)를
내려받아 몇 초 걸리며 이후 12시간 캐시됩니다.

### `calc_isa_tax_status` 사용 메모

- 집계 시작일: `.env`의 `ISA_OPENED_ON`(계좌 개설일)이 기본값, 호출 시 `from_date`로 오버라이드 가능.
- 배당·분배금이 거래내역에서 자동 감지되지 않으면 `dividends_received` 인자로 수동 입력.
- 종목 과세유형(과세대상 vs 국내주식형)은 종목명 기반 자동 분류이며, 틀린 경우
  `overrides: [{stock_code, tax_type}]`로 수정. 결과는 참고용 — 실제 과세는 증권사 정산 기준.

## 요구 사항

- **Node.js 20.12 이상** (`process.loadEnvFile` 사용)
- 키움증권 REST API 앱키 — [키움 Open API 포털](https://openapi.kiwoom.com)에서
  앱 등록 후 발급
  - 모의투자(VIRTUAL)와 실전투자(REAL)는 **각각 별도로 발급받은 앱키**를 사용하며,
    발급받은 키 종류와 `KIWOOM_MODE`가 일치해야 합니다.
  - 계좌는 앱키에 귀속되므로 계좌번호 입력은 필요 없습니다.

## 설치

npm에 배포되어 있으므로 **클론 없이 `npx`로 바로 실행**할 수 있습니다 — 아래
"Claude Desktop 연결" / "Claude Code 연결"의 npx 설정을 그대로 쓰면 됩니다. 이 경우
앱키는 `.env` 파일 대신 **클라이언트 설정의 `env` 블록**으로 전달합니다(예제는 각
연결 섹션 참고).

소스에서 직접 빌드하거나 코드를 수정하려면:

```sh
git clone <이 저장소 URL>   # 또는 소스 복사
cd kiwoom-mcp-server
npm install
cp .env.example .env        # 아래 표를 참고해 값 입력
npm run build               # dist/ 생성
npm test                    # 단위 테스트 (네트워크 불필요)
```

## 환경 변수 (`.env`)

| 변수 | 필수 | 설명 |
|---|---|---|
| `KIWOOM_APP_KEY` | ✅ | 키움 REST API 앱키 |
| `KIWOOM_APP_SECRET` | ✅ | 키움 REST API 앱 시크릿 |
| `KIWOOM_MODE` | | `VIRTUAL`(모의투자, 기본값) 또는 `REAL`(실전투자) |
| `ISA_ENABLED` | | `true`면 `calc_isa_tax_status` tool 활성화. 기본값 `false`(일반 계좌 기준) |
| `ISA_TYPE` | | `GENERAL`(일반형, 한도 200만원, 기본값) 또는 `SEOMIN`(서민형/농어민형, 400만원). `ISA_ENABLED=true`일 때만 사용 |
| `ISA_OPENED_ON` | | ISA 계좌 개설일 `yyyy-MM-dd` — `calc_isa_tax_status` 집계 시작일 기본값. `ISA_ENABLED=true`일 때만 사용 |

기본값은 **일반(비-ISA) 계좌 기준**입니다 — 별도 설정이 없으면 시장·계좌 조회 tool만
노출됩니다. ISA 계좌를 연결해 비과세 한도 tool을 쓰려면 `ISA_ENABLED=true`로 켜고
`ISA_TYPE`/`ISA_OPENED_ON`을 채우세요. 끄면 `calc_isa_tax_status`가 등록되지 않고
나머지 tool은 모두 그대로 동작합니다.

`.env`는 프로젝트 루트에서 먼저 찾기 때문에 (Claude Desktop처럼) 임의의 작업
디렉터리에서 실행돼도 동작합니다.

## Claude Desktop 연결

설정 파일 위치:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**npx (배포판) — 클론 없이 실행. 앱키는 `env` 블록으로 전달:**

```json
{
  "mcpServers": {
    "kiwoom": {
      "command": "npx",
      "args": ["-y", "kiwoom-mcp-server"],
      "env": {
        "KIWOOM_APP_KEY": "…",
        "KIWOOM_APP_SECRET": "…",
        "KIWOOM_MODE": "REAL"
      }
    }
  }
}
```

**소스 빌드 — `dist/index.js` 직접 실행. 앱키는 프로젝트 루트 `.env` 사용:**

```json
{
  "mcpServers": {
    "kiwoom": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/절대/경로/kiwoom-mcp-server/dist/index.js"]
    }
  }
}
```

> **`command`에는 실행 파일의 절대 경로**를 쓰는 편이 가장 안전합니다 (`which node`,
> `which npx`로 확인). GUI 앱은 셸 PATH를 상속받지 않으므로 `"node"`/`"npx"`라고만
> 쓰면 서버가 조용히 뜨지 않을 수 있습니다 — 가장 흔한 실패 원인입니다.

저장 후 Claude Desktop을 완전히 종료(macOS는 ⌘Q)했다가 다시 실행하면 tool이
보입니다. `npm run build`로 **다시 빌드한 뒤에도 완전 종료 후 재실행**해야
변경이 반영됩니다.

## Claude Code 연결

npx (배포판) — 앱키는 `-e` 플래그로 전달:

```sh
claude mcp add kiwoom \
  -e KIWOOM_APP_KEY=… -e KIWOOM_APP_SECRET=… -e KIWOOM_MODE=REAL \
  -- npx -y kiwoom-mcp-server
```

소스 빌드 — 프로젝트 루트 `.env` 사용:

```sh
claude mcp add kiwoom -- node /절대/경로/kiwoom-mcp-server/dist/index.js
```

## 동작 확인

MCP 클라이언트 없이 stdio로 직접 확인할 수 있습니다:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}' \
  | node dist/index.js
```

`ping`은 `.env` 없이도 응답합니다. 시세·계좌 tool은 앱키가 있어야 합니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| Desktop에 tool이 안 보임 | `command`가 node **절대 경로**인지, `npm run build`를 했는지, Desktop을 완전 종료 후 재실행했는지 |
| `환경설정이 없거나 잘못되었습니다` | `.env`가 프로젝트 루트에 있는지, 필수 변수가 채워졌는지 |
| `키움 인증에 실패했습니다` | 앱키 종류(모의/실전)와 `KIWOOM_MODE`가 일치하는지, 포털에서 앱이 활성 상태인지 |
| `요청 한도를 초과했습니다` | 키움 레이트리밋(TR당 약 1초 1회). 서버가 자동 재시도한 뒤에도 초과한 경우이니 잠시 후 다시 시도 |
| 예수금과 D+2 추정예수금이 다름 | 미결제(D+2 정산) 매매가 있으면 정상입니다 |

## 개발

```sh
npm run dev        # tsx로 소스 직접 실행
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # tsc → dist/
```

구조: `src/kiwoom/`(인증·HTTP·TR 계층) → `src/tools/`(MCP tool, 포맷터 분리) →
`src/isa/`(과세유형 분류·실현손익 재구성·손익통산). 상세 규칙과 검증된 API
계약은 `CLAUDE.md` 참고.

## 라이선스

[MIT](LICENSE)
