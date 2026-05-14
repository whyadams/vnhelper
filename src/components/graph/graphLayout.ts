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

/**
 * Chapter-frame node: a translucent rectangle drawn behind a chapter's
 * labels with the chapter title in the top-left. Pure visual grouping —
 * not user-editable, not stored, derived entirely from the dagre cluster
 * bounding boxes computed during layout. */
export interface ChapterFrameDatum extends Record<string, unknown> {
  chapter: string;
  /** Width / height of the frame, applied via xyflow's style. */
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: Node<LabelNodeDatum | ChapterFrameDatum>[];
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
  isSubroutine: boolean;
  callers: string[];
}

export interface EdgeDatum extends Record<string, unknown> {
  origin: EdgeOrigin;
  choiceText?: string;
  condition?: string;
  broken: boolean;
  brokenTarget?: string;
  viaCall: boolean;
}

const MAX_EDGE_LABEL = 18;

export function layoutGraph(built: GraphBuildResult): LayoutResult {
  // Compound graph so we can cluster labels by chapter. Each unique chapter
  // becomes a cluster node and its labels are `setParent`-ed into it; dagre
  // then keeps siblings close in the layout. We don't render the cluster
  // rectangles (xyflow doesn't have a native cluster node), but the rank
  // hint alone dramatically reduces edge crossings on large scripts.
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    // network-simplex is dagre's most stable ranker for compound graphs.
    // (tight-tree behaves poorly when children are nested inside clusters.)
    ranker: "network-simplex",
    // Separation tuned for 30–80 node graphs. Larger than dagre's defaults
    // because VN nodes carry chip+counter+status that needs breathing room.
    // Bumping ranksep especially helps inter-cluster edges find a path
    // through without overlapping cluster bodies.
    nodesep: 64,
    ranksep: 180,
    edgesep: 32,
    marginx: 32,
    marginy: 32,
  });

  // Bucket nodes into clusters. We prefer the structural `chapter` field
  // (set when a label sits under a Script chapter node), but fall back to
  // auto-detection by label-name prefix for flat .rpy imports where every
  // label lives in one scene. The prefix is the first `_`-separated word
  // when at least 2 labels share it — so `prologue_*`, `chapter_*`,
  // `ending_*`, `castle_*` etc. all group automatically without the user
  // ever wiring chapters in the editor.
  const nodeCluster = new Map<string, string>();
  const prefixCount = new Map<string, number>();
  for (const n of built.nodes) {
    if (n.chapter) continue;
    const prefix = labelPrefix(n.label);
    if (!prefix) continue;
    prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
  }
  const chapterIds = new Set<string>();
  for (const n of built.nodes) {
    if (n.chapter) {
      const id = `__cluster__:chapter:${n.chapter}`;
      nodeCluster.set(n.id, id);
      chapterIds.add(id);
      continue;
    }
    const prefix = labelPrefix(n.label);
    if (prefix && (prefixCount.get(prefix) ?? 0) >= 2) {
      const id = `__cluster__:prefix:${prefix}`;
      nodeCluster.set(n.id, id);
      chapterIds.add(id);
    }
  }
  for (const id of chapterIds) {
    g.setNode(id, {});
  }

  for (const n of built.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    const parent = nodeCluster.get(n.id);
    if (parent) g.setParent(n.id, parent);
  }
  for (const e of built.edges) {
    if (e.broken) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  // Padding around the children inside each chapter frame. Dagre already
  // bakes some inset into the cluster bbox, but the labels still hug the
  // edges — bump out a few more pixels so the frame breathes.
  const FRAME_PAD = 22;
  const FRAME_TITLE_GUTTER = 14;
  const chapterFrames: Node<ChapterFrameDatum>[] = [];
  for (const id of chapterIds) {
    const cluster = g.node(id);
    if (!cluster || !cluster.width || !cluster.height) continue;
    chapterFrames.push({
      id,
      type: "chapter_frame",
      // xyflow positions in top-left; dagre cluster origin is centre.
      position: {
        x: cluster.x - cluster.width / 2 - FRAME_PAD,
        y: cluster.y - cluster.height / 2 - FRAME_PAD - FRAME_TITLE_GUTTER,
      },
      // Frames must sit behind label nodes (xyflow draws in array order,
      // so prepending is enough — but z-index is the durable signal).
      zIndex: -1,
      selectable: false,
      draggable: false,
      data: {
        chapter: clusterDisplayName(id),
        width: cluster.width + FRAME_PAD * 2,
        height: cluster.height + FRAME_PAD * 2 + FRAME_TITLE_GUTTER,
      },
      style: {
        width: cluster.width + FRAME_PAD * 2,
        height: cluster.height + FRAME_PAD * 2 + FRAME_TITLE_GUTTER,
      },
    });
  }

  const labelNodes: Node<LabelNodeDatum>[] = built.nodes.map((n) => {
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

  // Frames first so xyflow paints them behind label nodes; zIndex backs this.
  const nodes: Node<LabelNodeDatum | ChapterFrameDatum>[] = [
    ...chapterFrames,
    ...labelNodes,
  ];

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
    isSubroutine: n.isSubroutine,
    callers: n.callers,
  };
}

function toEdgeDatum(e: GraphEdgeData): EdgeDatum {
  return {
    origin: e.origin,
    choiceText: e.choiceText,
    condition: e.condition,
    broken: e.broken,
    brokenTarget: e.brokenTarget,
    viaCall: e.viaCall,
  };
}

function edgeLabelText(e: GraphEdgeData): string | undefined {
  if (e.origin === "menu" && e.choiceText) return truncate(e.choiceText);
  if (e.origin === "conditional" && e.condition) return truncate(e.condition);
  // `call` semantics are already conveyed by the dashed info-coloured stroke
  // (set in edgeStyle when viaCall is true) — repeating "call" as a label
  // just adds clutter on dense graphs, so we drop it.
  // Fall-through is intentional but implicit — no label, keeps the graph clean.
  return undefined;
}

function truncate(s: string): string {
  if (s.length <= MAX_EDGE_LABEL) return s;
  return s.slice(0, MAX_EDGE_LABEL - 1) + "…";
}

/**
 * Extracts the first `_`-separated word from a label name for cluster
 * auto-detection. `prologue_look` → `prologue`. Returns null when the
 * name has no underscore (single-word labels stay uncluster-ed; they
 * usually represent unique entry / ending nodes that we want freely
 * positioned by dagre, not boxed in). */
function labelPrefix(name: string): string | null {
  const idx = name.indexOf("_");
  if (idx <= 0) return null;
  return name.slice(0, idx);
}

/**
 * Render-friendly cluster name for the frame title. Strips the
 * `__cluster__:<kind>:` prefix and lowercases. Prefix-based clusters
 * just show the raw prefix; structural-chapter clusters keep the
 * original chapter title. */
function clusterDisplayName(id: string): string {
  if (id.startsWith("__cluster__:chapter:")) {
    return id.slice("__cluster__:chapter:".length);
  }
  if (id.startsWith("__cluster__:prefix:")) {
    return id.slice("__cluster__:prefix:".length);
  }
  return id;
}

function edgeLabelColor(e: GraphEdgeData): string {
  if (e.origin === "conditional") return "var(--status-warn)";
  if (e.origin === "menu") return "var(--text-1)";
  return "var(--text-2)";
}

function edgeStyle(e: GraphEdgeData): React.CSSProperties {
  // `call` semantics (regardless of where the call sits — top-level, menu
  // choice, or conditional branch) override the base origin styling so the
  // user can see "this is a subroutine call, control comes back" at a glance.
  if (e.viaCall) {
    return {
      stroke: "var(--status-info)",
      strokeWidth: 1.6,
      strokeDasharray: "6 4",
      strokeOpacity: 0.8,
    };
  }
  if (e.origin === "conditional") {
    return {
      stroke: "var(--status-warn)",
      strokeWidth: 1.5,
      strokeDasharray: "2 4",
    };
  }
  if (e.origin === "call") {
    return {
      stroke: "var(--status-info)",
      strokeWidth: 1.6,
      strokeDasharray: "6 4",
      strokeOpacity: 0.8,
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
