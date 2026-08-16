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
  runs?: Array<{ text: string; font?: string; size?: number; color?: string }>;
  src?: string;
  fill?: string;
  [key: string]: unknown;
}

/** The preview URL for a design at a version. The version is what busts the cache. */
export const renderUrl = (id: string, version: number, width?: number) =>
  `/api/designs/${id}/render?format=jpg${width ? `&width=${width}` : ""}&v=${version}`;
