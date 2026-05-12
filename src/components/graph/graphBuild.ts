/**
 * Pure transformation from `script_nodes` rows into xyflow graph nodes + edges.
 * No fetching, no rendering — call site supplies the data, this file decides
 * what becomes a node, what becomes an edge, and which edges are broken.
 *
 * Nodes are LABELS, not scenes. A single scene's rpy_blocks can contain
 * multiple `label foo:` blocks at depth 0; each one becomes an independent
 * graph node addressable by `jump foo` / `call foo`. Scenes with `rpy_label`
 * set but no in-blocks label become an "implicit" label segment covering
 * the whole scene body.
 *
 * Edges come from three sources:
 *   1. `jump` / `call` blocks (direct flow control)
 *   2. `jump` / `call` inside `menu → choice` (carries choiceText for the edge label)
 *   3. `jump` / `call` inside `if` / `elif` / `else` RawBlocks (conditional;
 *      head text becomes the edge label, edge rendered dashed)
 *
 * Targets are resolved against the project's `labelName → segment_id` index.
 * Unresolvable targets produce broken edges (kept for stats but excluded from
 * dagre layout — they'd crash it with missing-node errors).
 */

import type {
  LabelBlock,
  RawBlock,
  RpyBlock,
  RpyBlocks,
} from "../../lib/renpy/blocks";
import { collectOutboundRefs } from "../../lib/renpy/blocks";

export interface GraphSourceRow {
  id: string;
  parent_id: string | null;
  kind: "chapter" | "scene" | "block";
  title: string;
  emoji: string | null;
  status: string;
  position: number;
  rpy_label: string | null;
  rpy_blocks: RpyBlocks | null;
}

export interface GraphNodeData {
  /** Unique node id == the Ren'Py label name (labels are project-unique). */
  id: string;
  /** The label name (== id, kept for clarity at render sites). */
  label: string;
  /** Title of the scene this label sits in. Provides context only. */
  sceneTitle: string;
  /** id of the script_node (scene) — used for navigation back to the editor. */
  sceneId: string;
  /** Emoji of the parent scene, surfaced as a small glyph next to the label. */
  emoji: string | null;
  /** Status of the parent scene. */
  status: string;
  /** Enclosing chapter title, walked up the parent chain. Null at top level. */
  chapter: string | null;
  /** Count of outbound refs from this label segment (jump+call+conditional). */
  outboundCount: number;
  /** Count of outbound refs whose target label isn't found in the project. */
  brokenOutboundCount: number;
  /** Texts of every `menu` choice present inside this segment, in order.
   *  Covers choices that change flow (have a jump/call inside — those also
   *  become labelled edges) AND "variable-only" choices that just set a
   *  flag and continue execution. Without this the latter would vanish
   *  from the graph entirely. */
  choiceTexts: string[];
  /** True when this label is the implicit whole-scene fallback (no label
   *  block in rpy_blocks, derived from script_nodes.rpy_label only). */
  isImplicit: boolean;
  /** True for the project's entry point — the first label by tree order.
   *  Surfaced in the UI as a "START" marker so you can find where the
   *  story actually begins at a glance. */
  isEntry: boolean;
  /** True when no other label in the project jumps/calls/branches into
   *  this one. The entry point is excluded from this flag. */
  isUnreachable: boolean;
}

export type EdgeOrigin =
  | "jump"
  | "call"
  | "menu"
  | "conditional"
  /** Implicit edge between two consecutive labels in the same scene when
   *  the source label doesn't terminate with a jump/return — Ren'Py
   *  execution falls through to the next label in file order. */
  | "fallthrough";

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  origin: EdgeOrigin;
  /** Choice text when origin = "menu". Free text from the choice block. */
  choiceText?: string;
  /** Condition text when origin = "conditional", e.g. `if foo == True`. */
  condition?: string;
  /** True when the target label doesn't exist in the project. */
  broken: boolean;
  /** When broken, the original target label string for the UI. */
  brokenTarget?: string;
}

export interface GraphBuildResult {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  stats: {
    labelCount: number;
    edgeCount: number;
    brokenEdgeCount: number;
    /** Labels with no inbound edge from any other label. The very first
     *  label in tree-order is treated as reachable (project entry point). */
    unreachableCount: number;
    conditionalEdgeCount: number;
  };
}

interface LabelSegment {
  name: string;
  sceneId: string;
  sceneTitle: string;
  emoji: string | null;
  status: string;
  /** Index in the scene's rpy_blocks where this segment starts (exclusive
   *  of the label block itself when present). Used for `collectOutboundRefs`
   *  so refs from another segment's blocks don't leak into this one. */
  blocks: RpyBlocks;
  /** Original tree order: chapter position * 1e6 + scene position; for
   *  deterministic "entry point" pick. */
  order: number;
  isImplicit: boolean;
}

