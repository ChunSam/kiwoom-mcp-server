import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type http from "node:http";

/**
 * Minimal built-in OAuth 2.0 authorization server for the HTTP transport,
 * implementing what the MCP authorization spec expects from a remote server
 * (claude.ai custom connectors drive this flow):
 *
 *   401 + WWW-Authenticate → RFC 9728 protected-resource metadata
 *   → RFC 8414 authorization-server metadata → RFC 7591 dynamic client
 *   registration → authorization-code + PKCE(S256) → opaque bearer tokens.
 *
 * Consent model: this server fronts ONE owner's brokerage account, so the
 * /authorize page asks for the pre-shared MCP_AUTH_TOKEN as an access
 * password instead of a user login. One secret serves both auth paths
 * (static bearer for header-capable clients, OAuth consent for claude.ai).
 */

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Consent brute-force guard: max failures per window, shared across IPs. */
const MAX_CONSENT_FAILURES = 10;
const CONSENT_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

interface OAuthClient {
  clientId: string;
  redirectUris: string[];
  clientName: string;
  createdAt: number;
}

interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}

interface TokenRecord {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  accessExpiresAt: number;
  createdAt: number;
}

interface PersistedState {
  clients: OAuthClient[];
  tokens: TokenRecord[];
}

const token = (bytes = 32): string => randomBytes(bytes).toString("hex");

const sha256base64url = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

/** Timing-safe string comparison (hash first so lengths never short-circuit). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

/** PKCE S256: does sha256(verifier) match the stored challenge? */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  return timingSafeStringEqual(sha256base64url(codeVerifier), codeChallenge);
}

const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** https-only redirect URIs, except loopback for local development. */
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export class OAuthProvider {
  private readonly consentToken: string;
  private readonly statePath: string | undefined;
  private clients = new Map<string, OAuthClient>();
  private codes = new Map<string, AuthCode>();
  private tokens = new Map<string, TokenRecord>(); // keyed by accessToken
  private refresh = new Map<string, TokenRecord>(); // keyed by refreshToken
  private consentFailures = 0;
  private consentWindowStart = 0;

  constructor(options: { consentToken: string; statePath?: string }) {
    this.consentToken = options.consentToken;
    this.statePath = options.statePath;
    this.load();
  }

  private load(): void {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const state = JSON.parse(readFileSync(this.statePath, "utf8")) as PersistedState;
      for (const c of state.clients ?? []) this.clients.set(c.clientId, c);
      for (const t of state.tokens ?? []) {
        this.tokens.set(t.accessToken, t);
        this.refresh.set(t.refreshToken, t);
      }
    } catch (error) {
      // A corrupt state file only means connectors must re-authorize.
      console.error("OAuth state file unreadable — starting empty:", error);
    }
  }

  private save(): void {
    if (!this.statePath) return;
    const state: PersistedState = {
      clients: [...this.clients.values()],
      tokens: [...this.refresh.values()],
    };
    try {
      writeFileSync(this.statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error("Failed to persist OAuth state:", error);
    }
  }

  registerClient(meta: {
    redirect_uris?: unknown;
    client_name?: unknown;
  }): OAuthClient | { error: string } {
    const uris = Array.isArray(meta.redirect_uris)
      ? meta.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (uris.length === 0 || !uris.every(isAllowedRedirectUri)) {
      return { error: "redirect_uris must be https URLs (or http loopback)" };
    }
    const client: OAuthClient = {
      clientId: token(16),
      redirectUris: uris,
      clientName: typeof meta.client_name === "string" ? meta.client_name.slice(0, 200) : "",
      createdAt: Date.now(),
    };
    this.clients.set(client.clientId, client);
    this.save();
    return client;
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  consentRateLimited(): boolean {
    if (Date.now() - this.consentWindowStart > CONSENT_FAILURE_WINDOW_MS) return false;
    return this.consentFailures >= MAX_CONSENT_FAILURES;
  }

  /** Validates the consent password; counts failures for the rate limit. */
  checkConsent(password: string): boolean {
    if (timingSafeStringEqual(password, this.consentToken)) return true;
    if (Date.now() - this.consentWindowStart > CONSENT_FAILURE_WINDOW_MS) {
      this.consentWindowStart = Date.now();
      this.consentFailures = 0;
    }
    this.consentFailures += 1;
    return false;
  }

  createCode(clientId: string, redirectUri: string, codeChallenge: string): string {
    const code: AuthCode = {
      code: token(24),
      clientId,
      redirectUri,
      codeChallenge,
      expiresAt: Date.now() + CODE_TTL_MS,
    };
    this.codes.set(code.code, code);
    return code.code;
  }

  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): TokenRecord | { error: string } {
    const record = this.codes.get(params.code);
    this.codes.delete(params.code); // single-use, even on failure
    if (!record || record.expiresAt < Date.now()) return { error: "invalid_grant" };
    if (record.clientId !== params.clientId || record.redirectUri !== params.redirectUri) {
      return { error: "invalid_grant" };
    }
    if (!verifyPkce(params.codeVerifier, record.codeChallenge)) return { error: "invalid_grant" };
    return this.issueTokens(record.clientId);
  }

  refreshTokens(refreshToken: string, clientId: string): TokenRecord | { error: string } {
    const record = this.refresh.get(refreshToken);
    if (!record || record.clientId !== clientId) return { error: "invalid_grant" };
    // Rotate: the presented refresh token is spent either way.
    this.refresh.delete(refreshToken);
    this.tokens.delete(record.accessToken);
    return this.issueTokens(clientId);
  }

  private issueTokens(clientId: string): TokenRecord {
    const record: TokenRecord = {
      accessToken: token(32),
      refreshToken: token(32),
      clientId,
      accessExpiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
      createdAt: Date.now(),
    };
    this.tokens.set(record.accessToken, record);
    this.refresh.set(record.refreshToken, record);
    this.save();
    return record;
  }

  validateAccessToken(accessToken: string): boolean {
    const record = this.tokens.get(accessToken);
    return record !== undefined && record.accessExpiresAt > Date.now();
  }
}

