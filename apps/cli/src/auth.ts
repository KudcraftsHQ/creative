/**
 * `creative login` — OAuth 2.0 authorization code with PKCE.
 *
 * The usual shape: bind a loopback listener on an ephemeral port, open the browser
 * at the authorize endpoint, and take the code off the redirect. PKCE rather than a
 * client secret because a CLI cannot keep one, and loopback rather than a device code
 * because the browser is right here.
 *
 * `state` is checked on the way back, and the listener closes after the first
 * response either way, so a stale tab cannot deliver a code into a later session.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { apiUrl, readConfig, updateConfig, type Config } from "./config.ts";

const CLIENT_ID = process.env.CREATIVE_CLIENT_ID ?? "creative-cli";

const base64url = (b: Buffer) => b.toString("base64url");

function pkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* headless box, no browser — the caller has already printed the URL */
  }
}

const PAGE = (title: string, body: string) => `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<div style="font:16px/1.6 -apple-system,system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem">
<h1 style="font-size:1.25rem;margin:0 0 .5rem">${title}</h1><p style="color:#555;margin:0">${body}</p></div>`;

export interface LoginOptions {
  /** Print the URL instead of opening a browser. */
  noBrowser?: boolean;
  timeoutMs?: number;
}

export async function login(o: LoginOptions = {}): Promise<Config> {
  const base = apiUrl();
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => { resolveCode = res; rejectCode = rej; });

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") return new Response("not found", { status: 404 });

      const error = url.searchParams.get("error");
      if (error) {
        rejectCode(new Error(`${error}: ${url.searchParams.get("error_description") ?? "authorization denied"}`));
        return new Response(PAGE("Authorization denied", "You can close this tab."), {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.searchParams.get("state") !== state) {
        rejectCode(new Error("state mismatch — the response did not come from the request this CLI made"));
        return new Response(PAGE("Something went wrong", "State mismatch. Try again."), {
          status: 400, headers: { "content-type": "text/html" },
        });
      }
      const code = url.searchParams.get("code");
      if (!code) {
        rejectCode(new Error("no authorization code in the callback"));
        return new Response(PAGE("Something went wrong", "No code in the callback."), {
          status: 400, headers: { "content-type": "text/html" },
        });
      }
      resolveCode(code);
      return new Response(PAGE("Signed in", "You can close this tab and go back to the terminal."), {
        headers: { "content-type": "text/html" },
      });
    },
  });

  const redirectUri = `http://127.0.0.1:${server.port}/callback`;
  const authorize = new URL("/oauth/authorize", base);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("scope", "designs:read designs:write fonts:read");

  process.stderr.write(`Opening ${authorize.origin} to authorize…\n`);
  if (o.noBrowser) process.stderr.write(`\n  ${authorize}\n\n`);
  else openBrowser(authorize.toString());

  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("timed out waiting for authorization")), o.timeoutMs ?? 300_000).unref?.(),
  );

  try {
    const code = await Promise.race([codePromise, timeout]);

    const res = await fetch(new URL("/oauth/token", base), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);

    const token = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      user?: Config["user"];
    };

    return updateConfig({
      apiUrl: base,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      user: token.user,
    });
  } finally {
    server.stop(true);
  }
}

export async function logout(): Promise<void> {
  updateConfig({ accessToken: undefined, refreshToken: undefined, expiresAt: undefined, user: undefined });
}

/** A valid access token, refreshed if it is close to expiry. Null when signed out. */
export async function accessToken(): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg.accessToken) return null;
  // Refresh a minute early: a token that expires mid-request is a confusing 401.
  if (!cfg.expiresAt || cfg.expiresAt - Date.now() > 60_000) return cfg.accessToken;
  if (!cfg.refreshToken) return cfg.accessToken;

  const res = await fetch(new URL("/oauth/token", apiUrl(cfg)), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) return cfg.accessToken;

  const token = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  updateConfig({
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? cfg.refreshToken,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  });
  return token.access_token;
}
