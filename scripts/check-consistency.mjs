#!/usr/bin/env node
/**
 * 사람이 손으로 맞춰야 하는 것들이 어긋났는지 본다.
 *
 * 1. 버전 5곳 동기화 — package.json / server.json ×2 / src/server.ts / package-lock.json
 * 2. CLAUDE.md의 실측 카운트 — tool 수, looseObject 수, TR fixture 파일 수
 * 3. README 2종에 tool이 문서화됐는지 — 한쪽만 고치고 넘어가기 쉬운 자리다
 * 4. tools/가 export한 register*Tool이 server.ts에서 다 불리는지
 * 5. 레이어 불변식 — 순환 0건, 하위→상위 import 금지, client.call은 api.ts 안에서만
 * 6. description의 tool 상호참조가 실존하는지 — 모델이 tool을 고르는 근거다
 * 7. 라우팅 시험(scripts/routing.py) 정답표가 실제 tool·파라미터를 가리키는지
 *
 * 1~4는 라운드마다 사람이 갱신해야 해서 조용히 어긋난다. 실제로 looseObject가
 * 83으로 적혀 있는 동안 코드에는 85개가 있었고, eb4bd47은 그 드리프트를 고치기만
 * 하는 커밋이었다. 5는 성격이 다르다 — 갱신할 숫자가 아니라 어겨선 안 되는 구조인데
 * typecheck·테스트가 원리상 못 잡는 자리라 여기 둔다.
 *
 * 사용:
 *   node scripts/check-consistency.mjs              # 전부 실패로 취급 (CI)
 *   node scripts/check-consistency.mjs --warn-counts # 카운트는 경고만 (pre-commit)
 *   node scripts/check-consistency.mjs --write       # 카운트를 실제 값으로 고쳐 쓴다
 *
 * `--write`는 tool 라운드마다 사람이 CLAUDE.md 숫자를 손으로 고치던 걸 없앤다 — 실제 값은
 * 이 스크립트가 이미 세고 있으므로 옮겨 적을 이유가 없었다. 한 번은 looseObject를 115로
 * 잘못 추정해 재실행한 적이 있다. **버전은 건드리지 않는다**(어느 쪽이 정답인지 모른다).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const warnCounts = process.argv.includes("--warn-counts");
const write = process.argv.includes("--write");

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const countOf = (text, re) => (text.match(re) ?? []).length;

/** CLAUDE.md에 적힌 숫자를 뽑는다. 문구가 바뀌면 null → 그 항목은 검사하지 않는다. */
const stated = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
};

const errors = [];
const warnings = [];

// ── 1. 버전 5곳 ────────────────────────────────────────────────────────
const pkg = JSON.parse(read("package.json"));
const serverJson = JSON.parse(read("server.json"));
const serverTs = read("src/server.ts");
// lockfile은 `npm install`이 알아서 맞춰 주는 자리라 손범프 절차에서 빠졌고,
// 그래서 0.27.0에 멈춘 채 9개 마이너를 흘렀다(v0.36.1에서 발견). 검사에 넣는다.
const lock = JSON.parse(read("package-lock.json"));

const versions = {
  "package.json": pkg.version,
  "server.json version": serverJson.version,
  "server.json packages[0].version": serverJson.packages?.[0]?.version,
  "src/server.ts SERVER_VERSION": serverTs.match(/SERVER_VERSION\s*=\s*"([^"]+)"/)?.[1],
  "package-lock.json version": lock.version,
  'package-lock.json packages[""].version': lock.packages?.[""]?.version,
};

const distinct = [...new Set(Object.values(versions))];
if (distinct.length === 1) {
  console.log(`✓ 버전 5곳 동기화 — ${distinct[0]}`);
} else {
  errors.push(
    ["✗ 버전이 어긋났습니다:", ...Object.entries(versions).map(([k, v]) => `    ${k}: ${v ?? "(못 읽음)"}`)].join("\n"),
  );
}

// ── 2. CLAUDE.md 실측 카운트 ───────────────────────────────────────────
const claudeMd = read("CLAUDE.md");
const types = read("src/kiwoom/types.ts");

