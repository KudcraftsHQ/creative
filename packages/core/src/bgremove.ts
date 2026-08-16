/**
 * Background removal.
 *
 * Hosted APIs rather than a local ONNX model: the hard cases here are black rubber
 * parts against a dark hand, which is close to the worst case for the small open
 * models, and a wrong cut-out costs more than a few cents. Providers are pluggable
 * so the quality-versus-price question can be answered with real photographs later
 * rather than guessed at now.
 *
 * Finishing (feather, matte, shadow) happens locally either way — it is what stops a
 * removed background from looking cut out with scissors.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

export type Provider = "removebg" | "photoroom" | "clipdrop";

export interface RemoveOptions {
  provider?: Provider;
  apiKey?: string;
  /** Soften the alpha edge, in px. */
  feather?: number;
  /** Drop shadow under the cut-out. */
  shadow?: { blur: number; x: number; y: number; opacity: number };
  /** Pad the result so a shadow is not clipped by the original bounds. */
  pad?: number;
}

interface ProviderSpec {
  url: string;
  keyEnv: string;
  keyHeader: (key: string) => Record<string, string>;
  field: string;
  extra?: Record<string, string>;
}

const PROVIDERS: Record<Provider, ProviderSpec> = {
  removebg: {
    url: "https://api.remove.bg/v1.0/removebg",
    keyEnv: "REMOVEBG_API_KEY",
    keyHeader: (k) => ({ "X-Api-Key": k }),
    field: "image_file",
    extra: { size: "auto", format: "png" },
  },
  photoroom: {
    url: "https://sdk.photoroom.com/v1/segment",
    keyEnv: "PHOTOROOM_API_KEY",
    keyHeader: (k) => ({ "x-api-key": k }),
    field: "image_file",
  },
  clipdrop: {
    url: "https://clipdrop-api.co/remove-background/v1",
    keyEnv: "CLIPDROP_API_KEY",
    keyHeader: (k) => ({ "x-api-key": k }),
    field: "image_file",
  },
};

export function resolveProvider(opts: RemoveOptions): { provider: Provider; key: string } {
  const candidates: Provider[] = opts.provider ? [opts.provider] : ["removebg", "photoroom", "clipdrop"];
  for (const provider of candidates) {
    const key = opts.apiKey ?? process.env[PROVIDERS[provider].keyEnv];
    if (key) return { provider, key };
  }
  const envs = candidates.map((p) => PROVIDERS[p].keyEnv).join(" or ");
  throw new Error(`no background-removal credentials — set ${envs}`);
}

async function callProvider(input: Buffer, provider: Provider, key: string): Promise<Buffer> {
  const spec = PROVIDERS[provider];
  const form = new FormData();
  form.append(spec.field, new Blob([new Uint8Array(input)]), "image.png");
  for (const [k, v] of Object.entries(spec.extra ?? {})) form.append(k, v);

  const res = await fetch(spec.url, { method: "POST", headers: spec.keyHeader(key), body: form });
  if (!res.ok) {
    throw new Error(`${provider} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function removeBackground(
  source: string | Buffer,
  opts: RemoveOptions = {},
): Promise<{ buffer: Buffer; provider: Provider }> {
  const input = Buffer.isBuffer(source) ? source : readFileSync(source);
  const { provider, key } = resolveProvider(opts);
  let out = await callProvider(input, provider, key);
  out = await finish(out, opts);
  return { buffer: out, provider };
}

/** Feather, pad and shadow — applied to any transparent PNG, cut out here or not. */
export async function finish(png: Buffer, opts: RemoveOptions): Promise<Buffer> {
  let img = sharp(png, { failOn: "none" }).ensureAlpha();

  if (opts.pad) {
    img = img.extend({
      top: opts.pad, bottom: opts.pad, left: opts.pad, right: opts.pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  let buf = await img.png().toBuffer();

  if (opts.feather && opts.feather > 0) {
    // Blur the alpha channel only: blurring the colour too would bleed the
    // background's fringe back into the subject's edge.
    const { width, height } = await sharp(buf).metadata();
    const alpha = await sharp(buf).extractChannel("alpha").blur(opts.feather).toBuffer();
    buf = await sharp(buf)
      .removeAlpha()
      .joinChannel(alpha)
      .png()
      .toBuffer();
    void width; void height;
  }

  if (opts.shadow) {
    const { blur, x, y, opacity } = opts.shadow;
    const meta = await sharp(buf).metadata();
    const w = meta.width!, h = meta.height!;
    const alpha = await sharp(buf).extractChannel("alpha").blur(blur).toBuffer();
    const shadow = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .joinChannel(await sharp(alpha).linear(opacity, 0).toBuffer())
      .png()
      .toBuffer();
    buf = await sharp({
      create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: shadow, left: Math.round(x), top: Math.round(y), blend: "over" },
        { input: buf, blend: "over" },
      ])
      .png()
      .toBuffer();
  }

  return buf;
}
