import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LabelNodeDatum } from "./graphLayout";

type Props = NodeProps & { data: LabelNodeDatum };

function formatWordCount(n: number): string {
  if (n < 1000) return `${n}w`;
  // 1 decimal place up to 9.9k, then integers.
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

export const LabelNode = memo(function LabelNode({ data, selected }: Props) {
  // Visual priority for left-edge stripe / badge picks the most actionable
  // signal: entry > orphan (no inbound at all, very loud) > unreachable
  // (reachable problem) > ending (often intentional, lowest priority).
  const cls = [
    "graph-node",
    "graph-node-label",
    selected ? "is-selected" : "",
    data.isImplicit ? "is-implicit" : "",
    data.isEntry ? "is-entry" : "",
    !data.isEntry && data.isOrphan ? "is-orphan" : "",
    !data.isEntry && data.isUnreachable && !data.isOrphan
      ? "is-unreachable"
      : "",
    !data.isEntry && data.isEnding ? "is-ending" : "",
    data.brokenOutboundCount > 0 ? "has-broken-out" : "",
    data.choiceTexts.length > 0 ? "has-choices" : "",
    data.isSubroutine ? "is-subroutine" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const choicesTooltip =
    data.choiceTexts.length > 0
      ? `\nChoices:\n  • ${data.choiceTexts.join("\n  • ")}`
      : "";

  const reachabilityNote = data.isEntry
    ? "\nProject entry point"
    : data.isOrphan
      ? "\nOrphan — no other label jumps/calls/falls through here"
      : data.isUnreachable
        ? "\nUnreachable — entry can't reach this label via any path"
        : "";
  const endingNote =
    !data.isEntry && data.isEnding
      ? "\nEnding — no outbound jump/call (intentional or missing transition?)"
      : "";
  const povNote = data.povName ? `\nPOV: ${data.povName}` : "";
  const wordNote = data.wordCount > 0 ? `\n${data.wordCount} words` : "";
  const subroutineNote = data.isSubroutine
    ? `\nSubroutine — ends with \`return\`${
        data.callers.length > 0
          ? ` (called from ${data.callers.length}: ${data.callers.slice(0, 3).join(", ")}${data.callers.length > 3 ? "…" : ""})`
          : " (no callers yet)"
      }`
    : "";

  // POV-character colour is fed in as a CSS custom property so the stylesheet
  // can paint the left border + the small avatar dot from one source of
  // truth. When no POV is set the var is unset and the rules fall back to
  // the existing status / integrity stripes.
  const style: CSSProperties | undefined = data.povColor
    ? ({ "--node-pov": data.povColor } as CSSProperties)
    : undefined;

  return (
    <div
      className={cls + (data.povColor ? " has-pov" : "")}
      data-status={data.status}
      style={style}
      title={`Scene: ${data.sceneTitle}${data.chapter ? `\nChapter: ${data.chapter}` : ""}${povNote}${wordNote}${reachabilityNote}${endingNote}${subroutineNote}${data.brokenOutboundCount > 0 ? `\n${data.brokenOutboundCount} broken outbound ref(s)` : ""}${choicesTooltip}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="graph-node-handle"
      />
      {data.isEntry && (
        <span className="graph-node-badge graph-node-badge-entry">START</span>
      )}
      {!data.isEntry && data.isOrphan && (
        <span className="graph-node-badge graph-node-badge-orphan">
          ORPHAN
        </span>
      )}
      {!data.isEntry && data.isUnreachable && !data.isOrphan && (
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
        {data.choiceTexts.length > 0 && (
          <span
            className="graph-node-fork"
            aria-hidden
            title="Choice node — branches via menu"
          >
            <ForkGlyph />
          </span>
        )}
        {data.isSubroutine && (
          <span
            className="graph-node-subroutine"
            aria-hidden
            title={
              data.callers.length > 0
                ? `Subroutine — called from ${data.callers.length} label(s)`
                : "Subroutine — ends with `return` (no callers yet)"
            }
          >
            <SubroutineGlyph />
          </span>
        )}
        {/* Status dot — small coloured circle in the upper-right corner.
            Left-edge stripes are preempted by integrity flags (entry / orphan
            / unreachable), so the dot is the only consistent place to surface
            todo / progress / review / done on every node. */}
        <span
          className="graph-node-status-dot"
          data-status={data.status}
          aria-hidden
          title={`Status: ${data.status}`}
        />
      </div>
      <div className="graph-node-scene">
        {data.chapter && (
          <span className="graph-node-chapter">{data.chapter}</span>
        )}
        <span className="graph-node-scene-title">{data.sceneTitle}</span>
      </div>
      <div className="graph-node-counters">
        {data.wordCount > 0 && (
          <span
            className="graph-node-words"
            title={`${data.wordCount} words across say / narrator / choice / note`}
          >
            {formatWordCount(data.wordCount)}
          </span>
        )}
        {data.choiceTexts.length > 0 && (
          <span className="graph-node-choices">≡ {data.choiceTexts.length}</span>
        )}
        {data.outboundCount > 0 && (
          <span className="graph-node-count">→ {data.outboundCount}</span>
        )}
        {!data.isEntry && data.isEnding && (
          <span className="graph-node-ending" title="No outbound — story end?">
            ◼ end
          </span>
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

function ForkGlyph() {
  // Inline branch glyph (12×12) tuned to sit next to the label name.
  // Single stem on the left forking to two diverging arms — reads as
  // "choice branches" without needing a legend.
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
    >
      <path d="M3 2v3a2 2 0 0 0 2 2h4" />
      <path d="M3 5v5" />
      <path d="M9 4l2 3-2 3" />
    </svg>
  );
}

function SubroutineGlyph() {
  // Inline subroutine glyph (12×12): a hooked return arrow. Reads as "this
  // label is callable AND comes back" — pairs with the dashed left rail
  // applied in graph.css when `.is-subroutine` is set.
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
    >
      <path d="M10 3h-5a3 3 0 0 0 0 6h2" />
      <path d="M4 7l-2 2 2 2" />
    </svg>
  );
}
