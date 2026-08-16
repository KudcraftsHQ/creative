/**
 * Rendering a stored design.
 *
 * The one wrinkle is asset URLs. A document references an uploaded image by its
 * public URL so that it renders from anywhere — but when *this* process renders
 * it, fetching that URL means a request out to the domain, through Cloudflare and
 * back into the container it started in. That works, and it is absurd: a slow,
 * failure-prone round trip to read a row this process could read directly.
 *
 * So our own asset URLs are swapped for the bytes before the document reaches the
 * renderer. Any other URL is left alone and core fetches it as usual.
 */
import { render as coreRender, parseDocument, type Document } from "@creative/core";
import { prisma } from "../lib/prisma.ts";

const ASSET_PATH = /\/api\/assets\/([a-zA-Z0-9_-]+)$/;

function assetId(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const m = ASSET_PATH.exec(src.split("?")[0] ?? "");
  return m ? m[1]! : null;
}

/** Replace this server's own asset URLs with data URIs. Other sources untouched. */
export async function inlineOwnAssets(doc: Document): Promise<Document> {
  const ids = new Map<string, string>();
  for (const layer of doc.layers) {
    if (layer.type !== "image") continue;
    const id = assetId(layer.src);
    if (id) ids.set(id, layer.src);
  }
  if (ids.size === 0) return doc;

  const rows = await prisma.asset.findMany({
    where: { id: { in: [...ids.keys()] } },
    select: { id: true, mimeType: true, data: true },
  });

  const inlined = new Map<string, string>();
  for (const row of rows) {
    // An asset held in a bucket has no bytes here; leave its URL and let core
    // fetch it, which is what the URL is for.
    if (!row.data) continue;
    inlined.set(row.id, `data:${row.mimeType};base64,${Buffer.from(row.data).toString("base64")}`);
  }
  if (inlined.size === 0) return doc;

  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.type !== "image") return layer;
      const id = assetId(layer.src);
      const data = id ? inlined.get(id) : undefined;
      return data ? { ...layer, src: data } : layer;
    }),
  };
}

/** Parse, inline, render. The one path every server-side render goes through. */
export async function renderStored(document: unknown) {
  const doc = await inlineOwnAssets(parseDocument(document));
  return { doc, ...(await coreRender(doc)) };
}
