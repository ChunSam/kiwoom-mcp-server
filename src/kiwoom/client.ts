import type { AppConfig } from "../config.js";
import { redactSecrets } from "../utils/redact.js";
import { sleep } from "../utils/sleep.js";
import type { TokenManager } from "./auth.js";
import { KiwoomApiError } from "./errors.js";

const REQUEST_TIMEOUT_MS = 10_000;
/** Kiwoom enforces ~1 req/s per TR (burst 2); 429 backoff must exceed 1s. */
const RETRY_429_BASE_MS = 1_300;
const RETRY_5XX_BASE_MS = 800;
const MAX_RETRIES = 2;

export interface KiwoomRequest {
  path: string;
  apiId: string;
  body: Record<string, string>;
  /** Set when fetching a continuation page. */
  contYn?: "Y";
  nextKey?: string;
}

export interface KiwoomResponse {
  json: unknown;
  hasNext: boolean;
  nextKey: string;
}

export class KiwoomClient {
  constructor(
    private readonly config: AppConfig,
    private readonly tokens: TokenManager,
  ) {}

  /**
   * Calls one Kiwoom REST TR. All TRs this server uses are read-only queries,
   * so retrying on transient failures (network, 429, 5xx) is safe.
   */
  async call(request: KiwoomRequest): Promise<KiwoomResponse> {
    let tokenRetryUsed = false;
    let retries = 0;

    while (true) {
      const token = await this.tokens.getToken();

      let response: Response;
      try {
        response = await fetch(`${this.config.baseUrl}${request.path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            authorization: `Bearer ${token}`,
            "api-id": request.apiId,
            ...(request.contYn ? { "cont-yn": request.contYn, "next-key": request.nextKey ?? "" } : {}),
          },
          body: JSON.stringify(request.body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (retries < 1) {
          retries += 1;
          await sleep(RETRY_5XX_BASE_MS);
          continue;
        }
        throw new KiwoomApiError(
          `키움 API 요청이 실패했습니다 (네트워크 오류 또는 시간 초과, ${request.apiId}): ${this.describe(error, token)}`,
          { apiId: request.apiId },
        );
      }

      if (response.status === 401 && !tokenRetryUsed) {
        tokenRetryUsed = true;
        this.tokens.invalidate();
        continue;
      }

      if ((response.status === 429 || response.status >= 500) && retries < MAX_RETRIES) {
        retries += 1;
        const base = response.status === 429 ? RETRY_429_BASE_MS : RETRY_5XX_BASE_MS;
        await sleep(base * retries);
        continue;
      }

      if (!response.ok) {
        throw new KiwoomApiError(this.httpErrorMessage(response.status, request.apiId), {
          httpStatus: response.status,
          apiId: request.apiId,
        });
      }

      const rawBody = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        throw new KiwoomApiError(
          `키움 API 응답을 해석할 수 없습니다 (${request.apiId}): ${redactSecrets(rawBody.slice(0, 200), [token])}`,
          { apiId: request.apiId },
        );
      }

      const envelope = json as { return_code?: string | number; return_msg?: string };
      const returnCode = Number(envelope.return_code ?? 0);
      if (returnCode !== 0) {
        const reason = envelope.return_msg?.trim() || "원인 미상";
        throw new KiwoomApiError(`키움 API 오류 (${request.apiId}, code ${returnCode}): ${reason}`, {
          returnCode,
          apiId: request.apiId,
        });
      }

      return {
        json,
        hasNext: response.headers.get("cont-yn") === "Y",
        nextKey: response.headers.get("next-key") ?? "",
      };
    }
  }

  private httpErrorMessage(status: number, apiId: string): string {
    if (status === 401 || status === 403) {
      return `키움 API 인증이 거부되었습니다 (${apiId}, HTTP ${status}). 앱키 상태와 KIWOOM_MODE를 확인해 주세요.`;
    }
    if (status === 429) {
      return `키움 API 요청 한도를 초과했습니다 (${apiId}). 잠시 후 다시 시도해 주세요.`;
    }
    if (status >= 500) {
      return `키움 서버 오류입니다 (${apiId}, HTTP ${status}). 잠시 후 다시 시도해 주세요.`;
    }
    return `키움 API 요청이 거부되었습니다 (${apiId}, HTTP ${status}).`;
  }

  private describe(error: unknown, token: string): string {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return redactSecrets(text, [this.config.appKey, this.config.appSecret, token]);
  }
}
