import { Hono } from "hono";
import { prisma } from "../lib/prisma.ts";
import { redisEnabled } from "../lib/redis.ts";
import { listFonts } from "@creative/core";

export const healthRoute = new Hono().get("/", async (c) => {
  // A health check that only says "the process is up" passes while the database
  // is unreachable, which is the outage worth catching.
  let database = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    database = err instanceof Error ? err.message : "unreachable";
  }

  // Fonts are baked into the image. If the registry is empty the container will
  // render every document in a substituted face and report success, so say so.
  const fonts = listFonts().length;

  const ok = database === "ok" && fonts > 0;
  return c.json({ ok, database, fonts, redis: redisEnabled }, ok ? 200 : 503);
});
