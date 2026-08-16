/**
 * `creative edit` — patch a document without rewriting the JSON.
 *
 * The iteration loop this is built for: an agent renders, looks at the image, decides
 * the headline is too low, and moves it — one command, no re-emitting a document it
 * would otherwise have to hold entirely in context.
 */
import { Command } from "commander";
import { loadDocument, saveDocument, findLayer, mergePatch, parseDocument } from "@creative/core";
import { emit, fail, note, dim } from "../output.ts";

/** `x.y.z=value` with JSON values where they parse, strings otherwise. */
function applyPath(target: Record<string, unknown>, path: string, raw: string): void {
  const keys = path.split(".");
  let node = target;
  for (const k of keys.slice(0, -1)) {
    if (typeof node[k] !== "object" || node[k] === null) node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    /* a bare word is a string, which is what anyone typing --set color=#fff means */
  }
  node[keys[keys.length - 1]!] = value;
}

function delta(raw: string): number {
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`expected a number, got "${raw}"`);
  return n;
}

export function registerEditCommands(program: Command): void {
  program
    .command("edit <document>")
    .description("patch a document in place")
    .option("--layer <id>", "the layer these changes apply to")
    .option("--set <path=value...>", "set a property, e.g. --set box.fill=#F5C518", (v: string, prev: string[] = []) => [...prev, v], [])
    .option("--move <dx,dy>", "nudge the layer's frame by this many px")
    .option("--text <text>", "replace the layer's text")
    .option("--patch <json>", "a JSON merge patch applied to the whole document")
    .option("-o, --out <file>", "write here instead of in place")
    .option("--print", "print the result instead of writing it")
    .action((docPath: string, o) => {
      try {
        let doc = loadDocument(docPath);

        if (o.patch) doc = mergePatch(doc, JSON.parse(o.patch));

        if (o.layer) {
          const layer = findLayer(doc, o.layer) as unknown as Record<string, unknown>;

          if (o.text !== undefined) {
            if (layer.type !== "text") throw new Error(`--text needs a text layer; "${o.layer}" is a ${layer.type}`);
            layer.text = o.text;
            delete layer.runs;
          }

          if (o.move) {
            const [dx, dy] = o.move.split(",").map((s: string) => delta(s.trim()));
            const frame = (typeof layer.frame === "object" && layer.frame !== null
              ? { ...(layer.frame as Record<string, unknown>) }
              : {}) as Record<string, unknown>;
            // Nudging an anchored layer moves its inset, which keeps the anchor
            // meaningful; nudging an absolute one moves the coordinates.
            if (frame.x !== undefined || frame.y !== undefined || frame.anchor === undefined) {
              frame.x = (Number(frame.x) || 0) + dx!;
              frame.y = (Number(frame.y) || 0) + dy!;
            } else {
              const inset = Array.isArray(frame.inset) ? [...(frame.inset as number[])] : [Number(frame.inset) || 0, Number(frame.inset) || 0];
              const anchor = String(frame.anchor);
              inset[0] = inset[0]! + (anchor.includes("right") ? -dx! : dx!);
              inset[1] = inset[1]! + (anchor.startsWith("bottom") ? -dy! : dy!);
              frame.inset = inset as [number, number];
            }
            layer.frame = frame;
          }

          for (const s of o.set as string[]) {
            const eq = s.indexOf("=");
            if (eq < 1) throw new Error(`--set expects path=value, got "${s}"`);
            applyPath(layer, s.slice(0, eq), s.slice(eq + 1));
          }
        } else if ((o.set as string[]).length) {
          for (const s of o.set as string[]) {
            const eq = s.indexOf("=");
            applyPath(doc as unknown as Record<string, unknown>, s.slice(0, eq), s.slice(eq + 1));
          }
        }

        // Round-trip through the schema so an edit that produces an invalid document
        // fails here, with a path, rather than at render time.
        const validated = parseDocument(doc);
        const out = o.out ?? docPath;
        if (o.print) return emit(validated);
        saveDocument(out, validated);
        note(dim(`wrote ${out}`));
      } catch (err) {
        fail(err);
      }
    });
}
