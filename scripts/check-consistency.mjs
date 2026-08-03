#!/usr/bin/env node
/**
 * 손으로 맞춰야 하는 두 가지가 어긋났는지 본다.
 *
 * 1. 버전 4곳 동기화 — package.json / server.json ×2 / src/server.ts
 * 2. CLAUDE.md의 실측 카운트 — tool 수, looseObject 수, TR fixture 파일 수
 *
 * 둘 다 라운드마다 사람이 갱신해야 해서 조용히 어긋난다. 실제로 looseObject가
 * 83으로 적혀 있는 동안 코드에는 85개가 있었고, eb4bd47은 그 드리프트를 고치기만
 * 하는 커밋이었다.
 *
 * 사용:
 *   node scripts/check-consistency.mjs              # 전부 실패로 취급 (CI)
 *   node scripts/check-consistency.mjs --warn-counts # 카운트는 경고만 (pre-commit)
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const warnCounts = process.argv.includes("--warn-counts");

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const countOf = (text, re) => (text.match(re) ?? []).length;

/** CLAUDE.md에 적힌 숫자를 뽑는다. 문구가 바뀌면 null → 그 항목은 검사하지 않는다. */
const stated = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
};

const errors = [];
const warnings = [];

// ── 1. 버전 4곳 ────────────────────────────────────────────────────────
const pkg = JSON.parse(read("package.json"));
const serverJson = JSON.parse(read("server.json"));
const serverTs = read("src/server.ts");

const versions = {
  "package.json": pkg.version,
  "server.json version": serverJson.version,
  "server.json packages[0].version": serverJson.packages?.[0]?.version,
  "src/server.ts SERVER_VERSION": serverTs.match(/SERVER_VERSION\s*=\s*"([^"]+)"/)?.[1],
};

const distinct = [...new Set(Object.values(versions))];
if (distinct.length === 1) {
  console.log(`✓ 버전 4곳 동기화 — ${distinct[0]}`);
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

const checks = [
  ["tool 수", stated(claudeMd, /기본 (\d+)개 tool/), actual.tool, "CLAUDE.md 첫 문단"],
  ["looseObject 수", stated(claudeMd, /looseObject (\d+)개/), actual.looseObject, "새 tool 추가 절차 1번"],
  ["z.object 수", stated(claudeMd, /`z\.object` (\d+)개/), actual.zObject, "새 tool 추가 절차 1번"],
  ["TR fixture 파일 수", stated(claudeMd, /TR 응답을 다루는 (\d+)개 파일/), actual.fixtureFiles, "테스트 섹션"],
];

for (const [label, statedValue, actualValue, where] of checks) {
  if (statedValue === null) {
    warnings.push(`? ${label} — CLAUDE.md에서 문구를 못 찾았습니다 (${where}). 표현이 바뀌었으면 이 스크립트도 고칠 것`);
  } else if (statedValue === actualValue) {
    console.log(`✓ ${label} — ${actualValue}`);
  } else {
    const msg = `${label} — CLAUDE.md ${statedValue} vs 실제 ${actualValue} (${where})`;
    if (warnCounts) warnings.push(msg);
    else errors.push(`✗ ${msg}`);
  }
}

// ── 결과 ───────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`⚠️  ${w}`);
for (const e of errors) console.error(e);

if (errors.length > 0) {
  console.error(
    "\n버전은 4곳(package.json / server.json ×2 / src/server.ts)을 함께 올리고,\n" +
      "카운트는 CLAUDE.md의 숫자를 실제 값으로 고치면 됩니다.",
  );
  process.exit(1);
}
