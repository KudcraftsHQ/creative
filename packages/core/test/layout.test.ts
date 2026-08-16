/**
 * The properties worth protecting.
 *
 * These are not "does it draw" tests — the eye catches that. They pin the behaviours
 * that are easy to break silently: auto-fit keeping run ratios, `grow` following the
 * copy, anchored layers moving when the layer above them changes size, and the size
 * budget actually being met.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// The registry this machine already has, captured before the suite points
// CREATIVE_HOME somewhere disposable. `beforeAll` borrows the face from here
// rather than downloading one — see the comment there.
const realHome = process.env.CREATIVE_HOME ?? join(homedir(), ".creative");

process.env.CREATIVE_HOME = mkdtempSync(join(tmpdir(), "creative-test-"));

const { render } = await import("../src/render.ts");
const { parseDocument, mergePatch } = await import("../src/document.ts");
const { fill, describe: describeTemplate, parseTemplate, MissingSlots } = await import("../src/template.ts").then(async (t) => ({
  ...t,
  parseTemplate: (await import("../src/document.ts")).parseTemplate,
}));
const { encode } = await import("../src/export.ts");
const { installFromGoogle, installLocal, getFont } = await import("../src/fonts.ts");

/**
 * The whole suite needs one real face; Skia substitutes silently without it.
 *
 * Borrowed from the machine's own registry when it has one, and only downloaded
 * otherwise. Fetching on every run made the suite depend on an anonymous GitHub
 * rate limit — sixty requests an hour shared with everything else on the host —
 * so a green suite turned red because of something no test touched.
 */
beforeAll(async () => {
  if (getFont("Anton")) return;

  const index = join(realHome, "fonts.json");
  if (existsSync(index)) {
    try {
      const entry = (JSON.parse(readFileSync(index, "utf8")) as Record<string, { files: { path: string }[] }>).anton;
      const file = entry?.files.find((f) => existsSync(f.path));
      if (file) {
        installLocal(file.path, { family: "Anton", license: "OFL", source: "borrowed from the local registry for tests" });
        return;
      }
    } catch {
      /* a malformed registry is not a reason to fail; fall through and fetch */
    }
  }

  await installFromGoogle("Anton");
}, 60_000);

const doc = (layers: unknown[], canvas = { w: 1000, h: 1000 }) =>
  parseDocument({ canvas, layers });

const headline = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  id: "headline",
  frame: { anchor: "top-left", inset: 40, w: 600 },
  font: "Anton",
  size: 100,
  text,
  box: { mode: "fit", pad: 0 },
  autofit: { min: 20, max: 200 },
  ...extra,
});

describe("auto-fit", () => {
  test("shrinks longer copy and leaves shorter copy alone", async () => {
    const short = await render(doc([headline("HARGA", { frame: { anchor: "top-left", inset: 40, w: 600, h: 300 } })]));
    const long = await render(doc([headline("HARGA GROSIR PROMO AKHIR TAHUN SPESIAL BABYBREATH", {
      frame: { anchor: "top-left", inset: 40, w: 600, h: 300 },
    })]));
    expect(short.report.layers[0]!.fontSize!).toBeGreaterThan(long.report.layers[0]!.fontSize!);
  });

  test("keeps the ratio between runs — a template's emphasis survives any length", async () => {
    const build = (tail: string) => doc([{
      type: "text", id: "t", frame: { anchor: "top-left", inset: 40, w: 500, h: 400 },
      runs: [
        { text: "cuma", font: "Anton", size: 40, color: "#000" },
        { text: "57", font: "Anton", size: 120, color: "#000" },
        { text: tail, font: "Anton", size: 40, color: "#000" },
      ],
      box: { mode: "fit", pad: 0 }, autofit: { min: 8, max: 200 },
    }]);

    const short = (await render(build("RIBUAN"))).report.layers[0]!;
    const long = (await render(build("RIBUAN INI PANJANG SEKALI SUPAYA MENGECIL"))).report.layers[0]!;

    expect(long.autofitScale!).toBeLessThan(short.autofitScale!);
    // One shared scale factor, so the 3× ratio between "57" and the rest holds at
    // both lengths: the reported size is always the largest run times that scale.
    for (const l of [short, long]) expect(l.fontSize).toBe(Math.round(120 * l.autofitScale!));
  });

  test("reports hitting the floor rather than silently producing tiny type", async () => {
    const r = await render(doc([headline("A".repeat(400), {
      frame: { anchor: "top-left", inset: 40, w: 300, h: 120 },
      autofit: { min: 40, max: 200 },
    })]));
    expect(r.report.layers[0]!.atMinimum).toBe(true);
  });
});

