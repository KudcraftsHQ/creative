/**
 * Reading, validating and patching documents.
 *
 * Validation errors are addressed to a model as much as to a person, so they name
 * the path and say what was expected rather than dumping a schema.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Document, Template } from "./types.ts";
import type { Document as Doc, Template as Tpl } from "./types.ts";
import { z } from "zod";

function explain(err: z.ZodError, what: string): Error {
  const lines = err.issues.map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `  ${path}: ${i.message}`;
  });
  return new Error(`${what} is not valid:\n${lines.join("\n")}`);
}

export function parseDocument(value: unknown): Doc {
  const r = Document.safeParse(value);
  if (!r.success) throw explain(r.error, "document");
  return r.data;
}

export function parseTemplate(value: unknown): Tpl {
  const r = Template.safeParse(value);
  if (!r.success) throw explain(r.error, "template");
  return r.data;
}

export function loadDocument(path: string): Doc {
  return parseDocument(JSON.parse(readFileSync(path, "utf8")));
}

export function loadTemplate(path: string): Tpl {
  return parseTemplate(JSON.parse(readFileSync(path, "utf8")));
}

export function saveDocument(path: string, doc: Doc): void {
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
}

/** RFC 7386-style merge: `null` removes, objects merge, everything else replaces. */
export function mergePatch<T>(target: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch as T;
  }
  const base: Record<string, unknown> =
    target && typeof target === "object" && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete base[k];
    else base[k] = mergePatch(base[k], v);
  }
  return base as T;
}

/** Address a layer by id for `creative edit`. */
export function findLayer(doc: Doc, id: string): Doc["layers"][number] {
  const layer = doc.layers.find((l, i) => (l.id ?? `${l.type}${i}`) === id);
  if (!layer) {
    const known = doc.layers.map((l, i) => l.id ?? `${l.type}${i}`).join(", ");
    throw new Error(`no layer "${id}". This document has: ${known || "(none)"}`);
  }
  return layer;
}
