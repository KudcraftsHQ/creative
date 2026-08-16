/**
 * `/api/assets` — uploaded images.
 *
 * The read route is deliberately **public**. A design is a portable document whose
 * image layers carry a `src`, and that src has to resolve from wherever the
 * document is rendered: this container, the worker, a laptop running
 * `creative render`. A credential-guarded URL would make the document only
 * renderable by a browser holding a session, which is the opposite of the point.
 *
 * What protects an asset is that its id is unguessable and nothing lists them but
 * their owner. That is the same trade every design tool makes with its CDN.
 */
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.ts";
import { requireAuth, requireScope } from "../middlewares/auth.ts";
import { presign, publicUrlFor, put, remove, storageEnabled } from "../lib/storage.ts";

/** What a browser may upload. Anything else is refused rather than stored. */
const ACCEPTED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Public: no auth, immutable, cached hard.
 *
 * Only serves assets held in Postgres. One in a bucket is referenced by its own
 * public URL and never reaches this process — this route redirects to it so that
 * a document written before the bucket existed keeps working.
 */
export const assetPublicRoute = new Hono().get("/:id", async (c) => {
  const asset = await prisma.asset.findUnique({ where: { id: c.req.param("id") } });
  if (!asset) return c.json({ error: "no such asset" }, 404);

  if (asset.key) {
    return c.redirect(publicUrlFor(asset.key) ?? (await presign(asset.key)), 302);
  }
  if (!asset.data) return c.json({ error: "asset has no stored bytes" }, 410);

  return c.body(new Uint8Array(asset.data), 200, {
    "content-type": asset.mimeType,
    // The id is content-addressed by creation, and there is no update route, so
    // this can be cached for as long as anything is willing to keep it.
    "cache-control": "public, max-age=31536000, immutable",
    etag: `"${asset.id}"`,
  });
});

export const assetsRoute = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const { userId } = c.get("auth");
    const items = await prisma.asset.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, mimeType: true, bytes: true, createdAt: true, key: true },
    });
    return c.json({
      items: items.map((a) => ({ ...a, key: undefined, url: assetUrl(a.id, a.key) })),
    });
  })

  .post("/", requireScope("designs:write"), async (c) => {
    const { userId } = c.get("auth");

    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "send the image as multipart/form-data under \"file\"" }, 400);
    }
    if (!ACCEPTED[file.type]) {
      return c.json(
        { error: `${file.type || "that"} is not an image this accepts — ${Object.keys(ACCEPTED).join(", ")}` },
        415,
      );
    }
    if (file.size > MAX_BYTES) {
      return c.json({ error: `${Math.round(file.size / 1024)}kB is over the ${MAX_BYTES / 1024 / 1024}MB limit` }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // A bucket when there is one, Postgres when there is not. The document does
    // not know the difference — it holds a URL either way.
    //
    // The key is random rather than derived from the filename: two uploads called
    // photo.jpg must not collide, and an immutable key is what lets both R2 and
    // the browser cache it forever.
    const key = storageEnabled
      ? `assets/${userId}/${randomUUID()}.${ACCEPTED[file.type]}`
      : null;
    if (key) await put(key, buffer, file.type);

    const asset = await prisma.asset.create({
      data: {
        ownerId: userId,
        name: file.name || `upload.${ACCEPTED[file.type]}`,
        mimeType: file.type,
        bytes: buffer.length,
        ...(key ? { key } : { data: buffer }),
      },
      select: { id: true, name: true, mimeType: true, bytes: true, createdAt: true, key: true },
    });

    return c.json({ ...asset, key: undefined, url: assetUrl(asset.id, asset.key) }, 201);
  })

  .delete("/:id", requireScope("designs:write"), async (c) => {
    const { userId } = c.get("auth");
    const asset = await prisma.asset.findFirst({
      where: { id: c.req.param("id"), ownerId: userId },
      select: { id: true, key: true },
    });
    if (!asset) return c.json({ error: "no such asset" }, 404);

    // The row goes first: an orphaned object costs a fraction of a cent, while a
    // row pointing at a deleted object is a broken image in someone's design.
    await prisma.asset.delete({ where: { id: asset.id } });
    if (asset.key) await remove(asset.key).catch((err) => console.error("[assets] R2 delete", err));
    return c.body(null, 204);
  });

/**
 * The absolute URL an asset is referenced by.
 *
 * The bucket's own public URL when there is one, so a render fetches from the CDN
 * rather than from this process. Absolute either way, because it is written into
 * a document that may be rendered from a terminal on another machine.
 */
export function assetUrl(id: string, key?: string | null): string {
  if (key) {
    const direct = publicUrlFor(key);
    if (direct) return direct;
  }
  const base = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/assets/${id}`;
}
