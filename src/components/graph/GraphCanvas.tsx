import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { listPhotos } from "../../lib/photosDb";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Json } from "../../lib/database.types";
import type { RpyBlocks } from "../../lib/renpy/blocks";
import {
  buildGraph,
  type GraphBuildResult,
  type GraphCharacter,
  type GraphSourceRow,
} from "./graphBuild";
import { layoutGraph, type LabelNodeDatum } from "./graphLayout";
import { LabelInspector } from "./LabelInspector";
import { LabelNode } from "./SceneNode";
import { ChapterFrame } from "./ChapterFrame";
import { LabelSearch, type SearchItem } from "./LabelSearch";
import { PathSimulator } from "./PathSimulator";
import { comparePaths, type CompareResult } from "./comparePaths";
import {
  appendJumpToLabel,
  nextSceneLabel,
  newSceneRpyBlocks,
  removeJumpFromLabel,
} from "./graphEdit";
import { StickyNoteNode, type StickyNoteDatum } from "./StickyNoteNode";
import { GroupRectangleNode, type GroupDatum } from "./GroupRectangleNode";
import { GraphBottomToolbar } from "./GraphBottomToolbar";

type CreateNodeOpts = {
  parentId?: string | null;
  kind?: "chapter" | "scene" | "block";
  title?: string;
};

type UpdateNodePatch = {
  title?: string;
  rpy_blocks?: RpyBlocks;
  rpy_label?: string | null;
  status?: string;
  pov?: string | null;
};

interface Props {
  projectId: string;
  workspaceId: string;
  /** Called when the user double-clicks a label node — navigates to Script. */
  onOpenScene: (sceneId: string) => void;
  /** Project-scoped scene creator from useScripts — Phase 3 right-click. */
  createNode: (opts?: CreateNodeOpts) => Promise<string | null>;
  /** Update an existing scene's fields. Used by Phase 3 drag-to-connect
   *  to inject `jump <target>` into the source scene's rpy_blocks. */
  updateNode: (id: string, patch: UpdateNodePatch) => Promise<void>;
  /** Cascade-delete a scene (and its DB children). Used by the Delete /
   *  Backspace key when a label node is selected on the canvas. */
  deleteNode: (id: string) => Promise<void>;
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
  pov: string | null;
  photo_id: string | null;
};

type CharacterRow = {
  id: string;
  name: string;
  color: string;
};

type LayoutRow = {
  label_name: string;
  x: number;
  y: number;
};

const nodeTypes = {
  label: LabelNode,
  note: StickyNoteNode,
  group: GroupRectangleNode,
  chapter_frame: ChapterFrame,
};

