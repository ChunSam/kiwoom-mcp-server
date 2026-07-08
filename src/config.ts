import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

/**
 * Treat an empty / whitespace-only env value the same as "unset", so a blank
 * line in `.env` (e.g. the shipped `.env.example`'s `ISA_OPENED_ON=`, or a
 * mock/general account that never uses ISA) falls back to the field's default /
 * optional instead of failing validation. Without this, one stray empty value
 * would throw at config load and break every tool, not just the ISA one.
 */
const emptyToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const envSchema = z.object({
  KIWOOM_APP_KEY: z.string().min(1),
  KIWOOM_APP_SECRET: z.string().min(1),
  KIWOOM_MODE: z.preprocess(emptyToUndefined, z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL")),
  ISA_TYPE: z.preprocess(emptyToUndefined, z.enum(["GENERAL", "SEOMIN"]).default("GENERAL")),
  /** ISA account opening date — default aggregation start for tax-status math. */
  ISA_OPENED_ON: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-?\d{2}-?\d{2}$/)
      .optional(),
  ),
});

const BASE_URLS = {
  VIRTUAL: "https://mockapi.kiwoom.com",
  REAL: "https://api.kiwoom.com",
} as const;

const MODE_LABELS = {
  VIRTUAL: "모의투자",
  REAL: "실전투자",
} as const;

export interface AppConfig {
  appKey: string;
  appSecret: string;
  mode: "VIRTUAL" | "REAL";
  modeLabel: string;
  isaType: "GENERAL" | "SEOMIN";
  /** yyyyMMdd, normalized; undefined when not configured. */
  isaOpenedOn: string | undefined;
  baseUrl: string;
}

let cached: AppConfig | null = null;

function loadDotEnv(): void {
  // Claude Desktop launches this server with an arbitrary cwd, so resolve .env
  // relative to the project root (parent of dist/ or src/) first.
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const candidate of [path.join(projectRoot, ".env"), path.join(process.cwd(), ".env")]) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // File missing — try the next candidate; env vars may also be set directly.
    }
  }
}

/** Pure env → config mapping (no file I/O), so it is unit-testable. */
export function buildConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(
      `환경설정이 없거나 잘못되었습니다: ${problems}. ` +
        `프로젝트 루트의 .env.example을 .env로 복사한 뒤 키움 REST API 앱키를 입력해 주세요.`,
    );
  }

  const e = parsed.data;
  return {
    appKey: e.KIWOOM_APP_KEY,
    appSecret: e.KIWOOM_APP_SECRET,
    mode: e.KIWOOM_MODE,
    modeLabel: MODE_LABELS[e.KIWOOM_MODE],
    isaType: e.ISA_TYPE,
    isaOpenedOn: e.ISA_OPENED_ON?.replaceAll("-", ""),
    baseUrl: BASE_URLS[e.KIWOOM_MODE],
  };
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  loadDotEnv();
  cached = buildConfig(process.env);
  return cached;
}
