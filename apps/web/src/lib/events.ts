/**
 * One EventSource for the whole tab.
 *
 * Pinned on `window` rather than held in a module binding: Vite's HMR
 * re-evaluates this module on every save, and a module-level connection would be
 * orphaned each time — the old stream stays open on the server while the new one
 * connects beside it, until the browser's six-connection limit is reached and the
 * app quietly stops receiving anything.
 *
 * Components subscribe; the connection is opened once on the first subscriber and
 * left open. It is one idle stream, and reconnecting is more expensive than
 * keeping it.
 */
export type EventKind = "design.updated" | "design.deleted" | "render.done" | "render.failed";

export interface LibraryEvent {
  kind: EventKind;
  designId: string;
  version?: number;
  ownerId: string;
  detail?: Record<string, unknown>;
}

type Listener = (event: LibraryEvent) => void;

interface Hub {
  source: EventSource | null;
  listeners: Set<Listener>;
}

const hub: Hub = ((window as unknown as { __creativeEvents?: Hub }).__creativeEvents ??= {
  source: null,
  listeners: new Set(),
});

const KINDS: EventKind[] = ["design.updated", "design.deleted", "render.done", "render.failed"];

function open(): void {
  if (hub.source) return;

  const source = new EventSource("/api/events", { withCredentials: true });
  hub.source = source;

  for (const kind of KINDS) {
    source.addEventListener(kind, (ev) => {
      try {
        const event = JSON.parse((ev as MessageEvent).data) as LibraryEvent;
        for (const fn of hub.listeners) fn(event);
      } catch {
        /* a malformed frame must not tear the stream down */
      }
    });
  }

  // `ping` and `ready` are keepalive and handshake; nothing listens to them, but
  // they must not be treated as events.
  source.addEventListener("error", () => {
    // EventSource reconnects on its own. Drop the handle only if the browser
    // actually closed it, so the next subscriber opens a fresh one.
    if (source.readyState === EventSource.CLOSED) hub.source = null;
  });
}

export function subscribeToEvents(listener: Listener): () => void {
  hub.listeners.add(listener);
  open();
  return () => {
    hub.listeners.delete(listener);
    // The connection is deliberately left open: a library page that unmounts on
    // the way to the editor would otherwise reconnect a second later.
  };
}