interface AnnotationRow {
  id: string;
  project_id: string;
  workspace_id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

interface GroupRow {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  color: string;
  label_names: string[];
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

/**
 * Quick-filter chips on the canvas overlay. Each chip narrows the visible
 * graph to one integrity / structure dimension. Non-matching nodes are
 * dimmed (not removed) so the spatial map stays the same — important for
 * authors who learned where things sit. Edges incident to a dimmed node
 * dim too.
 */
type FilterMode =
  | "all"
  | "orphan"
  | "unreachable"
  | "ending"
  | "choices"
  | "broken";

function matchesFilter(d: LabelNodeDatum, mode: FilterMode): boolean {
  switch (mode) {
    case "all":
      return true;
    case "orphan":
      return d.isOrphan && !d.isEntry;
    case "unreachable":
      return d.isUnreachable && !d.isEntry;
    case "ending":
      return d.isEnding && !d.isEntry;
    case "choices":
      return d.choiceTexts.length > 0;
    case "broken":
      return d.brokenOutboundCount > 0;
  }
}

/**
 * Spawn (or recycle) the standalone Path Simulator window in fullscreen.
 *
 * Tauri WebviewWindows are identified by a stable label — `simulator` —
 * so we never end up with two simulator windows fighting each other.
 * The flow:
 *   1. If a `simulator` window already exists, close it (its URL is
 *      fixed at creation, so we can't just refocus it for a different
 *      project) and wait briefly for the close to flush.
 *   2. Create a fresh window pointing at the same `index.html` with a
 *      `?simulator=1&projectId=<uuid>` query — `App.tsx` reads
 *      `WINDOW_LABEL === "simulator"` and dispatches to
 *      `SimulatorWindow`, which fetches the project rows and mounts the
 *      `<PathSimulator />` overlay full-screen.
 *
 * Returns `true` when the window was successfully created, `false` when
 * the API isn't available (e.g. running in a plain browser tab during
 * `pnpm dev`). The caller falls back to the in-app overlay in that case.
 */
async function openSimulatorWindow(
  projectId: string,
  startLabel: string | null,
): Promise<boolean> {
  try {
    const existing = await WebviewWindow.getByLabel("simulator");
    if (existing) {
      try {
        await existing.close();
      } catch (e) {
        console.warn("simulator window: close existing failed", e);
      }
      // Tauri tears the window down asynchronously; give it a tick so
      // the next `new WebviewWindow('simulator', …)` doesn't race
      // against a still-existing label.
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
    }
    const params = new URLSearchParams({
      simulator: "1",
      projectId,
    });
    if (startLabel) params.set("start", startLabel);
    const url = `index.html?${params.toString()}`;
    const win = new WebviewWindow("simulator", {
      url,
      title: "Path simulator",
      // Real OS fullscreen — borderless, edge-to-edge. The user exits
      // via Esc (the simulator's onClose calls window.close()) or via
      // the OS's standard fullscreen toggle.
      fullscreen: true,
      decorations: false,
      visible: true,
      focus: true,
    });
    // Surface Tauri-side creation failures (e.g. permission denied) so
    // they don't silently disappear into the void.
    win.once("tauri://error", (e) => {
      console.error("simulator window error", e);
    });
    return true;
  } catch (e) {
    console.warn("openSimulatorWindow failed, falling back to overlay", e);
    return false;
  }
}

function GraphCanvasInner({
  projectId,
  workspaceId,
  onOpenScene,
  createNode,
  updateNode,
  deleteNode,
}: Props) {
  const { t } = useTranslation();
  const { setCenter, fitView, getViewport } = useReactFlow();
  /** Wraps the canvas + overlays — used to compute viewport-centre for
   *  inserting a sticky note at the user's current attention. */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<GraphSourceRow[] | null>(null);
  const [characters, setCharacters] = useState<GraphCharacter[]>([]);
  /** Sticky-note annotations on the canvas. Lives separately from
   *  `nodes` (which xyflow controls) so realtime updates can flow in
   *  without fighting drag state. We merge them into displayed nodes
   *  via memo. */
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([]);
  /** Named coloured groups overlaid behind label clusters. Same pattern
   *  as annotations: separate state, realtime-fed, merged into displayed
   *  nodes via memo (sorted to render BEHIND labels). */
  const [groups, setGroups] = useState<GroupRow[]>([]);
  /** Group whose edit popover is open. */
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  /** Saved overrides keyed by labelName. null = still loading. */
  const [savedLayouts, setSavedLayouts] = useState<Map<string, {
    x: number;
    y: number;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // -- Fetch script_nodes + graph_layouts + script_characters in parallel ----
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setSavedLayouts(null);
    setError(null);
    void (async () => {
      const [nodesRes, layoutsRes, charsRes, notesRes, groupsRes] =
        await Promise.all([
          supabase
            .from("script_nodes")
            .select(
              "id, parent_id, kind, title, emoji, status, position, rpy_label, rpy_blocks, pov, photo_id",
            )
            .eq("project_id", projectId)
            .order("position", { ascending: true }),
          supabase
            .from("graph_layouts")
            .select("label_name, x, y")
            .eq("project_id", projectId),
          supabase
            .from("script_characters")
            .select("id, name, color")
            .eq("project_id", projectId),
          supabase
            .from("graph_annotations")
            .select("id, project_id, workspace_id, x, y, text, color")
            .eq("project_id", projectId),
          supabase
            .from("graph_groups")
            .select("id, project_id, workspace_id, name, color, label_names")
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
      if (charsRes.error) {
        // Characters are nice-to-have (drives POV colour ring). Non-fatal —
        // missing colours just mean no rings, the graph still builds.
        console.warn("graph fetch characters", charsRes.error);
      }
      if (notesRes.error) {
        // Same — sticky notes are decoration on the canvas, not required
        // for the graph itself to render.
        console.warn("graph fetch annotations", notesRes.error);
      }
      if (groupsRes.error) {
        console.warn("graph fetch groups", groupsRes.error);
      }
      const list = (nodesRes.data ?? []) as ScriptNodeRow[];
      setRows(
        list.map((r) => ({
          ...r,
          rpy_blocks: (r.rpy_blocks as RpyBlocks | null) ?? null,
        })),
      );
      setCharacters((charsRes.data ?? []) as CharacterRow[]);
      setAnnotations((notesRes.data ?? []) as AnnotationRow[]);
      setGroups((groupsRes.data ?? []) as GroupRow[]);
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
    const buildResult = buildGraph(rows, characters);
    return { layout: layoutGraph(buildResult), stats: buildResult.stats };
  }, [rows, characters]);

  // -- xyflow controlled state ------------------------------------------
  // We type the state as the broad `FlowNode` so sticky-note nodes
  // (`type: "note"`) coexist with label nodes (`type: "label"`) — the
  // generic still maps via `data as LabelNodeDatum` where the call site
  // needs the narrow shape.
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    (built?.layout.nodes ?? []) as FlowNode[],
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

  // Edges refresh when the graph structure changes (new jumps, broken
  // targets). Nodes added through Phase 3 (drag-to-connect / new scene)
  // are appended below — existing nodes keep their dragged positions.
  useEffect(() => {
    if (!built || !savedLayouts) return;
    if (initializedForProject.current !== projectId) return;
    setEdges(built.layout.edges);
    setNodes((curr) => {
      const existingIds = new Set(curr.map((n) => n.id));
      const additions = built.layout.nodes
        .filter((bn) => !existingIds.has(bn.id))
        .map((bn) => {
          const saved = savedLayouts.get(bn.id);
          return saved
            ? { ...bn, position: { x: saved.x, y: saved.y } }
            : bn;
        });
      if (additions.length === 0) return curr;
      return [...curr, ...additions];
    });
  }, [built, savedLayouts, projectId, setEdges, setNodes]);

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
      // Split by xyflow type — labels go to graph_layouts (keyed by
      // label_name), notes go to graph_annotations (keyed by id). Both
      // fire as bulk-upserts to keep round-trips down on multi-drag.
      const labelRows: Array<{
        project_id: string;
        workspace_id: string;
        label_name: string;
        x: number;
        y: number;
      }> = [];
      const notePatches: Array<{ id: string; x: number; y: number }> = [];
      for (const n of toSave) {
        if (n.type === "note") {
          notePatches.push({ id: n.id, x: n.position.x, y: n.position.y });
        } else {
          labelRows.push({
            project_id: projectId,
            workspace_id: workspaceId,
            label_name: n.id,
            x: n.position.x,
            y: n.position.y,
          });
        }
      }
      if (labelRows.length > 0) {
        void supabase
          .from("graph_layouts")
          .upsert(labelRows, { onConflict: "project_id,label_name" })
          .then(({ error: err }) => {
            if (err) console.error("graph_layouts upsert", err);
          });
      }
      // graph_annotations doesn't have a composite conflict key — patch
      // each row by id. The count of notes dragged simultaneously is tiny
      // (usually 1, rarely a handful), so individual updates are fine.
      for (const p of notePatches) {
        void supabase
          .from("graph_annotations")
          .update({ x: p.x, y: p.y })
          .eq("id", p.id)
          .then(({ error: err }) => {
            if (err) console.error("graph_annotations move", err);
          });
      }
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

  // -- Phase 3: drag-to-connect & new scene from canvas ------------------
  /**
   * xyflow `onConnect` — fires when the user drags from one label's
   * source handle to another's target. We translate that into appending
   * a `jump <target>` block to the source label's segment in its scene's
   * `rpy_blocks`. The new edge appears automatically on the next render
   * because the build pipeline re-derives edges from rpy_blocks.
   */
  const onConnect = useCallback(
    (conn: { source: string | null; target: string | null }) => {
      if (!conn.source || !conn.target) return;
      if (conn.source === conn.target) return; // self-jump — nothing meaningful
      // Locate the scene that defines the source label. We search via
      // `rows` (the raw script_nodes) because the xyflow node only knows
      // sceneId, not the rpy_blocks payload we need to mutate.
      if (!rows) return;
      const sourceLabel = conn.source;
      let sourceScene: GraphSourceRow | null = null;
      for (const r of rows) {
        if (r.kind !== "scene" || !r.rpy_blocks) continue;
        const blocks = r.rpy_blocks;
        // Either an explicit label block matches, or scene.rpy_label
        // matches the implicit-segment case.
        if (
          blocks.some((b) => b.kind === "label" && b.name === sourceLabel) ||
          r.rpy_label === sourceLabel
        ) {
          sourceScene = r;
          break;
        }
      }
      if (!sourceScene || !sourceScene.rpy_blocks) {
        console.warn("onConnect: source label not in any scene", sourceLabel);
        return;
      }
      const newBlocks = appendJumpToLabel(
        sourceScene.rpy_blocks,
        sourceLabel,
        conn.target,
      );
      if (!newBlocks) return; // idempotent: jump already exists
      // Optimistic — patch rows locally so the rebuild picks the new edge
      // up immediately, then await the DB write.
      setRows((curr) =>
        curr
          ? curr.map((r) =>
              r.id === sourceScene!.id ? { ...r, rpy_blocks: newBlocks } : r,
            )
          : curr,
      );
      void updateNode(sourceScene.id, { rpy_blocks: newBlocks });
    },
    [rows, updateNode],
  );

  // Figma-style tool mode. Drives cursor, panOnDrag, and pane-click
  // dispatch. Resets to "select" after a creation tool fires once.
  const [toolMode, setToolMode] = useState<ToolMode>("select");

  /** Convert a screen-space mouse event into the canvas's flow-coords.
   *  Used by every tool that creates something at the click point. */
  const eventToFlowCoords = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const wrap = wrapRef.current;
      if (!wrap) return null;
      const rect = wrap.getBoundingClientRect();
      const vp = getViewport();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      return { x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
    },
    [getViewport],
  );

  /** Spawns a new scene at the supplied flow-coords. Picks a unique
   *  rpy_label, seeds the rpy_blocks, pins the layout, then reverts the
   *  tool mode so the next click is a regular selection. */
  const createSceneAt = useCallback(
    async (cx: number, cy: number) => {
      const used = new Set<string>();
      for (const n of nodes) {
        if (n.type === "label" || !n.type) used.add(n.id);
      }
      const label = nextSceneLabel(used);
      const newId = await createNode({ kind: "scene", title: label });
      if (!newId) return;
      const seededBlocks = newSceneRpyBlocks(label);
      await updateNode(newId, {
        rpy_label: label,
        rpy_blocks: seededBlocks,
      });
      // Pin the layout BEFORE the optimistic rows-push so the saved
      // layout effect (which only fires once per project) sees the
      // position when it merges. The build itself reads positions from
      // `savedLayouts`, which we update in parallel below.
      void supabase.from("graph_layouts").upsert(
        {
          project_id: projectId,
          workspace_id: workspaceId,
          label_name: label,
          x: cx - NODE_WIDTH / 2,
          y: cy - NODE_HEIGHT / 2,
        },
        { onConflict: "project_id,label_name" },
      );
      // Push the new scene into local rows state so the graph rebuild
      // picks it up immediately — Graph doesn't subscribe to realtime
      // for script_nodes (the editor owns that), so without this nudge
      // the new node wouldn't appear until the user reloads the screen.
      // Position values mirror the kanban-store optimistic insert:
      // tail-of-list `position`, "scene" kind, empty body / metadata.
      setRows((curr) => {
        if (!curr) return curr;
        if (curr.some((r) => r.id === newId)) return curr;
        return [
          ...curr,
          {
            id: newId,
            parent_id: null,
            kind: "scene" as const,
            title: label,
            emoji: null,
            status: "draft",
            position: Date.now(),
            rpy_label: label,
            rpy_blocks: seededBlocks,
            pov: null,
          },
        ];
      });
      // Mirror the new position into the in-memory layouts map so the
      // initial seeding effect doesn't drop it if it fires later.
      setSavedLayouts((curr) => {
        const next = new Map(curr ?? new Map());
        next.set(label, {
          x: cx - NODE_WIDTH / 2,
          y: cy - NODE_HEIGHT / 2,
        });
        return next;
      });
      setToolMode("select");
    },
    [nodes, createNode, updateNode, projectId, workspaceId],
  );

  /** Click on the empty pane — dispatches per active tool. Select/pan
   *  don't create anything (the default xyflow behaviour applies). */
  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (toolMode === "select" || toolMode === "pan") return;
      const coords = eventToFlowCoords(e);
      if (!coords) return;
      if (toolMode === "add-scene") {
        void createSceneAt(coords.x, coords.y);
      } else if (toolMode === "add-note") {
        // Inline insert at the clicked point — mirrors onAddNote logic
        // but uses event coords instead of viewport centre.
        void supabase
          .from("graph_annotations")
          .insert({
            project_id: projectId,
            workspace_id: workspaceId,
            x: coords.x - 100,
            y: coords.y - 40,
            text: "",
            color: "yellow",
          })
          .select()
          .single()
          .then(({ data, error: err }) => {
            if (err) {
              console.error("graph_annotations insert", err);
              return;
            }
            if (data) {
              setAnnotations((curr) => {
                if (curr.some((a) => a.id === data.id)) return curr;
                return [...curr, data as AnnotationRow];
              });
            }
          });
        setToolMode("select");
      }
    },
    [toolMode, eventToFlowCoords, createSceneAt, projectId, workspaceId],
  );

  // Keyboard shortcuts: Esc cancels back to select; single-letter keys
  // pick tools (V/H/S/N — chosen for muscle-memory parity with Figma).
  // We don't react when an input/textarea has focus so users editing
  // a sticky-note can type "v" without warping their tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape" && toolMode !== "select") {
        setToolMode("select");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "v") setToolMode("select");
      else if (k === "h") setToolMode("pan");
      else if (k === "s") setToolMode("add-scene");
      else if (k === "n") setToolMode("add-note");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolMode]);

  // -- Sticky-note CRUD --------------------------------------------------
  // The legacy "+ Note" button in the v0.3 top strip created a note at
  // viewport centre via an `onAddNote` callback. The v0.4 top toolbar
  // replaced it with the "Add note" tool mode (click anywhere on canvas
  // to drop) — see `addNoteAt(coords)` paths below. The viewport-centre
  // insert can be reconstructed from `getViewport()` + a canvas insert
  // when a future keyboard shortcut needs it.

  const onNoteTextChange = useCallback((id: string, text: string) => {
    setAnnotations((curr) =>
      curr.map((a) => (a.id === id ? { ...a, text } : a)),
    );
    void supabase
      .from("graph_annotations")
      .update({ text })
      .eq("id", id)
      .then(({ error: err }) => {
        if (err) console.error("graph_annotations text", err);
      });
  }, []);

  const onNoteColorChange = useCallback((id: string, color: string) => {
    setAnnotations((curr) =>
      curr.map((a) => (a.id === id ? { ...a, color } : a)),
    );
    void supabase
      .from("graph_annotations")
      .update({ color })
      .eq("id", id)
      .then(({ error: err }) => {
        if (err) console.error("graph_annotations color", err);
      });
  }, []);

  const onNoteDelete = useCallback((id: string) => {
    setAnnotations((curr) => curr.filter((a) => a.id !== id));
    void supabase
      .from("graph_annotations")
      .delete()
      .eq("id", id)
      .then(({ error: err }) => {
        if (err) console.error("graph_annotations delete", err);
      });
  }, []);

  // Realtime subscription — keep notes in sync when collaborators edit /
  // add / move / delete them. We use a fresh channel id per mount so
  // React Strict-Mode double-subscribe doesn't collide on the channel name.
  useEffect(() => {
    const channelId = crypto.randomUUID();
    const ch = supabase
      .channel(`graph_annotations:${projectId}:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "graph_annotations",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as AnnotationRow;
            setAnnotations((curr) =>
              curr.some((a) => a.id === row.id) ? curr : [...curr, row],
            );
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as AnnotationRow;
            setAnnotations((curr) =>
              curr.map((a) => (a.id === row.id ? row : a)),
            );
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as { id?: string };
            if (!row.id) return;
            setAnnotations((curr) => curr.filter((a) => a.id !== row.id));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [projectId]);

  // -- Group CRUD --------------------------------------------------------
  const onCreateGroup = useCallback(
    (labelNames: string[]) => {
      if (labelNames.length === 0) return;
      void supabase
        .from("graph_groups")
        .insert({
          project_id: projectId,
          workspace_id: workspaceId,
          name: "",
          color: "blue",
          label_names: labelNames,
        })
        .select()
        .single()
        .then(({ data, error: err }) => {
          if (err) {
            console.error("graph_groups insert", err);
            return;
          }
          if (data) {
            const row = data as GroupRow;
            setGroups((curr) =>
              curr.some((g) => g.id === row.id) ? curr : [...curr, row],
            );
            setOpenGroupId(row.id);
          }
        });
    },
    [projectId, workspaceId],
  );

  const onGroupRename = useCallback((id: string, name: string) => {
    setGroups((curr) => curr.map((g) => (g.id === id ? { ...g, name } : g)));
    void supabase
      .from("graph_groups")
      .update({ name })
      .eq("id", id)
      .then(({ error: err }) => {
        if (err) console.error("graph_groups rename", err);
      });
  }, []);

  const onGroupRecolor = useCallback((id: string, color: string) => {
    setGroups((curr) => curr.map((g) => (g.id === id ? { ...g, color } : g)));
    void supabase
      .from("graph_groups")
      .update({ color })
      .eq("id", id)
      .then(({ error: err }) => {
        if (err) console.error("graph_groups recolor", err);
      });
  }, []);

  const onGroupDelete = useCallback((id: string) => {
    setGroups((curr) => curr.filter((g) => g.id !== id));
    if (openGroupId === id) setOpenGroupId(null);
    void supabase
      .from("graph_groups")
      .delete()
      .eq("id", id)
      .then(({ error: err }) => {
        if (err) console.error("graph_groups delete", err);
      });
  }, [openGroupId]);

  /** Delete/Backspace handler — removes whatever's currently selected on
   *  the canvas. Handles every selectable type:
   *    - label node → cascade-delete the scene (and DB children)
   *    - sticky note → delete the annotation row
   *    - group → delete the group row (labels stay put)
   *    - edge (only top-level jump/call origins) → strip the jump block
   *      from the source scene's rpy_blocks
   *  Implicit fall-through edges and edges nested inside menu/conditional
   *  can't be deleted from the canvas (would silently drop authorial
   *  intent); we leave those alone with a debug log.
   */
  const onDeleteSelected = useCallback(() => {
    const selLabels: string[] = [];
    const selNoteIds: string[] = [];
    const selGroupIds: string[] = [];
    for (const n of nodes) {
      if (!n.selected) continue;
      if (n.type === "note") {
        selNoteIds.push(n.id);
      } else if (n.type === "group") {
        selGroupIds.push(n.id.replace(/^group-/, ""));
      } else if (n.type === "label" || !n.type) {
        selLabels.push(n.id);
      }
    }
    const selEdges = edges.filter((e) => e.selected);

    // Delete edges first — they reference scenes that nodes below would
    // remove anyway, so processing in this order avoids touching freed rows.
    for (const e of selEdges) {
      const origin = (e.data as { origin?: string } | undefined)?.origin;
      // Only top-level jump/call edges are safe to remove via a single
      // block strip. Menu / conditional / fallthrough need their parent
      // construct edited — out of scope for the canvas Delete key.
      if (origin !== "jump" && origin !== "call") {
        console.warn(
          "Delete edge: skipping non-top-level edge",
          e.id,
          origin,
        );
        continue;
      }
      if (!rows) continue;
      const sourceLabel = e.source;
      const target = e.target;
      const scene = rows.find(
        (r) =>
          r.kind === "scene" &&
          !!r.rpy_blocks &&
          (r.rpy_blocks!.some(
            (b) => b.kind === "label" && b.name === sourceLabel,
          ) ||
            r.rpy_label === sourceLabel),
      );
      if (!scene || !scene.rpy_blocks) continue;
      const newBlocks = removeJumpFromLabel(
        scene.rpy_blocks,
        sourceLabel,
        target,
        origin,
      );
      if (!newBlocks) continue;
      setRows((curr) =>
        curr
          ? curr.map((r) =>
              r.id === scene.id ? { ...r, rpy_blocks: newBlocks } : r,
            )
          : curr,
      );
      void updateNode(scene.id, { rpy_blocks: newBlocks });
    }

    // Sticky notes — already optimistic-removed inside onNoteDelete.
    for (const id of selNoteIds) onNoteDelete(id);
    // Groups — same pattern.
    for (const id of selGroupIds) onGroupDelete(id);

    // Label/scene deletes go last because they cascade locally (rows
    // filter + xyflow nodes filter). Map each label back to its sceneId,
    // which is what deleteNode wants.
    if (selLabels.length > 0 && rows) {
      const sceneIdsToDelete = new Set<string>();
      for (const labelName of selLabels) {
        const scene = rows.find(
          (r) =>
            r.kind === "scene" &&
            (r.rpy_label === labelName ||
              (r.rpy_blocks ?? []).some(
                (b) => b.kind === "label" && b.name === labelName,
              )),
        );
        if (scene) sceneIdsToDelete.add(scene.id);
      }
      if (sceneIdsToDelete.size > 0) {
        setRows((curr) =>
          curr ? curr.filter((r) => !sceneIdsToDelete.has(r.id)) : curr,
        );
        setNodes((curr) =>
          curr.filter((n) => {
            if (n.type !== "label" && n.type) return true;
            return !selLabels.includes(n.id);
          }),
        );
        for (const sid of sceneIdsToDelete) void deleteNode(sid);
      }
    }
  }, [
    nodes,
    edges,
    rows,
    deleteNode,
    updateNode,
    onNoteDelete,
    onGroupDelete,
    setNodes,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      // Only fire when there's something to delete — otherwise xyflow's
      // internals can swallow the keystroke for other purposes.
      const hasSel =
        nodes.some((n) => n.selected) || edges.some((e2) => e2.selected);
      if (!hasSel) return;
      e.preventDefault();
      onDeleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, edges, onDeleteSelected]);

  // Realtime for groups — same shape as annotations subscription. Note we
  // pre-check id-membership on INSERT to avoid duplicating our own
  // optimistic insert from `onCreateGroup`.
  useEffect(() => {
    const channelId = crypto.randomUUID();
    const ch = supabase
      .channel(`graph_groups:${projectId}:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "graph_groups",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as GroupRow;
            setGroups((curr) =>
              curr.some((g) => g.id === row.id) ? curr : [...curr, row],
            );
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as GroupRow;
            setGroups((curr) =>
              curr.map((g) => (g.id === row.id ? row : g)),
            );
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as { id?: string };
            if (!row.id) return;
            setGroups((curr) => curr.filter((g) => g.id !== row.id));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [projectId]);

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

  // Coverage panel (small fly-out with reachable% + path-length numbers).
  // Closed by default; opens via the "Coverage" button in the stats overlay.
  const [coverageOpen, setCoverageOpen] = useState(false);

  // Path simulator overlay. Lets the author walk their VN like a player
  // would, picking through choices step by step. Opens via the "▶ Simulate"
  // button in the stats overlay; closes on Esc / backdrop click.
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [simulatorStart, setSimulatorStart] = useState<string | null>(null);

  // "Auto-match photos" status — shown briefly as a toast next to the
  // toolbar button so the user knows how many bindings just landed.
  const [autoMatchToast, setAutoMatchToast] = useState<string | null>(null);
  const autoMatchInFlightRef = useRef(false);

  /** Try to bind every still-unbound scene to a photo whose filename
   *  matches its `rpy_label`. Match is case-insensitive on the filename
   *  stem (everything before the LAST dot), so `Detective_1.jpg`,
   *  `detective_1.JPG`, and `detective_1.png` all match a `detective_1`
   *  label. Nodes that already have a `photo_id` are skipped — the user
   *  may have hand-picked something different, and we don't want to
   *  silently overwrite that choice. Returns a summary string for the
   *  toast: `"Bound 23 of 35 scenes"` etc. */
  const autoMatchPhotos = useCallback(async () => {
    if (autoMatchInFlightRef.current) return;
    autoMatchInFlightRef.current = true;
    try {
      setAutoMatchToast("Matching…");
      const photos = await listPhotos();
      // Two indices, tried in order so an exact match wins over a loose
      // prefix one. Both maps key on a lowercased "stem" — everything
      // before the LAST dot — so casing and extension don't matter.
      const exactByStem = new Map<string, string>();
      // Loose index: stems that start with `<key>_`, `<key>-`, or
      // `<key>.`. Built lazily inside the match loop below to avoid an
      // O(N×M) pre-pass when nothing matches.
      type StemEntry = { stem: string; id: string };
      const photoStems: StemEntry[] = [];
      for (const p of photos) {
        const name = p.name ?? "";
        const dot = name.lastIndexOf(".");
        const stem = (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();
        if (!stem) continue;
        photoStems.push({ stem, id: p.id });
        if (!exactByStem.has(stem)) exactByStem.set(stem, p.id);
      }
      const current = rows ?? [];
      const planned: Array<{ id: string; photo_id: string }> = [];
      // Collect unmatched candidates for the console diagnostic at the
      // end — far more useful than a generic "No new matches" when the
      // user has thousands of photos and dozens of scenes that should
      // have hit something.
      const unmatched: Array<{
        title: string | null;
        rpy_label: string | null;
        bg: string | null;
      }> = [];
      for (const r of current) {
        if (r.photo_id) continue; // respect hand-picked bindings
        // Match-key candidates, tried in order of how specific they are
        // for a VN scene:
        //   1. The Ren'Py `scene <bg>` background tag — the closest
        //      thing to an actual image filename in the script. Photos
        //      tend to be named after this (`pool_kira_14.jpg`), not
        //      after the scene label.
        //   2. The label — works for projects where someone named the
        //      photo after the scene (`detective_1.jpg`).
        //   3. The display title — last-resort fallback for projects
        //      that don't use Ren'Py labels at all.
        const firstSceneBg = (() => {
          const blocks = r.rpy_blocks;
          if (!blocks || !Array.isArray(blocks)) return null;
          for (const b of blocks) {
            if (b && typeof b === "object" && (b as { kind?: string }).kind === "scene") {
              const bg = (b as { bg?: unknown }).bg;
              if (typeof bg === "string" && bg.trim()) return bg.trim();
            }
          }
          return null;
        })();
        // Build candidates with collapsed-whitespace variants too —
        // Ren'Py allows multi-word bg tags like `bg room day` which the
        // user might have stored on disk as `bg_room_day.jpg`.
        const rawCandidates: string[] = [];
        if (firstSceneBg) {
          rawCandidates.push(firstSceneBg);
          if (/\s/.test(firstSceneBg)) {
            rawCandidates.push(firstSceneBg.replace(/\s+/g, "_"));
            rawCandidates.push(firstSceneBg.replace(/\s+/g, "-"));
            // First whitespace-separated token alone — covers the
            // common `bg <name>` convention where the leading `bg`
            // prefix isn't part of the asset filename.
            const firstTok = firstSceneBg.split(/\s+/)[0];
            if (firstTok) rawCandidates.push(firstTok);
            // Everything AFTER an initial `bg ` prefix.
            const stripped = firstSceneBg.replace(/^bg\s+/i, "");
            if (stripped && stripped !== firstSceneBg) {
              rawCandidates.push(stripped);
              rawCandidates.push(stripped.replace(/\s+/g, "_"));
            }
          }
        }
        if (r.rpy_label) rawCandidates.push(r.rpy_label);
        if (r.title) rawCandidates.push(r.title);
        const candidates = rawCandidates
          .map((v) => v.toLowerCase().trim())
          .filter((v) => v.length > 0);
        if (candidates.length === 0) continue;
        let matchId: string | null = null;
        // Pass 1: exact stem match.
        for (const c of candidates) {
          const hit = exactByStem.get(c);
          if (hit) {
            matchId = hit;
            break;
          }
        }
        // Pass 2: loose prefix match — photo stem begins with the label
        // followed by a word-boundary separator. Lets `detective_1` bind
        // to `detective_1_v2.jpg` etc. First match in photo-iteration
        // order wins (deterministic across runs because `listPhotos`
        // returns a stable order).
        if (!matchId) {
          for (const c of candidates) {
            for (const ph of photoStems) {
              if (
                ph.stem.length > c.length &&
                ph.stem.startsWith(c) &&
                /[_\-. ]/.test(ph.stem.charAt(c.length))
              ) {
                matchId = ph.id;
                break;
              }
            }
            if (matchId) break;
          }
        }
        if (matchId) {
          planned.push({ id: r.id, photo_id: matchId });
        } else {
          unmatched.push({
            title: r.title ?? null,
            rpy_label: r.rpy_label ?? null,
            bg: firstSceneBg,
          });
        }
      }
      if (planned.length === 0) {
        // Dump a diagnostic so the user can see WHY nothing matched —
        // this is the lever that turns "No new matches" from useless
        // into actionable.
        console.info("[auto-match photos] no matches", {
          scenes: current.length,
          photos: photos.length,
          firstScenesWithoutPhoto: unmatched.slice(0, 20),
          firstPhotoStems: photoStems.slice(0, 20).map((p) => p.stem),
        });
        setAutoMatchToast(
          current.length === 0
            ? "No scenes yet"
            : "No new matches (see console)",
        );
        return;
      }
      if (unmatched.length > 0) {
        console.info("[auto-match photos] partial", {
          matched: planned.length,
          unmatched: unmatched.slice(0, 30),
        });
      }
      // Bulk-update in chunks so a single huge payload doesn't get
      // rejected by PostgREST's URL length limit. Supabase has no batch-
      // update primitive on disparate values, so we issue one update per
      // node in parallel (cap concurrency so a 500-scene match doesn't
      // open 500 sockets at once).
      const CONCURRENCY = 8;
      let i = 0;
      let okCount = 0;
      const errors: string[] = [];
      const run = async () => {
        while (i < planned.length) {
          const idx = i++;
          const row = planned[idx];
          const { error } = await supabase
            .from("script_nodes")
            .update({ photo_id: row.photo_id } as never)
            .eq("id", row.id);
          if (error) {
            errors.push(error.message);
          } else {
            okCount++;
          }
        }
      };
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () => run()),
      );

      // Patch local rows so the graph re-renders immediately — otherwise
      // the user would have to refetch the project to see the matches.
      setRows((curr) =>
        curr
          ? curr.map((r) => {
              const hit = planned.find((p) => p.id === r.id);
              return hit ? { ...r, photo_id: hit.photo_id } : r;
            })
          : curr,
      );
      const total = rows?.length ?? 0;
      setAutoMatchToast(
        errors.length > 0
          ? `Bound ${okCount} (${errors.length} failed)`
          : `Bound ${okCount} of ${total} scene${total === 1 ? "" : "s"}`,
      );
    } catch (e) {
      console.error("autoMatchPhotos failed", e);
      setAutoMatchToast("Auto-match failed");
    } finally {
      autoMatchInFlightRef.current = false;
      // Toast clears itself after 3.2s — long enough to read, short
      // enough not to clutter the toolbar.
      setTimeout(() => setAutoMatchToast(null), 3200);
    }
  }, [rows]);

  // Compare-paths mode. Activated when the user has exactly two nodes
  // selected and clicks the "Compare" button. We snapshot the two ids so
  // the comparison survives a selection change (e.g. when the user clicks
  // a path-A node to inspect it). Clearing the highlight resets to null.
  const [compareTargets, setCompareTargets] = useState<
    [string, string] | null
  >(null);

  // -- Filter chip state -------------------------------------------------
  // Active filter narrows the visible graph by integrity / structure. We
  // dim non-matching nodes and their incident edges via className rather
  // than removing them so the spatial layout stays stable across toggles.
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const filterCounts = useMemo(() => {
    if (!built) {
      return { orphan: 0, unreachable: 0, ending: 0, choices: 0, broken: 0 };
    }
    let choices = 0;
    let broken = 0;
    for (const n of built.layout.nodes) {
      // Skip non-label nodes — chapter frames and any future synthetic
      // background nodes don't carry choiceTexts / brokenOutboundCount.
      if (n.type !== "label") continue;
      const d = n.data as LabelNodeDatum;
      if (d.choiceTexts.length > 0) choices += 1;
      if (d.brokenOutboundCount > 0) broken += 1;
    }
    return {
      orphan: built.stats.orphanCount,
      unreachable: built.stats.unreachableCount,
      ending: built.stats.endingCount,
      choices,
      broken,
    };
  }, [built]);

  // Apply the filter as a className mutation on the live xyflow state.
  // We deliberately keep `nodes`/`edges` as the source of truth (so drag
  // positions persist) and project the filter on top via className.
  const dimmedIds = useMemo<Set<string>>(() => {
    if (filterMode === "all") return new Set();
    const dim = new Set<string>();
    for (const n of nodes) {
      // Frames / notes / groups aren't filterable label data — skip so the
      // filter only ever dims actual labels (otherwise frames vanish).
      if (n.type !== "label") continue;
      const d = n.data as LabelNodeDatum;
      if (!matchesFilter(d, filterMode)) dim.add(n.id);
    }
    return dim;
  }, [nodes, filterMode]);

  // -- Reachability highlight on the focused node ------------------------
  // When exactly one node is selected, paint "what leads here" (ancestors,
  // BFS via reversed edges) one colour and "where this goes" (descendants,
  // BFS forward) another. Wins visually over the filter dimming — selecting
  // a node says "show me this node's neighbourhood", regardless of any
  // filter the user might have set first.
  const focusedNodeId = useMemo<string | null>(() => {
    const sel = nodes.filter((n) => n.selected);
    return sel.length === 1 ? sel[0].id : null;
  }, [nodes]);

  /** Exactly two selected LABEL nodes — drives the "Compare paths" chip. */
  const selectedTwo = useMemo<[string, string] | null>(() => {
    const sel = nodes.filter(
      (n) => n.selected && (n.type === "label" || !n.type),
    );
    if (sel.length !== 2) return null;
    return [sel[0].id, sel[1].id];
  }, [nodes]);

  /** Two-or-more selected label nodes — drives the "Group these" chip. */
  const selectedLabelIds = useMemo<string[]>(() => {
    return nodes
      .filter((n) => n.selected && (n.type === "label" || !n.type))
      .map((n) => n.id);
  }, [nodes]);

  const reachability = useMemo<{
    ancestors: Set<string>;
    descendants: Set<string>;
    ancestorEdgeIds: Set<string>;
    descendantEdgeIds: Set<string>;
  } | null>(() => {
    if (!focusedNodeId) return null;
    const fwd = new Map<string, string[]>();
    const rev = new Map<string, string[]>();
    for (const e of edges) {
      (fwd.get(e.source) ?? fwd.set(e.source, []).get(e.source)!).push(
        e.target,
      );
      (rev.get(e.target) ?? rev.set(e.target, []).get(e.target)!).push(
        e.source,
      );
    }
    const bfs = (start: string, adj: Map<string, string[]>) => {
      const visited = new Set<string>();
      const queue = [start];
      visited.add(start);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const next = adj.get(cur);
        if (!next) continue;
        for (const n of next) {
          if (visited.has(n)) continue;
          visited.add(n);
          queue.push(n);
        }
      }
      visited.delete(start);
      return visited;
    };
    const ancestors = bfs(focusedNodeId, rev);
    const descendants = bfs(focusedNodeId, fwd);
    const ancestorEdgeIds = new Set<string>();
    const descendantEdgeIds = new Set<string>();
    for (const e of edges) {
      // Ancestor edges go INTO an ancestor (or into focus from an ancestor).
      const intoFocusOrAncestor =
        e.target === focusedNodeId || ancestors.has(e.target);
      const fromAncestor =
        ancestors.has(e.source) || e.source === focusedNodeId;
      if (intoFocusOrAncestor && fromAncestor) ancestorEdgeIds.add(e.id);

      const fromFocusOrDescendant =
        e.source === focusedNodeId || descendants.has(e.source);
      const intoDescendant =
        descendants.has(e.target) || e.target === focusedNodeId;
      if (fromFocusOrDescendant && intoDescendant)
        descendantEdgeIds.add(e.id);
    }
    return { ancestors, descendants, ancestorEdgeIds, descendantEdgeIds };
  }, [focusedNodeId, edges]);

  // Compare-paths result. Recomputed whenever the user picks two endings
  // (via the Compare button below). Reuses the build's edges + node data —
  // pure call, no DB. Null when the user hasn't entered compare mode.
  const compareResult = useMemo<CompareResult | null>(() => {
    if (!compareTargets) return null;
    const [a, b] = compareTargets;
    const entry = nodes.find((n) => (n.data as LabelNodeDatum).isEntry)?.id;
    const meta = new Map<string, { id: string; wordCount: number }>();
    for (const n of nodes) {
      const d = n.data as LabelNodeDatum;
      meta.set(n.id, { id: n.id, wordCount: d.wordCount });
    }
    const compareEdges = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));
    return comparePaths({
      entry: entry ?? null,
      edges: compareEdges,
      nodes: meta,
      a,
      b,
    });
  }, [compareTargets, edges, nodes]);

  /** Group-rectangle xyflow nodes — sized to the bounding box of each
   *  group's label set + a padding ring so the labels feel "inside" the
   *  rect. Recomputed when labels move or groups change. We force
   *  `zIndex: 0` so they render BEHIND labels (default zIndex) and
   *  notes (zIndex: 2). */
  const GROUP_PAD = 32;
  const GROUP_HEADER = 22;
  const groupNodes = useMemo<FlowNode<GroupDatum>[]>(() => {
    if (groups.length === 0) return [];
    const positionById = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      if (n.type === "label" || !n.type) {
        positionById.set(n.id, { x: n.position.x, y: n.position.y });
      }
    }
    const out: FlowNode<GroupDatum>[] = [];
    for (const g of groups) {
      const present: Array<{ x: number; y: number }> = [];
      for (const name of g.label_names) {
        const p = positionById.get(name);
        if (p) present.push(p);
      }
      if (present.length === 0) continue;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of present) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + NODE_WIDTH > maxX) maxX = p.x + NODE_WIDTH;
        if (p.y + NODE_HEIGHT > maxY) maxY = p.y + NODE_HEIGHT;
      }
      out.push({
        id: `group-${g.id}`,
        type: "group",
        position: { x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_HEADER },
        style: {
          width: maxX - minX + GROUP_PAD * 2,
          height: maxY - minY + GROUP_PAD * 2 + GROUP_HEADER,
        },
        data: {
          name: g.name,
          color: g.color,
          size: present.length,
          onOpen: () => setOpenGroupId(g.id),
        },
        zIndex: 0,
        // The group rectangle isn't draggable in v1 — moving the whole
        // cluster would need to translate every label, and we'd rather
        // keep label-drag straightforward. Click-through allowed.
        draggable: false,
        selectable: true,
      });
    }
    return out;
  }, [groups, nodes]);

  /** Sync annotations → xyflow `nodes` state. Notes have to live in the
   *  controlled `nodes` so xyflow's drag pipeline applies changes through
   *  our `onNodesChange` handler — otherwise the drag visual would snap
   *  back every frame because the props would re-supply the original
   *  position. Existing note refs are preserved when their data hasn't
   *  changed so React/xyflow can skip work. */
  useEffect(() => {
    setNodes((curr) => {
      const existing = new Map(curr.map((n) => [n.id, n] as const));
      const next: FlowNode[] = [];
      // Carry over every non-note node unchanged.
      for (const n of curr) {
        if (n.type !== "note") next.push(n);
      }
      // Re-build the note slice from annotations, preserving the live
      // drag position from existing state when present (annotations'
      // x/y is the last *persisted* position — possibly stale during
      // a drag).
      for (const a of annotations) {
        const prior = existing.get(a.id);
        if (prior && prior.type === "note") {
          const oldData = prior.data as StickyNoteDatum;
          if (
            oldData.text === a.text &&
            oldData.color === a.color &&
            oldData.onSaveText === onNoteTextChange &&
            oldData.onChangeColor === onNoteColorChange &&
            oldData.onDelete === onNoteDelete
          ) {
            next.push(prior);
            continue;
          }
          next.push({
            ...prior,
            data: {
              ...oldData,
              text: a.text,
              color: a.color,
              onSaveText: onNoteTextChange,
              onChangeColor: onNoteColorChange,
              onDelete: onNoteDelete,
            },
          });
        } else {
          next.push({
            id: a.id,
            type: "note",
            position: { x: a.x, y: a.y },
            data: {
              text: a.text,
              color: a.color,
              onSaveText: onNoteTextChange,
              onChangeColor: onNoteColorChange,
              onDelete: onNoteDelete,
            },
            draggable: true,
            selectable: true,
          } as FlowNode);
        }
      }
      // Drop notes that were removed.
      // (Already implicitly dropped — we only push notes that are still
      // in `annotations`.)
      // Short-circuit when nothing changed in the note slice.
      const prevNotes = curr.filter((n) => n.type === "note");
      const nextNotes = next.filter((n) => n.type === "note");
      if (
        prevNotes.length === nextNotes.length &&
        prevNotes.every((n, i) => n === nextNotes[i])
      ) {
        return curr;
      }
      return next;
    });
  }, [annotations, onNoteTextChange, onNoteColorChange, onNoteDelete, setNodes]);

  /** Pure label slice of xyflow's `nodes` state — keeps the mode-class
   *  mutations focused on the actual story-flow labels. Notes get pulled
   *  out into their own slice (`noteNodes`) below. */
  const labelNodes = useMemo(
    () => nodes.filter((n) => n.type === "label" || !n.type),
    [nodes],
  );

  const displayedLabelNodes = useMemo(() => {
    if (compareResult) {
      const [a, b] = compareTargets!;
      return labelNodes.map((n) => {
        let cls = "";
        const inA = compareResult.branchA.nodeIds.has(n.id);
        const inB = compareResult.branchB.nodeIds.has(n.id);
        if (n.id === compareResult.lca) cls = "is-cmp-lca";
        else if (n.id === a) cls = "is-cmp-target-a";
        else if (n.id === b) cls = "is-cmp-target-b";
        else if (inA && inB) cls = "is-cmp-shared";
        else if (inA) cls = "is-cmp-branch-a";
        else if (inB) cls = "is-cmp-branch-b";
        else if (compareResult.commonNodeIds.has(n.id)) cls = "is-cmp-common";
        else cls = "is-cmp-outside";
        return { ...n, className: cls };
      });
    }
    if (reachability) {
      return labelNodes.map((n) => {
        let cls = "";
        if (n.id === focusedNodeId) cls = "is-reach-focus";
        else if (reachability.ancestors.has(n.id)) cls = "is-reach-ancestor";
        else if (reachability.descendants.has(n.id))
          cls = "is-reach-descendant";
        else cls = "is-reach-outside";
        return { ...n, className: cls };
      });
    }
    if (filterMode === "all") return labelNodes;
    return labelNodes.map((n) =>
      dimmedIds.has(n.id)
        ? { ...n, className: "is-dimmed" }
        : { ...n, className: "is-highlighted" },
    );
  }, [
    labelNodes,
    filterMode,
    dimmedIds,
    reachability,
    focusedNodeId,
    compareResult,
    compareTargets,
  ]);

  /** Notes from xyflow `nodes` state — they live there so drag flows
   *  through onNodesChange. We slice them out so the merge below can
   *  re-order: groups (background) → labels (mid) → notes (top). */
  const noteNodes = useMemo(
    () => nodes.filter((n) => n.type === "note"),
    [nodes],
  );

  /** Final node array passed to ReactFlow. Order matters for z-paint when
   *  zIndex isn't set: earlier nodes render first, behind later ones.
   *  Groups come first so they sit behind labels; notes come last so they
   *  paper-stack on top of everything. */
  const displayedNodes = useMemo(
    () =>
      [...groupNodes, ...displayedLabelNodes, ...noteNodes] as FlowNode[],
    [groupNodes, displayedLabelNodes, noteNodes],
  );

  const displayedEdges = useMemo(() => {
    if (compareResult) {
      const aOnly = new Set<string>();
      const bOnly = new Set<string>();
      const both = new Set<string>();
      for (const id of compareResult.branchA.edgeIds) {
        if (compareResult.branchB.edgeIds.has(id)) both.add(id);
        else aOnly.add(id);
      }
      for (const id of compareResult.branchB.edgeIds) {
        if (!both.has(id)) bOnly.add(id);
      }
      return edges.map((e) => {
        if (aOnly.has(e.id)) {
          return {
            ...e,
            style: {
              ...e.style,
              stroke: "var(--status-info)",
              strokeWidth: 2,
              opacity: 1,
            },
            animated: true,
          };
        }
        if (bOnly.has(e.id)) {
          return {
            ...e,
            style: {
              ...e.style,
              stroke: "var(--status-warn)",
              strokeWidth: 2,
              opacity: 1,
            },
            animated: true,
          };
        }
        if (compareResult.commonEdgeIds.has(e.id) || both.has(e.id)) {
          return {
            ...e,
            style: {
              ...e.style,
              stroke: "var(--text-2)",
              strokeWidth: 1.6,
              opacity: 0.8,
            },
          };
        }
        return { ...e, style: { ...e.style, opacity: 0.08 } };
      });
    }
    if (reachability) {
      return edges.map((e) => {
        const isAncestor = reachability.ancestorEdgeIds.has(e.id);
        const isDescendant = reachability.descendantEdgeIds.has(e.id);
        if (isAncestor) {
          return {
            ...e,
            style: { ...e.style, stroke: "var(--status-info)", opacity: 1 },
            animated: true,
          };
        }
        if (isDescendant) {
          return {
            ...e,
            style: { ...e.style, stroke: "var(--status-ok)", opacity: 1 },
            animated: true,
          };
        }
        return { ...e, style: { ...e.style, opacity: 0.1 } };
      });
    }
    if (filterMode === "all") return edges;
    return edges.map((e) => {
      const dim = dimmedIds.has(e.source) || dimmedIds.has(e.target);
      return dim ? { ...e, style: { ...e.style, opacity: 0.15 } } : e;
    });
  }, [edges, filterMode, dimmedIds, reachability, compareResult]);

  // Cmd/Ctrl+F — fit-to-selection if any nodes are selected, otherwise
  // fit-to-filtered (or all when no filter). Lets the user zoom out to
  // see a meaningful subset after rubber-band select or filter narrowing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f")) return;
      e.preventDefault();
      const selected = nodes.filter((n) => n.selected).map((n) => ({ id: n.id }));
      if (selected.length > 0) {
        fitView({ nodes: selected, padding: 0.25, duration: 400, maxZoom: 1.2 });
        return;
      }
      if (filterMode !== "all") {
        const matching = nodes
          .filter((n) => !dimmedIds.has(n.id))
          .map((n) => ({ id: n.id }));
        if (matching.length > 0) {
          fitView({
            nodes: matching,
            padding: 0.25,
            duration: 400,
            maxZoom: 1.2,
          });
          return;
        }
      }
      fitView({ padding: 0.2, duration: 400, maxZoom: 1.2 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, dimmedIds, filterMode, fitView]);

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
          isOrphan: d.isOrphan,
          isUnreachable: d.isUnreachable,
          isEnding: d.isEnding,
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
    return <div className="graph-loading">{t("graph.loading_scenes")}</div>;
  }
  if (error) {
    return <div className="graph-error">{t("graph.load_error", { error })}</div>;
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
    <div
      className={"graph-canvas-wrap is-tool-" + toolMode}
      ref={wrapRef}
      // Suppress the browser's native context menu — we don't use right-
      // click for any in-app actions, so this is purely about not leaking
      // the OS menu through over minimap / controls / edges.
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Minimal canvas-topbar — Figma/Miro pattern. Stats inline on the
          left, Simulate (and Reset, when a saved layout exists) as quiet
          ghost buttons on the right. The actual tool palette lives as a
          floating capsule at the bottom of the canvas — see
          `GraphBottomToolbar`. Search opens via ⌘K or its icon down there. */}
      <div className="graph-canvas-bar">
        <div className="graph-meta">
          <span className="graph-meta-num">{built.stats.labelCount}</span>
          <span className="graph-meta-lbl">labels</span>
          <span className="graph-meta-sep" aria-hidden>·</span>
          <span className="graph-meta-num">{built.stats.edgeCount}</span>
          <span className="graph-meta-lbl">edges</span>
          {built.stats.endingCount > 0 && (
            <>
              <span className="graph-meta-sep" aria-hidden>·</span>
              <span className="graph-meta-num">{built.stats.endingCount}</span>
              <span className="graph-meta-lbl">ending</span>
            </>
          )}
          {built.stats.brokenEdgeCount > 0 && (
            <>
              <span className="graph-meta-sep" aria-hidden>·</span>
              <span className="graph-meta-num is-danger">
                {built.stats.brokenEdgeCount}
              </span>
              <span className="graph-meta-lbl">broken</span>
            </>
          )}
          {built.stats.orphanCount > 0 && (
            <>
              <span className="graph-meta-sep" aria-hidden>·</span>
              <span className="graph-meta-num is-warn">
                {built.stats.orphanCount}
              </span>
              <span className="graph-meta-lbl">orphan</span>
            </>
          )}
        </div>

        {autoMatchToast && (
          <span
            className="graph-automatch-toast"
            role="status"
            aria-live="polite"
          >
            {autoMatchToast}
          </span>
        )}

        <span className="tmt-spacer" />

        {savedLayouts.size > 0 && (
          <button
            type="button"
            className="graph-ghost-btn"
            onClick={() => void onResetLayout()}
          >
            {t("graph.reset_layout")}
          </button>
        )}

        <button
          type="button"
          className="graph-ghost-btn is-primary"
          onClick={() => {
            const sel = nodes.find((n) => n.selected);
            const start = sel ? sel.id : null;
            void (async () => {
              const ok = await openSimulatorWindow(projectId, start);
              if (!ok) {
                setSimulatorStart(start);
                setSimulatorOpen(true);
              }
            })();
          }}
        >
          ▶ {t("graph.simulate")}
        </button>
      </div>

      <div className="graph-canvas-stage">
      <ReactFlow
        nodes={displayedNodes}
        edges={displayedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={toolMode !== "pan" && toolMode !== "add-scene" && toolMode !== "add-note"}
        nodesConnectable={toolMode === "select"}
        elementsSelectable={toolMode === "select"}
        // Pan-tool: left-button also pans (drag-to-scroll). Other tools
        // keep the default mid/right-button pan so the left button is
        // free to do tool work (place, select, etc.).
        panOnDrag={toolMode === "pan" ? true : [1, 2]}
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
      {coverageOpen && <CoveragePanel stats={built.stats} />}
      {selectedTwo && !compareResult && (
        <button
          type="button"
          className="graph-compare-chip"
          onClick={() => setCompareTargets(selectedTwo)}
          title="Find the divergence point (LCA) between these two labels and colour the two paths"
        >
          <span className="graph-compare-chip-dot is-a" />
          <span className="graph-compare-chip-label">{selectedTwo[0]}</span>
          <span className="graph-compare-chip-sep">vs.</span>
          <span className="graph-compare-chip-dot is-b" />
          <span className="graph-compare-chip-label">{selectedTwo[1]}</span>
          <span className="graph-compare-chip-cta">Compare paths →</span>
        </button>
      )}
      {selectedLabelIds.length >= 2 && !compareResult && (
        <button
          type="button"
          className="graph-group-chip"
          onClick={() => onCreateGroup(selectedLabelIds)}
          title={`Group ${selectedLabelIds.length} selected labels into a coloured rectangle`}
        >
          ⌗ Group {selectedLabelIds.length} labels
        </button>
      )}
      {openGroupId && (
        <GroupEditPanel
          group={groups.find((g) => g.id === openGroupId) ?? null}
          onRename={onGroupRename}
          onRecolor={onGroupRecolor}
          onDelete={onGroupDelete}
          onClose={() => setOpenGroupId(null)}
        />
      )}
      {compareResult && compareTargets && (
        <ComparePanel
          result={compareResult}
          targetA={compareTargets[0]}
          targetB={compareTargets[1]}
          onJumpToLabel={onJumpToLabel}
          onExit={() => setCompareTargets(null)}
        />
      )}
      <FilterToolbar
        mode={filterMode}
        counts={filterCounts}
        onChange={setFilterMode}
      />
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
      <GraphBottomToolbar
        mode={toolMode}
        onChange={setToolMode}
        onAutoMatch={() => void autoMatchPhotos()}
        onSearch={() => setSearchOpen(true)}
        onCoverageToggle={() => setCoverageOpen((v) => !v)}
        coverageActive={coverageOpen}
      />
      <PathSimulator
        open={simulatorOpen}
        rows={rows ?? []}
        characters={characters}
        startLabel={simulatorStart}
        onClose={() => setSimulatorOpen(false)}
        onJumpToLabel={onJumpToLabel}
      />
      </div>
    </div>
  );
}

