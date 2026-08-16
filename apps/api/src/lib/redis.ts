/**
 * Redis, or nothing.
 *
 * The event hub is Redis pub/sub because the web app and the worker are two
 * containers: a document written by a render job has to reach a tab attached to
 * the other process, and an in-process EventEmitter cannot do that.
 *
 * With no REDIS_URL set — a local checkout, a test run — every call here is a
 * no-op and the hub falls back to in-process delivery. That keeps `bun dev`
 * working without a Redis running, at the cost of cross-process events, which a
 * single-process dev server does not have anyway.
 */
import Redis from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __redisPub: Redis | undefined;
  // eslint-disable-next-line no-var
  var __redisSub: Redis | undefined;
}

const url = process.env.REDIS_URL;

export const redisEnabled = Boolean(url);

function connect(role: string): Redis {
  const client = new Redis(url!, {
    maxRetriesPerRequest: null,
    // A dropped Redis must not take the API down with it: events degrade to
    // same-process delivery until it comes back.
    retryStrategy: (times) => Math.min(times * 200, 5000),
    lazyConnect: false,
  });
  client.on("error", (err) => console.error(`[redis:${role}]`, err.message));
  return client;
}

/** The publishing connection. Null when Redis is not configured. */
export const pub: Redis | null = url ? (globalThis.__redisPub ??= connect("pub")) : null;

/**
 * The subscribing connection — separate, because a connection in subscriber mode
 * cannot issue ordinary commands.
 */
export const sub: Redis | null = url ? (globalThis.__redisSub ??= connect("sub")) : null;
