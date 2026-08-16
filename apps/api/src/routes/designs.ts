/**
 * `/api/designs` — the library.
 *
 * The document goes in and comes out verbatim: this is the same JSON the CLI
 * writes to a file and the MCP server renders, so a design created in a terminal
 * opens in the editor and a design edited in the editor renders from the CLI.
 * Nothing here reshapes it.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { encode, lint } from "@creative/core";
import { requireAuth, requireScope } from "../middlewares/auth.ts";
import {
  createDesign,
  deleteDesign,
  getDesign,
  listDesigns,
  updateDesign,
} from "../services/design.ts";
import { renderStored } from "../services/render.ts";
import type { Via } from "../services/design.ts";

/**
 * Where a write came from.
 *
 * A cookie means a browser. A bearer token means something on a terminal, and
 * `x-creative-client` lets the MCP server say so specifically — without it the
 * editor would report an agent's edit as "via CLI", which is close enough to true
 * to be misleading.
 */
function via(c: { get: (k: "auth") => { via: string }; req: { header: (n: string) => string | undefined } }): Via {
  const declared = c.req.header("x-creative-client");
  if (declared === "mcp" || declared === "cli" || declared === "worker") return declared;
  return c.get("auth").via === "session" ? "web" : "cli";
}

const listQuery = z.object({
  q: z.string().trim().min(1).optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().optional(),
});

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  document: z.record(z.any()),
  projectId: z.string().nullish(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  document: z.record(z.any()).optional(),
  projectId: z.string().nullish(),
});

const renderQuery = z.object({
  format: z.enum(["png", "jpg", "webp"]).default("png"),
  width: z.coerce.number().int().min(16).max(4096).optional(),
  maxKb: z.coerce.number().int().min(1).optional(),
});

export const designsRoute = new Hono()
  .use("*", requireAuth)

  .get("/", zValidator("query", listQuery), async (c) => {
    const { userId } = c.get("auth");
    const q = c.req.valid("query");
    return c.json(await listDesigns(userId, q));
  })

  .post("/", requireScope("designs:write"), zValidator("json", createBody), async (c) => {
    const { userId } = c.get("auth");
    try {
      return c.json(await createDesign(userId, c.req.valid("json"), via(c)), 201);
    } catch (err) {
      // A document that fails validation is a client error with a useful message
      // — core's parse errors name the path and say what was expected.
      return c.json({ error: err instanceof Error ? err.message : "invalid document" }, 400);
    }
  })

  .get("/:id", async (c) => {
    const { userId } = c.get("auth");
    const design = await getDesign(userId, c.req.param("id"));
    if (!design) return c.json({ error: "no such design" }, 404);
    return c.json(design);
  })

  .patch("/:id", requireScope("designs:write"), zValidator("json", updateBody), async (c) => {
    const { userId } = c.get("auth");
    try {
      const design = await updateDesign(userId, c.req.param("id"), c.req.valid("json"), via(c));
      if (!design) return c.json({ error: "no such design" }, 404);
      return c.json(design);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "invalid document" }, 400);
    }
  })

  .delete("/:id", requireScope("designs:write"), async (c) => {
    const { userId } = c.get("auth");
    const ok = await deleteDesign(userId, c.req.param("id")!);
    if (!ok) return c.json({ error: "no such design" }, 404);
    return c.body(null, 204);
  })

  /** Duplicate. The library offers it because a variant is the common next act. */
  .post("/:id/duplicate", requireScope("designs:write"), async (c) => {
    const { userId } = c.get("auth");
    const design = await getDesign(userId, c.req.param("id")!);
    if (!design) return c.json({ error: "no such design" }, 404);

    const copy = await createDesign(
      userId,
      {
        name: `${design.name} copy`,
        document: design.document,
        projectId: design.projectId,
        templateName: design.templateName,
      },
      via(c),
    );
    return c.json(copy, 201);
  })

  /** The rendered image. The editor's preview is a GET against this. */
  .get("/:id/render", zValidator("query", renderQuery), async (c) => {
    const { userId } = c.get("auth");
    const design = await getDesign(userId, c.req.param("id"));
    if (!design) return c.json({ error: "no such design" }, 404);

    const q = c.req.valid("query");
    const { canvas } = await renderStored(design.document);
    const out = await encode(canvas, { format: q.format, width: q.width, maxKb: q.maxKb });

    return c.body(new Uint8Array(out.buffer), 200, {
      "content-type": `image/${q.format === "jpg" ? "jpeg" : q.format}`,
      // The version is in the etag, so a tab that already has this render is not
      // re-sent it — and a write bumps the version, which busts it exactly once.
      etag: `W/"${design.id}-${design.version}-${q.format}-${q.width ?? "full"}"`,
      "cache-control": "private, max-age=0, must-revalidate",
    });
  })

  /** Defects, with fixes. The editor's lint panel, and the same rules the CLI runs. */
  .get("/:id/lint", async (c) => {
    const { userId } = c.get("auth");
    const design = await getDesign(userId, c.req.param("id"));
    if (!design) return c.json({ error: "no such design" }, 404);

    const { doc, canvas, report } = await renderStored(design.document);
    return c.json({ findings: lint({ doc, report, canvas }), layers: report.layers });
  });
