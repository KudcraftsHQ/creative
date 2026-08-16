import { useEffect, type EffectCallback } from "react";

/**
 * Run once, on mount.
 *
 * The only sanctioned use of `useEffect` in this app, and only for syncing with
 * something outside React: an EventSource, a ResizeObserver, a listener on
 * `window`. Derived state is computed inline, data comes from TanStack Query, and
 * anything that happens because a person clicked belongs in the handler.
 */
export function useMountEffect(fn: EffectCallback): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fn, []);
}
