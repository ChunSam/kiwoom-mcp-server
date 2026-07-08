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

/**
 * Parse a boolean-ish env string. Only an explicit truthy token
 * ("true"/"1"/"yes"/"on", case-insensitive) is true — so unset, blank, and
 * "false" all mean disabled. Keeps ISA opt-in unambiguous.
 */
export const parseBool = (v: unknown): boolean =>
  typeof v === "string" && ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());

const envSchema = z.object({
  KIWOOM_APP_KEY: z.string().min(1),
  KIWOOM_APP_SECRET: z.string().min(1),
  KIWOOM_MODE: z.preprocess(emptyToUndefined, z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL")),
  /**
   * Opt-in switch for the ISA tax tool. Off by default so the server is
   * general-account-first; ISA users set ISA_ENABLED=true (+ the two fields
   * below). ISA_TYPE / ISA_OPENED_ON are only consulted when this is true.
   */
  ISA_ENABLED: z.preprocess((v) => parseBool(v), z.boolean()),
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
  /** Whether the optional ISA tax tool is enabled (general-account-first when false). */
  isaEnabled: boolean;
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
    isaEnabled: e.ISA_ENABLED,
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

/**
 * Lightweight startup check used to decide whether to register the optional ISA
 * tax tool. Loads `.env` if present and reads only the opt-in flag — it does NOT
 * validate credentials, so the server still starts (and `ping` works) without a
 * full config. Defaults to false → general-account-first.
 */
export function isIsaEnabled(): boolean {
  loadDotEnv();
  return parseBool(process.env.ISA_ENABLED);
}
