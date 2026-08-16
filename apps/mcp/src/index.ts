#!/usr/bin/env bun
/**
 * The MCP server.
 *
 * The point of this file is the loop it makes possible: render → look → lint → edit →
 * render again, with no human in it. So every tool returns something a model can act
 * on — `render` hands back the actual PNG as an image content block, because the last
 * check on a piece of design has to be a visual one, and `lint` hands back defects with
 * suggested fixes rather than a boolean.
 *
 * It is a thin skin over @creative/core. Anything that belongs to both this and the CLI
 * lives in core; nothing is implemented twice.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, extname, basename, join, resolve } from "node:path";
import {
  render, lint, encode, formatFromPath,
  parseDocument, parseTemplate, loadDocument, saveDocument, loadTemplate, mergePatch, findLayer,
  fill, describe as describeTemplate,
  listFonts, installFromGoogle, renderSpecimen,
  removeBackground,
  type Document,
} from "@creative/core";

const server = new McpServer({ name: "creative", version: "0.1.0" });

/** The content blocks these tools return — text, and images the model can look at. */
type Block =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/* ── shared helpers ────────────────────────────────────────────────────────── */

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const failure = (err: unknown) => ({
  content: [{ type: "text" as const, text: `error: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
});

/**
 * Render, lint, and hand back the image alongside the numbers.
 *
 * The image is capped and re-encoded before it goes over the wire: a 2.6MB lossless
 * PNG in a tool result is mostly a way to burn a model's context, and a 900px JPEG
 * shows exactly the same design problems.
 */
async function renderAndReport(doc: Document, baseDir: string, o: { out?: string; preview?: boolean } = {}) {
  const { canvas, report } = await render(doc, { baseDir });
  const findings = lint({ doc, report, canvas });

  const content: Block[] = [];

  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    const full = await encode(canvas, { format: formatFromPath(o.out) });
    writeFileSync(o.out, full.buffer);
  }

  if (o.preview !== false) {
    const preview = await encode(canvas, { format: "jpg", quality: 80, width: 900 });
    content.push({ type: "image", data: preview.buffer.toString("base64"), mimeType: "image/jpeg" });
  }

  content.push({
    type: "text",
    text: JSON.stringify({ written: o.out ?? null, report, findings }, null, 2),
  });

  return { content };
}

function templateDirs(): string[] {
  return [process.env.CREATIVE_TEMPLATES, join(process.cwd(), "templates")]
    .filter((d): d is string => Boolean(d) && existsSync(d!));
}

function resolveTemplatePath(nameOrPath: string): string {
  if (nameOrPath.endsWith(".json") && existsSync(resolve(nameOrPath))) return resolve(nameOrPath);
  for (const dir of templateDirs()) {
    const p = join(dir, `${nameOrPath}.json`);
    if (existsSync(p)) return p;
  }
  throw new Error(`no template "${nameOrPath}" — call list_templates to see what exists`);
}

/* ── tools ─────────────────────────────────────────────────────────────────── */

server.tool(
  "render_document",
  "Render a design document to an image and return it, with every layer's resolved geometry and any lint findings. " +
  "Look at the returned image before deciding the design is done — the report says whether it fits, not whether it is good.",
  {
    document: z.union([z.string(), z.record(z.any())])
      .describe("a path to a .json document, or the document object itself"),
    out: z.string().optional().describe("write the full-resolution image here"),
    baseDir: z.string().optional().describe("where relative image paths resolve from"),
  },
  async ({ document, out, baseDir }) => {
    try {
      const isPath = typeof document === "string";
      const doc = isPath ? loadDocument(document) : parseDocument(document);
      const dir = baseDir ?? (isPath ? dirname(resolve(document)) : process.cwd());
      return await renderAndReport(doc, dir, { out });
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "lint_document",
  "Check a document for defects — text overflow, layers off the canvas, low contrast against what is actually " +
  "behind them, missing or personal-use-only fonts, safe-area violations — without returning the image.",
  {
    document: z.union([z.string(), z.record(z.any())]),
    baseDir: z.string().optional(),
  },
  async ({ document, baseDir }) => {
    try {
      const isPath = typeof document === "string";
      const doc = isPath ? loadDocument(document) : parseDocument(document);
      const dir = baseDir ?? (isPath ? dirname(resolve(document)) : process.cwd());
      const { canvas, report } = await render(doc, { baseDir: dir });
      return text({ findings: lint({ doc, report, canvas }), layers: report.layers });
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "edit_document",
  "Apply a JSON merge patch to a document — set a layer's properties, move it, change copy — without rewriting " +
  "the whole file. Pass layerId to scope the patch to one layer. Returns the updated document.",
  {
    path: z.string().describe("the document file to edit in place"),
    layerId: z.string().optional().describe("scope the patch to this layer"),
    patch: z.record(z.any()).describe("RFC 7386 merge patch; null removes a key"),
    render: z.boolean().default(false).describe("also render and return the result"),
  },
  async ({ path, layerId, patch, render: shouldRender }) => {
    try {
      const doc = loadDocument(path);
      if (layerId) {
        const layer = findLayer(doc, layerId);
        Object.assign(layer, mergePatch(layer, patch));
      } else {
        Object.assign(doc, mergePatch(doc, patch));
      }
      const validated = parseDocument(doc);
      saveDocument(path, validated);
      if (shouldRender) return await renderAndReport(validated, dirname(resolve(path)));
      return text(validated);
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "list_templates",
  "The templates available, with their slots, length limits and size variants.",
  {},
  async () => {
    try {
      const out: unknown[] = [];
      for (const dir of templateDirs()) {
        for (const f of readdirSync(dir)) {
          if (extname(f) !== ".json") continue;
          try {
            out.push({ ...describeTemplate(loadTemplate(join(dir, f))), path: join(dir, f) });
          } catch {
            /* a malformed template should not hide the working ones */
          }
        }
      }
      return text(out);
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "describe_template",
  "What one template takes: every slot, its type, whether it is required, and how many characters the copy can " +
  "run to before auto-fit starts shrinking it. Read this before writing copy, so the copy fits by design.",
  { template: z.string() },
  async ({ template }) => {
    try {
      return text(describeTemplate(loadTemplate(resolveTemplatePath(template))));
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "fill_template",
  "Fill a template's slots and render it. Returns the image, the geometry and any lint findings.",
  {
    template: z.string(),
    values: z.record(z.string()).describe("slot id to value; image slots take a path"),
    out: z.string().optional(),
    size: z.string().optional().describe("a declared size variant, e.g. \"4:5\""),
    saveDocument: z.string().optional().describe("also write the filled document here, so it can be edited"),
  },
  async ({ template, values, out, size, saveDocument: savePath }) => {
    try {
      const path = resolveTemplatePath(template);
      const doc = fill(loadTemplate(path), values, { size });
      if (savePath) saveDocument(savePath, doc);
      return await renderAndReport(doc, dirname(path), { out });
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "save_template",
  "Write a template. This is how a template gets authored iteratively: propose one from a reference image, " +
  "fill it, render it, compare against the reference, adjust, save again.",
  {
    path: z.string(),
    template: z.record(z.any()),
  },
  async ({ path, template }) => {
    try {
      // Validated here so an invalid template fails with a named path, rather than
      // at the next render.
      const parsed = parseTemplate(template);
      mkdirSync(dirname(resolve(path)), { recursive: true });
      writeFileSync(path, JSON.stringify(parsed, null, 2) + "\n");
      return text({ written: path, ...describeTemplate(parsed) });
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "compare_images",
  "Return two images side by side in one result — a reference and a render — so they can be judged against each " +
  "other in a single look. This is the comparison step of authoring a template from a reference.",
  {
    reference: z.string().describe("path to the reference image"),
    candidate: z.string().describe("path to the rendered image"),
    width: z.number().default(760).describe("width each is scaled to"),
  },
  async ({ reference, candidate, width }) => {
    try {
      const content: Block[] = [];
      for (const [label, path] of [["reference", reference], ["candidate", candidate]] as const) {
        if (!existsSync(path)) throw new Error(`no such file: ${path}`);
        const enc = await encode(readFileSync(path), { format: "jpg", quality: 82, width });
        content.push({ type: "text", text: `${label}: ${basename(path)}` });
        content.push({ type: "image", data: enc.buffer.toString("base64"), mimeType: "image/jpeg" });
      }
      content.push({
        type: "text",
        text: "Compare composition, weight and spacing — not pixel equality. Name the specific differences, " +
          "then patch the template and render again.",
      });
      return { content };
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "list_fonts",
  "Installed font families, with the licence held for each. A personal-only face fails lint on commercial work.",
  {},
  async () => text(listFonts()),
);

server.tool(
  "add_font",
  "Install a family from the Google Fonts catalogue (no API key needed).",
  { family: z.string() },
  async ({ family }) => {
    try {
      return text(await installFromGoogle(family));
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "preview_font",
  "Render a specimen sheet for a family and return it, so a face can be chosen by looking rather than by name.",
  { family: z.string(), sampleText: z.string().optional() },
  async ({ family, sampleText }) => {
    try {
      const png = renderSpecimen(family, sampleText);
      const enc = await encode(png, { format: "jpg", quality: 82, width: 900 });
      return { content: [{ type: "image", data: enc.buffer.toString("base64"), mimeType: "image/jpeg" }] };
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "remove_background",
  "Cut a product out of its background to a transparent PNG, optionally feathered and with a drop shadow.",
  {
    image: z.string(),
    out: z.string(),
    provider: z.enum(["removebg", "photoroom", "clipdrop"]).optional(),
    feather: z.number().optional(),
    shadow: z.boolean().default(false),
  },
  async ({ image, out, provider, feather, shadow }) => {
    try {
      const { buffer, provider: used } = await removeBackground(image, {
        provider,
        feather,
        pad: shadow ? 40 : undefined,
        shadow: shadow ? { blur: 24, x: 0, y: 16, opacity: 0.35 } : undefined,
      });
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(out, buffer);
      return text({ written: out, provider: used, bytes: buffer.length });
    } catch (err) {
      return failure(err);
    }
  },
);

server.tool(
  "export_image",
  "Re-encode an image to a file-size budget, and to several widths at once.",
  {
    image: z.string(),
    out: z.string(),
    format: z.enum(["png", "jpg", "webp"]).optional(),
    quality: z.number().optional(),
    maxKb: z.number().optional(),
  },
  async ({ image, out, format, quality, maxKb }) => {
    try {
      const r = await encode(readFileSync(image), { format: format ?? formatFromPath(out), quality, maxKb });
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(out, r.buffer);
      return text({ written: out, format: r.format, quality: r.quality, bytes: r.bytes, overBudget: r.overBudget });
    } catch (err) {
      return failure(err);
    }
  },
);

await server.connect(new StdioServerTransport());
