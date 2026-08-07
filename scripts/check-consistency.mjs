#!/usr/bin/env node
/**
 * 손으로 맞춰야 하는 세 가지가 어긋났는지 본다.
 *
 * 1. 버전 5곳 동기화 — package.json / server.json ×2 / src/server.ts / package-lock.json
 * 2. CLAUDE.md의 실측 카운트 — tool 수, looseObject 수, TR fixture 파일 수
 * 3. README 2종에 tool이 문서화됐는지 — 한쪽만 고치고 넘어가기 쉬운 자리다
 *
 * 둘 다 라운드마다 사람이 갱신해야 해서 조용히 어긋난다. 실제로 looseObject가
 * 83으로 적혀 있는 동안 코드에는 85개가 있었고, eb4bd47은 그 드리프트를 고치기만
 * 하는 커밋이었다.
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
