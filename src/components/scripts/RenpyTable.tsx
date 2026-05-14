import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable as useDndSortable } from "@dnd-kit/react/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";

// Sortable index lookup — dnd-kit's `useSortable` needs each item's index in
// the flat blocks array. We compute the id→index map once per render in
// RenpyTable and expose it via context so every card can resolve its own
// index without prop-drilling through 5+ component layers.
const IndexCtx = createContext<Map<string, number> | null>(null);
function useBlockIndex(id: string): number {
  const map = useContext(IndexCtx);
  return map?.get(id) ?? 0;
}
import { parseRpyScript } from "../../lib/renpy/scriptParser";
import { HydrationProvider, LazyHydrate } from "./LazyHydrate";
import {
  newBlockId,
  type RpyBlock,
  type RpyBlockKind,
  type RpyBlocks,
  type LabelBlock,
  type SceneBlock,
  type MenuBlock,
  type ChoiceBlock,
  type RawBlock,
} from "../../lib/renpy/blocks";
import type { ScriptCharacter } from "../../state/scripts";
import { Popover } from "../kanban/Popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

// ── Drag-and-drop powered by @dnd-kit/react ──────────────────────────

/** Wraps a sortable card. `useSortable` from @dnd-kit returns refs we
 * attach to the card root (drop target) and the drag handle (drag source).
 * It also gives us `isDragSource` for visual feedback during the drag. */
function useSortable(id: string) {
  const index = useBlockIndex(id);
  const r = useDndSortable({ id, index });
  return {
    setRef: r.ref as (el: HTMLElement | null) => void,
    setHandleRef: r.handleRef as (el: HTMLElement | null) => void,
    dragClassSuffix: r.isDragSource ? " is-dragging" : "",
  };
}

/** Hover-revealed grip on the left gutter of every reorderable card. The
 * dnd-kit library wires the actual drag gesture to this element via
 * `handleRef`; we just style it. */
function DragHandleInner({
  setHandleRef,
}: {
  setHandleRef: (el: HTMLElement | null) => void;
}) {
  return (
    <button
      ref={setHandleRef}
      type="button"
      className="rs-drag-handle"
      aria-label="Drag to reorder"
      title="Drag to reorder"
    >
      <svg viewBox="0 0 6 14" width="6" height="14" aria-hidden>
        <circle cx="1.5" cy="2.5" r="1" fill="currentColor" />
        <circle cx="4.5" cy="2.5" r="1" fill="currentColor" />
        <circle cx="1.5" cy="7" r="1" fill="currentColor" />
        <circle cx="4.5" cy="7" r="1" fill="currentColor" />
        <circle cx="1.5" cy="11.5" r="1" fill="currentColor" />
        <circle cx="4.5" cy="11.5" r="1" fill="currentColor" />
      </svg>
    </button>
  );
}

interface Props {
  /** Stable per-node key — RenpyTable resets local state when this changes. */
  nodeId: string;
  initialBlocks: RpyBlocks | null;
  characters: ScriptCharacter[];
  /** Project-wide scene labels for jump/call autocompletion. The current
   * scene's own embedded labels are added on top inside the table. */
  projectLabels?: string[];
  /** Debounced save (~800ms) for keystroke-level edits. */
  onChange: (next: RpyBlocks) => void;
  /** Immediate, non-debounced save for bulk ops (paste-import, clear-all). */
  onReplace: (next: RpyBlocks) => Promise<void> | void;
}

/**
 * Renpy-tab editor — card-based screenplay layout.
 *
 * Each block is rendered as its own card with a kind chip. Scene blocks act
 * as containers: subsequent stage directions and dialogue belong visually
 * inside the scene card until the next scene/menu/label boundary. Audio
 * raw blocks (play/stop/queue/voice) get a dedicated Music card style;
 * other raw blocks fall back to a code-block card.
 *
 * Local state is the working copy; every edit propagates upstream via
 * `onChange`, debounced one level up.
 */