// ISA tool은 opt-in이라 "기본 N개"에서 빠진다.
const registrations = serverTs.match(/register\w+Tool\(server\)/g) ?? [];
const actual = {
  tool: registrations.filter((r) => !r.includes("Isa")).length,
  looseObject: countOf(types, /z\.looseObject/g),
  zObject: countOf(types, /z\.object\(/g),
  fixtureFiles: readdirSync(join(ROOT, "tests"), { recursive: true })
    .filter((f) => typeof f === "string" && f.endsWith(".ts"))
    .filter((f) => /Schema\.parse\(/.test(read(join("tests", f)))).length,
};

// 정규식은 검사와 --write가 함께 쓴다 — 캡처 그룹 1이 CLAUDE.md에 적힌 숫자다.
const checks = [
  ["tool 수", /기본 (\d+)개 tool/, actual.tool, "CLAUDE.md 첫 문단"],
  ["looseObject 수", /looseObject (\d+)개/, actual.looseObject, "새 tool 추가 절차 1번"],
  ["z.object 수", /`z\.object` (\d+)개/, actual.zObject, "새 tool 추가 절차 1번"],
  ["TR fixture 파일 수", /TR 응답을 다루는 (\d+)개 파일/, actual.fixtureFiles, "테스트 섹션"],
];

let rewritten = claudeMd;
const fixed = [];

for (const [label, re, actualValue, where] of checks) {
  const statedValue = stated(claudeMd, re);
  if (statedValue === null) {
    warnings.push(`? ${label} — CLAUDE.md에서 문구를 못 찾았습니다 (${where}). 표현이 바뀌었으면 이 스크립트도 고칠 것`);
  } else if (statedValue === actualValue) {
    console.log(`✓ ${label} — ${actualValue}`);
  } else if (write) {
    // 캡처 그룹만 바꾼다 — 문구는 손대지 않는다.
    rewritten = rewritten.replace(re, (m, n) => m.replace(n, String(actualValue)));
    fixed.push(`${label} — ${statedValue} → ${actualValue}`);
  } else {
    const msg = `${label} — CLAUDE.md ${statedValue} vs 실제 ${actualValue} (${where})`;
    if (warnCounts) warnings.push(msg);
    else errors.push(`✗ ${msg}`);
  }
}

if (write && fixed.length > 0) {
  writeFileSync(join(ROOT, "CLAUDE.md"), rewritten);
  for (const f of fixed) console.log(`✎ ${f}`);
  console.log(`\nCLAUDE.md의 카운트 ${fixed.length}건을 실제 값으로 고쳤습니다.`);
} else if (write) {
  console.log("✎ 고칠 카운트가 없습니다.");
}

// ── 3. README 2종에 tool이 문서화됐는지 ────────────────────────────────
// "새 tool 추가 절차" 6단계(README.md / README.en.md에 행 추가)가 손으로 하는 일이라
// 한쪽만 고치고 넘어가기 쉽다. 표 행인지까지는 보지 않는다 — `ping`은 표가 아니라
// 산문에 있고 그게 의도된 배치다. 이름이 어디에도 안 나오면 그건 빠뜨린 것.
const toolNames = new Set();
for (const file of readdirSync(join(ROOT, "src/tools"))) {
  if (!file.endsWith(".ts")) continue;
  for (const m of read(join("src/tools", file)).matchAll(/registerTool\(\s*"([a-z_]+)"/g)) {
    toolNames.add(m[1]);
  }
}

for (const readme of ["README.md", "README.en.md"]) {
  const text = read(readme);
  const missing = [...toolNames].filter((n) => !text.includes(`\`${n}\``));
  if (missing.length === 0) {
    console.log(`✓ ${readme} tool 문서화 — ${toolNames.size}개`);
  } else {
    const msg = `${readme}에 없는 tool: ${missing.join(", ")}`;
    if (warnCounts) warnings.push(msg);
    else errors.push(`✗ ${msg}`);
  }
}

// ── 4. tools/가 export한 register*Tool이 server.ts에서 다 불리는지 ─────
// tool 수 검사(2번)는 server.ts의 호출 개수를 세어 CLAUDE.md와만 대조하므로, 파일은
// 만들었는데 server.ts 등록을 빠뜨리면 "실제 값"이 그 누락을 포함한 채로 계산된다 —
// 카운트는 맞고 tool은 안 뜨는 상태로 통과하고, `--write`는 오히려 숫자를 맞춰 은폐한다.
// README 검사(3번)도 tools/ 쪽 이름만 보므로 이 드리프트를 못 잡는다.
const exportedRegistrars = new Map();
for (const file of readdirSync(join(ROOT, "src/tools"))) {
  if (!file.endsWith(".ts")) continue;
  for (const m of read(join("src/tools", file)).matchAll(/export function (register\w+Tool)/g)) {
    exportedRegistrars.set(m[1], file);
  }
}
const calledRegistrars = new Set(registrations.map((r) => r.replace("(server)", "")));

const unregistered = [...exportedRegistrars.keys()].filter((n) => !calledRegistrars.has(n));
const orphanCalls = [...calledRegistrars].filter((n) => !exportedRegistrars.has(n));

if (unregistered.length === 0 && orphanCalls.length === 0) {
  console.log(`✓ server.ts 등록 — ${exportedRegistrars.size}개 register*Tool 전부 호출됨`);
} else {
  for (const n of unregistered) {
    errors.push(`✗ ${n} (src/tools/${exportedRegistrars.get(n)})이 server.ts에 등록되지 않았습니다`);
  }
  for (const n of orphanCalls) {
    errors.push(`✗ server.ts가 ${n}을 부르는데 src/tools/ 어디에도 export가 없습니다`);
  }
}

// ── 5. 레이어 불변식 — 순환 · 방향 · client.call 봉인 ──────────────────
// CLAUDE.md가 "절대 규칙"과 "아키텍처"에 글로만 적어 둔 셋이다. 셋 다 어겨도 typecheck와
// 테스트는 초록으로 통과한다 — 포맷터 테스트는 받은 값을 렌더할 뿐이고 순환 import는
// ESM에서 런타임에야 undefined로 터진다. 그래서 검사로 옮긴다. 카운트 검사(2번)와 달리
// CLAUDE.md의 숫자와 대조하지 않는다 — 건수를 문서에 박으면 그 숫자가 또 낡는다.
//
//  (a) 순환 의존 0건
//  (b) 하위(kiwoom/·utils/)가 상위(tools/·isa/·server·http·oauth·context)를 import하지 않는다
//  (c) `.call(`은 kiwoom/api.ts 안에서만 — client.ts의 재시도 로직이 안전한 건 "모든 TR은
//      조회"라는 전제 위에 있고, 그 전제는 모든 호출이 api.ts의 fetch*를 거칠 때만 성립한다
const srcFiles = readdirSync(join(ROOT, "src"), { recursive: true })
  .filter((f) => typeof f === "string" && f.endsWith(".ts"))
  .map((f) => f.split(/[\\/]/).join("/"));

/** NodeNext라 소스는 `../kiwoom/api.js`로 적고 실제 파일은 `.ts`다. */
const resolveRel = (fromRel, spec) => {
  const out = [];
  for (const part of fromRel.split("/").slice(0, -1).concat(spec.split("/"))) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/").replace(/\.js$/, ".ts");
};

// `from "./x.js"`만 보면 side-effect import(`import "./x.js"`)와 동적 import를 통째로
// 놓친다 — 실패 주입으로 확인했다(그 형태로 순환을 만들어도 검사가 초록이었다).
// 없는 대상을 잡아도 아래에서 걸러지므로 넓게 잡는 쪽이 안전하다.
const IMPORT_SPEC = /(?:\bfrom\s+|\bimport\s*\(?\s*)"(\.[^"]+)"/g;

const importsOf = new Map();
for (const rel of srcFiles) {
  const text = read(join("src", rel));
  importsOf.set(rel, [...text.matchAll(IMPORT_SPEC)].map((m) => resolveRel(rel, m[1])));
}

// (a) 순환 — 진행 중(1)인 노드로 되돌아가면 그 지점부터가 사이클이다.
const cycles = new Set();
const color = new Map();
const walk = (node, stack) => {
  color.set(node, 1);
  stack.push(node);
  for (const target of importsOf.get(node) ?? []) {
    if (!importsOf.has(target)) continue; // 존재하지 않는 대상은 typecheck가 잡는다
    if (color.get(target) === 1) cycles.add([...stack.slice(stack.indexOf(target)), target].join(" → "));
    else if (!color.has(target)) walk(target, stack);
  }
  color.set(node, 2);
  stack.pop();
};
for (const f of importsOf.keys()) if (!color.has(f)) walk(f, []);

if (cycles.size === 0) {
  console.log(`✓ 순환 의존 없음 — ${importsOf.size}개 모듈`);
} else {
  for (const c of cycles) errors.push(`✗ 순환 의존: ${c}`);
}

// (b) 방향 — config.ts는 상위가 아니다(client/auth가 정상적으로 읽는 자리다).
const APP_ROOTS = new Set(["server.ts", "http.ts", "oauth.ts", "context.ts", "index.ts"]);
const isLower = (p) => /^(kiwoom|utils)\//.test(p);
const isUpper = (p) => /^(tools|isa)\//.test(p) || APP_ROOTS.has(p);

const upward = [];
for (const [from, targets] of importsOf) {
  if (!isLower(from)) continue;
  for (const target of targets) if (isUpper(target)) upward.push(`${from} → ${target}`);
}

if (upward.length === 0) {
  console.log("✓ 레이어 방향 — kiwoom/·utils/가 상위를 import하지 않음");
} else {
  for (const u of upward) errors.push(`✗ 레이어 역방향 import: ${u}`);
}

// (c) `Function.prototype.call`을 쓰면 여기 걸린다 — 이 저장소는 안 쓰므로 그대로 둔다.
// 걸리면 그건 "왜 call을 쓰는가"를 되묻는 편이 맞다.
const CALL_OWNER = "kiwoom/api.ts";
const strayCalls = srcFiles
  .filter((rel) => rel !== CALL_OWNER)
  .map((rel) => [rel, countOf(read(join("src", rel)), /\.call\(/g)])
  .filter(([, n]) => n > 0);

if (strayCalls.length === 0) {
  console.log(`✓ client.call 봉인 — ${countOf(read(join("src", CALL_OWNER)), /\.call\(/g)}곳 전부 ${CALL_OWNER}`);
} else {
  for (const [rel, n] of strayCalls) errors.push(`✗ ${CALL_OWNER} 밖에서 .call( 사용: src/${rel} (${n}곳)`);
}

// ── 6. description·describe의 tool 상호참조가 실존하는지 ───────────────
// 모델은 이 문구를 읽고 tool을 고른다 — "특정 종목 하나는 get_stock_price를 쓰세요" 같은
// 안내가 오타나 이름 변경으로 없는 tool을 가리키면, 모델은 그 이름을 부르려다 실패하거나
// 엉뚱한 tool로 흘러간다. typecheck는 문자열 안을 안 보고 포맷터 테스트는 description을
// 렌더하지 않으므로 둘 다 이걸 못 잡는다. 2026-08-19 라우팅 감사에서 상호참조 자체가
// 라우팅의 주 근거임이 확인돼(모델 3종 52문항) 검사로 승격했다.
const referenced = new Map(); // ref → [곳]
for (const file of readdirSync(join(ROOT, "src/tools"))) {
  if (!file.endsWith(".ts")) continue;
  const text = read(join("src/tools", file));
  for (const m of text.matchAll(/\b(get_[a-z_]+|search_stock|calc_isa_tax_status|ping)\b/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], new Set());
    referenced.get(m[1]).add(file);
  }
}
const danglingRefs = [...referenced].filter(([ref]) => !toolNames.has(ref));

if (danglingRefs.length === 0) {
  console.log(`✓ tool 상호참조 — ${referenced.size}개 이름 전부 실존`);
} else {
  for (const [ref, files] of danglingRefs) {
    errors.push(`✗ 존재하지 않는 tool을 가리킵니다: ${ref} (src/tools/${[...files].join(", ")})`);
  }
}

// ── 7. 라우팅 시험 데이터가 코드와 붙어 있는지 ─────────────────────────
// `scripts/routing.py`는 모델이 카탈로그만 보고 옳은 tool을 고르는지 잰다(2026-08-19 첫 측정).
// 그 정답표(`scripts/routing/key.json`)는 tool 이름과 파라미터 이름을 **문자열로** 들고 있어
// 개명 한 번에 조용히 낡는데, 시험 자체는 모델을 부르므로 CI에 없다 — 아무도 안 도는 동안
// 낡는다. 낡은 정답표의 증상 둘은 성격이 다르다:
//   - tool 이름이 낡으면 전 문항이 MISS로 쏟아져 **라우팅 회귀로 오독**된다.
//   - param_check의 이름이 낡으면 `__ABSENT__` 검사가 **영원히 통과**한다(넘길 리 없는 이름이니까).
//     q20의 `to_date`가 바로 그 자리다 — v0.52.3이 고친 회귀를 지키는 검사가 소리 없이 죽는다.
// 질문 수와 정답표 수가 어긋나는 것도 같은 부류다(질문만 늘리면 그 문항이 채점에서 빠진다).
const routingKey = JSON.parse(read("scripts/routing/key.json"));
const routingQuestions = new Set(
  read("scripts/routing/questions.md")
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\.\s+\S/))
    .filter(Boolean)
    .map((m) => m[1]),
);

