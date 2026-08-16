/**
 * `/api/templates` — the templates shipped in the image, and filling one.
 *
 * Read-only over HTTP on purpose. Templates are authored by an agent through the
 * MCP server against a reference image; this route only lets the UI start a new
 * design from one.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, fill, listFonts, loadTemplate } from "@creative/core";
import { requireAuth, requireScope } from "../middlewares/auth.ts";
import { createDesign } from "../services/design.ts";

function templateDir(): string | null {
  const dir = process.env.CREATIVE_TEMPLATES ?? join(process.cwd(), "templates");
  return existsSync(dir) ? dir : null;
}

function loadAll() {
  const dir = templateDir();
  if (!dir) return [];
  const out: Array<ReturnType<typeof describe> & { file: string }> = [];
  for (const f of readdirSync(dir)) {
    if (extname(f) !== ".json") continue;
    try {
      out.push({ ...describe(loadTemplate(join(dir, f))), file: f });
    } catch {
      /* one malformed template must not hide the working ones */
    }
  }
  return out;
}

const fillBody = z.object({
  values: z.record(z.string()),
  name: z.string().trim().min(1).max(200),
  projectId: z.string().nullish(),
  size: z.string().optional(),
});

export const templatesRoute = new Hono()
  .use("*", requireAuth)

  .get("/", (c) => c.json({ items: loadAll() }))

  .get("/:name", (c) => {
    const dir = templateDir();
    const path = dir ? join(dir, `${c.req.param("name")}.json`) : null;
    if (!path || !existsSync(path)) return c.json({ error: "no such template" }, 404);
    return c.json(describe(loadTemplate(path)));
  })

  /** Fill a template and keep the result as a design. */
  .post("/:name/fill", requireScope("designs:write"), zValidator("json", fillBody), async (c) => {
    const { userId } = c.get("auth");
    const dir = templateDir();
    const path = dir ? join(dir, `${c.req.param("name")}.json`) : null;
    if (!path || !existsSync(path)) return c.json({ error: "no such template" }, 404);

    const input = c.req.valid("json");
    try {
      const doc = fill(loadTemplate(path), input.values, { size: input.size });
      return c.json(
        await createDesign(userId, { name: input.name, document: doc, projectId: input.projectId }),
        201,
      );
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "could not fill template" }, 400);
    }
  });

/** The faces baked into this image, with the licence held for each. */
export const fontsRoute = new Hono()
  .use("*", requireAuth)
  .get("/", (c) => c.json({ items: listFonts() }));
