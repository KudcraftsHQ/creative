/**
 * Encoding and delivery.
 *
 * Marketplaces have hard file-size limits, so quality is a search, not a guess:
 * `--max-kb 300` binary-searches the encoder until it fits, which is the thing
 * nobody does by hand correctly.
 */
import sharp from "sharp";
import type { Canvas } from "@napi-rs/canvas";

export type Format = "png" | "jpg" | "webp";

export interface EncodeOptions {
  format?: Format;
  quality?: number;
  /** Target file size. When set, `quality` is the starting ceiling. */
  maxKb?: number;
  /** Longest-edge resize applied before encoding. */
  width?: number;
}

export function formatFromPath(path: string, fallback: Format = "png"): Format {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  if (ext === "png") return "png";
  return fallback;
}

function encodeAt(input: Buffer, format: Format, quality: number, width?: number): Promise<Buffer> {
  let img = sharp(input, { failOn: "none" });
  if (width) img = img.resize({ width, withoutEnlargement: true });
  if (format === "jpg") return img.jpeg({ quality, mozjpeg: true }).toBuffer();
  if (format === "webp") return img.webp({ quality }).toBuffer();
  // PNG has no quality dial worth searching; palette quantisation is the lever.
  return img.png({ compressionLevel: 9, palette: quality < 100 }).toBuffer();
}

export interface EncodeResult {
  buffer: Buffer;
  format: Format;
  quality: number;
  bytes: number;
  /** True when the budget could not be met even at the lowest quality tried. */
  overBudget: boolean;
}

export async function encode(source: Buffer | Canvas, o: EncodeOptions = {}): Promise<EncodeResult> {
  const input = Buffer.isBuffer(source) ? source : source.toBuffer("image/png");
  const format = o.format ?? "png";
  const ceiling = o.quality ?? (format === "png" ? 100 : 90);

  if (!o.maxKb) {
    const buffer = await encodeAt(input, format, ceiling, o.width);
    return { buffer, format, quality: ceiling, bytes: buffer.length, overBudget: false };
  }

  const budget = o.maxKb * 1024;
  let best = await encodeAt(input, format, ceiling, o.width);
  let bestQ = ceiling;

  if (best.length <= budget) {
    return { buffer: best, format, quality: bestQ, bytes: best.length, overBudget: false };
  }

  // Ten steps over a 100-point range lands within one quality point, and each step
  // is one encode of an already-decoded buffer — cheap next to the render.
  let lo = format === "png" ? 20 : 30, hi = ceiling;
  for (let i = 0; i < 10 && lo <= hi; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const buf = await encodeAt(input, format, mid, o.width);
    if (buf.length <= budget) {
      best = buf;
      bestQ = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { buffer: best, format, quality: bestQ, bytes: best.length, overBudget: best.length > budget };
}

/** One render, several deliverables — a listing image, a thumbnail, a story crop. */
export async function encodeSizes(
  source: Buffer | Canvas,
  widths: number[],
  o: EncodeOptions = {},
): Promise<Array<EncodeResult & { width: number }>> {
  const input = Buffer.isBuffer(source) ? source : source.toBuffer("image/png");
  const out: Array<EncodeResult & { width: number }> = [];
  for (const width of widths) {
    out.push({ ...(await encode(input, { ...o, width })), width });
  }
  return out;
}
