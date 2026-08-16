/**
 * Designs: the library's one interesting service.
 *
 * Two things happen on every write and neither is optional:
 *   - `searchText` is re-derived from the document, so search can never drift
 *     from what the design actually says;
 *   - an event is published, so a tab looking at this design re-renders whether
 *     the write came from the browser, the CLI, an agent or the worker.
 *
 * Both live here rather than in the route because the worker writes designs too
 * and must not be able to skip either.
 */
import { documentFonts, documentText, parseDocument, type Document } from "@creative/core";
import { prisma } from "../lib/prisma.ts";
import { publish } from "../lib/events.ts";
import { remove } from "../lib/storage.ts";

export interface DesignInput {
  name: string;
  document: unknown;
  projectId?: string | null;
  templateName?: string | null;
}

/** Where a write came from, so the editor can say "via CLI". */
export type Via = "web" | "cli" | "mcp" | "worker";

/** Validate a document and pull out everything the row derives from it. */
function derive(raw: unknown): {
  document: Document;
  searchText: string;
  fonts: string[];
  width: number;
  height: number;
} {
  const document = parseDocument(raw);
  return {
    document,
    searchText: documentText(document),
    fonts: documentFonts(document),
    width: document.canvas.w,
    height: document.canvas.h,
  };
}

export async function createDesign(ownerId: string, input: DesignInput, via: Via = "web") {
  const { document, searchText, fonts, width, height } = derive(input.document);

  const design = await prisma.design.create({
    data: {
      name: input.name,
      ownerId,
      projectId: input.projectId ?? null,
      templateName: input.templateName ?? null,
      document: document as unknown as object,
      searchText,
      fonts,
      width,
      height,
      updatedVia: via,
    },
  });

  publish({ kind: "design.updated", designId: design.id, version: design.version, ownerId });
  return design;
}

export async function updateDesign(
  ownerId: string,
  id: string,
  input: Partial<DesignInput>,
  via: Via = "web",
) {
  const existing = await prisma.design.findFirst({ where: { id, ownerId } });
  if (!existing) return null;

  const derived = input.document !== undefined ? derive(input.document) : null;

  const design = await prisma.design.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(derived
        ? {
            document: derived.document as unknown as object,
            searchText: derived.searchText,
            fonts: derived.fonts,
            width: derived.width,
            height: derived.height,
          }
        : {}),
      updatedVia: via,
      version: { increment: 1 },
    },
  });

  publish({ kind: "design.updated", designId: design.id, version: design.version, ownerId });
  return design;
}

export async function deleteDesign(ownerId: string, id: string): Promise<boolean> {
  const design = await prisma.design.findFirst({
    where: { id, ownerId },
    select: { id: true, previewKey: true },
  });
  if (!design) return false;

  await prisma.design.delete({ where: { id: design.id } });

  // The preview is a cache, so losing it is free and leaving it is a slow leak —
  // every deleted design would otherwise keep paying for a thumbnail of itself.
  if (design.previewKey) {
    await remove(design.previewKey).catch((err) => console.error("[designs] preview delete", err));
  }

  publish({ kind: "design.deleted", designId: id, ownerId });
  return true;
}

export interface ListOptions {
  q?: string;
  projectId?: string;
  limit: number;
  cursor?: string;
}

/**
 * The library listing.
 *
 * Search runs against `searchText` — every word of copy in the design — which is
 * the differentiator and costs one column. Postgres does the stemming; a bare
 * `contains` would miss "grosiran" for "grosir" and that is the search people
 * actually type.
 */
export async function listDesigns(ownerId: string, o: ListOptions) {
  const where = {
    ownerId,
    ...(o.projectId ? { projectId: o.projectId } : {}),
    ...(o.q
      ? {
          OR: [
            { name: { contains: o.q, mode: "insensitive" as const } },
            { searchText: { contains: o.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const items = await prisma.design.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: o.limit + 1,
    ...(o.cursor ? { cursor: { id: o.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      width: true,
      height: true,
      version: true,
      previewKey: true,
      projectId: true,
      updatedAt: true,
      searchText: true,
      templateName: true,
      fonts: true,
      updatedVia: true,
      project: { select: { name: true } },
    },
  });

  const hasMore = items.length > o.limit;
  return {
    items: items.slice(0, o.limit),
    nextCursor: hasMore ? items[o.limit - 1]!.id : null,
  };
}

export async function getDesign(ownerId: string, id: string) {
  return prisma.design.findFirst({ where: { id, ownerId } });
}
