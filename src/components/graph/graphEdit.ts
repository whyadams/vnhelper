/**
 * Pure mutators for Graph Phase 3 edits — drag-to-connect and new-scene-
 * from-canvas. Live in their own file so the canvas component stays
 * focused on rendering; these helpers manipulate `rpy_blocks` directly
 * and are independently testable.
 */

import type { JumpBlock, LabelBlock, RpyBlocks } from "../../lib/renpy/blocks";

let __jumpIdSeq = 0;
/** Stable id factory for client-side `JumpBlock` inserts. We don't reuse
 *  any shared UUID helper here because Block ids are local-only — never
 *  travel back to the DB — and a monotonic counter is plenty for React. */
function nextJumpId(): string {
  __jumpIdSeq += 1;
  return `jump-${Date.now().toString(36)}-${__jumpIdSeq}`;
}

/**
 * Append `jump <target>` to the end of the `labelName` segment inside a
 * scene's blocks. The "segment" runs from one `label:` block (exclusive)
 * up to the next `label:` block (or end of file). The jump lands at the
 * same depth as the surrounding statements (label.depth + 1), which is
 * the Ren'Py convention.
 *
 * Returns the new blocks list, or `null` when the label isn't in this
 * scene (caller should look elsewhere) or already has a `jump` to the
 * same target (idempotent — saves an accidental double-edge).
 */
export function appendJumpToLabel(
  blocks: RpyBlocks,
  labelName: string,
  target: string,
): RpyBlocks | null {
  const labelIdx: number[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "label") labelIdx.push(i);
  });

  let start = -1;
  let end = blocks.length;
  for (let i = 0; i < labelIdx.length; i++) {
    const idx = labelIdx[i];
    const lbl = blocks[idx] as LabelBlock;
    if (lbl.name === labelName) {
      start = idx;
      end = labelIdx[i + 1] ?? blocks.length;
      break;
    }
  }
  if (start < 0) return null;

  // Idempotency: bail if the segment already targets this label via an
  // unconditional top-level jump/call. (Conditional / menu-nested cases
  // are left alone — those edges are still "different" semantically.)
  const label = blocks[start] as LabelBlock;
  for (let i = start + 1; i < end; i++) {
    const b = blocks[i];
    if (b.depth !== label.depth + 1) continue;
    if ((b.kind === "jump" || b.kind === "call") && b.target === target) {
      return null;
    }
  }

  const jump: JumpBlock = {
    id: nextJumpId(),
    kind: "jump",
    depth: label.depth + 1,
    target,
  };

  // Insert at the end of the segment so the jump comes after the existing
  // body — semantics-wise this is "after everything happens, jump".
  const out = blocks.slice();
  out.splice(end, 0, jump);
  return out;
}

/**
 * Strip a top-level `jump <target>` (or `call <target>`) from the named
 * label's segment. Returns the new blocks list, or null when no such
 * top-level reference was found (caller should leave the scene alone —
 * the edge probably came from a menu / conditional / fallthrough that
 * lives at a deeper depth or a different source).
 *
 * Only top-level (depth == label.depth + 1) refs are removed — nested
 * `jump`s inside menu choices or if/elif blocks aren't touched here,
 * since they're semantically tied to the surrounding construct and
 * removing them would silently drop authorial intent.
 */
export function removeJumpFromLabel(
  blocks: RpyBlocks,
  labelName: string,
  target: string,
  kind: "jump" | "call" = "jump",
): RpyBlocks | null {
  const labelIdx: number[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "label") labelIdx.push(i);
  });
  let start = -1;
  let end = blocks.length;
  for (let i = 0; i < labelIdx.length; i++) {
    const idx = labelIdx[i];
    const lbl = blocks[idx] as LabelBlock;
    if (lbl.name === labelName) {
      start = idx;
      end = labelIdx[i + 1] ?? blocks.length;
      break;
    }
  }
  if (start < 0) return null;
  const label = blocks[start] as LabelBlock;
  for (let i = start + 1; i < end; i++) {
    const b = blocks[i];
    if (b.depth !== label.depth + 1) continue;
    if (b.kind === kind && b.target === target) {
      const out = blocks.slice();
      out.splice(i, 1);
      return out;
    }
  }
  return null;
}

/**
 * Generate a unique Ren'Py label name not already used by any segment in
 * the project. Pattern: `new_scene_1`, `new_scene_2`, … incrementing
 * until we find a gap. Returns the chosen name.
 */
export function nextSceneLabel(usedLabels: Set<string>): string {
  for (let i = 1; i < 10000; i++) {
    const candidate = `new_scene_${i}`;
    if (!usedLabels.has(candidate)) return candidate;
  }
  // Practically unreachable, but keep a fallback so the type stays string.
  return `new_scene_${Date.now()}`;
}

/**
 * Build an initial `rpy_blocks` array for a brand-new scene: a single
 * `label:` block at depth 0. The user fills the rest in the editor.
 */
export function newSceneRpyBlocks(labelName: string): RpyBlocks {
  return [
    {
      id: nextJumpId(),
      kind: "label",
      depth: 0,
      name: labelName,
    } as LabelBlock,
  ];
}