export function RenpyTable({
  nodeId,
  initialBlocks,
  characters,
  projectLabels,
  onChange,
  onReplace,
}: Props) {
  const [blocks, setBlocks] = useState<RpyBlocks>(initialBlocks ?? []);
  const [pasteText, setPasteText] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState<string[]>([]);
  /** Label-section ids that are currently collapsed (only the header shows).
   *  Initialised on scene-load to "everything closed" so big imports don't
   *  hit the user with a wall of 50 expanded sections. */
  const [collapsedLabels, setCollapsedLabels] = useState<Set<string>>(
    () => new Set(),
  );

  // Only resync local state when the *node* changes — depending on
  // `initialBlocks` here would clobber unsaved local edits during the
  // upstream save debounce window: any parent re-render in that window
  // (cast realtime, savedAgo tick, etc.) reuses the still-stale
  // `node.rpy_blocks`, and a race like that wipes a freshly-pasted scene.
  // The trade-off is that external updates to the same scene (other user,
  // other tab) won't auto-merge — same behavior as the TipTap Doc editor.
  useEffect(() => {
    const normalised = normalizeBlocks(initialBlocks ?? []);
    setBlocks(normalised);
    setPasteText("");
    setPasteWarnings([]);
    // Default-collapse every label-section on scene-load. The user can
    // expand the ones they want to work in — same model as a folder tree.
    const initial = new Set<string>();
    for (const b of normalised) {
      if (b.kind === "label") initial.add(b.id);
    }
    setCollapsedLabels(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  /** Toggle one section. Newly-inserted labels (post-import edits) get
   *  added to `collapsedLabels` automatically via the effect below so
   *  they too start closed. */
  const toggleCollapsed = useCallback((labelId: string) => {
    setCollapsedLabels((curr) => {
      const next = new Set(curr);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  }, []);

  // Keep the collapsed set tidy: drop ids of labels that no longer exist
  // (deleted or renamed-via-replace) so the Set doesn't leak forever.
  useEffect(() => {
    setCollapsedLabels((curr) => {
      const liveIds = new Set<string>();
      for (const b of blocks) {
        if (b.kind === "label") liveIds.add(b.id);
      }
      let changed = false;
      const next = new Set<string>();
      for (const id of curr) {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : curr;
    });
  }, [blocks]);

  /** Union of project-wide scene labels and any `label foo:` blocks defined
   * inside the current scene's body. Surface them via jump/call autocomplete
   * and broken-link detection. */
  const knownLabels = useMemo(() => {
    const set = new Set<string>();
    for (const l of projectLabels ?? []) {
      const t = l.trim();
      if (t) set.add(t);
    }
    for (const b of blocks) {
      if (b.kind === "label" && b.name.trim()) set.add(b.name.trim());
    }
    return Array.from(set).sort();
  }, [projectLabels, blocks]);

  const charByVar = useMemo(() => {
    const map = new Map<string, ScriptCharacter>();
    for (const c of characters) {
      if (c.rpy_var) map.set(c.rpy_var, c);
    }
    return map;
  }, [characters]);

  // All mutators go through `applyFn` with a functional updater so their
  // closures only depend on `setBlocks` + `onChange` — both stable. Without
  // this every keystroke recreated `updateById`/`deleteById`/… which broke
  // `memo` on the hundreds of leaf cards downstream (they re-rendered on
  // every render of RenpyTable, defeating the optimization).
  const applyFn = useCallback(
    (fn: (curr: RpyBlocks) => RpyBlocks) => {
      setBlocks((prev) => {
        const next = fn(prev);
        if (next !== prev) onChange(next);
        return next;
      });
    },
    [onChange],
  );

  // Convenience wrapper for callers that already have the next array.
  const apply = useCallback(
    (next: RpyBlocks) => {
      setBlocks(next);
      onChange(next);
    },
    [onChange],
  );

  const updateById = useCallback(
    (id: string, mut: (b: RpyBlock) => RpyBlock) => {
      applyFn((curr) => curr.map((b) => (b.id === id ? mut(b) : b)));
    },
    [applyFn],
  );

  const deleteById = useCallback(
    (id: string) => {
      applyFn((curr) => curr.filter((b) => b.id !== id));
    },
    [applyFn],
  );

  const duplicateById = useCallback(
    (id: string) => {
      applyFn((curr) => {
        const idx = curr.findIndex((b) => b.id === id);
        if (idx === -1) return curr;
        const clone: RpyBlock = { ...curr[idx], id: newBlockId() };
        const next = curr.slice();
        next.splice(idx + 1, 0, clone);
        return next;
      });
    },
    [applyFn],
  );

  const insertAfter = useCallback(
    (afterId: string | null, newBlocks: RpyBlock[]) => {
      if (newBlocks.length === 0) return;
      applyFn((curr) => {
        if (afterId === null) return [...curr, ...newBlocks];
        const idx = curr.findIndex((b) => b.id === afterId);
        if (idx === -1) return [...curr, ...newBlocks];
        const next = curr.slice();
        next.splice(idx + 1, 0, ...newBlocks);
        return next;
      });
    },
    [applyFn],
  );

  // Map of block id → flat index. Each sortable card looks up its index here
  // to participate in the dnd-kit sortable group; the lookup is O(1) after
  // a single pre-walk of the array per render.
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    blocks.forEach((b, i) => m.set(b.id, i));
    return m;
  }, [blocks]);

  const sections = useMemo(() => groupSections(blocks), [blocks]);

  const onPasteImport = () => {
    const trimmed = pasteText.trim();
    if (!trimmed) return;
    console.log(
      `[Renpy paste] input: ${trimmed.length} chars, ${trimmed.split("\n").length} lines`,
    );
    const parsed = parseRpyScript(trimmed);
    console.log(
      `[Renpy paste] parsed: ${parsed.blocks.length} blocks, ${parsed.warnings.length} warnings`,
    );
    setPasteWarnings(
      parsed.warnings.map((w) => `Line ${w.line}: ${w.message}`),
    );
    setBlocks(parsed.blocks);
    setPasteText("");
    // Bulk replacement → bypass the 800ms debounce so no parent re-render in
    // the wait window can race against the new state.
    void onReplace(parsed.blocks);
  };

  if (blocks.length === 0) {
    return (
      <div className="rs-empty">
        <h3 className="rs-empty-title">No Ren'Py content yet</h3>
        <p className="rs-empty-sub">
          Начни с пустой сцены — добавится новый <code>label</code>, а под
          ним сможешь раскладывать диалоги и сцены. Или вставь готовый
          <code>.rpy</code>-кусок и парсер разложит его сам.
        </p>
        <div className="rs-empty-actions">
          <button
            type="button"
            className="hbtn is-primary"
            onClick={() =>
              apply([
                { id: newBlockId(), kind: "label", depth: 0, name: "" },
              ])
            }
          >
            + Empty scene
          </button>
        </div>
        <div className="rs-paste-or">or paste .rpy below</div>
        <textarea
          className="rs-paste"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={`label scene_id:\n    play music "music/track.mp3"\n    scene bg with dissolve\n    mc "Hello"`}
          spellCheck={false}
          rows={8}
        />
        <button
          type="button"
          className="hbtn"
          onClick={onPasteImport}
          disabled={!pasteText.trim()}
        >
          Parse and import
        </button>
        {pasteWarnings.length > 0 && <Warnings warnings={pasteWarnings} />}
      </div>
    );
  }

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const sourceId =
          (event.operation.source?.id as string | undefined) ?? null;
        const targetId =
          (event.operation.target?.id as string | undefined) ?? null;
        if (!sourceId || !targetId || sourceId === targetId) return;
        const next = moveBlocksRange(blocks, sourceId, targetId);
        if (next !== blocks) apply(next);
      }}
    >
    <IndexCtx.Provider value={indexById}>
    <div className="rs-script">
      <div className="rs-toolbar">
        <span className="rs-stats">
          {sections.length} scene{sections.length === 1 ? "" : "s"}
          {" · "}
          {blocks.length} block{blocks.length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="hbtn"
          onClick={() => apply([])}
          title="Clear all blocks"
        >
          Clear all
        </button>
      </div>

      <VirtualizedSections
        nodeId={nodeId}
        sections={sections}
        charByVar={charByVar}
        characters={characters}
        knownLabels={knownLabels}
        collapsedLabels={collapsedLabels}
        onToggleCollapse={toggleCollapsed}
        onUpdate={updateById}
        onDelete={deleteById}
        onDuplicate={duplicateById}
        onInsertAfter={insertAfter}
      />

      <button
        type="button"
        className="rs-add-scene"
        onClick={() => {
          const lastBlock = blocks[blocks.length - 1];
          insertAfter(lastBlock?.id ?? null, [
            { id: newBlockId(), kind: "label", depth: 0, name: "" },
          ]);
        }}
      >
        + Add scene
      </button>

      {pasteWarnings.length > 0 && <Warnings warnings={pasteWarnings} />}

      {/* Sticky quick-add bar — pinned to the bottom of the doc scroll area
          so the most-used insertions are one click away regardless of how
          far the user has scrolled. Appends a new block at the end of the
          document (after the last existing block, or at top when empty). */}
      <QuickAddBar
        onPick={(kind) => {
          const lastBlock = blocks[blocks.length - 1];
          // Labels live at depth 0, everything else at depth 1. createEmptyBlock
          // already handles this, so we just feed the kind through.
          insertAfter(lastBlock?.id ?? null, [createEmptyBlock(kind, 1)]);
        }}
      />
    </div>
    </IndexCtx.Provider>
    </DragDropProvider>
  );
}

/**
 * Sticky quick-add bar at the bottom of the script doc. Floats with the
 * scroll area thanks to `position: sticky; bottom: 12px`. Holds chips for
 * the most-used block kinds — full Insert-picker menu still works via the
 * "+ Add block" button inside each section if the user wants something
 * exotic. */
function QuickAddBar({ onPick }: { onPick: (kind: RpyBlockKind) => void }) {
  const quick: Array<{ kind: RpyBlockKind; label: string; tone?: string }> = [
    { kind: "say", label: "Dialogue" },
    { kind: "narrator", label: "Narrator" },
    { kind: "scene", label: "Scene" },
    { kind: "show", label: "Show" },
    { kind: "hide", label: "Hide" },
    { kind: "menu", label: "Menu", tone: "menu" },
    { kind: "jump", label: "Jump", tone: "flow" },
    { kind: "call", label: "Call", tone: "flow" },
    { kind: "return", label: "Return", tone: "flow" },
    { kind: "note", label: "Note" },
    { kind: "raw", label: "Raw", tone: "raw" },
  ];
  return (
    <div
      className="rs-quick-add"
      role="toolbar"
      aria-label="Quick add block"
    >
      <span className="rs-quick-add-prefix">+ Insert</span>
      <span className="rs-quick-add-sep" aria-hidden />
      {quick.map((q) => (
        <button
          key={q.kind}
          type="button"
          className={
            "rs-quick-add-chip" + (q.tone ? ` is-tone-${q.tone}` : "")
          }
          onClick={() => onPick(q.kind)}
          title={`Append ${q.label.toLowerCase()} block at end`}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Virtualized list of SectionView. Each Ren'Py file imported as a single
 * `script_node` can produce 20-30 sections (one per label), each carrying
 * 10-100 cards. Mounting them all at once is the dominant cost of opening
 * the Renpy tab on a real-world `.rpy` import — 500+ cards × dnd-kit
 * `useSortable` subscriptions × variable layout work.
 *
 * `@tanstack/react-virtual` keeps only the sections that intersect the
 * visible viewport in the DOM. The scroll parent is `.doc-scroll` from
 * ScriptDoc — we resolve it via `closest()` rather than threading a ref
 * through props so this component stays drop-in compatible with the
 * non-virtual call site.
 *
 * Trade-off: dnd-kit can't see sections that aren't currently rendered. In
 * practice that's fine — reorders happen within the visible window; for
 * cross-window moves the user scrolls to the destination first.
 */
function VirtualizedSections({
  nodeId,
  sections,
  charByVar,
  characters,
  knownLabels,
  collapsedLabels,
  onToggleCollapse,
  onUpdate,
  onDelete,
  onDuplicate,
  onInsertAfter,
}: {
  nodeId: string;
  sections: Section[];
  charByVar: Map<string, ScriptCharacter>;
  characters: ScriptCharacter[];
  knownLabels: string[];
  collapsedLabels: Set<string>;
  onToggleCollapse: (labelId: string) => void;
  onUpdate: (id: string, mut: (b: RpyBlock) => RpyBlock) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onInsertAfter: (afterId: string | null, newBlocks: RpyBlock[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Resolve the actual scroll parent AFTER mount and pin it in state — at
  // first render `containerRef.current` is null, so an inline getter would
  // return null and the virtualizer would render zero items (blank screen).
  // Capturing once in a useEffect and re-rendering with the resolved
  // element is the pattern recommended in @tanstack/react-virtual docs.
  //
  // We ALSO need the scroll-relative offset of our container, because the
  // virtualizer reasons in scroller coordinates while our items are
  // positioned inside `containerRef` (which sits below a toolbar, meta-row
  // and other static header content in ScriptDoc). Without
  // `scrollMargin` the virtualizer mounts items for the wrong scroll range
  // — typically nothing on screen until the user scrolls a few hundred
  // pixels down.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scroller =
      el.closest<HTMLElement>(".doc-scroll") ??
      (document.scrollingElement as HTMLElement | null);
    setScrollEl(scroller);
    if (scroller) {
      // Distance from the top of the scroll content to the top of our
      // virtualized container. `scrollTop + getBoundingClientRect` is the
      // standard trick to get the content-space offset.
      const containerTop = el.getBoundingClientRect().top;
      const scrollerTop = scroller.getBoundingClientRect().top;
      setScrollMargin(containerTop - scrollerTop + scroller.scrollTop);
    }
  }, []);

  // Persistent measurements cache — the canonical fix for "fast scroll
  // shows blank gaps". The first time a scene is opened the virtualizer
  // measures each section on its way through the viewport; we persist
  // those numbers to localStorage and feed them back as
  // `initialMeasurementsCache` next session. Subsequent opens skip the
  // measure-and-correct cycle entirely — the virtualizer KNOWS where
  // every row sits, so dragging the scrollbar to the bottom lands
  // exactly on the right section instead of falling through an
  // unmeasured void. Same technique Linear / Notion use for long lists.
  const cacheKey = `vnhelper.virt.measurements:${nodeId}`;
  const initialCache = useMemo<
    ReturnType<typeof loadMeasurementsCache>
  >(() => loadMeasurementsCache(cacheKey), [cacheKey]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scrollEl,
    scrollMargin,
    initialMeasurementsCache: initialCache,
    onChange: (instance) => {
      // Debounced persistence — `onChange` fires on every scroll tick;
      // writing localStorage on each is ~1ms but the JSON.stringify of
      // hundreds of measurements adds up. 500ms is invisible to users
      // and amortizes the cost across a scroll gesture.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveMeasurementsCache(cacheKey, instance.measurementsCache);
      }, 500);
    },
    // Per-section estimate built by summing per-kind weights for every
    // block in the section's body, plus a header allowance. Far more
    // accurate than a flat `body.length * 80` average — sections heavy in
    // menus/choices/raw blocks (big cards) get a higher estimate, and
    // sections of pure dialogue (small cards) get a lower one. Accurate
    // estimates let TanStack put items in the right places on first paint,
    // which is what prevents the "blank gap on fast scroll" symptom.
    estimateSize: (i) => {
      const s = sections[i];
      // Collapsed sections render the header strip only — short and uniform.
      // ~48px (label name baseline + glyph) + 28px vertical padding-as-gap
      // ≈ 64px. The virtualizer will measure the real DOM and self-correct.
      if (s.label && collapsedLabels.has(s.label.id)) return 64;
      return estimateSectionHeight(s);
    },
    // Tight overscan. Counterintuitively *raising* it makes fast scroll
    // worse: more mid-scroll mounts per frame == more jank. 3 is enough
    // to mask normal-speed scroll while keeping mount cost low.
    overscan: 3,
    // Stable id per section so measured sizes survive section reorders
    // and re-renders.
    getItemKey: (i) => sections[i].label?.id ?? `orphan-${i}`,
    // Workaround for TanStack Virtual issue #659: when an item above the
    // viewport gets measured for the first time and is bigger than the
    // estimate, its growth pushes the visible area downward — visible to
    // the user as a scroll-up stutter. Caching the previous measurement
    // when scrolling backward avoids the layout shift. Adopted directly
    // from the maintainer-acknowledged workaround in that issue.
    measureElement: (element, _entry, instance) => {
      const direction = instance.scrollDirection;
      if (direction === "backward") {
        const cached = instance.measurementsCache[
          Number(element.getAttribute("data-index"))
        ];
        if (cached) return cached.size;
      }
      return element.getBoundingClientRect().height;
    },
  });

  const items = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  // Pulled into a variable so the HydrationProvider re-renders the moment
  // scroll state flips, telling child LazyHydrates to pause/resume.
  const isScrolling = rowVirtualizer.isScrolling;

  return (
    <HydrationProvider isScrolling={isScrolling}>
    <div
      ref={containerRef}
      style={{
        position: "relative",
        // Reserve the full virtualized height so the page's own scrollbar
        // reflects the true content length — the parent .doc-scroll drives
        // scrolling, this div just creates the right amount of space.
        height: totalSize,
        width: "100%",
      }}
    >
      {items.map((vItem) => {
        const section = sections[vItem.index];
        const sectionId = section.label?.id ?? `orphan-${vItem.index}`;
        // `content-visibility: auto` lives INSIDE LazyHydrate now, on a
        // sibling element to the one TanStack measures (per caveat:
        // measureElement on a c-v:auto element returns 0 offscreen).
        // The outer div here is only for absolute positioning + measurement.
        return (
          <div
            key={vItem.key}
            data-index={vItem.index}
            ref={rowVirtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              // `vItem.start` is in scroller-space (includes scrollMargin);
              // our container sits at `scrollMargin` inside that space, so we
              // subtract it to land at the right offset within our wrapper.
              transform: `translateY(${vItem.start - scrollMargin}px)`,
            }}
          >
            <LazyHydrate
              id={sectionId}
              estimatedHeight={vItem.size}
              skeleton={<SectionSkeleton section={section} />}
            >
              <SectionView
                section={section}
                charByVar={charByVar}
                characters={characters}
                knownLabels={knownLabels}
                isCollapsed={
                  section.label
                    ? collapsedLabels.has(section.label.id)
                    : false
                }
                onToggleCollapse={onToggleCollapse}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onInsertAfter={onInsertAfter}
              />
            </LazyHydrate>
          </div>
        );
      })}
    </div>
    </HydrationProvider>
  );
}

/**
 * Persisted measurements cache, keyed by scene node id. The shape mirrors
 * TanStack Virtual's `measurementsCache` (an array of items with `size`,
 * `start`, `end`, `key`, `lane`, `index`). We don't actively re-create
 * those objects ourselves — TanStack returns its real cache through the
 * `onChange` callback and we JSON-stringify it as-is. On load we feed it
 * straight back via `initialMeasurementsCache`.
 *
 * Stored under one key per scene so opening a new scene doesn't carry
 * over the wrong cache. Bumping the storage prefix invalidates old
 * caches if the shape ever changes — keep an eye on TanStack release
 * notes for any breaking changes to the cache item shape.
 */
type MeasurementsCache = Parameters<
  Exclude<
    Parameters<typeof useVirtualizer>[0]["initialMeasurementsCache"],
    undefined
  > extends infer T
    ? T extends ReadonlyArray<infer Item>
      ? (item: Item) => void
      : never
    : never
> extends [infer Item]
  ? Item[]
  : never;

function loadMeasurementsCache(key: string): MeasurementsCache | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MeasurementsCache) : undefined;
  } catch {
    return undefined;
  }
}

function saveMeasurementsCache(key: string, cache: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // QuotaExceededError or similar — silently drop. Worst case we just
    // re-measure on next open, no correctness impact.
  }
}

