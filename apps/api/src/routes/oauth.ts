/**
 * `/oauth/*` — mounted at the root, not under `/api`, because `creative login`
 * builds these URLs from the bare API origin.
 *
 * The consent screen is deliberately plain server-rendered HTML rather than a
 * route in the SPA: it is the one page where an error must be legible even if
 * the app's JavaScript never loads, and it is shown once per machine.
 */
import { Hono } from "hono";
import { auth } from "../lib/auth.ts";
import {
  CLIENT_ID,
  OAuthError,
  exchangeCode,
  issueCode,
  parseAuthorizeRequest,
  refresh,
} from "../lib/oauth.ts";

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<div style="font:16px/1.6 -apple-system,system-ui,sans-serif;max-width:30rem;margin:15vh auto;padding:0 1.5rem;color:#111">
${body}
</div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );

const SCOPE_LABELS: Record<string, string> = {
  "designs:read": "Read your designs",
  "designs:write": "Create and change your designs",
  "fonts:read": "See which fonts you have installed",
};

export const oauthRoute = new Hono()
  /**
   * The authorize endpoint. Signed out, it bounces through the SPA's login page
   * and comes straight back — the CLI never sees that detour.
   */
  .get("/authorize", async (c) => {
    let request;
    try {
      request = parseAuthorizeRequest(new URL(c.req.url).searchParams);
    } catch (err) {
      return page(
        "Cannot authorize",
        `<h1 style="font-size:1.2rem">Cannot authorize</h1>
         <p style="color:#666">${escape(err instanceof Error ? err.message : String(err))}</p>`,
        400,
      );
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      const next = encodeURIComponent(c.req.url.replace(new URL(c.req.url).origin, ""));
      return c.redirect(`/login?next=${next}`);
    }

    const scopes = request.scope
      .split(" ")
      .map((s) => `<li>${escape(SCOPE_LABELS[s] ?? s)}</li>`)
      .join("");

    // Every parameter is echoed back through the form so the POST can be validated
    // from scratch — nothing is carried in a server-side session between the two.
    const hidden = Object.entries({
      response_type: "code",
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      state: request.state ?? "",
      code_challenge: request.codeChallenge,
      code_challenge_method: request.codeChallengeMethod,
      scope: request.scope,
    })
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
      .join("");

    return page(
      "Authorize the creative CLI",
      `<h1 style="font-size:1.2rem;margin:0 0 .25rem">Sign in to the creative CLI</h1>
       <p style="color:#666;margin:0 0 1.25rem">Signed in as ${escape(session.user.email)}. The CLI on this
       machine is asking to:</p>
       <ul style="color:#333;margin:0 0 1.5rem;padding-left:1.2rem">${scopes}</ul>
       <form method="post" action="/oauth/authorize">${hidden}
         <button type="submit" style="font:inherit;background:#111;color:#fff;border:0;border-radius:8px;padding:.6rem 1.1rem;cursor:pointer">Allow</button>
         <a href="${escape(request.redirectUri)}?error=access_denied&state=${encodeURIComponent(request.state ?? "")}"
            style="margin-left:1rem;color:#666">Cancel</a>
       </form>
       <p style="color:#999;font-size:.85rem;margin-top:1.5rem">The code goes to
       ${escape(request.redirectUri)} — a listener on this computer. It never leaves the machine.</p>`,
    );
  })

  .post("/authorize", async (c) => {
    const form = await c.req.formData();
    const params = new URLSearchParams();
    for (const [k, v] of form.entries()) params.set(k, String(v));

    let request;
    try {
      request = parseAuthorizeRequest(params);
    } catch (err) {
      return page("Cannot authorize", `<p>${escape(err instanceof Error ? err.message : String(err))}</p>`, 400);
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.redirect("/login");

    const code = await issueCode(request, session.user.id);
    const target = new URL(request.redirectUri);
    target.searchParams.set("code", code);
    if (request.state) target.searchParams.set("state", request.state);
    return c.redirect(target.toString());
  })

  /** The token endpoint. Form-encoded in, JSON out, as the CLI expects. */
  .post("/token", async (c) => {
    const form = await c.req.formData();
    const get = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };

    try {
      const grantType = get("grant_type");

      if (grantType === "authorization_code") {
        const result = await exchangeCode({
          code: get("code"),
          clientId: get("client_id") || CLIENT_ID,
          redirectUri: get("redirect_uri"),
          codeVerifier: get("code_verifier"),
        });
        // `user` is not standard OAuth, but the CLI stores it so `creative whoami`
        // does not need a round trip on every invocation.
        return c.json(result);
      }

      if (grantType === "refresh_token") {
        return c.json(
          await refresh({
            refreshToken: get("refresh_token"),
            clientId: get("client_id") || CLIENT_ID,
          }),
        );
      }

      throw new OAuthError("unsupported_grant_type", `unsupported grant_type "${grantType}"`);
    } catch (err) {
      if (err instanceof OAuthError) {
        return c.json({ error: err.code, error_description: err.message }, err.status as 400);
      }
      console.error("[oauth] token endpoint", err);
      return c.json({ error: "server_error", error_description: "token exchange failed" }, 500);
    }
  });
