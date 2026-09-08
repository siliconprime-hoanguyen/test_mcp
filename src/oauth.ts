import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";

const ACCESS_TOKEN_TTL_SECONDS = 3_600;
const REFRESH_TOKEN_TTL_SECONDS = 86_400;
const AUTHORIZATION_TTL_MS = 5 * 60_000;
const CODE_TTL_MS = 2 * 60_000;
const MAX_BODY_BYTES = 32_768;
const MAX_REGISTERED_CLIENTS = 1_000;

interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state?: string;
  issuer: string;
  expiresAt: number;
}

interface AuthorizationCode extends PendingAuthorization {
  expiresAt: number;
}

interface StoredToken {
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
}

interface OAuthContext {
  issuer: URL;
  mcpUrl: URL;
}

export class MockOAuthServer {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly accessTokens = new Map<string, StoredToken>();
  private readonly refreshTokens = new Map<string, StoredToken>();

  constructor(
    private readonly username = "hoa",
    private readonly password = "123456",
  ) {}

  metadata(issuer: URL): OAuthMetadata {
    return {
      issuer: issuer.origin,
      authorization_endpoint: new URL("/oauth/authorize", issuer).href,
      token_endpoint: new URL("/oauth/token", issuer).href,
      registration_endpoint: new URL("/oauth/register", issuer).href,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    };
  }

  async handle(request: Request, context: OAuthContext): Promise<Response | undefined> {
    const url = new URL(request.url);

    if (url.pathname === "/oauth/register" && request.method === "POST") {
      return this.register(request);
    }
    if (url.pathname === "/oauth/authorize" && request.method === "GET") {
      return this.beginAuthorization(url, context);
    }
    if (url.pathname === "/oauth/authorize" && request.method === "POST") {
      return this.finishAuthorization(request);
    }
    if (url.pathname === "/oauth/token" && request.method === "POST") {
      return this.exchangeToken(request, context);
    }
    if (["/oauth/register", "/oauth/authorize", "/oauth/token"].includes(url.pathname)) {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
    }

    return undefined;
  }

  async verifyAccessToken(token: string, resource: URL): Promise<AuthInfo> {
    const stored = this.accessTokens.get(token);
    const now = Math.floor(Date.now() / 1_000);

    if (!stored || stored.expiresAt <= now || stored.resource !== resource.href) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or expired");
    }

