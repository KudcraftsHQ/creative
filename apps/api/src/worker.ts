/**
 * The worker: the same image, no domain in front of it.
 *
 * It exists so the web container never blocks a request on a render. A design
 * write publishes an event; this process picks it up, renders a thumbnail, stores
 * it, and publishes `render.done` — which reaches the tab that made the edit
 * through the same Redis channel.
 *
 * With no S3 configured there is nowhere to put a thumbnail, so it says so once
 * and idles rather than rendering into a void. The library falls back to
 * rendering previews on demand, which is slower and correct.
 */
import { encode, parseDocument, registerAll, render, type Document } from "@creative/core";
import { prisma } from "./lib/prisma.ts";
import { publish, subscribe } from "./lib/events.ts";
import { redisEnabled, sub } from "./lib/redis.ts";
import { put, storageEnabled } from "./lib/storage.ts";

const THUMB_WIDTH = 640;

async function renderPreview(designId: string, ownerId: string): Promise<void> {
  const design = await prisma.design.findUnique({ where: { id: designId } });
  if (!design) return;

  try {
    const doc = parseDocument(design.document) as Document;
    const { canvas } = await render(doc);
    const out = await encode(canvas, { format: "jpg", quality: 82, width: THUMB_WIDTH });

    const key = `previews/${design.ownerId}/${design.id}-${design.version}.jpg`;
    await put(key, out.buffer, "image/jpeg");
    await prisma.design.update({ where: { id: design.id }, data: { previewKey: key } });

    publish({ kind: "render.done", designId, ownerId, version: design.version, detail: { key } });
    console.log(`[worker] preview ${design.id} v${design.version} → ${key} (${out.bytes}b)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    publish({ kind: "render.failed", designId, ownerId, detail: { message } });
    console.error(`[worker] preview ${designId} failed: ${message}`);
  }
}

const registered = registerAll(true);
console.log(
  `[creative-worker] up  fonts=${registered}  redis=${redisEnabled}  storage=${storageEnabled}`,
);

if (!redisEnabled) {
  // Without Redis this process cannot hear the web container at all, which is a
  // misconfiguration rather than a degraded mode — say so loudly.
  console.error("[creative-worker] REDIS_URL is not set: this worker will never receive an event.");
}
if (!storageEnabled) {
  console.warn("[creative-worker] S3 is not configured: previews are left to on-demand rendering.");
}

// The worker listens for every owner, so it subscribes to the raw channel rather
// than the per-owner hub the SSE route uses.
if (redisEnabled && sub && storageEnabled) {
  sub.on("message", (_channel, payload) => {
    try {
      const event = JSON.parse(payload) as { kind: string; designId: string; ownerId: string };
      if (event.kind !== "design.updated") return;
      void renderPreview(event.designId, event.ownerId);
    } catch {
      /* a malformed message must not take the worker down */
    }
  });
}

// Keep the process alive. Bun exits when nothing is scheduled, and an ioredis
// subscription alone does not always hold it.
setInterval(() => {}, 1 << 30);

export { renderPreview, subscribe };
