/**
 * The OAuth 2.0 authorization server the CLI talks to.
 *
 * `apps/cli/src/auth.ts` is the specification for this file, and it is short:
 * authorization code with PKCE (S256), a loopback redirect on an ephemeral port,
 * client id `creative-cli`, no client secret — because a CLI cannot keep one.
 *
 * Three rules carry most of the security here:
 *   - the redirect must be loopback, so a code can never be delivered off-machine;
 *   - the code is single-use and short-lived, so a replay fails inside the window;
 *   - tokens are stored as SHA-256 hashes, so a leaked row is not a credential.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.ts";

export const CLIENT_ID = "creative-cli";

/** Scopes the CLI asks for. Anything else is refused rather than silently dropped. */
const KNOWN_SCOPES = new Set(["designs:read", "designs:write", "fonts:read"]);

const ACCESS_TTL_SECONDS = 60 * 60;          // an hour; the CLI refreshes early
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 60; // sixty days
const CODE_TTL_SECONDS = 5 * 60;

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const token = () => randomBytes(32).toString("base64url");

/**
 * Loopback only, and no fragment.
 *
 * The port is deliberately not pinned: the CLI binds an ephemeral one, which is
 * exactly what RFC 8252 §7.3 says to allow. The host is not — `127.0.0.1` and
 * `localhost` are the whole list, so a code cannot be redirected to a server.
 */
export function isLoopbackRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.hash) return false;
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
}

export function normaliseScope(requested: string | null | undefined): string {
  const asked = (requested ?? "").split(/\s+/).filter(Boolean);
  const granted = asked.filter((s) => KNOWN_SCOPES.has(s));
  // An empty request gets read access rather than nothing: a token that can do
  // nothing is a worse failure than a conservative default.
  return (granted.length ? granted : ["designs:read"]).join(" ");
}

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
}

/** Validate an /oauth/authorize query. Throws with a message meant for a browser. */
export function parseAuthorizeRequest(params: URLSearchParams): AuthorizeRequest {
  const responseType = params.get("response_type");
  if (responseType !== "code") {
    throw new Error(`unsupported response_type "${responseType ?? ""}" — this server issues codes only`);
  }
  const clientId = params.get("client_id") ?? "";
  if (clientId !== CLIENT_ID) {
    throw new Error(`unknown client_id "${clientId}"`);
  }
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!isLoopbackRedirect(redirectUri)) {
    throw new Error("redirect_uri must be a loopback address (http://127.0.0.1:<port>/callback)");
  }
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "";
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    throw new Error("PKCE is required: send code_challenge with code_challenge_method=S256");
  }

  return {
    clientId,
    redirectUri,
    state: params.get("state"),
    codeChallenge,
    codeChallengeMethod,
    scope: normaliseScope(params.get("scope")),
  };
}

/** Mint a single-use code bound to the PKCE challenge that asked for it. */
export async function issueCode(req: AuthorizeRequest, userId: string): Promise<string> {
  const code = token();
  await prisma.oAuthCode.create({
    data: {
      code,
      clientId: req.clientId,
      userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      codeChallengeMethod: req.codeChallengeMethod,
      scope: req.scope,
      expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
    },
  });
  return code;
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

async function issueTokens(userId: string, clientId: string, scope: string): Promise<IssuedTokens> {
  const access = token();
  const refresh = token();
  await prisma.oAuthToken.create({
    data: {
      accessTokenHash: sha256(access),
      refreshTokenHash: sha256(refresh),
      clientId,
      userId,
      scope,
      expiresAt: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000),
    },
  });
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    scope,
  };
}

export class OAuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

/** Constant-time compare of the PKCE verifier's digest against the stored challenge. */
function challengeMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<IssuedTokens & { user: { id: string; email: string; name: string } }> {
  const row = await prisma.oAuthCode.findUnique({
    where: { code: params.code },
    include: { user: true },
  });
  if (!row) throw new OAuthError("invalid_grant", "unknown authorization code");

  // Consume before validating anything else: a code presented twice is spent,
  // whether or not the second presentation was well-formed.
  if (row.consumedAt) {
    // A replay means the code leaked. Everything it produced is suspect.
    await prisma.oAuthToken.updateMany({
      where: { userId: row.userId, clientId: row.clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new OAuthError("invalid_grant", "authorization code has already been used");
  }
  await prisma.oAuthCode.update({
    where: { code: params.code },
    data: { consumedAt: new Date() },
  });

  if (row.expiresAt.getTime() < Date.now()) {
    throw new OAuthError("invalid_grant", "authorization code has expired");
  }
  if (row.clientId !== params.clientId) {
    throw new OAuthError("invalid_grant", "client_id does not match the one that requested this code");
  }
  if (row.redirectUri !== params.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the one that requested this code");
  }
  if (!params.codeVerifier || !challengeMatches(params.codeVerifier, row.codeChallenge)) {
    throw new OAuthError("invalid_grant", "code_verifier does not match the code_challenge");
  }

  const tokens = await issueTokens(row.userId, row.clientId, row.scope);
  return {
    ...tokens,
    user: { id: row.user.id, email: row.user.email, name: row.user.name },
  };
}

export async function refresh(params: {
  refreshToken: string;
  clientId: string;
}): Promise<IssuedTokens> {
  const row = await prisma.oAuthToken.findUnique({
    where: { refreshTokenHash: sha256(params.refreshToken) },
  });
  if (!row || row.revokedAt) throw new OAuthError("invalid_grant", "unknown or revoked refresh token");
  if (row.clientId !== params.clientId) {
    throw new OAuthError("invalid_grant", "client_id does not match the token");
  }
  if (row.createdAt.getTime() + REFRESH_TTL_SECONDS * 1000 < Date.now()) {
    throw new OAuthError("invalid_grant", "refresh token has expired — run `creative login` again");
  }

  // Rotate: the old pair is revoked as the new one is issued, so a stolen refresh
  // token stops working the moment the real client uses its own.
  const next = await issueTokens(row.userId, row.clientId, row.scope);
  await prisma.oAuthToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  return next;
}

export interface TokenIdentity {
  userId: string;
  scope: string;
}

/** Resolve a bearer token to its user, or null. */
export async function identify(accessToken: string): Promise<TokenIdentity | null> {
  const row = await prisma.oAuthToken.findUnique({
    where: { accessTokenHash: sha256(accessToken) },
  });
  if (!row || row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId, scope: row.scope };
}

export async function revokeAllFor(userId: string): Promise<number> {
  const { count } = await prisma.oAuthToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}
