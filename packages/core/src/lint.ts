/**
 * The linter.
 *
 * This is the file that decides whether an agent can work unsupervised. A renderer
 * that only draws will happily produce a headline running off the canvas and report
 * success; these rules are what turn "it rendered" into "it is usable". Every finding
 * carries a suggested fix, because the consumer is a model deciding what to change.
 *
 * What it cannot judge is taste — a headline auto-fitted down to 38px is legible and
 * still weak. `atMinimum` is the honest proxy: it says "this only fitted by shrinking
 * to the floor", which is the moment to rewrite the copy shorter rather than accept it.
 */
import type { Canvas } from "@napi-rs/canvas";
import { expandRuns } from "./text.ts";
import { resolveVars } from "./render.ts";
import { getFont, missingFamilies } from "./fonts.ts";
import type { Document, Finding, LayerReport, RenderReport, TextLayer } from "./types.ts";

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Average luminance of what is actually behind a text layer.
 *
 * Sampled from the rendered pixels rather than from the document, because "the
 * background" of a headline over a photograph is not a value anyone declared.
 */
function backgroundLuminance(canvas: Canvas, box: { x: number; y: number; w: number; h: number }, scale: number): number | null {
  const ctx = canvas.getContext("2d");
  const x = Math.max(0, Math.round(box.x * scale));
  const y = Math.max(0, Math.round(box.y * scale));
  const w = Math.min(canvas.width - x, Math.round(box.w * scale));
  const h = Math.min(canvas.height - y, Math.round(box.h * scale));
  if (w <= 0 || h <= 0) return null;

  const { data } = ctx.getImageData(x, y, w, h);
  let sum = 0, n = 0;
  // Every 16th pixel: the average is stable long before a full scan, and a 4K
  // frame has four million of them.
  for (let i = 0; i < data.length; i += 4 * 16) {
    sum += luminance(data[i]!, data[i + 1]!, data[i + 2]!);
    n++;
  }
  return n ? sum / n : null;
}

export interface LintInput {
  doc: Document;
  report: RenderReport;
  canvas?: Canvas;
  scale?: number;
}

