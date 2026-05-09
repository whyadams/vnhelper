import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/**
 * Workspace-scoped (or any-scoped) async data hook.
 *
 * Solves the systemic bugs where feature hooks render stale data after the
 * scope (workspaceId, projectId, …) changes:
 *   1. SYNCHRONOUSLY resets local data on scope change BEFORE the new fetch
 *      arrives. No "previous workspace's data flashes for 200ms" anymore.
 *   2. Drops async responses whose scope no longer matches the current one
 *      (race protection between two quick switches).
 *   3. Exposes `scopeRef` so realtime handlers and mutations can guard against
 *      stale callbacks fired from torn-down channels / in-flight requests.
 *   4. Exposes `setData` so callers can do optimistic mutations and inline
 *      realtime updates (INSERT/UPDATE/DELETE) without full refetch.
 *
 * The hook itself does NOT manage realtime channels — feature code attaches
 * those and uses `scopeRef.current` to discard stale events. Channels remain
 * close to the feature so each can shape its own filters and inline updates.
 */
export interface UseScopedQueryOptions<T, S> {
  /** Current scope (e.g. workspaceId). Pass `null` to disable fetching. */
  scope: S | null;

  /** Initial value used both at mount and on every scope change. Must be a stable reference. */
  initial: T;

  /**
   * Async loader. Receives the scope value (guaranteed non-null) and an
   * AbortSignal that fires when the scope changes mid-flight.
   * Throw to surface errors; the hook still flips `ready` to true.
   */
  fetch: (scope: S, signal: AbortSignal) => Promise<T>;

  /** Optional: skip fetching even when scope is non-null (gate by feature flag, etc). */
  enabled?: boolean;
}

export interface UseScopedQueryResult<T, S> {
  data: T;
  setData: Dispatch<SetStateAction<T>>;
  refetch: () => Promise<void>;
  /** True once the first fetch for the current scope has settled (success or error). */
  ready: boolean;
  /** Latest scope; safe to read inside async callbacks to discard stale work. */
  scopeRef: MutableRefObject<S | null>;
}

export function useScopedQuery<T, S = string>(
  opts: UseScopedQueryOptions<T, S>,
): UseScopedQueryResult<T, S> {
  const { scope, fetch, enabled = true } = opts;

  // Capture initial value once; ignore re-creations from inline literals.
  // Callers may reset to a fresh initial by remounting.
  const initialRef = useRef(opts.initial);

  const [data, setData] = useState<T>(initialRef.current);
  const [ready, setReady] = useState<boolean>(false);

  const scopeRef = useRef<S | null>(scope);
  scopeRef.current = scope;

  // Latest fetch fn — kept in a ref so refetch() never gets a stale closure
  // and so changing fetch identity doesn't re-trigger sync resets.
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refetch = useCallback(async () => {
    const myScope = scopeRef.current;
    if (myScope == null || !enabledRef.current) return;
    const ctrl = new AbortController();
    try {
      const result = await fetchRef.current(myScope, ctrl.signal);
      // Drop late responses if the scope changed under us.
      if (scopeRef.current !== myScope) return;
      setData(result);
    } finally {
      if (scopeRef.current === myScope) setReady(true);
    }
  }, []);

  useEffect(() => {
    // 1) Synchronous reset. THIS is what fixes the stale-flash bug.
    setData(initialRef.current);
    setReady(false);

    if (scope == null || !enabled) {
      // Idle state: nothing to fetch.
      setReady(true);
      return;
    }

    // 2) Kick off fetch with a stable reference to "this" scope value.
    const myScope = scope;
    const ctrl = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchRef.current(myScope, ctrl.signal);
        if (cancelled || scopeRef.current !== myScope) return;
        setData(result);
      } catch (e) {
        if (!cancelled && scopeRef.current === myScope) {
          // Surface to console; callers can wrap fetch with their own
          // notification UI if needed.
          console.error("[useScopedQuery] fetch failed", e);
        }
      } finally {
        if (!cancelled && scopeRef.current === myScope) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [scope, enabled]);

  return { data, setData, refetch, ready, scopeRef };
}
