import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Node as FlowNode,
  type NodeMouseHandler,
} from "@xyflow/react";
import { NODE_HEIGHT, NODE_WIDTH } from "./graphLayout";
import { supabase } from "../../lib/supabase";
import type { Json } from "../../lib/database.types";
import type { RpyBlocks } from "../../lib/renpy/blocks";
import {
  buildGraph,
  type GraphBuildResult,
  type GraphSourceRow,
} from "./graphBuild";
import { layoutGraph, type LabelNodeDatum } from "./graphLayout";
import { LabelInspector } from "./LabelInspector";
import { LabelNode } from "./SceneNode";
import { LabelSearch, type SearchItem } from "./LabelSearch";

interface Props {
  projectId: string;
  workspaceId: string;
  /** Called when the user double-clicks a label node — navigates to Script. */
  onOpenScene: (sceneId: string) => void;
}

type ScriptNodeRow = {
  id: string;
  parent_id: string | null;
  kind: "chapter" | "scene" | "block";
  title: string;
  emoji: string | null;
  status: string;
  position: number;
  rpy_label: string | null;
  rpy_blocks: Json | null;
};

type LayoutRow = {
  label_name: string;
  x: number;
  y: number;
};

const nodeTypes = { label: LabelNode };

// Show ⌘ on macOS, Ctrl elsewhere — keeps the hotkey hint accurate to what
// the user actually has to press. `navigator.platform` is deprecated but
// still the most reliable signal across Tauri's WebView2 surface.
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

