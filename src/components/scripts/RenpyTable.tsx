import {
  createContext,
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
function DragHandle({
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

  // Only resync local state when the *node* changes — depending on
  // `initialBlocks` here would clobber unsaved local edits during the
  // upstream save debounce window: any parent re-render in that window
  // (cast realtime, savedAgo tick, etc.) reuses the still-stale
  // `node.rpy_blocks`, and a race like that wipes a freshly-pasted scene.
  // The trade-off is that external updates to the same scene (other user,
  // other tab) won't auto-merge — same behavior as the TipTap Doc editor.
  useEffect(() => {
    setBlocks(normalizeBlocks(initialBlocks ?? []));
    setPasteText("");
    setPasteWarnings([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

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

  const apply = (next: RpyBlocks) => {
    setBlocks(next);
    onChange(next);
  };

  const updateById = (id: string, mut: (b: RpyBlock) => RpyBlock) => {
    apply(blocks.map((b) => (b.id === id ? mut(b) : b)));
  };

  const deleteById = (id: string) => {
    apply(blocks.filter((b) => b.id !== id));
  };

  const duplicateById = (id: string) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const clone: RpyBlock = { ...blocks[idx], id: newBlockId() };
    const next = blocks.slice();
    next.splice(idx + 1, 0, clone);
    apply(next);
  };

  const insertAfter = (afterId: string | null, newBlocks: RpyBlock[]) => {
    if (newBlocks.length === 0) return;
    if (afterId === null) {
      apply([...blocks, ...newBlocks]);
      return;
    }
    const idx = blocks.findIndex((b) => b.id === afterId);
    if (idx === -1) {
      apply([...blocks, ...newBlocks]);
      return;
    }
    const next = blocks.slice();
    next.splice(idx + 1, 0, ...newBlocks);
    apply(next);
  };

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

      {sections.map((section, si) => (
        // Pass characters in so deep components (SpeakerPill) can offer Cast-based autocompletion.
        <SectionView
          key={section.label?.id ?? `orphan-${si}`}
          section={section}
          charByVar={charByVar}
          characters={characters}
          knownLabels={knownLabels}
          onUpdate={updateById}
          onDelete={deleteById}
          onDuplicate={duplicateById}
          onInsertAfter={insertAfter}
        />
      ))}

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
    </div>
    </IndexCtx.Provider>
    </DragDropProvider>
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

function SectionView({
  section,
  charByVar,
  characters,
  knownLabels,
  onUpdate,
  onDelete,
  onDuplicate,
  onInsertAfter,
}: {
  section: Section;
  charByVar: Map<string, ScriptCharacter>;
  characters: ScriptCharacter[];
  knownLabels: string[];
} & CommonHandlers) {
  const lastBlockId =
    section.body.length > 0
      ? section.body[section.body.length - 1].id
      : section.label?.id ?? null;

  const items = useMemo(() => groupSceneItems(section.body), [section.body]);

  return (
    <section className="rs-section">
      {section.label ? (
        <header className="rs-section-head">
          <span className="rs-section-label-prefix">Label</span>
          <input
            className="rs-label-name"
            value={section.label.name}
            onChange={(e) => {
              const v = e.target.value;
              onUpdate(section.label!.id, (b) =>
                ({ ...(b as LabelBlock), name: v }) satisfies LabelBlock,
              );
            }}
            placeholder="label_name"
            spellCheck={false}
          />
          <span className="rs-section-divider" aria-hidden />
          <RowActions
            onDuplicate={() => onDuplicate(section.label!.id)}
            onDelete={() => onDelete(section.label!.id)}
          />
        </header>
      ) : (
        <header className="rs-section-head">
          <span className="rs-section-label-prefix">Pre-label</span>
          <span className="rs-section-divider" aria-hidden />
        </header>
      )}

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
    </section>
  );
}

function SceneItemView({
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

function SceneCard({
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
function SpeakerPill({
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
function SceneBodyLine({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  block: RpyBlock;
} & Omit<CommonHandlers, "onInsertAfter">) {
  if (block.kind !== "say" && block.kind !== "narrator") return null;

  const isNarrator = block.kind === "narrator";
  const s = useSortable(block.id);

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

function SingleBlockCard({
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

function SpriteCard({
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

function TransitionCard({
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

function PauseCard({
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

function NoteCard({
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

function DialogueCard({
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

function NarratorCard({
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

function FlowCard({
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

function AudioCard({
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

function RawCard({
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

function MenuView({
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

function ChoiceView({
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
];

// Strict: scene container holds only dialogue (say + narrator). All other
// kinds — audio/show/hide/pause/note/jump/call — live at section level.
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
