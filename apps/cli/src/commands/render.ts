/**
 * render / inspect / lint — the three that matter to an agent.
 *
 * `render` draws. `inspect` draws and hands back every resolved box, so a model can
 * reason about geometry instead of guessing. `lint` draws and reports defects. They
 * share one code path because a report describing a render that did not happen is
 * exactly the kind of thing that lets an agent ship a broken image confidently.
 */
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import {
  loadDocument, render, encode, encodeSizes, lint, formatFromPath,
  type Document, type Finding, type RenderReport,
} from "@creative/core";
import { emit, fail, humanBytes, note, dim, printFindings } from "../output.ts";

export interface RenderedOnce {
  doc: Document;
  report: RenderReport;
  findings: Finding[];
  canvas: Awaited<ReturnType<typeof render>>["canvas"];
}

export async function renderDocument(
  doc: Document,
  o: { baseDir: string; scale: number; skipLint?: boolean },
): Promise<RenderedOnce> {
  const { canvas, report } = await render(doc, { baseDir: o.baseDir, scale: o.scale });
  const findings = o.skipLint ? [] : lint({ doc, report, canvas, scale: o.scale });
  return { doc, report, findings, canvas };
}

export async function writeImage(
  canvas: Awaited<ReturnType<typeof render>>["canvas"],
  out: string,
  o: { format?: string; quality?: number; maxKb?: number; sizes?: string },
): Promise<void> {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const format = (o.format as "png" | "jpg" | "webp") ?? formatFromPath(out);

  if (o.sizes) {
    const widths = o.sizes.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
    const results = await encodeSizes(canvas, widths, { format, quality: o.quality, maxKb: o.maxKb });
    for (const r of results) {
      const path = out.replace(/(\.[^.]+)$/, `-${r.width}$1`);
      writeFileSync(path, r.buffer);
      note(`${path}  ${dim(`${r.width}px · q${r.quality} · ${humanBytes(r.bytes)}`)}`);
      if (r.overBudget) note(dim(`  over budget even at q${r.quality}`));
    }
    return;
  }

  const r = await encode(canvas, { format, quality: o.quality, maxKb: o.maxKb });
  writeFileSync(out, r.buffer);
  note(`${out}  ${dim(`${r.format} · q${r.quality} · ${humanBytes(r.bytes)}`)}`);
  if (r.overBudget) {
    note(dim(`  smallest reachable was ${humanBytes(r.bytes)} at q${r.quality} — try --sizes or a smaller canvas`));
  }
}

/** Non-zero exit on lint errors so a batch script or an agent notices. */
export function reportAndExit(findings: Finding[], strict: boolean): void {
  if (findings.length) printFindings(findings);
  if (strict && findings.some((f) => f.severity === "error")) process.exit(2);
}

export function registerRenderCommands(program: Command): void {
  program
    .command("render <document>")
    .description("render a document to an image")
    .option("-o, --out <file>", "output path", "out.png")
    .option("-s, --scale <n>", "render at N× the canvas size", Number, 1)
    .option("-f, --format <fmt>", "png | jpg | webp (default: from the output extension)")
    .option("-q, --quality <n>", "encoder quality, 1-100", Number)
    .option("--max-kb <n>", "search quality down until the file fits this budget", Number)
    .option("--sizes <list>", "also write these widths, e.g. 1080,800,400")
    .option("--no-lint", "skip the lint pass")
    .option("--strict", "exit non-zero when lint finds an error")
    .action(async (docPath: string, o) => {
      try {
        const doc = loadDocument(docPath);
        const r = await renderDocument(doc, {
          baseDir: dirname(resolve(docPath)),
          scale: o.scale,
          skipLint: !o.lint,
        });
        await writeImage(r.canvas, o.out, o);
        note(dim(`${r.report.canvas.w}×${r.report.canvas.h} · ${r.report.ms}ms`));
        reportAndExit(r.findings, o.strict);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("inspect <document>")
    .description("render and report every layer's resolved geometry, as JSON")
    .option("-s, --scale <n>", "render scale", Number, 1)
    .option("--render <file>", "also write the image, so the agent can look at it")
    .action(async (docPath: string, o) => {
      try {
        const doc = loadDocument(docPath);
        const r = await renderDocument(doc, { baseDir: dirname(resolve(docPath)), scale: o.scale });
        if (o.render) await writeImage(r.canvas, o.render, {});
        emit({ ...r.report, findings: r.findings });
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("lint <document>")
    .description("render and report defects: overflow, off-canvas, contrast, fonts, safe area")
    .option("-s, --scale <n>", "render scale", Number, 1)
    .option("--json", "machine-readable output")
    .action(async (docPath: string, o) => {
      try {
        const doc = loadDocument(docPath);
        const r = await renderDocument(doc, { baseDir: dirname(resolve(docPath)), scale: o.scale });
        if (o.json) emit({ findings: r.findings });
        else printFindings(r.findings);
        if (r.findings.some((f) => f.severity === "error")) process.exit(2);
      } catch (err) {
        fail(err);
      }
    });
}
