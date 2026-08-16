/**
 * Decoding, resizing, filtering and encoding — all through Skia.
 *
 * This used to be sharp. It is not any more, and the reason is worth recording: the
 * CLI ships as one compiled binary, and `bun build --compile` embeds the Skia addon
 * but not sharp's, so a shipped binary died on its first encode. Skia already does
 * every operation we needed — CSS filters, composite modes, PNG/JPEG/WebP/AVIF with
 * quality — so the second native dependency bought nothing and cost the release.
 *
 * Keep it that way: if something here seems to want an image library, it probably
 * wants a canvas and a composite operation.
 */
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";

export type Format = "png" | "jpg" | "webp" | "avif";

const MIME: Record<Format, "image/png" | "image/jpeg" | "image/webp" | "image/avif"> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export async function decode(input: Buffer): Promise<Image> {
  return loadImage(input);
}

export function toCanvas(img: Image, width?: number): Canvas {
  const scale = width ? Math.min(1, width / img.width) : 1;
  const canvas = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Encode a canvas. `quality` is ignored by PNG, which has no lossy dial. */
export function encodeCanvas(canvas: Canvas, format: Format, quality: number): Buffer {
  return format === "png"
    ? canvas.toBuffer("image/png")
    : canvas.toBuffer(MIME[format] as "image/jpeg", quality);
}

export interface ColorAdjustments {
  brightness?: number;
  saturation?: number;
  hue?: number;
  tint?: string;
  tintAmount?: number;
  grayscale?: boolean;
}

export function hasAdjustments(c?: ColorAdjustments): boolean {
  if (!c) return false;
  return c.brightness !== undefined || c.saturation !== undefined || c.hue !== undefined
    || c.tint !== undefined || c.grayscale === true;
}

function filterString(c: ColorAdjustments): string {
  const parts: string[] = [];
  if (c.grayscale) parts.push("grayscale(1)");
  if (c.brightness !== undefined) parts.push(`brightness(${c.brightness})`);
  if (c.saturation !== undefined) parts.push(`saturate(${c.saturation})`);
  if (c.hue !== undefined) parts.push(`hue-rotate(${c.hue}deg)`);
  return parts.join(" ");
}

/** Grade an image. Returns the input untouched when there is nothing to do. */
export async function adjustColor(input: Buffer, c?: ColorAdjustments): Promise<Buffer> {
  if (!hasAdjustments(c)) return input;
  const img = await decode(input);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");

  const filter = filterString(c!);
  if (filter) ctx.filter = filter;
  ctx.drawImage(img, 0, 0);
  ctx.filter = "none";

  if (c!.tint) {
    // Painted over the photograph at a partial alpha and clipped to its own shape,
    // so a transparent PNG stays transparent instead of gaining a coloured square.
    ctx.save();
    ctx.globalAlpha = c!.tintAmount ?? 0.5;
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = c!.tint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}

/**
 * Soften an alpha edge without smearing the colour.
 *
 * Blurring the image would drag the old background's fringe into the subject. Blurring
 * a *copy* and using it as a `destination-in` mask touches only the alpha channel.
 */
export async function featherAlpha(input: Buffer, radius: number): Promise<Buffer> {
  if (radius <= 0) return input;
  const img = await decode(input);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(img, 0, 0);

  return canvas.toBuffer("image/png");
}

export interface Shadow {
  blur: number;
  x: number;
  y: number;
  opacity: number;
  color?: string;
}

/** Pad the canvas and drop a shadow under whatever is opaque. */
export async function addShadow(input: Buffer, shadow: Shadow, pad = 0): Promise<Buffer> {
  const img = await decode(input);
  const canvas = createCanvas(img.width + pad * 2, img.height + pad * 2);
  const ctx = canvas.getContext("2d");

  const rgb = shadow.color ?? "#000000";
  ctx.shadowColor = withAlpha(rgb, shadow.opacity);
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetX = shadow.x;
  ctx.shadowOffsetY = shadow.y;
  ctx.drawImage(img, pad, pad);

  return canvas.toBuffer("image/png");
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function pad(input: Buffer, amount: number): Promise<Buffer> {
  if (amount <= 0) return input;
  const img = await decode(input);
  const canvas = createCanvas(img.width + amount * 2, img.height + amount * 2);
  canvas.getContext("2d").drawImage(img, amount, amount);
  return canvas.toBuffer("image/png");
}
