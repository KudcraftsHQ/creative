/**
 * `/api/events` — live preview.
 *
 * A document write from any source re-renders and reaches every open tab. That is
 * the property this route exists for, and it is why the hub is Redis-backed: the
 * write may have happened in the worker container, not this one.
 *
 * `ping` every 25 seconds is not decoration. Bun's default idle timeout would cut
 * an idle stream long before anything interesting happened, and proxies in front
 * of it are worse.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireAuth } from "../middlewares/auth.ts";
import { subscribe, type LibraryEvent } from "../lib/events.ts";

const PING_MS = 25_000;

export const eventsRoute = new Hono().use("*", requireAuth).get("/", (c) => {
  const { userId } = c.get("auth");

  return streamSSE(c, async (stream) => {
    const queue: LibraryEvent[] = [];
    let wake: (() => void) | null = null;

    const unsubscribe = subscribe(userId, (event) => {
      queue.push(event);
      wake?.();
    });

    // The client uses this to tell a fresh connection from a reconnect.
    await stream.writeSSE({ event: "ready", data: JSON.stringify({ at: Date.now() }) });

    stream.onAbort(() => {
      unsubscribe();
      wake?.();
    });

    try {
      let id = 0;
      while (!stream.closed && !stream.aborted) {
        while (queue.length) {
          const event = queue.shift()!;
          await stream.writeSSE({
            id: String(++id),
            event: event.kind,
            data: JSON.stringify(event),
          });
        }
        if (stream.closed || stream.aborted) break;

        // Wait for either an event or the keepalive deadline, whichever lands
        // first — a busy loop here would burn a core per connected tab.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, PING_MS);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;

        if (queue.length === 0 && !stream.closed && !stream.aborted) {
          await stream.writeSSE({ event: "ping", data: String(Date.now()) });
        }
      }
    } finally {
      unsubscribe();
    }
  });
});
