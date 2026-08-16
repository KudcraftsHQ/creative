import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeToEvents, type LibraryEvent } from "./events.ts";
import { useMountEffect } from "./use-mount-effect.ts";

/**
 * Attach the tab's event stream to the query cache.
 *
 * A write from anywhere — this tab, another tab, `creative edit` in a terminal,
 * an agent over MCP, the worker — invalidates the queries that describe it, and
 * TanStack Query does the refetching. That is the whole live-preview mechanism;
 * there is no separate socket state to keep in sync.
 */
export function useLiveLibrary(): void {
  const queryClient = useQueryClient();
  // Held in a ref so the subscription is established once and still reaches the
  // current client — resubscribing every render would thrash the listener set.
  const clientRef = useRef(queryClient);
  clientRef.current = queryClient;

  useMountEffect(() =>
    subscribeToEvents((event: LibraryEvent) => {
      const qc = clientRef.current;
      qc.invalidateQueries({ queryKey: ["designs"] });
      if (event.designId) qc.invalidateQueries({ queryKey: ["design", event.designId] });
    }),
  );
}