export function GraphCanvas(props: Props) {
  // ReactFlowProvider wraps the whole wrap (canvas + stats + inspector) so
  // `useReactFlow()` is available inside the inspector — needed to center
  // the camera on click-to-jump from a ref entry.
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvasInner({ projectId, workspaceId, onOpenScene }: Props) {
  const { setCenter } = useReactFlow();
  const [rows, setRows] = useState<GraphSourceRow[] | null>(null);
  /** Saved overrides keyed by labelName. null = still loading. */
  const [savedLayouts, setSavedLayouts] = useState<Map<string, {
    x: number;
    y: number;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // -- Fetch script_nodes + graph_layouts in parallel ---------------------
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setSavedLayouts(null);
    setError(null);
    void (async () => {
      const [nodesRes, layoutsRes] = await Promise.all([
        supabase
          .from("script_nodes")
          .select(
            "id, parent_id, kind, title, emoji, status, position, rpy_label, rpy_blocks",
          )
          .eq("project_id", projectId)
          .order("position", { ascending: true }),
        supabase
          .from("graph_layouts")
          .select("label_name, x, y")
          .eq("project_id", projectId),
      ]);
      if (cancelled) return;
      if (nodesRes.error) {
        console.error("graph fetch nodes", nodesRes.error);
        setError(nodesRes.error.message);
        setRows([]);
        setSavedLayouts(new Map());
        return;
      }
      if (layoutsRes.error) {
        // Layout fetch failure is non-fatal — fall through with empty overrides.
        console.warn("graph fetch layouts", layoutsRes.error);
      }
      const list = (nodesRes.data ?? []) as ScriptNodeRow[];
      setRows(
        list.map((r) => ({
          ...r,
          rpy_blocks: (r.rpy_blocks as RpyBlocks | null) ?? null,
        })),
      );
      const lm = new Map<string, { x: number; y: number }>();
      for (const l of (layoutsRes.data ?? []) as LayoutRow[]) {
        lm.set(l.label_name, { x: l.x, y: l.y });
      }
      setSavedLayouts(lm);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // -- Build + dagre (pure, no overlay). Stats also derive from here. ----
  // Overlay of saved positions happens ONCE per project load in an effect
  // below — not inside this memo — so that drag-induced position changes
  // don't trigger a setNodes() during/after drag, which would race with
  // xyflow's own state during multi-node drags.
  const built = useMemo<{
    layout: ReturnType<typeof layoutGraph>;
    stats: GraphBuildResult["stats"];
  } | null>(() => {
    if (!rows) return null;
    const buildResult = buildGraph(rows);
    return { layout: layoutGraph(buildResult), stats: buildResult.stats };
  }, [rows]);

  // -- xyflow controlled state ------------------------------------------
  const [nodes, setNodes, onNodesChange] = useNodesState(
    built?.layout.nodes ?? [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    built?.layout.edges ?? [],
  );

  // Apply dagre + saved-layout overlay only when the graph data first lands
  // for the current project. Subsequent drags update xyflow's own state via
  // onNodesChange and persist asynchronously — we never re-seed from `built`
  // mid-session, or multi-drag would snap one of the dragged nodes back.
  const initializedForProject = useRef<string | null>(null);
  useEffect(() => {
    if (!built || !savedLayouts) return;
    if (initializedForProject.current === projectId) return;
    initializedForProject.current = projectId;

    const seeded = built.layout.nodes.map((n) => {
      const saved = savedLayouts.get(n.id);
      return saved ? { ...n, position: { x: saved.x, y: saved.y } } : n;
    });
    setNodes(seeded);
    setEdges(built.layout.edges);
  }, [built, savedLayouts, projectId, setNodes, setEdges]);

  // Edges still need to refresh when the graph structure changes (new
  // jumps, broken targets, …). Nodes already include the latest data.
  useEffect(() => {
    if (!built) return;
    if (initializedForProject.current !== projectId) return;
    setEdges(built.layout.edges);
  }, [built, projectId, setEdges]);

  // -- Persist position on drag stop --------------------------------------
  // xyflow fires *different* callbacks for single vs multi-node drag:
  //   - onNodeDragStop fires for a single, non-selection drag.
  //   - onSelectionDragStop fires once when a multi-node selection drag ends,
  //     with the full list of nodes that moved.
  // We wire both to the same persister so multi-drag actually saves.
  // No local state updates here; the init-guard effect above won't re-seed
  // and yank a node back mid-drag.
  const persistNodes = useCallback(
    (toSave: FlowNode[]) => {
      if (toSave.length === 0) return;
      const rows = toSave.map((n) => ({
        project_id: projectId,
        workspace_id: workspaceId,
        label_name: n.id,
        x: n.position.x,
        y: n.position.y,
      }));
      void supabase
        .from("graph_layouts")
        .upsert(rows, { onConflict: "project_id,label_name" })
        .then(({ error: err }) => {
          if (err) console.error("graph_layouts upsert", err);
        });
    },
    [projectId, workspaceId],
  );

  const onNodeDragStop = useCallback<NodeMouseHandler>(
    (_e, node) => {
      persistNodes([node]);
    },
    [persistNodes],
  );

  const onSelectionDragStop = useCallback(
    (_e: React.MouseEvent, selectionNodes: FlowNode[]) => {
      persistNodes(selectionNodes);
    },
    [persistNodes],
  );

  // -- Reset to auto layout (clears saved positions) ----------------------
  const onResetLayout = useCallback(async () => {
    const { error: err } = await supabase
      .from("graph_layouts")
      .delete()
      .eq("project_id", projectId);
    if (err) {
      console.error("graph_layouts reset", err);
      return;
    }
    setSavedLayouts(new Map());
    // Re-seed xyflow with bare dagre layout. The init-guard effect won't
    // fire again (same projectId), so do it directly here.
    if (built) {
      setNodes(built.layout.nodes);
      setEdges(built.layout.edges);
    }
  }, [projectId, built, setNodes, setEdges]);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_e, node) => {
      const sceneId = (node.data as { sceneId?: string } | undefined)?.sceneId;
      if (sceneId) onOpenScene(sceneId);
    },
    [onOpenScene],
  );

  // -- Selection tracking for the inspector panel ------------------------
  // Single-click on a node selects it (xyflow default). We pick the
  // currently selected node out of `nodes` so it auto-updates on change.
  const selectedLabelNode = useMemo<
    (LabelNodeDatum & { id: string }) | null
  >(() => {
    const sel = nodes.find((n) => n.selected);
    if (!sel) return null;
    return { ...(sel.data as LabelNodeDatum), id: sel.id };
  }, [nodes]);

  // All label names currently in the graph — used by the inspector to
  // tell broken refs apart from valid ones (only the latter become clickable).
  const knownLabels = useMemo<Set<string>>(
    () => new Set(nodes.map((n) => n.id)),
    [nodes],
  );

  // Edges pointing INTO the selected label, surfaced in the panel.
  const inboundLabels = useMemo<string[]>(() => {
    if (!selectedLabelNode) return [];
    const set = new Set<string>();
    for (const e of edges) {
      if (e.target === selectedLabelNode.id) set.add(e.source);
    }
    return Array.from(set).sort();
  }, [edges, selectedLabelNode]);

  const onCloseInspector = useCallback(() => {
    setNodes((curr) => curr.map((n) => ({ ...n, selected: false })));
  }, [setNodes]);

  const onOpenSelectedScene = useCallback(() => {
    if (selectedLabelNode) onOpenScene(selectedLabelNode.sceneId);
  }, [selectedLabelNode, onOpenScene]);

  // Esc closes the inspector — mirrors how editor panels behave.
  useEffect(() => {
    if (!selectedLabelNode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseInspector();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLabelNode, onCloseInspector]);

  // -- Search palette ----------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const searchItems = useMemo<SearchItem[]>(
    () =>
      nodes.map((n) => {
        const d = n.data as LabelNodeDatum;
        return {
          id: n.id,
          label: d.label,
          sceneTitle: d.sceneTitle,
          chapter: d.chapter,
          isEntry: d.isEntry,
          isUnreachable: d.isUnreachable,
          brokenOutboundCount: d.brokenOutboundCount,
        };
      }),
    [nodes],
  );

  // Ctrl/Cmd+K toggles the search palette. We register at window-level so
  // it works regardless of focus inside the canvas; preventDefault keeps
  // browsers from hijacking the chord for their own search/find UI.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click on a ref in the inspector → select that label and pan camera to it.
  // Used by every clickable target in the panel (outbound jumps, inbound,
  // choice.outgoing, conditional branches). Silently no-ops on broken refs
  // (target doesn't exist in the graph).
  const onJumpToLabel = useCallback(
    (labelName: string) => {
      const target = nodes.find((n) => n.id === labelName);
      if (!target) return;
      setNodes((curr) =>
        curr.map((n) => ({ ...n, selected: n.id === labelName })),
      );
      setCenter(
        target.position.x + NODE_WIDTH / 2,
        target.position.y + NODE_HEIGHT / 2,
        { zoom: 1, duration: 400 },
      );
    },
    [nodes, setNodes, setCenter],
  );

  if (rows === null || savedLayouts === null) {
    return <div className="graph-loading">Loading scenes…</div>;
  }
  if (error) {
    return <div className="graph-error">Couldn't load: {error}</div>;
  }
  if (!built || built.layout.nodes.length === 0) {
    return (
      <div className="graph-empty">
        <p>Nothing to graph yet.</p>
        <p className="graph-empty-hint">
          The graph builds itself from Ren'Py labels —
          either a scene's <code>rpy_label</code> or a <code>label foo:</code>
          {" "}block inside the scene's Renpy tab. Add at least one to see it
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="graph-canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        nodeTypes={nodeTypes}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag={[1, 2]}
      >
        <Background gap={24} size={1} color="rgba(200,199,202,0.06)" />
        <MiniMap
          pannable
          zoomable
          nodeStrokeColor="transparent"
          nodeColor={() => "rgba(200,199,202,0.25)"}
          maskColor="rgba(19,20,22,0.7)"
          style={{ background: "var(--bg-elevated)" }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="graph-stats">
        <span>{built.stats.labelCount} labels</span>
        <span>{built.stats.edgeCount} edges</span>
        {built.stats.conditionalEdgeCount > 0 && (
          <span>{built.stats.conditionalEdgeCount} conditional</span>
        )}
        {built.stats.brokenEdgeCount > 0 && (
          <span className="graph-stat-danger">
            {built.stats.brokenEdgeCount} broken
          </span>
        )}
        {built.stats.unreachableCount > 0 && (
          <span className="graph-stat-warn">
            {built.stats.unreachableCount} unreachable
          </span>
        )}
        {savedLayouts.size > 0 && (
          <button
            type="button"
            className="graph-stat-reset"
            onClick={() => {
              void onResetLayout();
            }}
            title="Discard your manual positions and re-run auto layout"
          >
            Reset layout
          </button>
        )}
      </div>
      <button
        type="button"
        className="graph-search-trigger"
        onClick={() => setSearchOpen(true)}
        title="Search labels"
      >
        <span className="graph-search-trigger-icon">⌕</span>
        <span className="graph-search-trigger-text">Search labels</span>
        <span className="graph-search-trigger-kbd">
          {isMac() ? "⌘" : "Ctrl"} K
        </span>
      </button>
      <LabelInspector
        selected={selectedLabelNode}
        sourceRows={rows ?? []}
        inboundLabels={inboundLabels}
        knownLabels={knownLabels}
        onJumpToLabel={onJumpToLabel}
        onOpenScene={onOpenSelectedScene}
        onClose={onCloseInspector}
      />
      <LabelSearch
        open={searchOpen}
        items={searchItems}
        onJumpToLabel={onJumpToLabel}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  );
}
