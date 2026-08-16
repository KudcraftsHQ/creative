/**
 * Image-level commands: rmbg, color, export.
 *
 * These operate on files rather than documents, because half the work of a creative
 * happens before a layout exists — cut the product out, warm the photo up, then place it.
 */
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { removeBackground, finish, encode, encodeSizes, formatFromPath, applyColor } from "@creative/core";
import { fail, note, dim, humanBytes } from "../output.ts";

export function registerImageCommands(program: Command): void {
  program
    .command("rmbg <image>")
    .description("remove the background, to a transparent PNG")
    .option("-o, --out <file>", "output path (default: <input>-cut.png)")
    .option("--provider <name>", "removebg | photoroom | clipdrop (default: whichever has a key)")
    .option("--feather <px>", "soften the alpha edge", Number)
    .option("--shadow", "add a drop shadow under the cut-out")
    .option("--shadow-blur <px>", "", Number, 24)
    .option("--shadow-x <px>", "", Number, 0)
    .option("--shadow-y <px>", "", Number, 16)
    .option("--shadow-opacity <n>", "0-1", Number, 0.35)
    .option("--pad <px>", "pad the canvas so a shadow is not clipped", Number)
    .action(async (input: string, o) => {
      try {
        const out = o.out ?? input.replace(/\.[^.]+$/, "") + "-cut.png";
        const { buffer, provider } = await removeBackground(input, {
          provider: o.provider,
          feather: o.feather,
          pad: o.pad ?? (o.shadow ? Math.round(o.shadowBlur * 1.5) : undefined),
          shadow: o.shadow
            ? { blur: o.shadowBlur, x: o.shadowX, y: o.shadowY, opacity: o.shadowOpacity }
            : undefined,
        });
        writeFileSync(out, buffer);
        note(`${out}  ${dim(`${provider} · ${humanBytes(buffer.length)}`)}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("finish <image>")
    .description("feather, pad and shadow an existing transparent PNG")
    .option("-o, --out <file>", "output path")
    .option("--feather <px>", "", Number)
    .option("--pad <px>", "", Number)
    .option("--shadow-blur <px>", "", Number)
    .option("--shadow-x <px>", "", Number, 0)
    .option("--shadow-y <px>", "", Number, 16)
    .option("--shadow-opacity <n>", "", Number, 0.35)
    .action(async (input: string, o) => {
      try {
        const out = o.out ?? input.replace(/\.[^.]+$/, "") + "-finished.png";
        const buffer = await finish(readFileSync(input), {
          feather: o.feather,
          pad: o.pad,
          shadow: o.shadowBlur
            ? { blur: o.shadowBlur, x: o.shadowX, y: o.shadowY, opacity: o.shadowOpacity }
            : undefined,
        });
        writeFileSync(out, buffer);
        note(`${out}  ${dim(humanBytes(buffer.length))}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("color <image>")
    .description("grade an image: brightness, saturation, hue, tint, grayscale")
    .option("-o, --out <file>", "output path")
    .option("--brightness <n>", "1 is unchanged", Number)
    .option("--saturation <n>", "1 is unchanged", Number)
    .option("--hue <deg>", "rotate hue", Number)
    .option("--tint <color>", "#rrggbb")
    .option("--tint-amount <n>", "0-1", Number, 0.5)
    .option("--grayscale", "")
    .action(async (input: string, o) => {
      try {
        const out = o.out ?? input.replace(/(\.[^.]+)$/, "-graded$1");
        const buf = await applyColor(readFileSync(input), {
          brightness: o.brightness,
          saturation: o.saturation,
          hue: o.hue,
          tint: o.tint,
          tintAmount: o.tintAmount,
          grayscale: o.grayscale,
        });
        writeFileSync(out, buf);
        note(`${out}  ${dim(humanBytes(buf.length))}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("export <image>")
    .description("re-encode to a size budget, and to several widths at once")
    .option("-o, --out <file>", "output path (default: alongside the input)")
    .option("-f, --format <fmt>", "png | jpg | webp")
    .option("-q, --quality <n>", "", Number)
    .option("--max-kb <n>", "search quality down until the file fits", Number)
    .option("--sizes <list>", "widths, e.g. 1080,800,400")
    .action(async (input: string, o) => {
      try {
        const format = o.format ?? formatFromPath(o.out ?? input, "jpg");
        const out = o.out ?? input.replace(/\.[^.]+$/, `.${format}`);
        const buf = readFileSync(input);

        if (o.sizes) {
          const widths = o.sizes.split(",").map((s: string) => Number(s.trim())).filter((n: number) => n > 0);
          for (const r of await encodeSizes(buf, widths, { format, quality: o.quality, maxKb: o.maxKb })) {
            const path = out.replace(/(\.[^.]+)$/, `-${r.width}$1`);
            writeFileSync(path, r.buffer);
            note(`${path}  ${dim(`${r.width}px · q${r.quality} · ${humanBytes(r.bytes)}`)}`);
          }
          return;
        }

        const r = await encode(buf, { format, quality: o.quality, maxKb: o.maxKb });
        writeFileSync(out, r.buffer);
        note(`${out}  ${dim(`${r.format} · q${r.quality} · ${humanBytes(r.bytes)}`)}`);
        if (r.overBudget) note(dim(`  over ${o.maxKb}kB even at q${r.quality}`));
      } catch (err) {
        fail(err);
      }
    });
}