// tool별 입력 파라미터 이름 — `inputSchema: {` 뒤의 `이름: z.`를 그 tool 블록 안에서만 줍는다.
const paramsOf = new Map();
for (const file of readdirSync(join(ROOT, "src/tools"))) {
  if (!file.endsWith(".ts")) continue;
  const text = read(join("src/tools", file));
  const blocks = text.split(/server\.registerTool\(/).slice(1);
  for (const block of blocks) {
    const name = block.match(/^\s*"([a-z_]+)"/)?.[1];
    if (!name) continue;
    const schema = block.slice(block.indexOf("inputSchema:"));
    // `view: z\n  .enum(...)`처럼 줄바꿈이 끼므로 `z.`이 아니라 `z` 경계까지만 요구한다.
    paramsOf.set(name, new Set([...schema.matchAll(/^\s+(\w+):\s*z\b/gm)].map((m) => m[1])));
  }
}

const routingProblems = [];
const keyQuestions = new Set(Object.keys(routingKey));
for (const q of keyQuestions) if (!routingQuestions.has(q)) routingProblems.push(`정답표에만 있는 문항 q${q}`);
for (const q of routingQuestions) if (!keyQuestions.has(q)) routingProblems.push(`질문에만 있고 정답이 없는 문항 q${q} — 채점에서 통째로 빠집니다`);

for (const [q, entry] of Object.entries(routingKey)) {
  // "NONE"은 "이 서버로는 못 한다"가 정답이라는 뜻의 가짜 이름이라 실존하지 않는 게 정상이다.
  for (const t of [entry.tool, ...(entry.also_ok ?? [])]) {
    if (t !== "NONE" && !toolNames.has(t)) routingProblems.push(`q${q}가 없는 tool을 가리킵니다: ${t}`);
  }
  for (const p of Object.keys(entry.param_check ?? {})) {
    const known = paramsOf.get(entry.tool);
    if (known && !known.has(p)) routingProblems.push(`q${q} param_check의 ${p}는 ${entry.tool}의 파라미터가 아닙니다`);
  }
}

if (routingProblems.length === 0) {
  console.log(`✓ 라우팅 시험 데이터 — 질문 ${routingQuestions.size}개 · 정답표의 tool·파라미터 전부 실존`);
} else {
  for (const p of routingProblems) errors.push(`✗ 라우팅 정답표: ${p}`);
}

// ── 결과 ───────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`⚠️  ${w}`);
for (const e of errors) console.error(e);

if (errors.length > 0) {
  console.error(
    "\n버전은 5곳(package.json / server.json ×2 / src/server.ts / package-lock.json)을\n" +
      "함께 올리고 — lockfile은 `npm install --package-lock-only`로 맞춥니다 —\n" +
      "카운트는 CLAUDE.md의 숫자를 실제 값으로,\n" +
      "README는 빠진 tool을 README.md/README.en.md 양쪽에 적으면 됩니다.",
  );
  process.exit(1);
}
