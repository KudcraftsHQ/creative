/**
 * Encoding and delivery.
 *
 * Marketplaces have hard file-size limits, so quality is a search, not a guess:
 * `--max-kb 300` binary-searches the encoder until it fits, which is the thing
 * nobody does by hand correctly.
 */
import type { Canvas } from "@napi-rs/canvas";
import { decode, toCanvas, encodeCanvas, type Format } from "./imaging.ts";

export type { Format };

export interface EncodeOptions {
  format?: Format;
  quality?: number;
  /** Target file size. When set, `quality` is the starting ceiling. */
  maxKb?: number;
  /** Longest-edge resize applied before encoding. Never enlarges. */
  width?: number;
}

export function formatFromPath(path: string, fallback: Format = "png"): Format {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  if (ext === "avif") return "avif";
  if (ext === "png") return "png";
  return fallback;
}

export interface EncodeResult {
  buffer: Buffer;
  format: Format;
  quality: number;
  bytes: number;
  /** True when the budget could not be met even at the lowest quality tried. */
  overBudget: boolean;
}

async function prepare(source: Buffer | Canvas, width?: number): Promise<Canvas> {
  if (!Buffer.isBuffer(source)) {
    // A canvas that is already the right size needs no round trip through PNG.
    if (!width || width >= source.width) return source;
    return toCanvas(await decode(source.toBuffer("image/png")), width);
  }
  return toCanvas(await decode(source), width);
}

export async function encode(source: Buffer | Canvas, o: EncodeOptions = {}): Promise<EncodeResult> {
  const format = o.format ?? "png";
  const ceiling = o.quality ?? (format === "png" ? 100 : 90);
  const canvas = await prepare(source, o.width);

  const at = (q: number) => encodeCanvas(canvas, format, q);

  if (!o.maxKb) {
    const buffer = at(ceiling);
    return { buffer, format, quality: ceiling, bytes: buffer.length, overBudget: false };
  }

  const budget = o.maxKb * 1024;
  let best = at(ceiling);
  let bestQ = ceiling;

  if (best.length <= budget) {
    return { buffer: best, format, quality: bestQ, bytes: best.length, overBudget: false };
  }

  // PNG is lossless: there is no quality dial to search, so an over-budget PNG is
  // over budget. Saying so is more useful than silently shipping a 4MB file.
  if (format === "png") {
    return { buffer: best, format, quality: 100, bytes: best.length, overBudget: true };
  }

  // Ten steps over a 100-point range lands within one quality point, and each step
  // is one encode of an already-decoded canvas — cheap next to the render.
  let lo = 20, hi = ceiling;
  let fits = false;
  // Tracked separately so that when nothing fits we hand back the smallest file we
  // actually produced, at the quality that produced it. Returning the ceiling encode
  // and calling it "over budget at q90" is a lie about what was tried.
  let smallest = best;
  let smallestQ = bestQ;

  for (let i = 0; i < 10 && lo <= hi; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const buf = at(mid);
    if (buf.length < smallest.length) {
      smallest = buf;
      smallestQ = mid;
    }
    if (buf.length <= budget) {
      best = buf;
      bestQ = mid;
      fits = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (!fits) {
    return { buffer: smallest, format, quality: smallestQ, bytes: smallest.length, overBudget: true };
  }
  return { buffer: best, format, quality: bestQ, bytes: best.length, overBudget: false };
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
