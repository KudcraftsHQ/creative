/**
 * better-auth: sessions for the browser.
 *
 * The CLI does not use this — it holds an OAuth bearer token issued by
 * `src/lib/oauth.ts`. Two credential types, one user table: the browser gets a
 * cookie, the terminal gets a token, and `requireAuth` accepts either.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.ts";

const baseURL =
  process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
const isProd = process.env.NODE_ENV === "production";

/** Strict origin equality is what better-auth compares against, so normalise. */
const toOrigin = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

const envTrusted = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(toOrigin)
  .filter((v): v is string => Boolean(v));

// In dev the SPA is on Vite at :5173 and proxies /api to :3000, so the browser's
// Origin is :5173 — blocked unless it is listed.
const devTrusted = ["http://localhost:5173", "http://localhost:3000"];

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    ...new Set([baseURL, ...envTrusted, ...(isProd ? [] : devTrusted)].filter(Boolean)),
  ],
  emailAndPassword: {
    enabled: true,
    // Open signup: this is a tool people sign up for, not an internal back office.
    // Flip to true and provision by hand if that stops being true.
    disableSignUp: process.env.DISABLE_SIGNUP === "true",
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
});

export type AppSession = typeof auth.$Infer.Session;
