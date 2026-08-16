/**
 * Loading and colour-grading source images.
 *
 * Everything funnels through a Buffer so a document can reference a local path, a
 * URL or an inline data: uri without the renderer caring which it was. Remote assets
 * are cached, because a batch of 200 renders sharing one background should fetch it
 * once.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { paths } from "./paths.ts";
import { adjustColor } from "./imaging.ts";
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

/** Apply a layer's colour block. Returns the buffer untouched when there is none. */
export async function applyColor(buf: Buffer, color: ImageLayer["color"]): Promise<Buffer> {
  return adjustColor(buf, color);
}