interface FilterToolbarProps {
  mode: FilterMode;
  counts: {
    orphan: number;
    unreachable: number;
    ending: number;
    choices: number;
    broken: number;
  };
  onChange: (m: FilterMode) => void;
}

/**
 * Quick-filter chip row at the bottom-center of the canvas. Chips light up
 * when active; their counts come from the build's stats so the user sees
 * "how many of each kind" without opening anything. "All" resets the view.
 * A chip with zero matches is rendered disabled rather than hidden — the
 * stable layout makes the toolbar easier to scan as data changes.
 */
function FilterToolbar({ mode, counts, onChange }: FilterToolbarProps) {
  const { t } = useTranslation();
  const chips: Array<{
    kind: FilterMode;
    labelKey: string;
    count?: number;
    tone?: "warn" | "info" | "danger" | "accent";
  }> = [
    { kind: "all", labelKey: "graph.filter.all" },
    { kind: "orphan", labelKey: "graph.filter.orphans", count: counts.orphan, tone: "warn" },
    {
      kind: "unreachable",
      labelKey: "graph.filter.unreachable",
      count: counts.unreachable,
      tone: "warn",
    },
    { kind: "ending", labelKey: "graph.filter.endings", count: counts.ending, tone: "info" },
    {
      kind: "choices",
      labelKey: "graph.filter.with_choices",
      count: counts.choices,
      tone: "accent",
    },
    { kind: "broken", labelKey: "graph.filter.broken", count: counts.broken, tone: "danger" },
  ];

  return (
    <div className="graph-filter-bar" role="toolbar">
      {chips.map((c) => {
        const isAll = c.kind === "all";
        const active = mode === c.kind;
        const disabled = !isAll && (c.count ?? 0) === 0;
        const label = t(c.labelKey);
        return (
          <button
            key={c.kind}
            type="button"
            className={
              "graph-filter-chip" +
              (active ? " is-active" : "") +
              (c.tone ? ` is-${c.tone}` : "") +
              (disabled ? " is-disabled" : "")
            }
            onClick={() => {
              if (disabled) return;
              onChange(active && !isAll ? "all" : c.kind);
            }}
            disabled={disabled}
          >
            <span>{label}</span>
            {!isAll && c.count !== undefined && (
              <span className="graph-filter-chip-count">{c.count}</span>
            )}
          </button>
        );
      })}
      <span className="graph-filter-bar-kbd">⌘F</span>
    </div>
  );
}