    return {
      token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: stored.expiresAt,
      resource,
      extra: { username: this.username },
    };
  }

  private async register(request: Request): Promise<Response> {
    if (this.clients.size >= MAX_REGISTERED_CLIENTS) {
      return json({ error: "too_many_requests", error_description: "Client registration limit reached" }, 429);
    }

    const body = await readJson(request);
    if (!isObject(body)) {
      return oauthError("invalid_client_metadata", "Registration body must be JSON");
    }

    const redirectUris = body.redirect_uris;
    const applicationType = body.application_type;
    const authMethod = body.token_endpoint_auth_method;
    const grantTypes = body.grant_types;

    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > 10 ||
      !redirectUris.every((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))
    ) {
      return oauthError("invalid_redirect_uri", "redirect_uris contains an unsupported URI");
    }
    if (applicationType !== undefined && applicationType !== "native" && applicationType !== "web") {
      return oauthError("invalid_client_metadata", "application_type must be native or web");
    }
    if (authMethod !== undefined && authMethod !== "none") {
      return oauthError("invalid_client_metadata", "Only public clients are supported");
    }
    if (
      grantTypes !== undefined &&
      (!Array.isArray(grantTypes) ||
        !grantTypes.every((grant) => grant === "authorization_code" || grant === "refresh_token"))
    ) {
      return oauthError("invalid_client_metadata", "Unsupported grant type");
    }

    const clientId = randomToken();
    const client: RegisteredClient = {
      clientId,
      clientName: typeof body.client_name === "string" ? body.client_name.slice(0, 200) : "MCP client",
      redirectUris,
    };
    this.clients.set(clientId, client);

    return json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1_000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        application_type: applicationType ?? "native",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  }

  private beginAuthorization(url: URL, context: OAuthContext): Response {
    this.removeExpired();
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge") ?? "";
    const resource = url.searchParams.get("resource") ?? "";
    const scope = url.searchParams.get("scope") ?? "mcp";
    const client = this.clients.get(clientId);

    if (url.searchParams.get("response_type") !== "code") {
      return oauthError("unsupported_response_type", "Only authorization code is supported");
    }
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return oauthError("invalid_request", "Unknown client or redirect URI");
    }
    if (url.searchParams.get("code_challenge_method") !== "S256" || !isPkceValue(codeChallenge)) {
      return oauthError("invalid_request", "S256 PKCE is required");
    }
    if (resource !== context.mcpUrl.href) {
      return oauthError("invalid_target", "The MCP resource is required");
    }
    if (scope.split(" ").some((value) => value !== "mcp")) {
      return oauthError("invalid_scope", "Only the mcp scope is supported");
    }

    const requestId = randomToken();
    this.pending.set(requestId, {
      clientId,
      redirectUri,
      codeChallenge,
      resource,
      scope,
      state: url.searchParams.get("state") ?? undefined,
      issuer: context.issuer.origin,
      expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
    });

    return html(loginPage(requestId));
  }

  private async finishAuthorization(request: Request): Promise<Response> {
    const form = await readForm(request);
    const requestId = form?.get("request_id") ?? "";
    const pending = this.pending.get(requestId);

    if (!pending || pending.expiresAt <= Date.now()) {
      return oauthError("invalid_request", "Authorization request is invalid or expired");
    }
    if (!safeEqual(form?.get("username") ?? "", this.username) || !safeEqual(form?.get("password") ?? "", this.password)) {
      return html(loginPage(requestId, "Invalid credentials"), 401);
    }

    this.pending.delete(requestId);
    const code = randomToken();
    this.codes.set(code, { ...pending, expiresAt: Date.now() + CODE_TTL_MS });

    const callback = new URL(pending.redirectUri);
    callback.searchParams.set("code", code);
    if (pending.state) callback.searchParams.set("state", pending.state);
    callback.searchParams.set("iss", pending.issuer);
    return new Response(null, { status: 302, headers: { location: callback.href, "cache-control": "no-store" } });
  }

  private async exchangeToken(request: Request, context: OAuthContext): Promise<Response> {
    const form = await readForm(request);
    if (!form) return oauthError("invalid_request", "Token request must be form encoded");

    const grantType = form.get("grant_type");
    if (grantType === "authorization_code") {
      return this.exchangeCode(form, context);
    }
    if (grantType === "refresh_token") {
      return this.exchangeRefreshToken(form, context);
    }
    return oauthError("unsupported_grant_type", "Unsupported grant type");
  }

  private exchangeCode(form: URLSearchParams, context: OAuthContext): Response {
    const codeValue = form.get("code") ?? "";
    const code = this.codes.get(codeValue);
    this.codes.delete(codeValue);

    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      !code ||
      code.expiresAt <= Date.now() ||
      code.clientId !== form.get("client_id") ||
      code.redirectUri !== form.get("redirect_uri") ||
      code.resource !== (form.get("resource") ?? context.mcpUrl.href) ||
      code.codeChallenge !== challenge ||
      !isPkceValue(verifier)
    ) {
      return oauthError("invalid_grant", "Authorization code is invalid");
    }

    return this.issueTokens(code.clientId, code.resource, code.scope.split(" "));
  }

  private exchangeRefreshToken(form: URLSearchParams, context: OAuthContext): Response {
    const refreshToken = form.get("refresh_token") ?? "";
    const stored = this.refreshTokens.get(refreshToken);
    this.refreshTokens.delete(refreshToken);

    if (
      !stored ||
      stored.expiresAt <= Math.floor(Date.now() / 1_000) ||
      stored.clientId !== form.get("client_id") ||
      stored.resource !== (form.get("resource") ?? context.mcpUrl.href)
    ) {
      return oauthError("invalid_grant", "Refresh token is invalid");
    }

    return this.issueTokens(stored.clientId, stored.resource, stored.scopes);
  }

  private issueTokens(clientId: string, resource: string, scopes: string[]): Response {
    const now = Math.floor(Date.now() / 1_000);
    const accessToken = randomToken();
    const refreshToken = randomToken();
    this.accessTokens.set(accessToken, { clientId, resource, scopes, expiresAt: now + ACCESS_TOKEN_TTL_SECONDS });
    this.refreshTokens.set(refreshToken, { clientId, resource, scopes, expiresAt: now + REFRESH_TOKEN_TTL_SECONDS });

    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    });
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= now) this.pending.delete(key);
    }
    for (const [key, value] of this.codes) {
      if (value.expiresAt <= now) this.codes.delete(key);
    }
  }
}

function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return !["javascript:", "data:", "file:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isPkceValue(value: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return undefined;
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function readForm(request: Request): Promise<URLSearchParams | undefined> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return undefined;
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return undefined;
  return new URLSearchParams(text);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function oauthError(error: string, errorDescription: string): Response {
  return json({ error, error_description: errorDescription }, 400);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function loginPage(requestId: string, error = ""): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Ticket mock MCP sign in</title>
    <style>body{font:16px system-ui;max-width:24rem;margin:4rem auto;padding:1rem}label{display:block;margin-top:1rem}input,button{box-sizing:border-box;width:100%;padding:.65rem;margin-top:.3rem}.error{color:#b00020}</style>
  </head>
  <body>
    <h1>Ticket mock MCP</h1>
    ${error ? `<p class="error">${error}</p>` : ""}
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="request_id" value="${requestId}">
      <label>Username<input name="username" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button type="submit">Authorize</button>
    </form>
  </body>
</html>`;
}
