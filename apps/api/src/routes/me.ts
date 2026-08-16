import { Hono } from "hono";
import { requireAuth } from "../middlewares/auth.ts";
import { prisma } from "../lib/prisma.ts";

export const meRoute = new Hono().use("*", requireAuth).get("/", async (c) => {
  const { userId, scope, via } = c.get("auth");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, createdAt: true },
  });
  if (!user) return c.json({ error: "user no longer exists" }, 401);
  return c.json({ user, scope: scope.split(/\s+/), via });
});
