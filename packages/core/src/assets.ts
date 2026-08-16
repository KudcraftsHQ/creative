/**
 * Loading and colour-grading source images.
 *
 * Everything funnels through a Buffer so the colour pipeline (sharp) and the paint
 * pipeline (Skia) never disagree about what the pixels are, and so a document can
 * reference a local path, a URL or an inline data: uri without the renderer caring.
 */
import sharp from "sharp";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { paths } from "./paths.ts";
import type { ImageLayer } from "./types.ts";

export async function loadSource(src: string, baseDir = process.cwd()): Promise<Buffer> {
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    if (comma < 0) throw new Error("malformed data: uri");
    return Buffer.from(src.slice(comma + 1), src.includes(";base64") ? "base64" : "utf8");
  }

  if (/^https?:\/\//i.test(src)) {
    // Remote assets are cached by URL hash: a batch of 200 renders sharing one
    // background should fetch it once, and re-runs should not hit the network.
    const cached = join(paths.cache(), createHash("sha256").update(src).digest("hex"));
    if (existsSync(cached)) return readFileSync(cached);
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetching ${src}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cached, buf);
    return buf;
  }

  const p = resolve(baseDir, src);
  if (!existsSync(p)) throw new Error(`image not found: ${src} (looked in ${dirname(p)})`);
  return readFileSync(p);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Apply a layer's colour block. Returns the buffer untouched when there is none. */
export async function applyColor(buf: Buffer, color: ImageLayer["color"]): Promise<Buffer> {
  if (!color) return buf;
  let img = sharp(buf, { failOn: "none" });

  if (color.brightness !== undefined || color.saturation !== undefined || color.hue !== undefined) {
    img = img.modulate({
      brightness: color.brightness,
      saturation: color.saturation,
      hue: color.hue,
    });
  }
  if (color.grayscale) img = img.grayscale();
  if (color.tint) {
    const { r, g, b } = hexToRgb(color.tint);
    const amount = color.tintAmount ?? 0.5;
    // `tint` alone is absolute; blending it back over the original keeps the
    // photograph readable, which is what a designer means by "tint it yellow".
    const tinted = await sharp(buf, { failOn: "none" }).tint({ r, g, b }).toBuffer();
    const base = await img.toBuffer();
    img = sharp(base, { failOn: "none" }).composite([
      { input: await sharp(tinted).ensureAlpha(amount).toBuffer(), blend: "over" },
    ]);
  }
  return img.png().toBuffer();
}
