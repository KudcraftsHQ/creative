/**
 * fill / batch / templates — the commands that do the actual job.
 *
 * `fill` is the 90% command: a template, some values, an image out. `batch` is the
 * same thing over a CSV, which is how 200 marketplace listings get made without
 * anybody opening a browser.
 */
import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { loadTemplate, fill, describe, MissingSlots, saveDocument } from "@creative/core";
import { emit, fail, note, dim, bold, collectSet } from "../output.ts";
import { renderDocument, writeImage, reportAndExit } from "./render.ts";

/** Templates live next to the CLI, in the cwd, or wherever CREATIVE_TEMPLATES points. */
export function templateDirs(): string[] {
  const dirs = [
    process.env.CREATIVE_TEMPLATES,
    join(process.cwd(), "templates"),
    join(dirname(process.execPath), "templates"),
  ].filter(Boolean) as string[];
  return dirs.filter((d) => existsSync(d));
}

export function resolveTemplate(nameOrPath: string): string {
  if (nameOrPath.includes("/") || nameOrPath.endsWith(".json")) {
    const p = resolve(nameOrPath);
    if (existsSync(p)) return p;
  }
  for (const dir of templateDirs()) {
    const p = join(dir, `${nameOrPath}.json`);
    if (existsSync(p)) return p;
  }
  const known = listTemplates().map((t) => t.name).join(", ");
  throw new Error(`no template "${nameOrPath}". Available: ${known || "(none — set CREATIVE_TEMPLATES)"}`);
}

export function listTemplates(): Array<{ name: string; path: string }> {
  const seen = new Map<string, string>();
  for (const dir of templateDirs()) {
    for (const f of readdirSync(dir)) {
      if (extname(f) !== ".json") continue;
      const name = basename(f, ".json");
      if (!seen.has(name)) seen.set(name, join(dir, f));
    }
  }
  return [...seen].map(([name, path]) => ({ name, path }));
}

/** A small CSV reader: quoted fields, embedded commas, doubled quotes. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

function slotHelp(err: MissingSlots, templatePath: string): string {
  const d = describe(loadTemplate(templatePath));
  const lines = d.slots.map((s) => {
    const bits = [s.type, s.required ? "required" : "optional"];
    if (s.maxChars) bits.push(`≤${s.maxChars} chars before it shrinks`);
    return `  ${s.id}  ${dim(bits.join(" · "))}`;
  });
  return `${err.message}\n\nThis template takes:\n${lines.join("\n")}`;
}

export function registerTemplateCommands(program: Command): void {
  program
    .command("templates")
    .description("list available templates")
    .option("--json", "machine-readable output")
    .action((o) => {
      const all = listTemplates();
      if (o.json) return emit(all.map((t) => describe(loadTemplate(t.path))));
      if (!all.length) return note(dim("no templates found — looked in: " + (templateDirs().join(", ") || "(nowhere)")));
      for (const t of all) {
        const d = describe(loadTemplate(t.path));
        note(`${bold(d.name)}  ${dim(`${d.canvas.w}×${d.canvas.h} · ${d.slots.length} slots · sizes: ${d.sizes.join(", ")}`)}`);
        if (d.description) note(dim(`  ${d.description}`));
      }
    });

  program
    .command("describe <template>")
    .description("what a template takes: slots, types, length limits, sizes")
    .action((name: string) => {
      try {
        emit(describe(loadTemplate(resolveTemplate(name))));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("fill <template>")
    .description("fill a template's slots and render it")
    .option("--set <key=value...>", "slot value; repeat for each", collectSet, {})
    .option("-o, --out <file>", "output path", "out.png")
    .option("--size <name>", "a declared size variant instead of the base canvas")
    .option("-s, --scale <n>", "render at N× the canvas size", Number, 1)
    .option("-f, --format <fmt>", "png | jpg | webp")
    .option("-q, --quality <n>", "encoder quality, 1-100", Number)
    .option("--max-kb <n>", "search quality down until the file fits this budget", Number)
    .option("--sizes <list>", "also write these widths, e.g. 1080,800,400")
    .option("--save-doc <file>", "also write the filled document, for editing afterwards")
    .option("--strict", "exit non-zero when lint finds an error")
    .action(async (name: string, o) => {
      const path = resolveTemplate(name);
      try {
        const doc = fill(loadTemplate(path), o.set, { size: o.size });
        if (o.saveDoc) saveDocument(o.saveDoc, doc);
        const r = await renderDocument(doc, { baseDir: dirname(path), scale: o.scale });
        await writeImage(r.canvas, o.out, o);
        note(dim(`${r.report.canvas.w}×${r.report.canvas.h} · ${r.report.ms}ms`));
        reportAndExit(r.findings, o.strict);
      } catch (err) {
        if (err instanceof MissingSlots) fail(slotHelp(err, path));
        fail(err);
      }
    });

  program
    .command("batch <template> <csv>")
    .description("render one image per CSV row; columns are slot values")
    .option("--out <dir>", "output directory", "./out")
    .option("--name <column>", "column to use for filenames", "id")
    .option("--size <name>", "a declared size variant")
    .option("-s, --scale <n>", "render scale", Number, 1)
    .option("-f, --format <fmt>", "png | jpg | webp", "jpg")
    .option("--max-kb <n>", "per-file size budget", Number)
    .option("--sizes <list>", "also write these widths")
    .option("--continue-on-error", "keep going when a row fails")
    .action(async (name: string, csvPath: string, o) => {
      try {
        const path = resolveTemplate(name);
        const template = loadTemplate(path);
        const rows = parseCsv(readFileSync(csvPath, "utf8"));
        if (!rows.length) return note(dim("no rows"));

        let ok = 0;
        const failures: Array<{ row: number; error: string }> = [];

        for (const [i, row] of rows.entries()) {
          // Deterministic filenames: a re-run overwrites cleanly instead of
          // leaving final-v3-FIX.png behind.
          const stem = (row[o.name] || `row-${i + 1}`).replace(/[^a-zA-Z0-9._-]+/g, "-");
          const out = join(o.out, `${stem}.${o.format}`);
          try {
            const doc = fill(template, row, { size: o.size });
            const r = await renderDocument(doc, { baseDir: dirname(path), scale: o.scale });
            await writeImage(r.canvas, out, o);
            const errors = r.findings.filter((f) => f.severity === "error");
            if (errors.length) note(dim(`  ${errors.length} lint error(s): ${errors.map((e) => e.rule).join(", ")}`));
            ok++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push({ row: i + 1, error: msg });
            note(dim(`row ${i + 1}: ${msg}`));
            if (!o.continueOnError) throw err;
          }
        }

        note(`${ok}/${rows.length} rendered into ${o.out}`);
        if (failures.length) {
          note(dim(`${failures.length} failed`));
          process.exit(2);
        }
      } catch (err) {
        fail(err);
      }
    });
}
