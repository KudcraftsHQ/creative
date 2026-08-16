/**
 * The event hub.
 *
 * One fact drives the whole design: a document write from *any* source — a tab,
 * `creative edit` in a terminal, an agent over MCP, a batch job in the worker —
 * has to re-render and reach every open tab. So writes publish here, and the SSE
 * route subscribes; nothing polls.
 *
 * Delivery is Redis pub/sub when REDIS_URL is set (the deployed shape: web and
 * worker are separate containers) and in-process otherwise (a local checkout).
 * Local listeners are always notified directly rather than via the round trip,
 * so a single-process dev server behaves identically with or without Redis.
 */
import { pub, sub, redisEnabled } from "./redis.ts";

export type EventKind = "design.updated" | "design.deleted" | "render.done" | "render.failed";

export interface LibraryEvent {
  kind: EventKind;
  designId: string;
  /** The design's version after the write, so a tab can drop what it already has. */
  version?: number;
  /** Who the event belongs to. A tab only ever sees its own. */
  ownerId: string;
  /** Free-form detail — an error message on a failure, a preview key on a render. */
  detail?: Record<string, unknown>;
}

type Listener = (event: LibraryEvent) => void;

interface Hub {
  listeners: Map<string, Set<Listener>>;
  seq: number;
  subscribed: boolean;
}

// Pinned on globalThis for the same reason tempe-sadari does it: under `bun --hot`
// a re-evaluated module gets a fresh Map, while already-open SSE connections hold
// callbacks registered against the old one — and events silently stop arriving.
const globalForHub = globalThis as unknown as { __creativeHub?: Hub };
const hub: Hub = (globalForHub.__creativeHub ??= {
  listeners: new Map(),
  seq: 0,
  subscribed: false,
});

const CHANNEL = "creative:events";

/** Deliver to this process's own listeners. */
function dispatch(event: LibraryEvent): void {
  const set = hub.listeners.get(event.ownerId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch (err) {
      console.error("[events] listener threw", err);
    }
  }
}

if (redisEnabled && sub && !hub.subscribed) {
  hub.subscribed = true;
  sub.subscribe(CHANNEL, (err) => {
    if (err) console.error("[events] subscribe failed", err.message);
  });
  sub.on("message", (channel, payload) => {
    if (channel !== CHANNEL) return;
    try {
      const event = JSON.parse(payload) as LibraryEvent & { origin?: string };
      // Skip the echo of our own publish — dispatch() already ran locally.
      if (event.origin === PROCESS_ID) return;
      dispatch(event);
    } catch {
      /* a malformed message must not kill the subscriber */
    }
  });
}

/** Distinguishes our own published messages from another container's. */
const PROCESS_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export function publish(event: LibraryEvent): void {
  hub.seq++;
  // Locally first, so a single-process deployment is not waiting on a network
  // hop to update its own tabs.
  dispatch(event);
  if (pub) {
    pub.publish(CHANNEL, JSON.stringify({ ...event, origin: PROCESS_ID })).catch((err) => {
      console.error("[events] publish failed", err.message);
    });
  }
}

export function subscribe(ownerId: string, listener: Listener): () => void {
  let set = hub.listeners.get(ownerId);
  if (!set) {
    set = new Set();
    hub.listeners.set(ownerId, set);
  }
  set.add(listener);

  return () => {
    const s = hub.listeners.get(ownerId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) hub.listeners.delete(ownerId);
  };
}

export function listenerCount(ownerId: string): number {
  return hub.listeners.get(ownerId)?.size ?? 0;
}
