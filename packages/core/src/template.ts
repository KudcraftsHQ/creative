/**
 * Templates: a document with holes.
 *
 * Slots are `{{name}}` placeholders anywhere in the document's strings, which keeps
 * the template readable as a document and lets a slot fill a colour, a font family or
 * a photo path as easily as a headline.
 *
 * `describe()` exists for the agent: it reports what a template wants, including how
 * long copy can be before auto-fit starts shrinking. A model that knows the headline
 * wants ~24 characters writes copy that fits, instead of copy that gets mangled.
 */
import { parseDocument, mergePatch } from "./document.ts";
import type { Document, Slot, Template } from "./types.ts";

export class MissingSlots extends Error {
  constructor(public readonly slots: string[]) {
    super(`missing required slot${slots.length > 1 ? "s" : ""}: ${slots.join(", ")}`);
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function interpolate<T>(value: T, values: Record<string, string>): T {
  if (typeof value === "string") {
    // A whole-string placeholder keeps its type — `"{{count}}"` can become a number
    // if the value is one — while an embedded one is plain substitution.
    const whole = /^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/.exec(value);
    if (whole) {
      const v = values[whole[1]!];
      return (v ?? value) as unknown as T;
    }
    return value.replace(PLACEHOLDER, (m, k: string) => values[k] ?? m) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, values)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, values);
    return out as T;
  }
  return value;
}

export function fill(
  template: Template,
  values: Record<string, string>,
  opts: { size?: string } = {},
): Document {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];

  for (const slot of template.slots) {
    const v = values[slot.id] ?? slot.default;
    if (v === undefined) {
      if (slot.required) missing.push(slot.id);
      continue;
    }
    resolved[slot.id] = v;
  }
  if (missing.length) throw new MissingSlots(missing);

  // Values for slots the template never declared are still substituted: a template
  // is allowed to be sloppier than its schema, and refusing here helps nobody.
  for (const [k, v] of Object.entries(values)) if (!(k in resolved)) resolved[k] = v;

  let doc: unknown = template.document;
  if (opts.size) {
    const variant = template.sizes[opts.size];
    if (!variant) {
      const known = Object.keys(template.sizes).join(", ") || "(none)";
      throw new Error(`template "${template.name}" has no size "${opts.size}". It has: ${known}`);
    }
    doc = mergePatch(doc, { canvas: variant.canvas, ...variant.patch });
  }

  return parseDocument(interpolate(doc, resolved));
}

export interface SlotDescription extends Slot {
  /** Where it is used, so an agent can see a slot fills the headline. */
  usedBy: string[];
}

export function describe(template: Template): {
  name: string;
  description?: string;
  sizes: string[];
  canvas: { w: number; h: number };
  slots: SlotDescription[];
} {
  const json = JSON.stringify(template.document);
  const declared = new Map(template.slots.map((s) => [s.id, s]));

  // Any placeholder in the document is a slot, declared or not — an undeclared one
  // is still something the caller must supply, and hiding it would be a trap.
  for (const m of json.matchAll(PLACEHOLDER)) {
    const id = m[1]!;
    if (!declared.has(id)) {
      declared.set(id, { id, type: "text", required: true, label: `(undeclared)` } as Slot);
    }
  }

  const usedBy = (id: string): string[] => {
    const out: string[] = [];
    for (const [i, layer] of template.document.layers.entries()) {
      if (JSON.stringify(layer).includes(`{{${id}}}`)) out.push(layer.id ?? `${layer.type}${i}`);
    }
    return out;
  };

  return {
    name: template.name,
    description: template.description,
    sizes: ["base", ...Object.keys(template.sizes)],
    canvas: { w: template.document.canvas.w, h: template.document.canvas.h },
    slots: [...declared.values()].map((s) => ({ ...s, usedBy: usedBy(s.id) })),
  };
}