/**
 * Per-content row-height approximations used by TanStack's `estimateSize`.
 * Rather than a flat per-kind constant, dialogue/note/raw estimates scale
 * with their actual text length — a single-line "yes." dialogue should not
 * cost the same vertical budget as a 400-char paragraph. Accurate estimates
 * are what stops "fast scroll leaves a blank gap" from happening: the
 * virtualizer's idea of the offset for row N agrees with reality, so when
 * the user drags the scrollbar to a deep position it lands on the right
 * content instead of an unmeasured void.
 *
 * Approximations target a card ~480px wide, ~80 chars/line, ~22px line-height
 * (matches the resolved layout from scripts.css; tweak if the design shifts).
 */
const CHARS_PER_LINE = 80;
const LINE_HEIGHT = 22;
const CARD_VPAD = 36; // top+bottom padding inside a typical card

function estimateBlockHeight(b: RpyBlock): number {
  switch (b.kind) {
    case "label":
      return 48;
    case "scene":
      return 120;
    case "show":
    case "hide":
      return 80;
    case "say":
    case "narrator": {
      // Dialogue card cost scales linearly with how many wrapped lines
      // the text produces. Short barks ("..."): ~58px. Paragraphs: 100+.
      const text = (b as { text?: string }).text ?? "";
      const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
      return CARD_VPAD + lines * LINE_HEIGHT;
    }
    case "menu":
      // Menu container alone — choices count below as separate blocks.
      return 56;
    case "choice": {
      const text = (b as { text?: string }).text ?? "";
      const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
      return 48 + lines * LINE_HEIGHT;
    }
    case "jump":
    case "call":
      return 64;
    case "return":
      return 44;
    case "with":
    case "pause":
      return 60;
    case "note": {
      const text = (b as { text?: string }).text ?? "";
      const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
      return 32 + lines * LINE_HEIGHT;
    }
    case "raw": {
      // Multi-line code blocks: each `lines[]` entry is one rendered row.
      const raw = b as { lines?: string[] };
      const count = raw.lines?.length ?? 1;
      return 44 + count * 18;
    }
    default:
      return 100;
  }
}

function estimateSectionHeight(section: Section | undefined): number {
  if (!section) return 200;
  // Header strip (label name + scene chip + actions) is ~60px regardless
  // of body contents. Section gap inside `.rs-section { gap: 21px }` adds
  // ~21px between every two child blocks.
  let total = 60;
  for (let i = 0; i < section.body.length; i++) {
    total += estimateBlockHeight(section.body[i]);
    if (i < section.body.length - 1) total += 21;
  }
  return total;
}

/**
 * Lightweight stand-in for a SectionView before it has been visible. Renders
 * just the label name and a block count — no Radix, no useSortable, no
 * controlled inputs. Mount cost is essentially zero, so a thousand of these
 * cost ~the same as one. Replaced with the real SectionView the moment
 * IntersectionObserver fires on this section.
 */
