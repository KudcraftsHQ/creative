/**
 * The API client.
 *
 * Same-origin in production and proxied in dev, so there is no base URL to
 * configure — the one thing that always matters is `credentials: "include"`,
 * because the session lives in a cookie.
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    // The API answers errors as { error }. Fall back to the status text for
    // anything that did not come from it — a proxy 502, say.
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/* ── shapes ────────────────────────────────────────────────────────────────── */

export interface DesignSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  version: number;
  previewKey: string | null;
  projectId: string | null;
  updatedAt: string;
  searchText: string;
  /** The template it was filled from, when it came from one. */
  templateName: string | null;
  /** Families the document draws with, derived on write. */
  fonts: string[];
  /** "web" | "cli" | "mcp" | "worker" — where the last write came from. */
  updatedVia: string | null;
}

export interface TemplateSummary {
  name: string;
  description?: string;
  sizes: string[];
  canvas: { w: number; h: number };
  slots: Array<{ id: string; type: string; required: boolean; maxChars?: number; label?: string }>;
}

export interface FontEntry {
  family: string;
  license: string;
  source: string;
}

export interface Design extends DesignSummary {
  document: CreativeDocument;
}

export interface Project {
  id: string;
  name: string;
  designs: number;
  updatedAt: string;
}

export interface Finding {
  rule: string;
  severity: "error" | "warning";
  layer?: string;
  message: string;
  fix?: string;
}

export interface LayerReport {
  id: string;
  type: "text" | "image" | "rect";
  box: { x: number; y: number; w: number; h: number };
  /** Present only when the layer is rotated: the area it actually occupies. */
  bounds?: { x: number; y: number; w: number; h: number };
  fontSize?: number;
  lines?: number;
  atMinimum?: boolean;
  overflow?: boolean;
  text?: string;
}

/** The document, loosely typed here — core owns the real schema and validates it. */
export interface CreativeDocument {
  name?: string;
  canvas: { w: number; h: number; bg?: string };
  vars?: Record<string, string>;
  safeArea?: number;
  layers: DocumentLayer[];
}

export interface DocumentLayer {
  type: "text" | "image" | "rect";
  id?: string;
  frame?: unknown;
  hidden?: boolean;
  text?: string;
  runs?: Array<{
    text: string;
    font?: string;
    size?: number;
    color?: string;
    tracking?: number;
    transform?: "none" | "upper" | "lower";
    italic?: boolean;
    stroke?: { color: string; width: number };
  }>;
  src?: string;
  fill?: string;
  [key: string]: unknown;
}

export interface Asset {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
  url: string;
}

/**
 * Upload an image.
 *
 * Not through `api.post`: a multipart body must not carry a JSON content-type, and
 * the browser has to set its own boundary.
 */
export async function uploadAsset(file: File): Promise<Asset> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/assets", { method: "POST", credentials: "include", body });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as Asset;
}

/** The preview URL for a design at a version. The version is what busts the cache. */
export const renderUrl = (id: string, version: number, width?: number) =>
  `/api/designs/${id}/render?format=jpg${width ? `&width=${width}` : ""}&v=${version}`;