type ToolMode = "select" | "pan" | "add-scene" | "add-note";

// Tools live in the bottom-center floating palette — see `./GraphBottomToolbar.tsx`.

interface GroupEditPanelProps {
  group: GroupRow | null;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const GROUP_PALETTE = ["blue", "green", "purple", "amber", "red"] as const;

/**
 * Small floating editor for a group — name input, colour swatches, and
 * an "Ungroup" affordance that deletes the group row (labels stay put).
 * Sits in the top-right corner alongside the compare panel; clicking
 * outside closes it.
 */
function GroupEditPanel({
  group,
  onRename,
  onRecolor,
  onDelete,
  onClose,
}: GroupEditPanelProps) {
  if (!group) return null;
  return (
    <div
      className="graph-group-editor"
      role="dialog"
      aria-label="Edit group"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="graph-group-editor-head">
        <span className="graph-group-editor-title">Edit group</span>
        <button
          type="button"
          className="graph-group-editor-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </header>
      <input
        className="graph-group-editor-name"
        type="text"
        placeholder="Group name…"
        value={group.name}
        onChange={(e) => onRename(group.id, e.target.value)}
        autoFocus
      />
      <div className="graph-group-editor-swatches">
        {GROUP_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={
              "graph-group-editor-swatch is-color-" +
              c +
              (group.color === c ? " is-active" : "")
            }
            onClick={() => onRecolor(group.id, c)}
            title={`Colour: ${c}`}
            aria-label={`Set colour to ${c}`}
          />
        ))}
      </div>
      <div className="graph-group-editor-meta">
        {group.label_names.length} label{group.label_names.length === 1 ? "" : "s"}
      </div>
      <button
        type="button"
        className="graph-group-editor-delete"
        onClick={() => onDelete(group.id)}
      >
        Ungroup
      </button>
    </div>
  );
}

