import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { ChapterFrameDatum } from "./graphLayout";

type Props = NodeProps & { data: ChapterFrameDatum };

/**
 * Chapter-cluster background frame. Drawn behind label nodes that belong
 * to the same chapter — the dagre compound layout keeps them spatially
 * close, this frame makes the grouping read at a glance.
 *
 * Non-interactive (no drag, no select). Title sits in the top-left
 * gutter so it doesn't bleed into the labels themselves.
 */
export const ChapterFrame = memo(function ChapterFrame({ data }: Props) {
  return (
    <div
      className="graph-chapter-frame"
      // The wrapper picks up width/height from the node's style; we just
      // render the title + visual chrome here. Pointer-events stay off so
      // selection rectangles drag through the frame to the labels behind.
      aria-hidden
    >
      <div className="graph-chapter-frame-title">{data.chapter}</div>
    </div>
  );
});
