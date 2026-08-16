import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../lib/prisma.ts";
import { requireAuth, requireScope } from "../middlewares/auth.ts";

const body = z.object({ name: z.string().trim().min(1).max(120) });

export const projectsRoute = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const { userId } = c.get("auth");
    const projects = await prisma.project.findMany({
      where: { ownerId: userId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        _count: { select: { designs: true } },
      },
    });
    // Flattened rather than spread-with-undefined: the count is the only thing
    // the UI wants from the relation, and `_count: undefined` still serialises.
    return c.json({
      items: projects.map((p: (typeof projects)[number]) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        designs: p._count.designs,
      })),
    });
  })

  .post("/", requireScope("designs:write"), zValidator("json", body), async (c) => {
    const { userId } = c.get("auth");
    const { name } = c.req.valid("json");
    const existing = await prisma.project.findFirst({ where: { ownerId: userId, name } });
    if (existing) return c.json({ error: `you already have a project called "${name}"` }, 409);
    return c.json(await prisma.project.create({ data: { name, ownerId: userId } }), 201);
  })

  .patch("/:id", requireScope("designs:write"), zValidator("json", body), async (c) => {
    const { userId } = c.get("auth");
    const { count } = await prisma.project.updateMany({
      where: { id: c.req.param("id"), ownerId: userId },
      data: { name: c.req.valid("json").name },
    });
    if (count === 0) return c.json({ error: "no such project" }, 404);
    return c.json(await prisma.project.findUnique({ where: { id: c.req.param("id") } }));
  })

  /** Deleting a folder must not delete what is filed in it — designs fall back to loose. */
  .delete("/:id", requireScope("designs:write"), async (c) => {
    const { userId } = c.get("auth");
    const { count } = await prisma.project.deleteMany({
      where: { id: c.req.param("id"), ownerId: userId },
    });
    if (count === 0) return c.json({ error: "no such project" }, 404);
    return c.body(null, 204);
  });
