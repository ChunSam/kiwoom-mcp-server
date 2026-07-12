import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createHttpServer } from "../src/http.js";
import {
  buildAuthServerMetadata,
  buildProtectedResourceMetadata,
  isAllowedRedirectUri,
  OAuthProvider,
  verifyPkce,
} from "../src/oauth.js";

const CONSENT = "consent-secret-token";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const tempDir = mkdtempSync(path.join(tmpdir(), "kiwoom-oauth-"));
const statePath = (name: string) => path.join(tempDir, `${name}.json`);

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

describe("PKCE / redirect URI validation", () => {
  it("accepts a matching S256 verifier and rejects a wrong one", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("something-else", challenge)).toBe(false);
  });

  it("allows https and loopback http redirect URIs only", () => {
    expect(isAllowedRedirectUri(REDIRECT)).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3000/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://evil.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
});

describe("metadata builders", () => {
  it("points the protected resource at /mcp and the AS at itself", () => {
    const base = "https://kiwoom.example.com";
    expect(buildProtectedResourceMetadata(base)).toMatchObject({
      resource: `${base}/mcp`,
      authorization_servers: [base],
    });
    expect(buildAuthServerMetadata(base)).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });
});

describe("OAuthProvider", () => {
  it("registers clients and rejects bad redirect URIs", () => {
    const p = new OAuthProvider({ consentToken: CONSENT });
    const ok = p.registerClient({ redirect_uris: [REDIRECT], client_name: "Claude" });
    expect("clientId" in ok && ok.clientId.length).toBeGreaterThan(10);
    expect(p.registerClient({ redirect_uris: ["http://evil.example.com"] })).toHaveProperty(
      "error",
    );
    expect(p.registerClient({})).toHaveProperty("error");
  });

  it("runs the full code → token → refresh lifecycle with rotation", () => {
    const p = new OAuthProvider({ consentToken: CONSENT });
    const client = p.registerClient({ redirect_uris: [REDIRECT] });
    if ("error" in client) throw new Error("register failed");
    const { verifier, challenge } = pkcePair();
    const code = p.createCode(client.clientId, REDIRECT, challenge);

    const tokens = p.exchangeCode({
      code,
      codeVerifier: verifier,
      clientId: client.clientId,
      redirectUri: REDIRECT,
    });
    if ("error" in tokens) throw new Error("exchange failed");
    expect(p.validateAccessToken(tokens.accessToken)).toBe(true);

    // Codes are single-use.
    expect(
      p.exchangeCode({
        code,
        codeVerifier: verifier,
        clientId: client.clientId,
        redirectUri: REDIRECT,
      }),
    ).toHaveProperty("error", "invalid_grant");

    const rotated = p.refreshTokens(tokens.refreshToken, client.clientId);
    if ("error" in rotated) throw new Error("refresh failed");
    expect(p.validateAccessToken(rotated.accessToken)).toBe(true);
    expect(p.validateAccessToken(tokens.accessToken)).toBe(false); // revoked by rotation
    expect(p.refreshTokens(tokens.refreshToken, client.clientId)).toHaveProperty(
      "error",
      "invalid_grant",
    ); // old refresh token spent
  });

  it("rejects a wrong PKCE verifier and a mismatched client", () => {
    const p = new OAuthProvider({ consentToken: CONSENT });
    const client = p.registerClient({ redirect_uris: [REDIRECT] });
    if ("error" in client) throw new Error("register failed");
    const { challenge } = pkcePair();
    const code = p.createCode(client.clientId, REDIRECT, challenge);
    expect(
      p.exchangeCode({
        code,
        codeVerifier: "wrong-verifier",
        clientId: client.clientId,
        redirectUri: REDIRECT,
      }),
    ).toHaveProperty("error", "invalid_grant");
  });

  it("persists clients and tokens across restarts", () => {
    const file = statePath("persist");
    const p1 = new OAuthProvider({ consentToken: CONSENT, statePath: file });
    const client = p1.registerClient({ redirect_uris: [REDIRECT] });
    if ("error" in client) throw new Error("register failed");
    const { verifier, challenge } = pkcePair();
    const code = p1.createCode(client.clientId, REDIRECT, challenge);
    const tokens = p1.exchangeCode({
      code,
      codeVerifier: verifier,
      clientId: client.clientId,
      redirectUri: REDIRECT,
    });
    if ("error" in tokens) throw new Error("exchange failed");

    const p2 = new OAuthProvider({ consentToken: CONSENT, statePath: file });
    expect(p2.getClient(client.clientId)).toBeDefined();
    expect(p2.validateAccessToken(tokens.accessToken)).toBe(true);
  });

  it("rate-limits consent failures", () => {
    const p = new OAuthProvider({ consentToken: CONSENT });
    for (let i = 0; i < 10; i += 1) expect(p.checkConsent("wrong")).toBe(false);
    expect(p.consentRateLimited()).toBe(true);
  });

  it("accepts the correct consent password without counting", () => {
    const p = new OAuthProvider({ consentToken: CONSENT });
    expect(p.checkConsent(CONSENT)).toBe(true);
    expect(p.consentRateLimited()).toBe(false);
  });
});

