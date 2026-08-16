/**
 * `creative init` — a starting document or template that already renders.
 *
 * A blank file is a bad starting point for a model: it has to invent the schema. A
 * working document it can mutate is a much better one, which is why this writes
 * something real rather than an empty scaffold.
 */
import { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import type { Document, Template } from "@creative/core";
import { fail, note, dim } from "../output.ts";

function starterDocument(w: number, h: number): Document {
  return {
    name: "untitled",
    canvas: { w, h, bg: "#ffffff" },
    vars: { "brand.yellow": "#F5C518", "brand.ink": "#3B1E0A" },
    safeArea: 0,
    layers: [
      {
        type: "image",
        id: "photo",
        src: "photo.jpg",
        frame: "full",
        fit: "cover",
        focal: [0.5, 0.4],
        radius: 0,
        opacity: 1,
        rotate: 0,
        hidden: false,
      },
      {
        type: "text",
        id: "headline",
        frame: { anchor: "top-right", inset: [40, 40], w: 560, gap: 0 },
        align: "left",
        lineHeight: 1.14,
        box: { mode: "grow", fill: "@brand.yellow", radius: 18, pad: [30, 22], perLine: true },
        autofit: { min: 36, max: 120 },
        runs: [
          { text: "HARGA GROSIR\n", font: "Anton", size: 88, color: "@brand.ink" },
          { text: "CUMA", font: "Anton", size: 88, color: "@brand.ink" },
          { text: "57", font: "Anton", size: 120, color: "#B3261E" },
          { text: "RIBUAN!", font: "Anton", size: 88, color: "@brand.ink" },
        ],
        opacity: 1,
        rotate: 0,
        hidden: false,
      },
      {
        type: "text",
        id: "fine",
        frame: { below: "headline", gap: 12, align: "end" },
        text: "* MIN 6 IKAT",
        font: "Anton",
        size: 34,
        color: "@brand.ink",
        align: "right",
        lineHeight: 1.14,
        box: { mode: "grow", fill: "@brand.yellow", radius: 12, pad: [20, 14], perLine: true },
        autofit: { min: 12, max: 400 },
        opacity: 1,
        rotate: 0,
        hidden: false,
      },
    ],
  } as unknown as Document;
}

export function registerInitCommands(program: Command): void {
  program
    .command("init [file]")
    .description("write a starting document (or template) that already renders")
    .option("--template", "write a template with slots instead of a document")
    .option("--size <wxh>", "canvas size", "1080x1080")
    .option("--force", "overwrite an existing file")
    .action((file: string | undefined, o) => {
      try {
        const out = file ?? (o.template ? "template.json" : "design.json");
        if (existsSync(out) && !o.force) throw new Error(`${out} exists — pass --force to overwrite`);

        const m = /^(\d+)x(\d+)$/.exec(o.size);
        if (!m) throw new Error(`--size expects WxH, e.g. 1080x1350`);
        const doc = starterDocument(Number(m[1]), Number(m[2]));

        if (o.template) {
          const template: Template = {
            name: "untitled",
            description: "a starting template",
            slots: [
              { id: "photo", type: "image", required: true, label: "background photo", aspect: "1:1" },
              { id: "headline", type: "text", required: true, label: "headline", maxChars: 26 },
              { id: "fine", type: "text", required: false, default: "* MIN 6 IKAT", label: "fine print", maxChars: 20 },
            ],
            document: {
              ...doc,
              layers: doc.layers.map((l) =>
                l.id === "photo" ? { ...l, src: "{{photo}}" }
                : l.id === "headline" ? { ...l, runs: undefined, text: "{{headline}}", font: "Anton", size: 88, color: "@brand.ink" }
                : l.id === "fine" ? { ...l, text: "{{fine}}" }
                : l,
              ) as Document["layers"],
            },
            sizes: {
              "4:5": { canvas: { w: 1080, h: 1350 }, patch: {} },
              "9:16": { canvas: { w: 1080, h: 1920 }, patch: {} },
            },
          };
          writeFileSync(out, JSON.stringify(template, null, 2) + "\n");
          note(`${out}  ${dim("template · fill it with: creative fill ./" + out + " --set headline=\"…\" --set photo=./photo.jpg")}`);
          return;
        }

        writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
        note(`${out}  ${dim("render it with: creative render " + out + " -o out.png")}`);
        note(dim("it needs a font and a photo:  creative font add Anton"));
      } catch (err) {
        fail(err);
      }
    });
}
