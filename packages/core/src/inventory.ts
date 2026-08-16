/**
 * What a document uses.
 *
 * The library lists a design as "promo-band · 1:1 · Anton, Archivo Black" — which
 * means the faces a design draws with are a fact about the document, wanted by the
 * UI, the linter and anything deciding whether a machine has what it needs to
 * render. Derived here once rather than three times.
 */
import { expandRuns } from "./text.ts";
import type { Document, TextLayer } from "./types.ts";

/** Every font family the document draws with, in first-use order. */
export function documentFonts(doc: Document): string[] {
  const seen = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.type !== "text" || layer.hidden) continue;
    for (const run of expandRuns(layer as TextLayer)) seen.add(run.font);
  }
  return [...seen];
}

/** The canvas ratio, reduced — "1:1", "4:5", "9:16". */
export function canvasRatio(doc: Document): string {
  const { w, h } = doc.canvas;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h) || 1;
  return `${w / d}:${h / d}`;
}