/** Base URL for metadata/issuer: explicit override, else the request's own host. */
export function requestBaseUrl(req: http.IncomingMessage, publicUrl?: string): string {
  if (publicUrl) return publicUrl.replace(/\/+$/, "");
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() ||
    "http";
  return `${proto}://${req.headers.host ?? "localhost"}`;
}

export function buildProtectedResourceMetadata(base: string): object {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
  };
}

export function buildAuthServerMetadata(base: string): object {
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [],
  };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBodyParams(raw: string, contentType: string | undefined): Record<string, string> {
  if (contentType?.includes("application/json")) {
    const parsed: unknown = JSON.parse(raw);
    const out: Record<string, string> = {};
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function sendJson(res: http.ServerResponse, status: number, body: object): void {
  res
    .writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    .end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, status: number, body: string): void {
  res
    .writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    })
    .end(body);
}

function consentPage(fields: Record<string, string>, clientName: string, error?: string): string {
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n      ");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>kiwoom-mcp-server 연결 승인</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 26rem; margin: 4rem auto; padding: 0 1rem; }
  input[type=password] { width: 100%; padding: .6rem; font-size: 1rem; margin: .8rem 0; box-sizing: border-box; }
  button { padding: .6rem 1.4rem; font-size: 1rem; }
  .err { color: #c0392b; }
  .meta { color: #666; font-size: .85rem; }
</style></head>
<body>
  <h2>kiwoom-mcp-server 연결 승인</h2>
  <p>클라이언트${clientName ? ` <strong>${escapeHtml(clientName)}</strong>` : ""}가 이 서버의
  주식 조회 도구(읽기 전용)에 접근하려고 합니다.</p>
  <p class="meta">승인하려면 서버의 <code>MCP_AUTH_TOKEN</code> 값을 입력하세요.</p>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="/authorize">
      ${hidden}
      <input type="password" name="password" placeholder="접속 암호 (MCP_AUTH_TOKEN)" autofocus required>
      <button type="submit">승인</button>
  </form>
</body></html>`;
}

interface AuthorizeParams {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

/** Shared /authorize validation for GET (render) and POST (approve). */
function validateAuthorizeParams(
  provider: OAuthProvider,
  q: Record<string, string>,
  res: http.ServerResponse,
): AuthorizeParams | null {
  const client = q.client_id ? provider.getClient(q.client_id) : undefined;
  if (!client) {
    sendHtml(res, 400, consentPage({}, "", "알 수 없는 client_id입니다. 커넥터를 다시 등록해 주세요."));
    return null;
  }
  const redirectUri = q.redirect_uri ?? "";
  if (!client.redirectUris.includes(redirectUri)) {
    sendHtml(res, 400, consentPage({}, client.clientName, "redirect_uri가 등록된 값과 다릅니다."));
    return null;
  }
  // From here on the redirect target is trusted — protocol errors go back via redirect.
  const redirectError = (error: string): null => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (q.state) url.searchParams.set("state", q.state);
    res.writeHead(302, { Location: url.toString() }).end();
    return null;
  };
  if (q.response_type !== "code") return redirectError("unsupported_response_type");
  if (!q.code_challenge || (q.code_challenge_method ?? "S256") !== "S256") {
    return redirectError("invalid_request");
  }
  return { client, redirectUri, codeChallenge: q.code_challenge, state: q.state ?? "" };
}

/**
 * Handles OAuth endpoints. Returns true when the request was consumed.
 * Wire this BEFORE the /mcp route; call only when auth is enabled.
 */
export async function handleOAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  provider: OAuthProvider,
  publicUrl?: string,
): Promise<boolean> {
  const base = requestBaseUrl(req, publicUrl);
  const url = new URL(req.url ?? "/", base);

  if (url.pathname === "/.well-known/oauth-protected-resource") {
    sendJson(res, 200, buildProtectedResourceMetadata(base));
    return true;
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    sendJson(res, 200, buildAuthServerMetadata(base));
    return true;
  }

  if (url.pathname === "/register" && req.method === "POST") {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "invalid_client_metadata" });
      return true;
    }
    const client = provider.registerClient(meta);
    if ("error" in client) {
      sendJson(res, 400, { error: "invalid_redirect_uri", error_description: client.error });
      return true;
    }
    sendJson(res, 201, {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      redirect_uris: client.redirectUris,
      client_name: client.clientName || undefined,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    return true;
  }

  if (url.pathname === "/authorize" && req.method === "GET") {
    const q = Object.fromEntries(url.searchParams);
    const params = validateAuthorizeParams(provider, q, res);
    if (!params) return true;
    sendHtml(
      res,
      200,
      consentPage(
        {
          client_id: params.client.clientId,
          redirect_uri: params.redirectUri,
          state: params.state,
          code_challenge: params.codeChallenge,
          code_challenge_method: "S256",
          response_type: "code",
        },
        params.client.clientName,
      ),
    );
    return true;
  }

  if (url.pathname === "/authorize" && req.method === "POST") {
    let form: Record<string, string>;
    try {
      form = parseBodyParams(await readBody(req), req.headers["content-type"]);
    } catch {
      sendHtml(res, 400, consentPage({}, "", "요청을 읽지 못했습니다. 다시 시도해 주세요."));
      return true;
    }
    const params = validateAuthorizeParams(provider, form, res);
    if (!params) return true;
    if (provider.consentRateLimited()) {
      sendHtml(res, 429, consentPage({}, params.client.clientName, "시도 횟수를 초과했습니다. 10분 후 다시 시도해 주세요."));
      return true;
    }
    if (!provider.checkConsent(form.password ?? "")) {
      const { password: _password, ...fields } = form;
      sendHtml(res, 401, consentPage(fields, params.client.clientName, "접속 암호가 일치하지 않습니다."));
      return true;
    }
    const code = provider.createCode(params.client.clientId, params.redirectUri, params.codeChallenge);
    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);
    res.writeHead(302, { Location: target.toString() }).end();
    return true;
  }

  if (url.pathname === "/token" && req.method === "POST") {
    let form: Record<string, string>;
    try {
      form = parseBodyParams(await readBody(req), req.headers["content-type"]);
    } catch {
      sendJson(res, 400, { error: "invalid_request" });
      return true;
    }
    let result: TokenRecord | { error: string };
    if (form.grant_type === "authorization_code") {
      result = provider.exchangeCode({
        code: form.code ?? "",
        codeVerifier: form.code_verifier ?? "",
        clientId: form.client_id ?? "",
        redirectUri: form.redirect_uri ?? "",
      });
    } else if (form.grant_type === "refresh_token") {
      result = provider.refreshTokens(form.refresh_token ?? "", form.client_id ?? "");
    } else {
      sendJson(res, 400, { error: "unsupported_grant_type" });
      return true;
    }
    if ("error" in result) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: result.refreshToken,
    });
    return true;
  }

  return false;
}