function SectionSkeleton({ section }: { section: Section }) {
  const name = section.label?.kind === "label" ? section.label.name : "";
  return (
    <div className="rs-section-skeleton">
      <div className="rs-section-skeleton-head">
        <span className="rs-section-skeleton-label">
          {name || "(orphan body)"}
        </span>
        <span className="rs-section-skeleton-count">
          {section.body.length} block{section.body.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

/**
 * Compute the half-open end index of the block-range that visually
 * "belongs" to the block at `startIdx`. Container blocks (label, menu,
 * choice, scene) carry their body with them when reordered:
 *
 *   - `scene`              → following `say` / `narrator` siblings only
 *                            (per the spec — scene body is strictly dialogue)
 *   - `label`/`menu`/`choice` → every following block at deeper indent
 *   - everything else      → just the block itself
 *
 * The returned index is exclusive (slice-friendly).
 */
function getRangeEnd(blocks: RpyBlocks, startIdx: number): number {
  const start = blocks[startIdx];
  if (!start) return startIdx + 1;

  if (start.kind === "scene") {
    let end = startIdx + 1;
    while (end < blocks.length) {
      const k = blocks[end].kind;
      if (k === "say" || k === "narrator") end++;
      else break;
    }
    return end;
  }

  if (
    start.kind === "label" ||
    start.kind === "menu" ||
    start.kind === "choice"
  ) {
    const baseDepth = start.depth;
    let end = startIdx + 1;
    while (end < blocks.length && blocks[end].depth > baseDepth) {
      end++;
    }
    return end;
  }

  return startIdx + 1;
}

/**
 * Reorder helper used by the dnd-kit drag-end handler. Generalises beyond
 * the single-block `move()` from `@dnd-kit/helpers` so containers (label,
 * scene, menu, choice) carry their body when dragged, and dropping onto a
 * container while moving downward lands AFTER its entire body — not
 * between the container header and its first child.
 */
function moveBlocksRange(
  blocks: RpyBlocks,
  sourceId: string,
  targetId: string,
): RpyBlocks {
  const srcIdx = blocks.findIndex((b) => b.id === sourceId);
  if (srcIdx === -1) return blocks;

  const removeStart = srcIdx;
  const removeEnd = getRangeEnd(blocks, srcIdx);

  const tgtIdx = blocks.findIndex((b) => b.id === targetId);
  if (tgtIdx === -1) return blocks;
  if (tgtIdx >= removeStart && tgtIdx < removeEnd) return blocks;

  const movingDown = srcIdx < tgtIdx;
  const moved = blocks.slice(removeStart, removeEnd);
  const without = blocks
    .slice(0, removeStart)
    .concat(blocks.slice(removeEnd));

  const targetIdxInWithout = without.findIndex((b) => b.id === targetId);
  if (targetIdxInWithout === -1) return blocks;

  // Moving down: land BELOW the target's entire range so containers stay
  // intact. Moving up: insert right before the target — no skip needed.
  const insertAt = movingDown
    ? getRangeEnd(without, targetIdxInWithout)
    : targetIdxInWithout;

  return without
    .slice(0, insertAt)
    .concat(moved)
    .concat(without.slice(insertAt));
}

// -- Section grouping (by `label`) ------------------------------------------

interface Section {
  label: LabelBlock | null;
  body: RpyBlock[];
}

function groupSections(blocks: RpyBlocks): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const b of blocks) {
    if (b.kind === "label") {
      if (current) sections.push(current);
      current = { label: b, body: [] };
    } else {
      if (!current) current = { label: null, body: [] };
      current.body.push(b);
    }
  }
  if (current) sections.push(current);
  return sections;
}

// -- Within a label, group blocks into scene containers / menus / loose -----

type GroupedItem =
  | { kind: "scene-card"; scene: SceneBlock; body: RpyBlock[] }
  | { kind: "menu-card"; tree: MenuTree }
  | { kind: "loose"; block: RpyBlock };

/**
 * Strict scene-container rule: a `scene` block opens a container that holds
 * ONLY dialogue lines (say / narrator). Anything else — audio, show/hide,
 * pause, notes, jump/call — closes the scene visually and renders at the
 * section level. Subsequent dialogue without a fresh `scene` block also
 * stays loose, since by the user's mental model dialogue belongs to a
 * specific scene declaration.
 */
function isSceneBodyKind(kind: RpyBlockKind): boolean {
  return kind === "say" || kind === "narrator";
}

function groupSceneItems(body: RpyBlock[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  let currentScene: { scene: SceneBlock; body: RpyBlock[] } | null = null;

  const flushScene = () => {
    if (currentScene) {
      items.push({ kind: "scene-card", ...currentScene });
      currentScene = null;
    }
  };

  let i = 0;
  while (i < body.length) {
    const b = body[i];
    if (b.kind === "scene") {
      flushScene();
      currentScene = { scene: b, body: [] };
      i++;
      continue;
    }
    if (b.kind === "menu") {
      flushScene();
      const { tree, nextIdx } = groupMenu(body, i);
      items.push({ kind: "menu-card", tree });
      i = nextIdx;
      continue;
    }
    if (currentScene && isSceneBodyKind(b.kind)) {
      currentScene.body.push(b);
      i++;
      continue;
    }
    // Non-dialogue block under an open scene → close the scene and render
    // this block (and any following non-dialogue) at section level.
    flushScene();
    items.push({ kind: "loose", block: b });
    i++;
  }
  flushScene();
  return items;
}

interface MenuTree {
  menu: MenuBlock;
  choices: Array<{ choice: ChoiceBlock; body: RpyBlock[] }>;
}

function groupMenu(
  body: RpyBlock[],
  startIdx: number,
): { tree: MenuTree; nextIdx: number } {
  const menu = body[startIdx] as MenuBlock;
  const tree: MenuTree = { menu, choices: [] };
  let i = startIdx + 1;
  let currentChoice: { choice: ChoiceBlock; body: RpyBlock[] } | null = null;
  while (i < body.length) {
    const b = body[i];
    if (b.depth <= menu.depth) break;
    if (b.kind === "choice" && b.depth === menu.depth + 1) {
      if (currentChoice) tree.choices.push(currentChoice);
      currentChoice = { choice: b, body: [] };
    } else if (currentChoice) {
      currentChoice.body.push(b);
    } else {
      break;
    }
    i++;
  }
  if (currentChoice) tree.choices.push(currentChoice);
  return { tree, nextIdx: i };
}

// -- Section view -----------------------------------------------------------

interface CommonHandlers {
  onUpdate: (id: string, mut: (b: RpyBlock) => RpyBlock) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onInsertAfter: (afterId: string | null, newBlocks: RpyBlock[]) => void;
}

function SectionViewInner({
  section,
  charByVar,
  characters,
  knownLabels,
  isCollapsed,
  onToggleCollapse,
  onUpdate,
  onDelete,
  onDuplicate,
  onInsertAfter,
}: {
  section: Section;
  charByVar: Map<string, ScriptCharacter>;
  characters: ScriptCharacter[];
  knownLabels: string[];
  isCollapsed: boolean;
  onToggleCollapse: (labelId: string) => void;
} & CommonHandlers) {
  const lastBlockId =
    section.body.length > 0
      ? section.body[section.body.length - 1].id
      : section.label?.id ?? null;

  const items = useMemo(() => groupSceneItems(section.body), [section.body]);

  // Body-summary for the collapsed header — "12 blocks · 3 menus · 2 jumps".
  // Lets the user know what's inside without expanding. Costs O(body.length)
  // but body is already in scope.
  const bodySummary = useMemo(() => {
    if (section.body.length === 0) return "empty";
    const counts = new Map<string, number>();
    for (const b of section.body) {
      counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    }
    const total = section.body.length;
    const parts: string[] = [`${total} block${total === 1 ? "" : "s"}`];
    const menus = counts.get("menu") ?? 0;
    const jumps = (counts.get("jump") ?? 0) + (counts.get("call") ?? 0);
    if (menus > 0) parts.push(`${menus} menu${menus === 1 ? "" : "s"}`);
    if (jumps > 0) parts.push(`${jumps} jump${jumps === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [section.body]);

  const canCollapse = !!section.label;
  const collapsed = canCollapse && isCollapsed;

  return (
    <section className={"rs-section" + (collapsed ? " is-collapsed" : "")}>
      {section.label ? (
        <header
          className={
            "rs-section-card" +
            (canCollapse ? " is-clickable" : "") +
            (collapsed ? " is-collapsed" : "")
          }
          // Click anywhere on the header to toggle — except on the label-name
          // input (editing) and the action buttons (duplicate/delete).
          onClick={(e) => {
            if (!canCollapse) return;
            const tgt = e.target as HTMLElement;
            if (tgt.closest(".rs-label-name, .rs-actions")) return;
            onToggleCollapse(section.label!.id);
          }}
          role={canCollapse ? "button" : undefined}
          aria-expanded={canCollapse ? !collapsed : undefined}
          tabIndex={canCollapse ? 0 : undefined}
          onKeyDown={(e) => {
            if (!canCollapse) return;
            if (e.key === "Enter" || e.key === " ") {
              const tgt = e.target as HTMLElement;
              if (tgt.closest(".rs-label-name")) return;
              e.preventDefault();
              onToggleCollapse(section.label!.id);
            }
          }}
        >
          <span
            className={
              "rs-section-toggle" + (collapsed ? "" : " is-open")
            }
            aria-hidden
          >
            <ChevronGlyph />
          </span>
          <span className="rs-section-keyword">label</span>
          <input
            className="rs-label-name"
            value={section.label.name}
            onChange={(e) => {
              const v = e.target.value;
              onUpdate(section.label!.id, (b) =>
                ({ ...(b as LabelBlock), name: v }) satisfies LabelBlock,
              );
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="name"
            spellCheck={false}
          />
          <span className="rs-section-colon" aria-hidden>
            :
          </span>
          {collapsed && (
            <span className="rs-section-meta-stats">{bodySummary}</span>
          )}
          <span className="rs-section-spacer" aria-hidden />
          <RowActions
            onDuplicate={() => onDuplicate(section.label!.id)}
            onDelete={() => onDelete(section.label!.id)}
          />
        </header>
      ) : (
        <header className="rs-section-card rs-section-card-prelabel">
          <span className="rs-section-keyword is-prelabel"># pre-label</span>
          <span className="rs-section-meta-stats">
            Lines before the first <code>label:</code>
          </span>
        </header>
      )}

      {!collapsed && (
        <div className="rs-section-body">
          {items.map((item) => (
            <SceneItemView
              key={
                item.kind === "scene-card"
                  ? item.scene.id
                  : item.kind === "menu-card"
                    ? item.tree.menu.id
                    : item.block.id
              }
              item={item}
              charByVar={charByVar}
              characters={characters}
              knownLabels={knownLabels}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onInsertAfter={onInsertAfter}
            />
          ))}
          <div className="rs-section-add">
            <InsertPicker
              label="+ Add block"
              allowed={SECTION_ALLOWED_KINDS}
              onPick={(kind) =>
                onInsertAfter(lastBlockId, [createEmptyBlock(kind, 1)])
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}

function ChevronGlyph() {
  // 12×12 right-pointing chevron — rotated 90° when the section is open
  // via the `.is-open` class on the parent button. Stroke-only so it
  // inherits the muted text colour.
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}

function SceneItemViewInner({
  item,
  charByVar,
  characters,
  knownLabels,
  onUpdate,
  onDelete,
  onDuplicate,
  onInsertAfter,
}: {
  item: GroupedItem;
  charByVar: Map<string, ScriptCharacter>;
  characters: ScriptCharacter[];
  knownLabels: string[];
} & CommonHandlers) {
  if (item.kind === "scene-card") {
    return (
      <SceneCard
        scene={item.scene}
        body={item.body}
        charByVar={charByVar}
        characters={characters}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onInsertAfter={onInsertAfter}
      />
    );
  }
  if (item.kind === "menu-card") {
    return (
      <MenuView
        tree={item.tree}
        charByVar={charByVar}
        knownLabels={knownLabels}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onInsertAfter={onInsertAfter}
      />
    );
  }
  return (
    <SingleBlockCard
      block={item.block}
      charByVar={charByVar}
      knownLabels={knownLabels}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
    />
  );
}

// -- Scene card (container) -------------------------------------------------

function SceneCardInner({
  scene,
  body,
  charByVar,
  characters,
  onUpdate,
  onDelete,
  onDuplicate,
  onInsertAfter,
}: {
  scene: SceneBlock;
  body: RpyBlock[];
  charByVar: Map<string, ScriptCharacter>;
  characters: ScriptCharacter[];
} & CommonHandlers) {
  const lastInBody = body.length > 0 ? body[body.length - 1].id : scene.id;
  const setScene = (next: SceneBlock) => onUpdate(scene.id, () => next);

  // The scene's "active speaker" is derived from the first say-block in the
  // body. Setting the speaker pill rewrites every say-block's char_var so
  // the whole scene speaks with one voice — matches the Figma model where a
  // scene declaration owns the dialogue that follows it. While the body has
  // no say-blocks yet, we hold the user's pick in transient local state so
  // the next "+ Dialogue" inherits it.
  const firstSay = body.find((b): b is Extract<RpyBlock, { kind: "say" }> =>
    b.kind === "say",
  );
  const [intendedSpeaker, setIntendedSpeaker] = useState<string>("");
  const activeSpeakerVar = firstSay?.char_var ?? intendedSpeaker;
  const activeSpeaker = activeSpeakerVar
    ? (charByVar.get(activeSpeakerVar) ?? null)
    : null;

  const applySpeaker = (nextVar: string) => {
    const m = charByVar.get(nextVar);
    setIntendedSpeaker(nextVar);
    for (const b of body) {
      if (b.kind === "say") {
        onUpdate(b.id, () => ({
          ...(b as Extract<RpyBlock, { kind: "say" }>),
          char_var: nextVar,
          char_id: m?.id ?? null,
          char_name: m?.name ?? nextVar,
        }));
      }
    }
  };

  // Track focus within the scene to gate the keyboard-hint reveal.
  const sceneRootRef = useRef<HTMLDivElement | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const onFocus = () => setHasFocus(true);
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!sceneRootRef.current?.contains(e.relatedTarget as Node | null)) {
      setHasFocus(false);
    }
  };

  const insertDialogue = () => {
    const m = charByVar.get(activeSpeakerVar);
    onInsertAfter(lastInBody, [
      {
        id: newBlockId(),
        kind: "say",
        depth: scene.depth,
        char_var: activeSpeakerVar,
        char_id: m?.id ?? null,
        char_name: m?.name ?? activeSpeakerVar,
        text: "",
      },
    ]);
  };

  const onSceneKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      insertDialogue();
    }
  };

  const s = useSortable(scene.id);
  const setRefs = (el: HTMLDivElement | null) => {
    s.setRef(el);
    sceneRootRef.current = el;
  };
  return (
    <div
      ref={setRefs}
      className={"rs-scene" + s.dragClassSuffix}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onSceneKeyDown}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <header className="rs-scene-head">
        <div className="rs-scene-head-left">
          <span className="rs-chip rs-chip-scene">Scene</span>
          <input
            className="rs-name-field"
            value={scene.bg}
            onChange={(e) => setScene({ ...scene, bg: e.target.value })}
            placeholder="bg_image"
            spellCheck={false}
          />
          <span className="rs-vdivider" aria-hidden />
          <SpeakerPill
            charVar={activeSpeakerVar}
            character={activeSpeaker}
            characters={characters}
            onChange={applySpeaker}
          />
        </div>
        <div className="rs-scene-head-right">
          <span className="rs-stage-kw">with</span>
          <span className="rs-pill rs-pill-amber">
            <input
              value={scene.transition ?? ""}
              onChange={(e) =>
                setScene({
                  ...scene,
                  transition: e.target.value || undefined,
                })
              }
              placeholder="dissolve"
              spellCheck={false}
            />
          </span>
          <RowActions
            onDuplicate={() => onDuplicate(scene.id)}
            onDelete={() => onDelete(scene.id)}
          />
        </div>
      </header>
      {body.length > 0 && (
        <>
          <div className="rs-scene-divider" aria-hidden />
          <div className="rs-scene-body">
            {body.map((b) => (
              <SceneBodyLine
                key={b.id}
                block={b}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
              />
            ))}
          </div>
        </>
      )}
      {hasFocus && (
        <div className="rs-kbd-hint" aria-hidden>
          <span className="rs-kbd">CTRL</span>
          <span className="rs-kbd-plus">+</span>
          <span className="rs-kbd">Enter</span>
          <span className="rs-kbd-text">New dialogue</span>
        </div>
      )}
    </div>
  );
}

/**
 * Speaker pill on the scene header. Click → the name flips to an editable
 * input; on blur we resolve the typed `rpy_var` against the cast and apply
 * the new speaker to every say-block in the scene.
 */
function SpeakerPillInner({
  charVar,
  character,
  characters,
  onChange,
}: {
  charVar: string;
  character: ScriptCharacter | null;
  characters: ScriptCharacter[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pillRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Cast members with `rpy_var` are the recommended pool. Sort linked-first
  // so the most relevant entries surface; characters without a Ren'Py var
  // appear under a "needs linking" subgroup that prompts the user to set
  // one (so the speaker can be colourised in the editor).
  const linked = useMemo(
    () => characters.filter((c) => c.rpy_var && c.rpy_var.trim()),
    [characters],
  );
  const unlinked = useMemo(
    () => characters.filter((c) => !c.rpy_var || !c.rpy_var.trim()),
    [characters],
  );

  const q = search.trim().toLowerCase();
  const filteredLinked = useMemo(() => {
    if (!q) return linked;
    return linked.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.rpy_var!.toLowerCase().includes(q),
    );
  }, [linked, q]);
  const filteredUnlinked = useMemo(() => {
    if (!q) return unlinked;
    return unlinked.filter((c) => c.name.toLowerCase().includes(q));
  }, [unlinked, q]);

  const exactMatchExists = useMemo(() => {
    if (!q) return true;
    return linked.some((c) => c.rpy_var!.toLowerCase() === q);
  }, [linked, q]);
  const canUseCustom = q && !exactMatchExists && /^[a-z_][a-z0-9_]*$/.test(q);

  const apply = (next: string) => {
    setOpen(false);
    if (next !== charVar) onChange(next);
  };

  const initial = (character?.name ?? charVar ?? "?")
    .charAt(0)
    .toUpperCase();
  const accent = character?.color ?? "#c8c7ca";
  const display = character?.name ?? charVar ?? "";

  return (
    <span
      ref={pillRef}
      className={"rs-speaker-pill" + (open ? " is-open" : "")}
      title={
        character
          ? `Linked: ${character.name} (rpy_var = ${character.rpy_var ?? charVar})`
          : charVar
            ? `Unlinked rpy_var "${charVar}" — link via Cast`
            : "Pick a speaker"
      }
    >
      <span
        className="rs-speaker-avatar"
        style={{ background: accent } as React.CSSProperties}
        aria-hidden
      >
        {character?.emoji ?? initial}
      </span>
      <button
        type="button"
        className="rs-speaker-name"
        onClick={() => setOpen((v) => !v)}
      >
        {display || <span className="rs-speaker-empty">— pick —</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={pillRef}>
        <div className="rs-speaker-pop">
          <input
            className="rs-speaker-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or rpy_var…"
            autoFocus
            spellCheck={false}
          />
          <div className="rs-speaker-pop-list">
            {filteredLinked.length > 0 && (
              <>
                {!q && (
                  <div className="rs-speaker-pop-group">From Cast</div>
                )}
                {filteredLinked.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={
                      "rs-speaker-pop-item" +
                      (c.rpy_var === charVar ? " is-active" : "")
                    }
                    onClick={() => apply(c.rpy_var!.trim())}
                  >
                    <span
                      className="rs-speaker-pop-avatar"
                      style={{ background: c.color } as React.CSSProperties}
                    >
                      {c.emoji ??
                        (c.name || c.rpy_var!).charAt(0).toUpperCase()}
                    </span>
                    <span className="rs-speaker-pop-name">{c.name}</span>
                    <code className="rs-speaker-pop-var">{c.rpy_var}</code>
                  </button>
                ))}
              </>
            )}
            {filteredUnlinked.length > 0 && (
              <>
                <div className="rs-speaker-pop-group rs-speaker-pop-group-warn">
                  Needs rpy_var — set one in Cast
                </div>
                {filteredUnlinked.map((c) => (
                  <div
                    key={c.id}
                    className="rs-speaker-pop-item rs-speaker-pop-item-disabled"
                    title="Open Cast (bottom of Script screen) and set this character's Ren'Py var"
                  >
                    <span
                      className="rs-speaker-pop-avatar"
                      style={{ background: c.color } as React.CSSProperties}
                    >
                      {c.emoji ?? c.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="rs-speaker-pop-name">{c.name}</span>
                    <span className="rs-speaker-pop-hint">no var</span>
                  </div>
                ))}
              </>
            )}
            {canUseCustom && (
              <button
                type="button"
                className="rs-speaker-pop-item rs-speaker-pop-custom"
                onClick={() => apply(q)}
              >
                <span className="rs-speaker-pop-avatar rs-speaker-pop-avatar-empty">
                  +
                </span>
                <span className="rs-speaker-pop-name">
                  Use <code>{q}</code>
                </span>
                <span className="rs-speaker-pop-hint">not in Cast</span>
              </button>
            )}
            {filteredLinked.length === 0 &&
              filteredUnlinked.length === 0 &&
              !canUseCustom && (
                <div className="rs-speaker-pop-empty">
                  {q
                    ? "No match. Type a valid identifier to use it anyway."
                    : "No characters yet. Add one in Cast (bottom of Script screen)."}
                </div>
              )}
            {charVar && (
              <button
                type="button"
                className="rs-speaker-pop-item rs-speaker-pop-clear"
                onClick={() => apply("")}
              >
                <span className="rs-speaker-pop-avatar rs-speaker-pop-avatar-empty">
                  ∅
                </span>
                <span className="rs-speaker-pop-name">No speaker</span>
                <span className="rs-speaker-pop-hint">narration</span>
              </button>
            )}
          </div>
        </div>
      </Popover>
    </span>
  );
}

/**
 * One body line of a scene — speaker is owned by the scene header, so a
 * line is just the dialogue text (italic for narrator, plain for say).
 */
function SceneBodyLineInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: RpyBlock;
} & Omit<CommonHandlers, "onInsertAfter">) {
  // Hooks first — Rules of Hooks. The early-return guard for the wrong block
  // kind has to live AFTER all hook calls, otherwise re-renders that switch
  // between matching/non-matching blocks would change the hook call order
  // and corrupt React's fiber state.
  const s = useSortable(block.id);

  if (block.kind !== "say" && block.kind !== "narrator") return null;

  const isNarrator = block.kind === "narrator";

  return (
    <div
      ref={s.setRef}
      className={
        "rs-scene-line" +
        (isNarrator ? " rs-scene-line-narrator" : " rs-scene-line-say") +
        s.dragClassSuffix
      }
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <textarea
        className="rs-scene-line-text"
        value={block.text}
        onChange={(e) =>
          onUpdate(block.id, () =>
            ({
              ...(block as typeof block),
              text: e.target.value,
            }) as typeof block,
          )
        }
        placeholder={isNarrator ? '"Narration…"' : "Dialogue text"}
        spellCheck
        rows={Math.min(4, Math.max(1, (block.text || "").split("\n").length))}
      />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

// -- Single block card dispatch ---------------------------------------------

function SingleBlockCardInner({
  block,
  charByVar,
  knownLabels,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: RpyBlock;
  charByVar: Map<string, ScriptCharacter>;
  knownLabels: string[];
} & Omit<CommonHandlers, "onInsertAfter">) {
  switch (block.kind) {
    case "show":
    case "hide":
      return (
        <SpriteCard
          block={block}
          charByVar={charByVar}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "with":
      return (
        <TransitionCard
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "pause":
      return (
        <PauseCard
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "note":
      return (
        <NoteCard
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "say":
      return (
        <DialogueCard
          block={block}
          charByVar={charByVar}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "narrator":
      return (
        <NarratorCard
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "jump":
    case "call":
      return (
        <FlowCard
          block={block}
          knownLabels={knownLabels}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "return":
      return (
        <ReturnCard
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "raw":
      return classifyRaw(block) === "audio" ? (
        <AudioCard
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      ) : (
        <RawCard
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      );
    case "scene":
    case "menu":
    case "label":
    case "choice":
      // Containers and nesting are handled at higher levels.
      return null;
  }
}

// -- Per-kind cards ---------------------------------------------------------

interface BlockHandlers extends Omit<CommonHandlers, "onInsertAfter"> {}

function SpriteCardInner({
  block,
  charByVar,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "show" | "hide" }>;
  charByVar: Map<string, ScriptCharacter>;
} & BlockHandlers) {
  const linked = charByVar.get(block.char);
  const accent = linked?.color;
  const setBlock = (next: typeof block) => onUpdate(block.id, () => next);
  const s = useSortable(block.id);
  return (
    <div
      className={
        `rs-card rs-card-sprite rs-card-${block.kind}` + s.dragClassSuffix
      }
      ref={s.setRef}
      style={
        accent
          ? ({ "--rs-accent": accent } as React.CSSProperties)
          : undefined
      }
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <span className={`rs-chip rs-chip-${block.kind}`}>{block.kind}</span>
      <BareInput
        value={block.char}
        onChange={(v) => setBlock({ ...block, char: v })}
        placeholder="character"
        mono
        className={
          "rs-sprite-char" + (linked ? " rs-sprite-char-linked" : "")
        }
        title={
          linked
            ? `Linked to ${linked.name}`
            : `No character with rpy_var "${block.char}"`
        }
      />
      {block.kind === "show" && (
        <BareInput
          value={block.expression ?? ""}
          onChange={(v) =>
            setBlock({ ...block, expression: v || undefined })
          }
          placeholder="expression"
          className="rs-sprite-expr"
        />
      )}
      {block.kind === "show" && (
        <>
          <span className="rs-stage-kw">at</span>
          <BareInput
            value={block.position ?? ""}
            onChange={(v) =>
              setBlock({ ...block, position: v || undefined })
            }
            placeholder="position"
          />
        </>
      )}
      <span className="rs-stage-kw">with</span>
      <BareInput
        value={block.transition ?? ""}
        onChange={(v) =>
          setBlock({ ...block, transition: v || undefined })
        }
        placeholder="dissolve"
      />
      <span style={{ flex: 1 }} />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

function TransitionCardInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "with" }>;
} & BlockHandlers) {
  const s = useSortable(block.id);
  return (
    <div
      className={"rs-card rs-card-transition" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <span className="rs-chip rs-chip-with">with</span>
      <BareInput
        value={block.transition}
        onChange={(v) =>
          onUpdate(block.id, () => ({ ...block, transition: v }))
        }
        placeholder="dissolve"
      />
      <span style={{ flex: 1 }} />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

function PauseCardInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "pause" }>;
} & BlockHandlers) {
  const s = useSortable(block.id);
  return (
    <div
      className={"rs-card rs-card-pause" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <span className="rs-chip rs-chip-pause">pause</span>
      <BareInput
        value={block.duration !== undefined ? String(block.duration) : ""}
        onChange={(v) => {
          const trimmed = v.trim();
          if (trimmed === "") {
            onUpdate(block.id, () => ({ ...block, duration: undefined }));
            return;
          }
          const n = parseFloat(trimmed);
          onUpdate(block.id, () => ({
            ...block,
            duration: Number.isFinite(n) ? n : block.duration,
          }));
        }}
        placeholder="(forever)"
      />
      <span className="rs-stage-kw">s</span>
      <span style={{ flex: 1 }} />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

function ReturnCardInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "return" }>;
} & BlockHandlers) {
  const s = useSortable(block.id);
  return (
    <div
      className={"rs-card rs-card-return" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <span className="rs-chip rs-chip-return">return</span>
      <BareInput
        value={block.expression ?? ""}
        onChange={(v) => {
          const trimmed = v.trim();
          onUpdate(block.id, () => ({
            ...block,
            expression: trimmed === "" ? undefined : v,
          }));
        }}
        placeholder="(optional expression)"
      />
      <span style={{ flex: 1 }} />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

function NoteCardInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "note" }>;
} & BlockHandlers) {
  const s = useSortable(block.id);
  return (
    <div
      className={"rs-card rs-card-note" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <span className="rs-chip rs-chip-note">note</span>
      <span className="rs-note-hash">#</span>
      <BareInput
        value={block.text}
        onChange={(v) => onUpdate(block.id, () => ({ ...block, text: v }))}
        placeholder="comment (not rendered in game)"
        grow
        className="rs-note-text"
      />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

function DialogueCardInner({
  block,
  charByVar,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "say" }>;
  charByVar: Map<string, ScriptCharacter>;
} & BlockHandlers) {
  const linked = charByVar.get(block.char_var);
  const accent = linked?.color;
  const initials = (linked?.name ?? block.char_var ?? "?")
    .slice(0, 1)
    .toUpperCase();
  const s = useSortable(block.id);
  return (
    <div
      className={
        "rs-card rs-card-dialogue" +
        (linked ? "" : " rs-card-dialogue-unlinked") +
        s.dragClassSuffix
      }
      ref={s.setRef}
      style={
        accent
          ? ({ "--rs-accent": accent } as React.CSSProperties)
          : undefined
      }
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <div className="rs-card-dialogue-head">
        <div
          className="rs-dialogue-avatar"
          aria-hidden
          title={linked ? `Linked to ${linked.name}` : "No character linked"}
        >
          {linked?.emoji ?? initials}
        </div>
        <BareInput
          value={block.char_var}
          onChange={(v) =>
            onUpdate(block.id, () => {
              const m = charByVar.get(v);
              return {
                ...block,
                char_var: v,
                char_id: m?.id ?? null,
                char_name: m?.name ?? v,
              };
            })
          }
          placeholder="speaker"
          className="rs-dialogue-speaker"
          title={
            linked
              ? `Linked to ${linked.name}`
              : `No character with rpy_var "${block.char_var}" — link via Cast`
          }
        />
        <BareInput
          value={block.expression ?? ""}
          onChange={(v) =>
            onUpdate(block.id, () => ({
              ...block,
              expression: v || undefined,
            }))
          }
          placeholder="(expression)"
          className="rs-dialogue-expr"
        />
        <span style={{ flex: 1 }} />
        <RowActions
          onDuplicate={() => onDuplicate(block.id)}
          onDelete={() => onDelete(block.id)}
        />
      </div>
      <BareTextarea
        value={block.text}
        onChange={(v) => onUpdate(block.id, () => ({ ...block, text: v }))}
        placeholder="Dialogue line…"
        className="rs-dialogue-text"
      />
    </div>
  );
}

function NarratorCardInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "narrator" }>;
} & BlockHandlers) {
  const s = useSortable(block.id);
  return (
    <div
      className={"rs-card rs-card-narrator" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <span className="rs-chip rs-chip-narrator">narrator</span>
      <BareTextarea
        value={block.text}
        onChange={(v) => onUpdate(block.id, () => ({ ...block, text: v }))}
        placeholder='"Narration…"'
        className="rs-narrator-text"
      />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

function FlowCardInner({
  block,
  knownLabels,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: Extract<RpyBlock, { kind: "jump" | "call" }>;
  knownLabels: string[];
} & BlockHandlers) {
  const isBroken =
    block.target.trim().length > 0 && !knownLabels.includes(block.target);
  const s = useSortable(block.id);
  return (
    <div
      className={
        "rs-card rs-card-flow" +
        (isBroken ? " is-broken" : "") +
        s.dragClassSuffix
      }
      ref={s.setRef}
      title={isBroken ? "Target not found in this project" : undefined}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <span className={`rs-chip rs-chip-${block.kind}`}>{block.kind}</span>
      <span className="rs-flow-arrow" aria-hidden>
        →
      </span>
      <LabelAutocomplete
        value={block.target}
        options={knownLabels}
        onChange={(v) =>
          onUpdate(block.id, () => ({ ...block, target: v }))
        }
        placeholder="target_label"
      />
      {isBroken && (
        <span className="rs-flow-broken" title="No matching label found">
          ⚠
        </span>
      )}
      <span style={{ flex: 1 }} />
      <RowActions
        onDuplicate={() => onDuplicate(block.id)}
        onDelete={() => onDelete(block.id)}
      />
    </div>
  );
}

/**
 * Inline label autocomplete: a small text input that on focus/typing opens a
 * popover with matching project labels. Keyboard navigable: ↑/↓ moves the
 * highlight, Enter commits, Escape closes. Clicking outside reverts to
 * whatever was typed (so a custom new label name is still permitted).
 */
function LabelAutocomplete({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const o of options) {
      const k = o.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      if (!q || k.includes(q)) out.push(o);
      if (out.length >= 12) break;
    }
    return out;
  }, [options, value]);

  useEffect(() => {
    setHighlight(0);
  }, [filtered.length]);

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onChange(filtered[highlight]);
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <span className="rs-label-ac">
      <input
        ref={inputRef}
        className="rs-input rs-input-mono rs-flow-target"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        onBlur={() => {
          // Defer close to allow click on a suggestion to register first.
          setTimeout(() => setOpen(false), 100);
        }}
        placeholder={placeholder}
        spellCheck={false}
      />
      {open && filtered.length > 0 && (
        <span className="rs-label-ac-pop" role="listbox">
          {filtered.map((opt, i) => (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={
                "rs-label-ac-item" + (i === highlight ? " is-active" : "")
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              <code>{opt}</code>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

type AudioVariant = "music" | "sound" | "stop" | "voice";

function getAudioVariant(parsed: ParsedAudio): AudioVariant {
  if (parsed.verb === "stop") return "stop";
  if (parsed.verb === "voice") return "voice";
  if (parsed.channel === "music") return "music";
  if (parsed.channel === "sound") return "sound";
  if (parsed.channel === "voice") return "voice";
  // Custom channels fall back to neutral sound styling.
  return "sound";
}

function audioCardLabel(parsed: ParsedAudio): string {
  if (parsed.verb === "stop") {
    if (parsed.channel === "music") return "Stop Music";
    if (parsed.channel === "sound") return "Stop Sound";
    if (parsed.channel === "voice") return "Stop Voice";
    return parsed.channel ? `Stop ${cap(parsed.channel)}` : "Stop";
  }
  if (parsed.verb === "voice") return "Voice";
  return cap(parsed.channel || parsed.verb);
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function AudioCardInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: RawBlock;
} & BlockHandlers) {
  const parsed = parseAudioHead(block.head);
  const variant = getAudioVariant(parsed);
  const isStop = parsed.verb === "stop";

  // Re-emit the raw block's lines whenever the user edits a structured field.
  const setAudio = (next: ParsedAudio) => {
    const head = serializeAudio(next);
    onUpdate(block.id, () => {
      const rb = block;
      const newLines =
        rb.lines.length === 0 ? [head] : [head, ...rb.lines.slice(1)];
      return { ...rb, head, lines: newLines };
    });
  };

  // Fade mode is whichever side currently holds a value — `fadein` and
  // `fadeout` are mutually exclusive in our model. The toggle button flips
  // the existing value to the other side, so a user can switch direction
  // without losing the duration they've typed.
  const fadeMode: "fadein" | "fadeout" =
    parsed.fadein !== undefined
      ? "fadein"
      : parsed.fadeout !== undefined
        ? "fadeout"
        : isStop
          ? "fadeout"
          : "fadein";
  const fadeValue = parsed.fadein ?? parsed.fadeout;

  const toggleFade = () => {
    if (fadeMode === "fadein") {
      setAudio({
        ...parsed,
        fadein: undefined,
        fadeout: fadeValue ?? "",
      });
    } else {
      setAudio({
        ...parsed,
        fadein: fadeValue ?? "",
        fadeout: undefined,
      });
    }
  };

  const setFadeValue = (v: string | undefined) => {
    if (fadeMode === "fadein") {
      setAudio({ ...parsed, fadein: v, fadeout: undefined });
    } else {
      setAudio({ ...parsed, fadein: undefined, fadeout: v });
    }
  };

  const s = useSortable(block.id);
  return (
    <div
      className={
        `rs-card rs-card-audio rs-card-audio--${variant}` + s.dragClassSuffix
      }
      ref={s.setRef}
      title={block.head}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <div className="rs-audio-main">
        <span className={`rs-chip rs-chip-audio--${variant}`}>
          {audioCardLabel(parsed)}
        </span>
        {!isStop && (
          <input
            className="rs-audio-arg"
            value={parsed.file}
            onChange={(e) => setAudio({ ...parsed, file: e.target.value })}
            placeholder="path/to/track.mp3"
            spellCheck={false}
          />
        )}
      </div>
      <div className="rs-audio-tail">
        <button
          type="button"
          className="rs-pill rs-pill-toggle"
          onClick={toggleFade}
          title="Toggle between fadein and fadeout"
        >
          {fadeMode}
        </button>
        <span className="rs-audio-arrow" aria-hidden>
          →
        </span>
        <FadeValuePill value={fadeValue} onChange={setFadeValue} />
        <RowActions
          onDuplicate={() => onDuplicate(block.id)}
          onDelete={() => onDelete(block.id)}
        />
      </div>
    </div>
  );
}

function FadeValuePill({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <span className="rs-pill" title="duration in seconds">
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="0.5"
        spellCheck={false}
        style={{ minWidth: 32 }}
      />
    </span>
  );
}

interface ParsedAudio {
  verb: "play" | "stop" | "queue" | "voice";
  channel: string;
  file: string;
  fadein?: string;
  fadeout?: string;
}

const AUDIO_VERBS = ["play", "stop", "queue", "voice"] as const;

function parseAudioHead(head: string): ParsedAudio {
  // Examples:
  //   play music "track.mp3" fadein 0.5
  //   stop music fadeout 1.0
  //   voice "line.ogg"
  const tokens = head.match(/"[^"]*"|\S+/g) ?? [];
  const verb = (
    AUDIO_VERBS.includes(tokens[0] as (typeof AUDIO_VERBS)[number])
      ? tokens[0]
      : "play"
  ) as ParsedAudio["verb"];

  // For `voice` there's no channel — file follows directly.
  let cursor = 1;
  let channel = "";
  if (verb !== "voice" && tokens[cursor] && !tokens[cursor].startsWith('"')) {
    channel = tokens[cursor];
    cursor++;
  }

  // File path is the next quoted string.
  let file = "";
  if (tokens[cursor]?.startsWith('"')) {
    file = tokens[cursor].slice(1, -1);
    cursor++;
  }

  // Optional `fadein N` / `fadeout N` clauses (in any order).
  let fadein: string | undefined;
  let fadeout: string | undefined;
  while (cursor < tokens.length) {
    const t = tokens[cursor];
    if (t === "fadein" && tokens[cursor + 1]) {
      fadein = tokens[cursor + 1];
      cursor += 2;
    } else if (t === "fadeout" && tokens[cursor + 1]) {
      fadeout = tokens[cursor + 1];
      cursor += 2;
    } else {
      cursor++;
    }
  }

  return { verb, channel, file, fadein, fadeout };
}

function serializeAudio(a: ParsedAudio): string {
  const parts: string[] = [a.verb];
  if (a.verb !== "voice" && a.channel) parts.push(a.channel);
  if (a.file) parts.push(`"${a.file}"`);
  if (a.fadein) parts.push("fadein", a.fadein);
  if (a.fadeout) parts.push("fadeout", a.fadeout);
  return parts.join(" ");
}

function RawCardInner({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: RawBlock;
} & BlockHandlers) {
  // Local draft buffer so users can edit multi-line text fluently without
  // re-splitting on every keystroke. On blur we commit to the block's
  // `lines` array and refresh the head (first non-blank line) so the chip
  // label and audio-classification stay accurate.
  const initial = block.lines.join("\n");
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    setDraft(block.lines.join("\n"));
  }, [block.id, block.lines]);

  const commit = () => {
    if (draft === initial) return;
    const lines = draft.replace(/\r\n/g, "\n").split("\n");
    const firstNonBlank = lines.find((l) => l.trim().length > 0)?.trim() ?? "";
    onUpdate(block.id, () => ({
      ...block,
      lines,
      head: firstNonBlank,
    }));
  };

  const s = useSortable(block.id);
  return (
    <div
      className={"rs-card rs-card-raw" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <div className="rs-raw-head">
        <span className="rs-chip rs-chip-raw">raw</span>
        <span className="rs-raw-summary">
          {draft.split("\n").length} line
          {draft.split("\n").length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1 }} />
        <RowActions
          onDuplicate={() => onDuplicate(block.id)}
          onDelete={() => onDelete(block.id)}
        />
      </div>
      <textarea
        className="rs-raw-area"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        spellCheck={false}
        rows={Math.min(20, Math.max(1, draft.split("\n").length))}
        placeholder="$ flag = True"
      />
    </div>
  );
}

// -- Menu container ---------------------------------------------------------

function MenuViewInner({
  tree,
  charByVar,
  knownLabels,
  onUpdate,
  onDelete,
  onDuplicate,
  onInsertAfter,
}: {
  tree: MenuTree;
  charByVar: Map<string, ScriptCharacter>;
  knownLabels: string[];
} & CommonHandlers) {
  const lastChoiceBodyId = (() => {
    const last = tree.choices[tree.choices.length - 1];
    if (!last) return tree.menu.id;
    if (last.body.length === 0) return last.choice.id;
    return last.body[last.body.length - 1].id;
  })();

  const s = useSortable(tree.menu.id);
  return (
    <div
      className={"rs-menu" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <header className="rs-menu-head">
        <span className="rs-chip rs-chip-menu">menu</span>
        <span className="rs-menu-title">
          {tree.choices.length} choice
          {tree.choices.length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1 }} />
        <RowActions
          onDuplicate={() => onDuplicate(tree.menu.id)}
          onDelete={() => onDelete(tree.menu.id)}
        />
      </header>
      <div className="rs-menu-body">
        {tree.choices.length === 0 ? (
          <div className="rs-menu-empty">No choices yet</div>
        ) : (
          tree.choices.map((c) => (
            <ChoiceView
              key={c.choice.id}
              entry={c}
              menu={tree.menu}
              charByVar={charByVar}
              knownLabels={knownLabels}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onInsertAfter={onInsertAfter}
            />
          ))
        )}
        <button
          type="button"
          className="rs-menu-add"
          onClick={() =>
            onInsertAfter(lastChoiceBodyId, [
              createEmptyBlock("choice", tree.menu.depth + 1),
            ])
          }
        >
          + Add choice
        </button>
      </div>
    </div>
  );
}

function ChoiceViewInner({
  entry,
  menu,
  charByVar,
  knownLabels,
  onUpdate,
  onDelete,
  onDuplicate,
  onInsertAfter,
}: {
  entry: { choice: ChoiceBlock; body: RpyBlock[] };
  menu: MenuBlock;
  charByVar: Map<string, ScriptCharacter>;
  knownLabels: string[];
} & CommonHandlers) {
  const choiceBodyDepth = menu.depth + 2;
  const lastInChoiceBody =
    entry.body.length > 0
      ? entry.body[entry.body.length - 1].id
      : entry.choice.id;

  const s = useSortable(entry.choice.id);
  return (
    <div
      className={"rs-choice" + s.dragClassSuffix}
      ref={s.setRef}
    >
      <DragHandle setHandleRef={s.setHandleRef} />
      <div className="rs-choice-head">
        <span className="rs-choice-bullet" aria-hidden>
          ▶
        </span>
        <BareInput
          value={entry.choice.text}
          onChange={(v) =>
            onUpdate(entry.choice.id, (b) =>
              ({ ...(b as ChoiceBlock), text: v }) satisfies ChoiceBlock,
            )
          }
          placeholder="Choice text"
          grow
          className="rs-choice-text"
        />
        <span className="rs-stage-kw">if</span>
        <BareInput
          value={entry.choice.condition ?? ""}
          onChange={(v) =>
            onUpdate(entry.choice.id, (b) =>
              ({
                ...(b as ChoiceBlock),
                condition: v || undefined,
              }) satisfies ChoiceBlock,
            )
          }
          placeholder="(condition)"
        />
        <RowActions
          onDuplicate={() => onDuplicate(entry.choice.id)}
          onDelete={() => onDelete(entry.choice.id)}
        />
      </div>
      <div className="rs-choice-body">
        {entry.body.map((b) => (
          <SingleBlockCard
            key={b.id}
            block={b}
            charByVar={charByVar}
            knownLabels={knownLabels}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
          />
        ))}
        <div className="rs-choice-add">
          <InsertPicker
            label="+ Add"
            allowed={CHOICE_BODY_ALLOWED_KINDS}
            onPick={(kind) =>
              onInsertAfter(lastInChoiceBody, [
                createEmptyBlock(kind, choiceBodyDepth),
              ])
            }
          />
        </div>
      </div>
    </div>
  );
}

// -- Inputs (bare, look-like-text) -----------------------------------------

interface BareInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  grow?: boolean;
  className?: string;
  title?: string;
}

function BareInput({
  value,
  onChange,
  placeholder,
  mono,
  grow,
  className,
  title,
}: BareInputProps) {
  const cls =
    "rs-input" +
    (mono ? " rs-input-mono" : "") +
    (grow ? " rs-input-grow" : "") +
    (className ? " " + className : "");
  return (
    <input
      type="text"
      className={cls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      title={title}
      spellCheck={false}
    />
  );
}

function BareTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <textarea
      className={"rs-area" + (className ? " " + className : "")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={Math.min(6, Math.max(1, value.split("\n").length))}
      spellCheck
    />
  );
}

// -- Row actions ------------------------------------------------------------

function RowActions({
  onDuplicate,
  onDelete,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="rs-actions">
      <ActionButton title="Duplicate" onClick={onDuplicate}>
        ⎘
      </ActionButton>
      <ActionButton title="Delete" danger onClick={onDelete}>
        ×
      </ActionButton>
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={"rs-action" + (danger ? " rs-action-danger" : "")}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

// -- Insert picker ----------------------------------------------------------

const KIND_LABEL: Record<RpyBlockKind, string> = {
  label: "label",
  scene: "scene",
  show: "show",
  hide: "hide",
  say: "dialogue",
  narrator: "narrator",
  menu: "menu",
  choice: "choice",
  jump: "jump",
  call: "call",
  return: "return",
  with: "with",
  pause: "pause",
  note: "note",
  raw: "raw",
};

const KIND_HINT: Record<RpyBlockKind, string> = {
  label: "Scene boundary (jumpable)",
  scene: "Background image — opens a new scene container",
  show: "Show character sprite",
  hide: "Hide character sprite",
  say: "Character dialogue",
  narrator: "Narration / no speaker",
  menu: "Branching menu",
  choice: "Menu option",
  jump: "Go to label",
  call: "Call label, will return",
  return: "Return to caller (or end story)",
  with: "Standalone transition",
  pause: "Pause timing",
  note: "Comment, ignored by Ren'Py",
  raw: "Raw Ren'Py",
};

const SECTION_ALLOWED_KINDS: RpyBlockKind[] = [
  "scene",
  "menu",
  "say",
  "narrator",
  "show",
  "hide",
  "with",
  "pause",
  "note",
  "jump",
  "call",
  "return",
  // `raw` is the escape hatch for anything the structured editor doesn't
  // model — `if`/`elif`/`else`, `$ flag = …`, `python:`, `screen`, `play`,
  // etc. We expose it as a normal insertable so authors can drop these
  // in without round-tripping through a paste.
  "raw",
];

// Strict: scene container holds only dialogue (say + narrator). All other
// kinds — audio/show/hide/pause/note/jump/call/raw — live at section level.
// The scene-add UI uses dedicated `+ Dialogue` / `+ Narrator` buttons,
// so no general InsertPicker allow-list is needed for scene bodies.

const CHOICE_BODY_ALLOWED_KINDS: RpyBlockKind[] = [
  "say",
  "narrator",
  "show",
  "hide",
  "with",
  "pause",
  "note",
  "jump",
  "call",
  "return",
  "raw",
];

function InsertPicker({
  label,
  allowed,
  onPick,
}: {
  label: string;
  allowed: RpyBlockKind[];
  onPick: (kind: RpyBlockKind) => void;
}) {
  const groups = useMemo(() => {
    const all = allowed.map((k) => ({ kind: k, group: groupOf(k) }));
    return [
      { title: "Text", items: all.filter((x) => x.group === "Text") },
      { title: "Stage", items: all.filter((x) => x.group === "Stage") },
      { title: "Flow", items: all.filter((x) => x.group === "Flow") },
    ].filter((g) => g.items.length > 0);
  }, [allowed]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rs-insert-trigger">
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {groups.map((g, gi) => (
          <div key={g.title}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{g.title}</DropdownMenuLabel>
            {g.items.map((it) => (
              <DropdownMenuItem
                key={it.kind}
                onSelect={() => onPick(it.kind)}
              >
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 500 }}>
                    {KIND_LABEL[it.kind]}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {KIND_HINT[it.kind]}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function groupOf(k: RpyBlockKind): "Text" | "Stage" | "Flow" {
  if (k === "say" || k === "narrator" || k === "note") return "Text";
  if (
    k === "scene" ||
    k === "show" ||
    k === "hide" ||
    k === "with" ||
    k === "pause"
  )
    return "Stage";
  return "Flow";
}

// -- Misc -------------------------------------------------------------------

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="rs-warnings">
      <strong>{warnings.length} warning(s):</strong>
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Classify a raw block by its leading keyword. Audio raws (`play`/`stop`/
 * `queue`/`voice`) get a dedicated card style; everything else falls back
 * to the generic code-block raw card.
 */
function classifyRaw(block: RawBlock): "audio" | "misc" {
  return /^(play|stop|queue|voice)\b/.test(block.head) ? "audio" : "misc";
}

/**
 * Migrate legacy `say` blocks whose `char_var` is an audio statement keyword
 * (`play`/`stop`/`queue`/`voice`) into proper raw blocks. Older versions of
 * the parser would mis-classify `play music "x.mp3"` as dialogue with a
 * speaker called "play" — those rows live in the DB now and need fixing on
 * load so they re-render as Audio cards instead of corrupt dialogue.
 *
 * Once the user touches an affected block the normalised raw form is what
 * gets persisted, so this pass is effectively a one-shot per-scene migration.
 */
const AUDIO_VERB_SET = new Set(["play", "stop", "queue", "voice"]);

function normalizeBlocks(blocks: RpyBlocks): RpyBlocks {
  return blocks.map((b) => {
    if (b.kind !== "say") return b;
    if (!AUDIO_VERB_SET.has(b.char_var)) return b;
    const verb = b.char_var;
    const channel = b.expression?.trim();
    const file = b.text;
    const head = channel
      ? `${verb} ${channel} "${file}"`
      : `${verb} "${file}"`;
    return {
      id: b.id,
      kind: "raw",
      depth: b.depth,
      lines: [head],
      head,
    } satisfies RawBlock;
  });
}

function createEmptyBlock(kind: RpyBlockKind, depth: number): RpyBlock {
  const id = newBlockId();
  switch (kind) {
    case "label":
      return { id, kind, depth: 0, name: "" };
    case "scene":
      return { id, kind, depth, bg: "" };
    case "show":
      return { id, kind, depth, char: "" };
    case "hide":
      return { id, kind, depth, char: "" };
    case "say":
      return {
        id,
        kind,
        depth,
        char_var: "",
        char_id: null,
        char_name: "",
        text: "",
      };
    case "narrator":
      return { id, kind, depth, text: "" };
    case "menu":
      return { id, kind, depth };
    case "choice":
      return { id, kind, depth, text: "" };
    case "jump":
      return { id, kind, depth, target: "" };
    case "call":
      return { id, kind, depth, target: "" };
    case "return":
      return { id, kind, depth };
    case "with":
      return { id, kind, depth, transition: "" };
    case "pause":
      return { id, kind, depth };
    case "note":
      return { id, kind, depth, text: "" };
    case "raw":
      return { id, kind, depth, lines: [""], head: "" };
  }
}

// ---------------------------------------------------------------------------
// Memo wrappers
//
// Every heavy component in this file is exported only through `memo()` so
// reorders, edits and drag operations re-render just the affected cards
// instead of the entire scene (500+ blocks for `Time Heals`-sized scripts).
// The `*Inner` functions are the implementations; the exported names below
// are what JSX references. Note: const initialization happens at module load
// before RenpyTable is ever called, so the JSX usage above resolves cleanly.
// ---------------------------------------------------------------------------

const DragHandle = memo(DragHandleInner);
const SectionView = memo(SectionViewInner);
const SceneItemView = memo(SceneItemViewInner);
const SceneCard = memo(SceneCardInner);
const SpeakerPill = memo(SpeakerPillInner);
const SceneBodyLine = memo(SceneBodyLineInner);
const SingleBlockCard = memo(SingleBlockCardInner);
const SpriteCard = memo(SpriteCardInner);
const TransitionCard = memo(TransitionCardInner);
const PauseCard = memo(PauseCardInner);
const ReturnCard = memo(ReturnCardInner);
const NoteCard = memo(NoteCardInner);
const DialogueCard = memo(DialogueCardInner);
const NarratorCard = memo(NarratorCardInner);
const FlowCard = memo(FlowCardInner);
const AudioCard = memo(AudioCardInner);
const RawCard = memo(RawCardInner);
const MenuView = memo(MenuViewInner);
const ChoiceView = memo(ChoiceViewInner);
