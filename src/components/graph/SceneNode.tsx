import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LabelNodeDatum } from "./graphLayout";

type Props = NodeProps & { data: LabelNodeDatum };

export const LabelNode = memo(function LabelNode({ data, selected }: Props) {
  const cls = [
    "graph-node",
    "graph-node-label",
    selected ? "is-selected" : "",
    data.isImplicit ? "is-implicit" : "",
    data.isEntry ? "is-entry" : "",
    data.isUnreachable ? "is-unreachable" : "",
    data.brokenOutboundCount > 0 ? "has-broken-out" : "",
    data.choiceTexts.length > 0 ? "has-choices" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const choicesTooltip =
    data.choiceTexts.length > 0
      ? `\nChoices:\n  • ${data.choiceTexts.join("\n  • ")}`
      : "";

  return (
    <div
      className={cls}
      data-status={data.status}
      title={`Scene: ${data.sceneTitle}${data.chapter ? `\nChapter: ${data.chapter}` : ""}${data.isEntry ? "\nProject entry point" : ""}${data.isUnreachable ? "\nUnreachable — no jump/call into this label" : ""}${data.brokenOutboundCount > 0 ? `\n${data.brokenOutboundCount} broken outbound ref(s)` : ""}${choicesTooltip}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="graph-node-handle"
      />
      {data.isEntry && (
        <span className="graph-node-badge graph-node-badge-entry">START</span>
      )}
      {!data.isEntry && data.isUnreachable && (
        <span className="graph-node-badge graph-node-badge-unreachable">
          UNREACHABLE
        </span>
      )}
      {data.brokenOutboundCount > 0 && (
        <span className="graph-node-badge graph-node-badge-broken">
          ⚠ {data.brokenOutboundCount}
        </span>
      )}
      <div className="graph-node-label-name">
        {data.emoji && <span className="graph-node-emoji">{data.emoji}</span>}
        <span className="graph-node-label-text">{data.label}</span>
      </div>
      <div className="graph-node-scene">
        {data.chapter && (
          <span className="graph-node-chapter">{data.chapter}</span>
        )}
        <span className="graph-node-scene-title">{data.sceneTitle}</span>
      </div>
      <div className="graph-node-counters">
        {data.choiceTexts.length > 0 && (
          <span className="graph-node-choices">≡ {data.choiceTexts.length}</span>
        )}
        {data.outboundCount > 0 && (
          <span className="graph-node-count">→ {data.outboundCount}</span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="graph-node-handle"
      />
    </div>
  );
});
