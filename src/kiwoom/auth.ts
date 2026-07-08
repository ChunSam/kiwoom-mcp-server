import type { AppConfig } from "../config.js";
import { redactSecrets } from "../utils/redact.js";
import { KiwoomAuthError } from "./errors.js";
import { tokenResponseSchema } from "./types.js";

/** Refresh this long before the reported expiry to avoid using a token mid-expiration. */
const EXPIRY_MARGIN_MS = 60_000;
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Parses Kiwoom's expires_dt ("yyyyMMddHHmmss", KST) into a unix epoch (ms).
 * Returns null when the format is unrecognized.
 */
export function parseExpiresDt(expiresDt: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(expiresDt.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  // KST is UTC+9 with no DST; subtract 9h to convert to UTC.
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(s));
}

export class TokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;

  constructor(private readonly config: AppConfig) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) {
      return this.token;
    }
    // Concurrent tool calls share a single issuance request.
    this.inflight ??= this.issueToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Drops the cached token, forcing re-issuance on the next call (e.g. after a 401). */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  private async issueToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: this.config.appKey,
          secretkey: this.config.appSecret,
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch (error) {
      throw new KiwoomAuthError(
        `키움 토큰 발급 요청이 실패했습니다 (네트워크 오류 또는 시간 초과): ${this.describe(error)}`,
      );
    }

    const rawBody = await response.text();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      throw new KiwoomAuthError(
        `키움 토큰 발급 응답을 해석할 수 없습니다 (HTTP ${response.status}): ${this.snippet(rawBody)}`,
      );
    }

    const body = tokenResponseSchema.parse(parsedJson);
    const returnCode = Number(body.return_code ?? (response.ok ? 0 : -1));

    if (!response.ok || returnCode !== 0 || !body.token) {
      const reason = body.return_msg?.trim() || `HTTP ${response.status}`;
      throw new KiwoomAuthError(
        `키움 인증에 실패했습니다: ${reason}. .env의 KIWOOM_APP_KEY/KIWOOM_APP_SECRET과 ` +
          `KIWOOM_MODE(현재 ${this.config.mode})가 앱 등록 정보와 일치하는지 확인해 주세요.`,
      );
    }

    this.token = body.token;
    this.expiresAt = body.expires_dt ? (parseExpiresDt(body.expires_dt) ?? this.fallbackExpiry()) : this.fallbackExpiry();
    return this.token;
  }

  /** Conservative fallback when expires_dt is missing or malformed. */
  private fallbackExpiry(): number {
    return Date.now() + 10 * 60_000;
  }

  private describe(error: unknown): string {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return redactSecrets(text, [this.config.appKey, this.config.appSecret, this.token]);
  }

  private snippet(rawBody: string): string {
    return redactSecrets(rawBody.slice(0, 200), [this.config.appKey, this.config.appSecret, this.token]);
  }
}