export function lint({ doc, report, canvas, scale = 1 }: LintInput): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map<string, LayerReport>(report.layers.map((l) => [l.id, l]));

  /* fonts: installed, and licensed for what these images are for */
  const families = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.type !== "text") continue;
    for (const run of expandRuns(resolveVars(layer, doc.vars) as TextLayer)) families.add(run.font);
  }
  for (const family of missingFamilies(families)) {
    findings.push({
      rule: "font-missing",
      severity: "error",
      message: `font "${family}" is not installed — Skia silently substitutes a default face, so the render is not what the document says`,
      fix: `creative font add "${family}"`,
    });
  }
  for (const family of families) {
    const entry = getFont(family);
    if (entry?.license === "personal-only") {
      findings.push({
        rule: "font-license",
        severity: "error",
        message: `font "${family}" is registered as personal-only and this is commercial use`,
        fix: `replace it, or re-register with the licence you hold: creative font add <file> --family "${family}" --license commercial --source "invoice #…"`,
      });
    }
    if (entry?.license === "unknown") {
      findings.push({
        rule: "font-license-unknown",
        severity: "warning",
        message: `font "${family}" has no recorded licence`,
        fix: `creative font set-license "${family}" --license commercial --source "where it came from"`,
      });
    }
  }

  for (const raw of doc.layers) {
    if (raw.hidden) continue;
    // Against the resolved layer, not the authored one: a fill of "@brand.yellow"
    // is a colour by the time it is painted, and linting the literal would both
    // miss the contrast and give advice for a box that is already there.
    const layer = resolveVars(raw, doc.vars);
    const id = layer.id ?? "";
    const r = id ? byId.get(id) : undefined;
    if (!r) continue;

    /* geometry — against the area the layer occupies once rotated, not the frame it
       was placed in. A headline turned 20° leaves the canvas well before its frame
       does, and a linter that reads the frame calls that fine. */
    const { x, y, w, h } = r.bounds ?? r.box;

    /**
     * A picture or a block that covers the whole canvas is bleeding off it on
     * purpose — a background photograph turned a few degrees, a colour field run
     * past the edge so no white line shows at the corner. Nothing is lost, so
     * there is nothing to report.
     *
     * Text is never bleed. A headline wider than the canvas has lost its ends,
     * which is exactly the defect this rule exists to catch.
     */
    const bleed = layer.type !== "text"
      && x <= 0.5 && y <= 0.5
      && x + w >= doc.canvas.w - 0.5 && y + h >= doc.canvas.h - 0.5;

    if (!bleed && (x < -0.5 || y < -0.5 || x + w > doc.canvas.w + 0.5 || y + h > doc.canvas.h + 0.5)) {
      findings.push({
        rule: "off-canvas",
        severity: "error",
        layer: r.id,
        message: `"${r.id}" extends outside the canvas (${Math.round(x)},${Math.round(y)} ${Math.round(w)}×${Math.round(h)} on ${doc.canvas.w}×${doc.canvas.h})`
          + (r.bounds ? `, once rotated by ${layer.rotate}°` : ""),
        fix: r.bounds
          ? "reduce its rotation or its width, or move it to an anchor with more room"
          : "reduce its width, shorten the copy, or move it to an anchor with more room",
      });
    }

    if (doc.safeArea > 0 && layer.type === "text") {
      const s = doc.safeArea;
      if (x < s || y < s || x + w > doc.canvas.w - s || y + h > doc.canvas.h - s) {
        findings.push({
          rule: "safe-area",
          severity: "warning",
          layer: r.id,
          message: `"${r.id}" crosses the ${s}px safe area, where marketplace UI may cover it`,
          fix: `move it inside the safe area, or set safeArea to 0 if this size has no overlay`,
        });
      }
    }

    if (layer.type !== "text") continue;

    /* text fit */
    if (r.overflow) {
      findings.push({
        rule: "text-overflow",
        severity: "error",
        layer: r.id,
        message: `"${r.id}" does not fit its frame and is clipped`,
        fix: layer.box.mode === "fit"
          ? "shorten the copy, widen the frame, or lower autofit.min"
          : `set box.mode to "fit" so it shrinks, or to "grow" so the box follows the text`,
      });
    } else if (r.atMinimum) {
      findings.push({
        rule: "autofit-floor",
        severity: "warning",
        layer: r.id,
        message: `"${r.id}" only fits at the minimum size (${r.fontSize}px) — legible, but it will read as weak next to the rest`,
        fix: "rewrite the copy shorter rather than shrinking further; that is what a designer would do here",
      });
    }

    /* contrast, against what was actually painted behind it */
    if (canvas) {
      const runs = expandRuns(layer as TextLayer);
      const bg = layer.box.mode !== "none" && layer.box.fill
        ? parseColor(layer.box.fill)
        : null;
      const bgLum = bg
        ? luminance(bg[0], bg[1], bg[2])
        : backgroundLuminance(canvas, r.box, scale);
      if (bgLum !== null) {
        for (const run of runs) {
          const fg = parseColor(run.color);
          if (!fg) continue;
          const ratio = contrastRatio(luminance(fg[0], fg[1], fg[2]), bgLum);
          // 4.5:1 is the WCAG AA body threshold; display sizes get the 3:1 large-text
          // allowance, which is the same distinction a designer makes by eye.
          const threshold = (r.fontSize ?? run.size) >= 48 ? 3 : 4.5;
          if (ratio < threshold) {
            findings.push({
              rule: "contrast",
              severity: "warning",
              layer: r.id,
              message: `"${r.id}" text ${run.color} sits at ${ratio.toFixed(1)}:1 against what is behind it (wants ${threshold}:1)`,
              fix: bg
                ? "darken the text or lighten the box fill"
                : "put a box behind it (box.mode grow + a fill), or move it over a calmer part of the photo",
            });
            break;
          }
        }
      }
    }
  }

  return findings;
}