export function buildGraph(rows: GraphSourceRow[]): GraphBuildResult {
  const byId = new Map<string, GraphSourceRow>();
  for (const r of rows) byId.set(r.id, r);

  const chapterOf = (id: string): string | null => {
    let cur: GraphSourceRow | undefined = byId.get(id);
    while (cur) {
      if (cur.kind === "chapter") return cur.title;
      if (!cur.parent_id) return null;
      cur = byId.get(cur.parent_id);
    }
    return null;
  };

  // -- 1. Extract label segments from all scenes ---------------------------

  const scenes = rows
    .filter((r) => r.kind === "scene")
    .sort((a, b) => a.position - b.position);

  // Dedupe by label name as we collect: in well-formed Ren'Py projects a
  // label name is project-unique, but imports of work-in-progress scripts
  // can produce duplicates (e.g. the same .rpy imported twice into different
  // scenes). Keep the first occurrence — same policy as the engine's own
  // "label X is defined twice" resolution — and silently drop the rest.
  // Without this dedup the graph would emit duplicate React keys for the
  // shared label, and edges would point at an arbitrary one.
  const segments: LabelSegment[] = [];
  const labelToSegment = new Map<string, LabelSegment>();
  scenes.forEach((scene, sceneIdx) => {
    const segs = extractLabelSegments(scene);
    for (const s of segs) {
      if (labelToSegment.has(s.name)) continue;
      const seg = { ...s, order: sceneIdx };
      segments.push(seg);
      labelToSegment.set(s.name, seg);
    }
  });

  // -- 2. Build edges first (we need inbound + brokenOut counts per node) -

  const edges: GraphEdgeData[] = [];
  const inbound = new Set<string>();
  const brokenOutBySource = new Map<string, number>();

  for (const seg of segments) {
    const refs = collectAllRefs(seg.blocks);
    refs.forEach((ref, i) => {
      const targetSeg = labelToSegment.get(ref.target.trim());
      const broken = !targetSeg;
      if (targetSeg) inbound.add(targetSeg.name);
      else
        brokenOutBySource.set(
          seg.name,
          (brokenOutBySource.get(seg.name) ?? 0) + 1,
        );
      edges.push({
        id: `${seg.name}->${ref.target}:${i}:${ref.origin}`,
        source: seg.name,
        target: targetSeg ? targetSeg.name : `__broken__:${ref.target}:${i}`,
        origin: ref.origin,
        choiceText: ref.choiceText,
        condition: ref.condition,
        broken,
        brokenTarget: broken ? ref.target : undefined,
      });
    });
  }

  // -- 2b. Implicit fall-through edges between consecutive labels in the --
  //        same scene. Ren'Py executes labels sequentially within a file
  //        when the previous one doesn't terminate with jump/return — so a
  //        `label foo: <dialog>` immediately followed by `label bar: …`
  //        flows foo → bar without any explicit reference. Without this
  //        edge the graph shows disconnected chains for files that rely on
  //        fall-through (which `Time Heals` does heavily).
  for (let i = 0; i < segments.length - 1; i++) {
    const cur = segments[i];
    const next = segments[i + 1];
    // Only chain segments that belong to the same scene — between scenes
    // there is no implicit fall-through (different files, no guarantee).
    if (cur.sceneId !== next.sceneId) continue;
    if (isTerminalSegment(cur.blocks)) continue;
    inbound.add(next.name);
    edges.push({
      id: `${cur.name}~>${next.name}:fallthrough`,
      source: cur.name,
      target: next.name,
      origin: "fallthrough",
      broken: false,
    });
  }

  // -- 3. Build nodes (annotated with isEntry / isUnreachable / brokenOut) -

  // Count outbound edges per source — covers explicit refs + fall-through
  // (so the badge on the node tells the whole story, not just `jump`/`call`).
  const outboundCount = new Map<string, number>();
  for (const e of edges) {
    outboundCount.set(e.source, (outboundCount.get(e.source) ?? 0) + 1);
  }

  const entrySegmentName = segments[0]?.name;
  const nodes: GraphNodeData[] = segments.map((s) => {
    const sceneRow = byId.get(s.sceneId);
    return {
      id: s.name,
      label: s.name,
      sceneTitle: s.sceneTitle,
      sceneId: s.sceneId,
      emoji: s.emoji,
      status: s.status,
      chapter:
        sceneRow && sceneRow.parent_id ? chapterOf(sceneRow.parent_id) : null,
      outboundCount: outboundCount.get(s.name) ?? 0,
      brokenOutboundCount: brokenOutBySource.get(s.name) ?? 0,
      choiceTexts: collectChoiceTexts(s.blocks),
      isImplicit: s.isImplicit,
      isEntry: s.name === entrySegmentName,
      isUnreachable: s.name !== entrySegmentName && !inbound.has(s.name),
    };
  });

  // -- 4. Stats ------------------------------------------------------------

  return {
    nodes,
    edges,
    stats: {
      labelCount: nodes.length,
      edgeCount: edges.length,
      brokenEdgeCount: edges.filter((e) => e.broken).length,
      unreachableCount: nodes.filter((n) => n.isUnreachable).length,
      conditionalEdgeCount: edges.filter((e) => e.origin === "conditional")
        .length,
    },
  };
}

