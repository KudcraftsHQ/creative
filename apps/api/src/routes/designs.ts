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
import { encode, lint, render, parseDocument, type Document } from "@creative/core";
import { requireAuth, requireScope } from "../middlewares/auth.ts";
import {
  createDesign,
  deleteDesign,
  getDesign,
  listDesigns,
  updateDesign,
} from "../services/design.ts";

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
      return c.json(await createDesign(userId, c.req.valid("json")), 201);
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
      const design = await updateDesign(userId, c.req.param("id"), c.req.valid("json"));
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

  /** The rendered image. The editor's preview is a GET against this. */
  .get("/:id/render", zValidator("query", renderQuery), async (c) => {
    const { userId } = c.get("auth");
    const design = await getDesign(userId, c.req.param("id"));
    if (!design) return c.json({ error: "no such design" }, 404);

    const q = c.req.valid("query");
    const doc = parseDocument(design.document) as Document;
    const { canvas } = await render(doc);
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

    const doc = parseDocument(design.document) as Document;
    const { canvas, report } = await render(doc);
    return c.json({ findings: lint({ doc, report, canvas }), layers: report.layers });
  });
