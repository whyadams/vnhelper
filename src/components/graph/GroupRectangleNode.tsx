import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

export interface GroupDatum extends Record<string, unknown> {
  name: string;
  color: string;
  /** Number of labels currently in this group — surfaced in the tag so
   *  the user knows the group's size at a glance. */
  size: number;
  onOpen: (id: string) => void;
}

export const GROUP_COLORS = [
  "blue",
  "green",
  "purple",
  "amber",
  "red",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

function isGroupColor(c: string): c is GroupColor {
  return (GROUP_COLORS as readonly string[]).includes(c);
}

type Props = NodeProps & { id: string; data: GroupDatum; selected: boolean };

/**
 * Background rectangle that sits BEHIND the label nodes it groups. Width
 * + height + position are computed in the parent from the bounding box of
 * the group's labels and fed into xyflow's `style`. This component only
 * draws the rectangle and the corner tag — click on the tag opens the
 * group editor panel; the rect itself ignores pointer events so labels
 * stay interactive over it.
 */
export const GroupRectangleNode = memo(function GroupRectangleNode({
  id,
  data,
  selected,
}: Props) {
  const safeColor: GroupColor = isGroupColor(data.color) ? data.color : "blue";
  return (
    <div
      className={
        "graph-group" +
        ` is-color-${safeColor}` +
        (selected ? " is-selected" : "")
      }
    >
      <button
        type="button"
        className="graph-group-tag"
        onClick={(e) => {
          e.stopPropagation();
          data.onOpen(id);
        }}
        title="Edit / ungroup"
      >
        <span className="graph-group-tag-dot" />
        <span className="graph-group-tag-name">
          {data.name || "Untitled group"}
        </span>
        <span className="graph-group-tag-count">{data.size}</span>
      </button>
    </div>
  );
});