interface ComparePanelProps {
  result: CompareResult;
  targetA: string;
  targetB: string;
  onJumpToLabel: (labelName: string) => void;
  onExit: () => void;
}

/**
 * Side panel that surfaces the metrics of a path comparison. Sits in the
 * top-right corner so it doesn't fight with the stats overlay or filter
 * toolbar. Click on any label name → reveal it on the canvas. Exit
 * returns the canvas to its normal (or reachability / filter) mode.
 */
function ComparePanel({
  result,
  targetA,
  targetB,
  onJumpToLabel,
  onExit,
}: ComparePanelProps) {
  const formatLen = (n: number) =>
    Number.isFinite(n) ? `${n} edges` : "unreachable";

  return (
    <aside className="graph-compare-panel" role="region" aria-label="Path comparison">
      <header className="graph-compare-panel-head">
        <span className="graph-compare-panel-title">Compare paths</span>
        <button
          type="button"
          className="graph-compare-panel-exit"
          onClick={onExit}
          title="Exit compare mode"
          aria-label="Exit compare"
        >
          ✕
        </button>
      </header>

      <div className="graph-compare-panel-row is-divergence">
        <span className="graph-compare-panel-label">Diverged at</span>
        <button
          type="button"
          className="graph-compare-panel-target"
          onClick={() => onJumpToLabel(result.lca)}
          title="Reveal divergence point on canvas"
        >
          {result.lca}
        </button>
      </div>

      <div className="graph-compare-panel-row is-branch-a">
        <span className="graph-compare-panel-bullet" />
        <div className="graph-compare-panel-branch">
          <button
            type="button"
            className="graph-compare-panel-target"
            onClick={() => onJumpToLabel(targetA)}
            title="Reveal on canvas"
          >
            {targetA}
          </button>
          <span className="graph-compare-panel-metric">
            {formatLen(result.branchA.shortestEdges)} ·{" "}
            {result.branchA.wordCount}w ·{" "}
            {result.branchA.nodeIds.size - 1} labels
          </span>
        </div>
      </div>

      <div className="graph-compare-panel-row is-branch-b">
        <span className="graph-compare-panel-bullet" />
        <div className="graph-compare-panel-branch">
          <button
            type="button"
            className="graph-compare-panel-target"
            onClick={() => onJumpToLabel(targetB)}
            title="Reveal on canvas"
          >
            {targetB}
          </button>
          <span className="graph-compare-panel-metric">
            {formatLen(result.branchB.shortestEdges)} ·{" "}
            {result.branchB.wordCount}w ·{" "}
            {result.branchB.nodeIds.size - 1} labels
          </span>
        </div>
      </div>

      <div className="graph-compare-panel-foot">
        Blue = path to <strong>{targetA}</strong> · Amber = path to{" "}
        <strong>{targetB}</strong> · Grey = shared
      </div>
    </aside>
  );
}