describe("grow boxes and anchoring", () => {
  test("a grow box follows the copy, and what is anchored below moves with it", async () => {
    const build = (text: string) => doc([
      { type: "text", id: "headline", frame: { anchor: "top-left", inset: 40, w: 600 },
        font: "Anton", size: 80, text, box: { mode: "grow", fill: "#F5C518", pad: [20, 16] } },
      { type: "text", id: "fine", frame: { below: "headline", gap: 12 },
        font: "Anton", size: 30, text: "* MIN 6 IKAT", box: { mode: "grow", pad: 0 } },
    ]);

    const one = await render(build("SATU BARIS"));
    const three = await render(build("INI JUDUL YANG JAUH LEBIH PANJANG SEHINGGA MEMBUNGKUS TIGA BARIS"));

    const h1 = one.report.layers.find((l) => l.id === "headline")!;
    const h3 = three.report.layers.find((l) => l.id === "headline")!;
    expect(h3.lines!).toBeGreaterThan(h1.lines!);
    expect(h3.box.h).toBeGreaterThan(h1.box.h);

    const f1 = one.report.layers.find((l) => l.id === "fine")!;
    const f3 = three.report.layers.find((l) => l.id === "fine")!;
    expect(f3.box.y).toBeGreaterThan(f1.box.y);
    // The gap is honoured exactly — the fine print does not overlap the block.
    expect(f3.box.y).toBeCloseTo(h3.box.y + h3.box.h + 12, 1);
  });

  test("a fit layer with no declared height is as tall as its content, not the canvas", async () => {
    const r = await render(doc([headline("KARET ANTING")]));
    const layer = r.report.layers[0]!;
    // Without this, everything anchored below it is pushed off the bottom edge.
    expect(layer.box.h).toBeLessThan(1000 - 40 * 2);
    expect(layer.box.h).toBeCloseTo(layer.lines! * layer.fontSize! * 1.14, 0);
  });

  test("an unresolvable anchor reference fails loudly", async () => {
    await expect(
      render(doc([{ type: "text", id: "a", frame: { below: "nope" }, text: "x", font: "Anton" }])),
    ).rejects.toThrow(/nope/);
  });
});

describe("documents", () => {
  test("rejects an unknown layer type with a path", () => {
    expect(() => parseDocument({ canvas: { w: 10, h: 10 }, layers: [{ type: "spline" }] }))
      .toThrow(/document is not valid/);
  });

  test("merge patch removes with null and merges objects", () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9, d: null }, e: 4 }))
      .toEqual({ a: 1, b: { c: 9 }, e: 4 });
  });

  test("vars resolve into the paint, so a palette swap is one edit", async () => {
    const d = parseDocument({
      canvas: { w: 100, h: 100 },
      vars: { brand: "#ff0000" },
      layers: [{ type: "rect", id: "r", frame: "full", fill: "@brand" }],
    });
    const { canvas } = await render(d);
    const px = canvas.getContext("2d").getImageData(50, 50, 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]);
  });
});

describe("templates", () => {
  const template = {
    name: "t",
    slots: [
      { id: "headline", type: "text", required: true, maxChars: 20 },
      { id: "fine", type: "text", required: false, default: "* MIN 6" },
    ],
    document: {
      canvas: { w: 500, h: 500 },
      layers: [{ type: "text", id: "h", frame: { anchor: "top-left", inset: 10, w: 400 }, font: "Anton", size: 40, text: "{{headline}} {{fine}}" }],
    },
    sizes: { "4:5": { canvas: { w: 400, h: 500 }, patch: {} } },
  };

  test("fills slots and applies defaults", () => {
    const d = fill(parseTemplate(template), { headline: "HALO" });
    expect(JSON.stringify(d)).toContain("HALO * MIN 6");
  });

  test("names what is missing instead of rendering a placeholder", () => {
    expect(() => fill(parseTemplate(template), {})).toThrow(MissingSlots);
  });

  test("a size variant changes the canvas", () => {
    const d = fill(parseTemplate(template), { headline: "X" }, { size: "4:5" });
    expect(d.canvas).toMatchObject({ w: 400, h: 500 });
  });

  test("describe reports undeclared placeholders too", () => {
    const t = parseTemplate({
      ...template,
      slots: [],
      document: { ...template.document, layers: [{ ...template.document.layers[0], text: "{{surprise}}" }] },
    });
    expect(describeTemplate(t).slots.map((s) => s.id)).toContain("surprise");
  });
});

describe("export", () => {
  test("searches quality down until the file fits the budget", async () => {
    const { canvas } = await render(doc([
      { type: "rect", id: "bg", frame: "full", fill: "#3B1E0A" },
      headline("HARGA GROSIR CUMA 57 RIBUAN"),
    ], { w: 1080, h: 1080 }));

    const big = await encode(canvas, { format: "jpg", quality: 95 });
    const budgeted = await encode(canvas, { format: "jpg", quality: 95, maxKb: 40 });

    expect(budgeted.bytes).toBeLessThanOrEqual(40 * 1024);
    expect(budgeted.quality).toBeLessThan(big.quality);
    expect(budgeted.overBudget).toBe(false);
  });

  test("says so when a budget is impossible rather than pretending", async () => {
    const { canvas } = await render(doc([{ type: "rect", id: "bg", frame: "full", fill: "#123456" }], { w: 2000, h: 2000 }));
    const r = await encode(canvas, { format: "jpg", maxKb: 0.05 });
    expect(r.overBudget).toBe(true);
  });
});

test("the home directory is the sandbox, not the real one", () => {
  expect(existsSync(process.env.CREATIVE_HOME!)).toBe(true);
});