describe("OAuth over HTTP (end-to-end against the real server)", () => {
  const servers: http.Server[] = [];

  afterAll(async () => {
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
  });

  async function listen(name: string): Promise<string> {
    const server = createHttpServer({
      port: 0,
      host: "127.0.0.1",
      authToken: CONSENT,
      allowNoAuth: false,
      oauthStatePath: statePath(name),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("no bound address");
    return `http://127.0.0.1:${address.port}`;
  }

  /** Drives register → authorize(consent) → token; returns an access token. */
  async function fullFlow(base: string, password = CONSENT): Promise<Response | string> {
    const reg = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "vitest" }),
    });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as { client_id: string };

    const { verifier, challenge } = pkcePair();
    const consent = await fetch(`${base}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id,
        redirect_uri: REDIRECT,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "xyz",
        password,
      }),
    });
    if (consent.status !== 302) return consent;

    const location = new URL(consent.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");
    const code = location.searchParams.get("code") ?? "";

    const tokenRes = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id,
        redirect_uri: REDIRECT,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const body = (await tokenRes.json()) as { access_token: string; token_type: string };
    expect(body.token_type).toBe("Bearer");
    return body.access_token;
  }

  it("serves discovery metadata with the request host as base", async () => {
    const base = await listen("http-meta");
    const pr = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(pr.status).toBe(200);
    expect(await pr.json()).toMatchObject({ resource: `${base}/mcp` });
    const as = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect((await as.json()) as object).toMatchObject({ issuer: base });
  });

  it("advertises the resource metadata on /mcp 401s", async () => {
    const base = await listen("http-401");
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("renders the consent form for a valid GET /authorize", async () => {
    const base = await listen("http-form");
    const reg = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Claude" }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const { challenge } = pkcePair();
    const page = await fetch(
      `${base}/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=abc`,
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("연결 승인");
    expect(html).toContain('name="password"');
    expect(html).toContain(client_id);
  });

  it("rejects an unknown client_id on /authorize", async () => {
    const base = await listen("http-badclient");
    const res = await fetch(`${base}/authorize?client_id=nope&redirect_uri=${REDIRECT}`);
    expect(res.status).toBe(400);
  });

  it("rejects a wrong consent password with a re-rendered form", async () => {
    const base = await listen("http-wrongpw");
    const res = await fullFlow(base, "wrong-password");
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
    expect(await (res as Response).text()).toContain("일치하지 않습니다");
  });

  it("completes the full OAuth flow and serves /mcp with the issued token", async () => {
    const base = await listen("http-full");
    const accessToken = await fullFlow(base);
    expect(typeof accessToken).toBe("string");

    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken as string}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest-oauth", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("kiwoom-mcp-server");
  });

  it("still accepts the static MCP_AUTH_TOKEN alongside OAuth tokens", async () => {
    const base = await listen("http-static");
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${CONSENT}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest-static", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects an unsupported grant type", async () => {
    const base = await listen("http-grant");
    const res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unsupported_grant_type" });
  });
});
