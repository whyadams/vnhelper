/**
 * Dagre-driven layout for the story-flow graph. Takes the built nodes/edges
 * from graphBuild and returns xyflow-ready positions. Direction: left-to-right
 * — branch/dialog flow reads naturally in reading order, vertical tracks
 * accommodate parallel paths cheaply.
 *
 * Broken edges (target label not found anywhere in the project) are kept in
 * the result for stats reporting but excluded from the dagre pass — their
 * fake target ids have no node, so dagre would error. The canvas can still
 * render them as detached stubs later; for the MVP we drop them silently.
 */

import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type {
  EdgeOrigin,
  GraphBuildResult,
  GraphEdgeData,
  GraphNodeData,
} from "./graphBuild";

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 84;

export interface LayoutResult {
  nodes: Node<LabelNodeDatum>[];
  edges: Edge<EdgeDatum>[];
}

export interface LabelNodeDatum extends Record<string, unknown> {
  label: string;
  sceneTitle: string;
  sceneId: string;
  emoji: string | null;
  status: string;
  chapter: string | null;
  outboundCount: number;
  brokenOutboundCount: number;
  choiceTexts: string[];
  isImplicit: boolean;
  isEntry: boolean;
  isOrphan: boolean;
  isUnreachable: boolean;
  isEnding: boolean;
  wordCount: number;
  povColor: string | null;
  povName: string | null;
}

export interface EdgeDatum extends Record<string, unknown> {
  origin: EdgeOrigin;
  choiceText?: string;
  condition?: string;
  broken: boolean;
  brokenTarget?: string;
}

const MAX_EDGE_LABEL = 28;

export function layoutGraph(built: GraphBuildResult): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 28,
    ranksep: 80,
    marginx: 24,
    marginy: 24,
  });

  for (const n of built.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of built.edges) {
    if (e.broken) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const nodes: Node<LabelNodeDatum>[] = built.nodes.map((n) => {
    const d = g.node(n.id);
    const x = (d?.x ?? 0) - NODE_WIDTH / 2;
    const y = (d?.y ?? 0) - NODE_HEIGHT / 2;
    return {
      id: n.id,
      type: "label",
      position: { x, y },
      data: toNodeDatum(n),
    };
  });

  const edges: Edge<EdgeDatum>[] = built.edges
    .filter((e) => !e.broken)
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: false,
      label: edgeLabelText(e),
      labelShowBg: !!edgeLabelText(e),
      data: toEdgeDatum(e),
      style: edgeStyle(e),
      labelStyle: {
        fill: edgeLabelColor(e),
        fontFamily: "Montserrat, sans-serif",
        fontSize: 11,
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: "var(--bg-elevated)",
        fillOpacity: 0.92,
      },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 4,
    }));

  return { nodes, edges };
}

function toNodeDatum(n: GraphNodeData): LabelNodeDatum {
  return {
    label: n.label,
    sceneTitle: n.sceneTitle,
    sceneId: n.sceneId,
    emoji: n.emoji,
    status: n.status,
    chapter: n.chapter,
    outboundCount: n.outboundCount,
    brokenOutboundCount: n.brokenOutboundCount,
    choiceTexts: n.choiceTexts,
    isImplicit: n.isImplicit,
    isEntry: n.isEntry,
    isOrphan: n.isOrphan,
    isUnreachable: n.isUnreachable,
    isEnding: n.isEnding,
    wordCount: n.wordCount,
    povColor: n.povColor,
    povName: n.povName,
  };
}

function toEdgeDatum(e: GraphEdgeData): EdgeDatum {
  return {
    origin: e.origin,
    choiceText: e.choiceText,
    condition: e.condition,
    broken: e.broken,
    brokenTarget: e.brokenTarget,
  };
}

function edgeLabelText(e: GraphEdgeData): string | undefined {
  if (e.origin === "menu" && e.choiceText) return truncate(e.choiceText);
  if (e.origin === "conditional" && e.condition) return truncate(e.condition);
  if (e.origin === "call") return "call";
  // Fall-through is intentional but implicit — no label, keeps the graph clean
  return undefined;
}

function truncate(s: string): string {
  if (s.length <= MAX_EDGE_LABEL) return s;
  return s.slice(0, MAX_EDGE_LABEL - 1) + "…";
}

function edgeLabelColor(e: GraphEdgeData): string {
  if (e.origin === "conditional") return "var(--status-warn)";
  if (e.origin === "menu") return "var(--text-1)";
  return "var(--text-2)";
}

function edgeStyle(e: GraphEdgeData): React.CSSProperties {
  if (e.origin === "conditional") {
    return {
      stroke: "var(--status-warn)",
      strokeWidth: 1.5,
      strokeDasharray: "2 4",
    };
  }
  if (e.origin === "call") {
    return {
      stroke: "var(--border-strong)",
      strokeWidth: 1.5,
      strokeDasharray: "5 3",
    };
  }
  if (e.origin === "menu") {
    return {
      stroke: "var(--accent-strong)",
      strokeWidth: 1.5,
      strokeOpacity: 0.6,
    };
  }
  if (e.origin === "fallthrough") {
    // Thin, dim, no-label — reads as "this just continues" rather than as
    // a deliberate flow-control choice. Distinct from the call/conditional
    // dashes so it's clear which edges the author actually wrote.
    return {
      stroke: "var(--text-3)",
      strokeWidth: 1,
      strokeOpacity: 0.55,
    };
  }
  return {
    stroke: "var(--border-strong)",
    strokeWidth: 1.5,
  };
}
