/**
 * Every word of copy in a document.
 *
 * A design is JSON, so its text is already structured — which is what makes
 * "find the listing that says GROSIR" a query instead of a crawl. This lives in
 * core rather than in the API because it is a fact about documents: the same
 * flattening feeds the library's search column, `creative grep` if it is ever
 * written, and anything else that wants to read a design without rendering it.
 *
 * Deliberately not clever. It collects text in layer order, applies each run's
 * `transform` so the stored copy matches what is drawn, and leaves stemming and
 * ranking to Postgres, which is better at both.
 */
import { expandRuns } from "./text.ts";
import type { Document, TextLayer } from "./types.ts";

/** The copy in one text layer, runs joined in reading order. */
export function layerText(layer: TextLayer): string {
  return expandRuns(layer)
    .map((run) => run.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * All copy in a document, one line per text layer.
 *
 * Placeholders (`{{slot}}`) are dropped: a template's holes are not copy, and
 * indexing them would make every unfilled template match every search for a
 * slot name.
 */
export function documentText(doc: Document): string {
  const lines: string[] = [];
  if (doc.name) lines.push(doc.name);

  for (const layer of doc.layers) {
    if (layer.type !== "text" || layer.hidden) continue;
    const text = layerText(layer).replace(/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/g, " ").replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
  }

  return lines.join("\n");
}