interface CoveragePanelProps {
  stats: GraphBuildResult["stats"];
}

/**
 * Small fly-out panel showing path-coverage metrics: how much of the story
 * graph is actually reachable from the entry point, how many endings the
 * player can really hit, and how long the average / min / max path is in
 * edges. Numbers sourced from `buildGraph` so the panel is just a view.
 */
function CoveragePanel({ stats }: CoveragePanelProps) {
  const coveragePct =
    stats.labelCount > 0
      ? Math.round((stats.reachableCount / stats.labelCount) * 100)
      : 0;
  const unreachableEndings = stats.endingCount - stats.reachableEndingCount;

  // Single decimal place for avg, but only when it isn't already an integer.
  const formatPath = (n: number | null): string => {
    if (n === null) return "—";
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1);
  };

  return (
    <div className="graph-coverage-panel" role="region" aria-label="Path coverage">
      <div className="graph-coverage-row">
        <span className="graph-coverage-label">Reachable</span>
        <span className="graph-coverage-value">
          {stats.reachableCount} / {stats.labelCount}{" "}
          <span className="graph-coverage-pct">({coveragePct}%)</span>
        </span>
      </div>
      <div className="graph-coverage-row">
        <span className="graph-coverage-label">Endings reachable</span>
        <span className="graph-coverage-value">
          {stats.reachableEndingCount} / {stats.endingCount}
          {unreachableEndings > 0 && (
            <span className="graph-coverage-warn">
              {" "}
              ({unreachableEndings} unreachable)
            </span>
          )}
        </span>
      </div>
      <div className="graph-coverage-sep" />
      <div className="graph-coverage-row">
        <span className="graph-coverage-label">Path to ending</span>
        <span className="graph-coverage-value">
          min {formatPath(stats.minPathToEnding)} · avg{" "}
          {formatPath(stats.avgPathToEnding)} · max{" "}
          {formatPath(stats.maxPathToEnding)}{" "}
          <span className="graph-coverage-unit">edges</span>
        </span>
      </div>
    </div>
  );
}
