import http from "node:http";
import path from "node:path";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  handleOAuthRequest,
  OAuthProvider,
  requestBaseUrl,
  timingSafeStringEqual,
} from "./oauth.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const DEFAULT_PORT = 8000;
const DEFAULT_HOST = "127.0.0.1";
const MCP_PATH = "/mcp";
const HEALTH_PATH = "/healthz";

export interface HttpOptions {
  port: number;
  host: string;
  /** Bearer token every /mcp request must present. Undefined only with allowNoAuth. */
  authToken: string | undefined;
  /** Explicit opt-out of auth (--no-auth / MCP_HTTP_NO_AUTH) — off by default. */
  allowNoAuth: boolean;
  /** Optional canonical base URL (MCP_PUBLIC_URL) for OAuth issuer/metadata. */
  publicUrl?: string;
  /** OAuth token/client persistence path (default: <cwd>/.oauth-state.json). */
  oauthStatePath?: string;
}

export type TransportChoice = { mode: "stdio" } | { mode: "http"; options: HttpOptions };

/**
 * Decides the transport from CLI args + env. Pure (unit-testable): pass
 * process.argv.slice(2) and process.env. Defaults to stdio so existing
 * Claude Desktop/Code installs are untouched; HTTP is strictly opt-in.
 *
 * The auth token is env-only (MCP_AUTH_TOKEN) — a CLI flag would leak the
 * secret to `ps`. HTTP mode refuses to start without a token unless the
 * operator explicitly passes --no-auth: this server fronts a brokerage
 * account, so an unauthenticated public endpoint must be a deliberate act.
 */
export function chooseTransport(argv: string[], env: NodeJS.ProcessEnv): TransportChoice {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--port" || arg === "--host") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} 옵션에 값이 없습니다 (예: ${arg === "--port" ? "--port 8000" : "--host 127.0.0.1"}).`);
      }
      values.set(arg, value);
      i += 1;
    } else if (arg === "--http" || arg === "--stdio" || arg === "--no-auth") {
      flags.add(arg);
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg} (지원: --http, --stdio, --port <n>, --host <addr>, --no-auth)`);
    }
  }

  const envTransport = env.MCP_TRANSPORT?.trim().toLowerCase();
  if (envTransport !== undefined && envTransport !== "" && envTransport !== "stdio" && envTransport !== "http") {
    throw new Error(`MCP_TRANSPORT 값이 잘못되었습니다: "${env.MCP_TRANSPORT}" (stdio 또는 http).`);
  }
  const wantsHttp = flags.has("--http") || (!flags.has("--stdio") && envTransport === "http");
  if (!wantsHttp) return { mode: "stdio" };

  const portRaw = values.get("--port") ?? env.MCP_HTTP_PORT?.trim();
  let port = DEFAULT_PORT;
  if (portRaw !== undefined && portRaw !== "") {
    port = Number(portRaw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`포트가 잘못되었습니다: "${portRaw}" (0~65535 정수).`);
    }
  }

  const host = values.get("--host") ?? (env.MCP_HTTP_HOST?.trim() || DEFAULT_HOST);
  const allowNoAuth = flags.has("--no-auth") || env.MCP_HTTP_NO_AUTH?.trim().toLowerCase() === "true";
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;

  if (!authToken && !allowNoAuth) {
    throw new Error(
      "HTTP 모드에는 MCP_AUTH_TOKEN 환경변수가 필요합니다 (모든 /mcp 요청의 Bearer 토큰). " +
        "인증 없이 열려면 --no-auth를 명시하세요 — 계좌 조회 도구가 인터넷에 그대로 노출되므로 " +
        "신뢰할 수 있는 네트워크/모의투자(VIRTUAL) 환경에서만 권장합니다.",
    );
  }

  const publicUrl = env.MCP_PUBLIC_URL?.trim() || undefined;
  return { mode: "http", options: { port, host, authToken, allowNoAuth, publicUrl } };
}

/** Extracts the bearer credential from an Authorization header, if any. */
export function bearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match?.[1];
}

/** Timing-safe static bearer-token check. */
export function isAuthorized(authorizationHeader: string | undefined, token: string): boolean {
  const presented = bearerToken(authorizationHeader);
  return presented !== undefined && timingSafeStringEqual(presented, token);
}

function deny(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
  );
}

/**
 * Streamable HTTP endpoint for remote MCP clients (claude.ai custom
 * connectors, Claude Desktop/mobile via the account-brokered connector).
 * Stateless per the MCP spec: each request gets a fresh McpServer+transport
 * pair; the expensive state (Kiwoom token cache, ka10099 master-list cache)
 * lives at module level and is shared across requests.
 */
export function createHttpServer(options: HttpOptions): http.Server {
  // OAuth rides on the same consent secret as the static bearer: no token → no
  // OAuth endpoints (that is the explicit --no-auth everything-open mode).
  const oauth = options.authToken
    ? new OAuthProvider({
        consentToken: options.authToken,
        statePath: options.oauthStatePath ?? path.join(process.cwd(), ".oauth-state.json"),
      })
    : null;
  return http.createServer((req, res) => {
    void handleRequest(req, res, options, oauth).catch((error: unknown) => {
      console.error("HTTP request handling failed:", error);
      if (!res.headersSent) deny(res, 500, "internal server error");
    });
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: HttpOptions,
  oauth: OAuthProvider | null,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === HEALTH_PATH) {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  if (oauth && (await handleOAuthRequest(req, res, oauth, options.publicUrl))) {
    return;
  }

  if (url.pathname !== MCP_PATH) {
    deny(res, 404, `not found — MCP endpoint is ${MCP_PATH}`);
    return;
  }

  if (options.authToken) {
    const presented = bearerToken(req.headers.authorization);
    const ok =
      presented !== undefined &&
      (timingSafeStringEqual(presented, options.authToken) ||
        (oauth?.validateAccessToken(presented) ?? false));
    if (!ok) {
      // RFC 9728: point 401s at the protected-resource metadata so MCP
      // clients (claude.ai connectors) can discover the OAuth flow.
      res.setHeader(
        "WWW-Authenticate",
        `Bearer realm="${SERVER_NAME}", resource_metadata="${requestBaseUrl(req, options.publicUrl)}/.well-known/oauth-protected-resource"`,
      );
      deny(res, 401, "unauthorized — OAuth 승인 또는 Authorization: Bearer <MCP_AUTH_TOKEN> 헤더가 필요합니다");
      return;
    }
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export async function startHttpServer(options: HttpOptions): Promise<http.Server> {
  const server = createHttpServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : options.port;
  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} listening on http://${options.host}:${boundPort}${MCP_PATH} ` +
      `(auth: ${options.authToken ? "bearer token" : "NONE — --no-auth"})`,
  );
  if (!options.authToken) {
    console.error(
      "⚠️  인증 없이 실행 중입니다. 이 서버는 계좌 조회 도구를 노출하므로 공개 네트워크에 직접 연결하지 마세요.",
    );
  }
  return server;
}
