import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Pinned on globalThis so `bun --hot` re-evaluating this module does not open a
// second pool on every save — through PgBouncer with connection_limit=1 that
// exhausts the pool in about a minute of editing.
if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;
