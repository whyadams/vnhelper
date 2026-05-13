import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Three-layer hydration primitive:
 *
 *   <div ref={virtualRow}>                            ← TanStack measureElement here
 *     <LazyHydrate id="…" estimatedHeight={400}
 *                  skeleton={<Light />}>
 *       <FullCard />                                  ← heavy: Radix, dnd-kit, inputs
 *     </LazyHydrate>
 *   </div>
 *
 * Internally LazyHydrate adds two wrapping divs:
 *
 *   <div ref={trigger}>                               ← IntersectionObserver here
 *     <div style="content-visibility: auto;
 *                 contain-intrinsic-size: auto 400px"> ← native paint skip
 *       {hydrated ? children : skeleton}
 *     </div>
 *   </div>
 *
 * Layering rationale (per the caveat: don't stack content-visibility with
 * the element TanStack is measuring — measureElement reads
 * getBoundingClientRect on a c-v:auto element returns 0 while offscreen):
 *
 *   - Outer (virtual row) — measured by TanStack, always laid out.
 *   - Middle (trigger) — observed by IntersectionObserver, always laid out.
 *   - Inner (c-v wrapper) — browser may skip layout/paint when offscreen.
 *
 * Hydration state lives in a parent `HydrationProvider` via a `Set<string>`
 * in a ref. That keeps it stable across virtual row unmount/remount — when
 * TanStack unmounts a row and remounts it on scroll back, the new
 * LazyHydrate instance reads from the same ref and short-circuits straight
 * to children. Without this, fast scroll up-then-down would re-trigger
 * hydration on every revisit and flicker.
 */

interface HydrationApi {
  /** Has this id already been hydrated this session? */
  has: (id: string) => boolean;
  /** Mark as hydrated. Triggers re-render of any LazyHydrate(s) for this id. */
  add: (id: string) => void;
  /** Re-render counter — read by LazyHydrate so it learns about external `add`s. */
  version: number;
  /** True while the parent virtualizer reports active scrolling. LazyHydrate
   *  defers *new* hydration while this is true so fast scroll doesn't pay
   *  the cost of mounting fly-by sections; sections that were already
   *  hydrated stay hydrated. */
  isScrolling: boolean;
}

const HydratedCtx = createContext<HydrationApi | null>(null);

export function HydrationProvider({
  children,
  isScrolling = false,
}: {
  children: ReactNode;
  isScrolling?: boolean;
}) {
  const hydrated = useRef<Set<string>>(new Set());
  // Bumped on every successful `add` so consumers re-evaluate `has(id)`.
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const api = useMemo<HydrationApi>(
    () => ({
      has: (id) => hydrated.current.has(id),
      add: (id) => {
        if (hydrated.current.has(id)) return;
        hydrated.current.add(id);
        bump();
      },
      version,
      isScrolling,
    }),
    [version, isScrolling],
  );

  return <HydratedCtx.Provider value={api}>{children}</HydratedCtx.Provider>;
}

interface Props {
  /** Stable identity for this hydratable region. Re-mounts with the same
   *  id skip the IntersectionObserver dance entirely. */
  id: string;
  /** Used by both contain-intrinsic-size (so the browser reserves space
   *  for the offscreen region) and as a fallback for skeleton height. */
  estimatedHeight: number;
  /** Lightweight stand-in shown before the region intersects the viewport.
   *  Must NOT include Radix, dnd-kit, controlled inputs, or anything that
   *  costs more than a few cheap DOM nodes — the whole point is that the
   *  skeleton's mount is essentially free. */
  skeleton: ReactNode;
  /** The real content. Only rendered once the region has been visible. */
  children: ReactNode;
  /** Pre-trigger margin so we hydrate slightly before the user reaches the
   *  card, masking the swap latency. 200px ≈ 2-3 cards worth of headroom. */
  rootMargin?: string;
}

const LazyHydrateInner = memo(function LazyHydrate({
  id,
  estimatedHeight,
  skeleton,
  children,
  rootMargin = "200px",
}: Props) {
  const ctx = useContext(HydratedCtx);
  if (!ctx) {
    throw new Error("LazyHydrate must be used inside <HydrationProvider />");
  }

  // Initial-mount short-circuit — if this id was already hydrated earlier
  // this session (user scrolled past, scrolled back), bypass the observer.
  const [hydrated, setHydrated] = useState(() => ctx.has(id));

  // The trigger div is what we observe. Kept separate from the c-v wrapper
  // (browsers can give degenerate boxes for c-v:auto elements offscreen,
  // breaking IntersectionObserver rootBounds calculations).
  const triggerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (hydrated) return;
    // External `add` (e.g. a sibling LazyHydrate for the same id) — sync up.
    if (ctx.has(id)) {
      setHydrated(true);
      return;
    }
    // Hold off on observing while the user is mid-scroll. We don't want to
    // hydrate sections flying past — they'd cost real mount work while
    // never being looked at. The effect re-runs when `isScrolling`
    // transitions to false and *then* attaches the observer.
    if (ctx.isScrolling) return;
    const el = triggerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            // Sync state update — visible-region hydration must not be
            // deferred (per the caveat: `startTransition` here would batch
            // and flicker on fast scroll).
            setHydrated(true);
            ctx.add(id);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
    // `ctx.version` so we re-check `has(id)` when another LazyHydrate adds
    // this id (e.g. a re-mount path that bypassed this effect).
    // `ctx.isScrolling` so we re-attach the observer the moment the user
    // stops scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, id, rootMargin, ctx.version, ctx.isScrolling]);

  return (
    <div ref={triggerRef}>
      <div
        style={{
          contentVisibility: "auto",
          containIntrinsicSize: `auto ${estimatedHeight}px`,
          // Stabilize layout: while showing the skeleton, force the wrapper
          // to the virtualizer's estimated height. Without this, the
          // skeleton renders at its natural (~40px) height, then jumps to
          // the real height once children mount — which retriggers
          // measureElement and shifts virtualizer offsets. After hydration
          // we release the floor so measureElement records the real size.
          minHeight: hydrated ? undefined : estimatedHeight,
        }}
      >
        {hydrated ? children : skeleton}
      </div>
    </div>
  );
});

export const LazyHydrate = LazyHydrateInner;
