/**
 * One middleware, two credentials.
 *
 * A browser arrives with a better-auth session cookie; the CLI and the MCP server
 * arrive with an OAuth bearer token. Both resolve to the same user id, so every
 * route below this can be written once and not care which one it got.
 */
import type { Context, Next } from "hono";
import { auth } from "../lib/auth.ts";
import { identify } from "../lib/oauth.ts";

export interface AuthContext {
  userId: string;
  /** Scopes on a bearer token. A cookie session carries all of them. */
  scope: string;
  via: "session" | "token";
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

const ALL_SCOPES = "designs:read designs:write fonts:read";

export async function resolveAuth(c: Context): Promise<AuthContext | null> {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const identity = await identify(header.slice(7).trim());
    return identity ? { userId: identity.userId, scope: identity.scope, via: "token" } : null;
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return null;
  return { userId: session.user.id, scope: ALL_SCOPES, via: "session" };
}

export async function requireAuth(c: Context, next: Next) {
  const resolved = await resolveAuth(c);
  if (!resolved) return c.json({ error: "not signed in" }, 401);
  c.set("auth", resolved);
  await next();
}

/** Guard a write route. Read routes only need `requireAuth`. */
export function requireScope(scope: string) {
  return async (c: Context, next: Next) => {
    const a = c.get("auth");
    if (!a.scope.split(/\s+/).includes(scope)) {
      return c.json({ error: `this token is missing the "${scope}" scope` }, 403);
    }
    await next();
  };
}