// ---------------------------------------------------------------------------
// Label segmentation
// ---------------------------------------------------------------------------

function extractLabelSegments(
  scene: GraphSourceRow,
): Array<Omit<LabelSegment, "order">> {
  const blocks = scene.rpy_blocks ?? [];
  const labelIdx: number[] = [];
  // Take labels at ANY depth — nested labels are still valid jump targets in
  // Ren'Py (and imports of slightly malformed scripts commonly produce them
  // when a label is accidentally indented). Restricting to depth 0 would
  // make their inbound jumps look "broken" while the engine resolves them
  // fine.
  blocks.forEach((b, i) => {
    if (b.kind === "label") labelIdx.push(i);
  });

  // No label blocks at all → fall back to the scene's own rpy_label.
  if (labelIdx.length === 0) {
    if (!scene.rpy_label) return [];
    return [
      {
        name: scene.rpy_label,
        sceneId: scene.id,
        sceneTitle: scene.title,
        emoji: scene.emoji,
        status: scene.status,
        blocks,
        isImplicit: true,
      },
    ];
  }

  // Slice the blocks into segments by label index. Content before the first
  // label block is unreachable (no entry point) and dropped.
  const out: Array<Omit<LabelSegment, "order">> = [];
  for (let i = 0; i < labelIdx.length; i++) {
    const start = labelIdx[i];
    const end = labelIdx[i + 1] ?? blocks.length;
    const lbl = blocks[start] as LabelBlock;
    out.push({
      name: lbl.name,
      sceneId: scene.id,
      sceneTitle: scene.title,
      emoji: scene.emoji,
      status: scene.status,
      // Exclude the label block itself — it isn't a flow ref.
      blocks: blocks.slice(start + 1, end),
      isImplicit: false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reference collection: direct + menu + conditional (parsed from RawBlock)
// ---------------------------------------------------------------------------

interface CollectedRef {
  origin: EdgeOrigin;
  target: string;
  choiceText?: string;
  condition?: string;
}

function collectAllRefs(blocks: RpyBlocks): CollectedRef[] {
  const direct = collectOutboundRefs(blocks).map<CollectedRef>((r) => ({
    origin: r.choiceText ? "menu" : r.kind,
    target: r.target,
    choiceText: r.choiceText,
  }));
  const conditional = collectConditionalRefs(blocks);
  return [...direct, ...conditional];
}

const JUMP_LINE_RE = /^\s*(jump|call)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * Pull `jump`/`call` lines out of any RawBlock whose head looks like a
 * Python conditional (`if ...`, `elif ...`, `else:`). The parser keeps such
 * constructs as raw text because they fall outside the structured block set —
 * but for graph purposes we still want to surface their outbound flow.
 *
 * Multiple jumps inside a single if-block (rare but possible) each become
 * a separate edge with the same condition label.
 */
/**
 * Flat list of choice texts inside a segment's blocks. Order matches the
 * source — multiple `menu` blocks accumulate together. We don't model the
 * grouping into separate menus on the graph because it adds visual noise
 * without changing the flow signal; the count + tooltip suffices.
 */
function collectChoiceTexts(blocks: RpyBlocks): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "choice") out.push(b.text);
  }
  return out;
}

/**
 * A segment terminates control flow (no fall-through to the next label)
 * when its last meaningful block is a `jump` or a Ren'Py `return` statement.
 * `call` returns, so it does NOT terminate. Notes and trailing comments
 * are ignored — execution skips over them.
 *
 * If the segment has no blocks at all, treat it as terminal (an empty
 * label with nothing inside it can't fall through to anything meaningful,
 * and adding a fake edge would just clutter the graph).
 */
function isTerminalSegment(blocks: RpyBlocks): boolean {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "note") continue;
    if (b.kind === "jump") return true;
    if (b.kind === "raw") {
      const head = (b.head ?? "").trim();
      if (/^return\b/.test(head)) return true;
    }
    return false;
  }
  return true;
}

function collectConditionalRefs(blocks: RpyBlocks): CollectedRef[] {
  const out: CollectedRef[] = [];
  for (const b of blocks) {
    if (b.kind !== "raw") continue;
    const raw = b as RawBlock;
    const head = (raw.head ?? "").trim();
    if (!/^(if\s|elif\s|else\b)/.test(head)) continue;
    const condition = head.replace(/:$/, "").trim();
    for (const line of raw.lines) {
      const m = line.match(JUMP_LINE_RE);
      if (m) {
        out.push({
          origin: "conditional",
          target: m[2],
          condition,
        });
      }
    }
  }
  return out;
}

// Re-export RpyBlock type so call sites that just want the source type
// don't have to reach into lib/renpy.
export type { RpyBlock };
