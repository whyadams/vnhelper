/**
 * Split a flat Ren'Py block list into separate logical scenes by
 * `label X:` at depth 0. Used by the import dialog to optionally break a
 * monolith .rpy file into one scene per label — keeps the editor fast on
 * large imports and surfaces the file's structure as a navigable tree in
 * the Script sidebar.
 *
 * Content that appears BEFORE the first label is returned as a
 * `name: null` "prelude" segment. In Ren'Py that's typically file-level
 * `image` definitions and `define` statements that don't belong to any
 * scene's narrative flow — the import flow will drop it by default.
 */

import type { LabelBlock, RpyBlocks } from "./blocks";

export interface BlockSegment {
  name: string | null;
  /** Includes the leading label block when `name` is set, so each segment
   *  is a fully-formed standalone scene body. */
  blocks: RpyBlocks;
}

export function splitByLabels(blocks: RpyBlocks): BlockSegment[] {
  if (blocks.length === 0) return [];

  const labelIdxs: number[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "label" && b.depth === 0) labelIdxs.push(i);
  });

  if (labelIdxs.length === 0) {
    return [{ name: null, blocks }];
  }

  const out: BlockSegment[] = [];
  if (labelIdxs[0] > 0) {
    out.push({ name: null, blocks: blocks.slice(0, labelIdxs[0]) });
  }
  for (let i = 0; i < labelIdxs.length; i++) {
    const start = labelIdxs[i];
    const end = labelIdxs[i + 1] ?? blocks.length;
    const head = blocks[start] as LabelBlock;
    out.push({
      name: head.name,
      blocks: blocks.slice(start, end),
    });
  }
  return out;
}

export function countTopLevelLabels(blocks: RpyBlocks): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === "label" && b.depth === 0) n++;
  }
  return n;
}
