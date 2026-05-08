import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { useStoryGraph } from "../../../state/storyGraph";
import {
  BLOCK_TYPES,
  DEFAULT_VIEWPORT,
  HANDLE,
  PALETTE_WIDTH,
  bumpIdCounterFromNodes,
  findHandle,
  makeNode,
  nextEdgeId,
  nodeHandles,
  nodeSize,
  type BlockType,
  type ChoiceNode,
  type GraphBoard,
  type GraphEdge,
  type GraphNode,
  type HandleRole,
  type SceneNode,
  type ConditionNode,
  type EndingNode,
  type Viewport,
} from "./storyGraphTypes";
import {
  bestHandleOnNode,
  freeOrthogonalPath,
  handleAt,
  handlePoint,
  nodeAt,
  orthogonalMidpoint,
  orthogonalPath,
  pathBetween,
  sideNormal,
  type EdgeGeom,
} from "./storyGraphGeometry";

type GraphApi = ReturnType<typeof useStoryGraph>;

interface Props {
  graph: GraphApi;
}

const SAVE_DEBOUNCE_MS = 600;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 1.2;
/** Scroll-wheel zoom sensitivity. exp(-deltaY * k) → factor per event. */
const WHEEL_ZOOM_K = 0.0015;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Apply a zoom factor anchored at screen point (sx, sy) inside the canvas.
 * The world point under the cursor stays under the cursor after the zoom.
 */
function zoomTo(view: Viewport, factor: number, sx: number, sy: number): Viewport {
  const newZoom = clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === view.zoom) return view;
  const realFactor = newZoom / view.zoom;
  return {
    zoom: newZoom,
    panX: sx - (sx - view.panX) * realFactor,
    panY: sy - (sy - view.panY) * realFactor,
  };
}

type Selection =
  | { type: "node"; id: string }
  | { type: "edge"; id: string }
  | null;

type EditingNode =
  | { id: string; field: "character" | "text" | "prompt" | "flag" | "title" }
  | { id: string; field: "option"; optionIndex: number }
  | null;

type DragState =
  | {
      mode: "node";
      id: string;
      offsetX: number;
      offsetY: number;
      moved: boolean;
    }
  | {
      mode: "connect";
      fromNodeId: string;
      fromHandleId: string;
    }
  | {
      mode: "reconnect";
      edgeId: string;
      end: "from" | "to";
      anchorNodeId: string;
      anchorHandleId: string;
    }
  | { mode: "palette"; blockType: BlockType }
  | {
      mode: "pan";
      startClientX: number;
      startClientY: number;
      startPanX: number;
      startPanY: number;
    }
  | null;

type Preview =
  | {
      kind: "connect";
      fromNodeId: string;
      fromHandleId: string;
      x: number;
      y: number;
      target: { nodeId: string; handleId: string } | null;
    }
  | {
      kind: "reconnect";
      edgeId: string;
      end: "from" | "to";
      anchorNodeId: string;
      anchorHandleId: string;
      x: number;
      y: number;
      target: { nodeId: string; handleId: string } | null;
    }
  | null;

interface PaletteDrag {
  type: BlockType;
  x: number;
  y: number;
}

export function StoryGraphCanvas({ graph }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [editingNode, setEditingNode] = useState<EditingNode>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);
  const [view, setView] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const dragRef = useRef<DragState>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const hydratedRef = useRef(false);
  const spaceHeldRef = useRef(false);
  const viewRef = useRef<Viewport>(DEFAULT_VIEWPORT);
  // Keep a ref mirror so non-React listeners (wheel, keyboard) read fresh view.
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Hydrate from server-fetched board, exactly once per project.
  useEffect(() => {
    if (!graph.initialData) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    bumpIdCounterFromNodes(graph.initialData.nodes);
    setNodes(graph.initialData.nodes);
    setEdges(graph.initialData.edges);
    if (graph.initialData.viewport) setView(graph.initialData.viewport);
    lastSavedRef.current = JSON.stringify(graph.initialData);
  }, [graph.initialData]);

  // Debounced autosave on any nodes/edges/view change.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const board: GraphBoard = { nodes, edges, viewport: view };
    const sig = JSON.stringify(board);
    if (sig === lastSavedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedRef.current = sig;
      void graph.save(board);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges, view, graph]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    // unproject: world = (screen - pan) / zoom
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - v.panX) / v.zoom,
      y: (clientY - rect.top - v.panY) / v.zoom,
    };
  }, []);

  /**
   * Returns true if this pointerdown should start a pan (and consumes it).
   * Pan triggers: middle-button OR primary-button while spacebar is held.
   * Called from every node/handle/canvas pointerdown so the trigger works
   * even if a child handler would otherwise stop propagation.
   */
  const startPanIfTriggered = useCallback(
    (e: ReactPointerEvent<HTMLElement>): boolean => {
      const isMiddle = e.button === 1;
      const isSpacePan = e.button === 0 && spaceHeldRef.current;
      if (!isMiddle && !isSpacePan) return false;
      e.preventDefault();
      e.stopPropagation();
      const v = viewRef.current;
      dragRef.current = {
        mode: "pan",
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: v.panX,
        startPanY: v.panY,
      };
      setIsPanning(true);
      return true;
    },
    [],
  );

  const resolveTarget = useCallback(
    (
      arr: GraphNode[],
      wx: number,
      wy: number,
      ignoreId: string | null,
      requireRole: HandleRole | null,
    ): { nodeId: string; handleId: string } | null => {
      const exact = handleAt(arr, wx, wy, ignoreId, requireRole);
      if (exact) return exact;
      const n = nodeAt(arr, wx, wy, ignoreId);
      if (n) {
        const h = bestHandleOnNode(n, wx, wy, requireRole);
        if (h) return { nodeId: n.id, handleId: h };
      }
      return null;
    },
    [],
  );

  // ---------- Mutation helpers ----------
  const createNode = useCallback((type: BlockType, wx: number, wy: number) => {
    const tempData = BLOCK_TYPES[type].defaultData();
    // size depends on the eventual node — use defaults so we can center on drop.
    const fakeNode = {
      id: "tmp",
      type,
      x: wx,
      y: wy,
      ...tempData,
    } as GraphNode;
    const { w, h } = nodeSize(fakeNode);
    const node = makeNode(type, wx - w / 2, wy - h / 2);
    setNodes((arr) => [...arr, node]);
    setSelected({ type: "node", id: node.id });
  }, []);

  const updateNode = useCallback(
    (id: string, patch: Partial<GraphNode>) => {
      setNodes((arr) =>
        arr.map((n) =>
          n.id === id ? ({ ...n, ...patch } as GraphNode) : n,
        ),
      );
      // If a choice's options changed, drop edges referencing handles that
      // no longer exist (an option got deleted).
      if (Object.prototype.hasOwnProperty.call(patch, "options")) {
        setEdges((es) =>
          es.filter((ed) => {
            if (ed.from !== id && ed.to !== id) return true;
            const existing = nodes.find((n) => n.id === id);
            if (!existing) return true;
            const updated = { ...existing, ...patch } as GraphNode;
            if (ed.from === id && !findHandle(updated, ed.fromHandle))
              return false;
            if (ed.to === id && !findHandle(updated, ed.toHandle))
              return false;
            return true;
          }),
        );
      }
    },
    [nodes],
  );

  // ---------- Pointer global handlers ----------
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const w = toWorld(e.clientX, e.clientY);

      if (drag.mode === "node") {
        drag.moved = true;
        setNodes((arr) =>
          arr.map((n) =>
            n.id === drag.id
              ? { ...n, x: w.x - drag.offsetX, y: w.y - drag.offsetY }
              : n,
          ),
        );
      } else if (drag.mode === "connect") {
        setNodes((curr) => {
          const target = resolveTarget(curr, w.x, w.y, drag.fromNodeId, "in");
          setPreview({
            kind: "connect",
            fromNodeId: drag.fromNodeId,
            fromHandleId: drag.fromHandleId,
            x: w.x,
            y: w.y,
            target,
          });
          return curr;
        });
      } else if (drag.mode === "reconnect") {
        const requireRole: HandleRole = drag.end === "to" ? "in" : "out";
        setNodes((curr) => {
          const target = resolveTarget(
            curr,
            w.x,
            w.y,
            drag.anchorNodeId,
            requireRole,
          );
          setPreview({
            kind: "reconnect",
            edgeId: drag.edgeId,
            end: drag.end,
            anchorNodeId: drag.anchorNodeId,
            anchorHandleId: drag.anchorHandleId,
            x: w.x,
            y: w.y,
            target,
          });
          return curr;
        });
      } else if (drag.mode === "palette") {
        setPaletteDrag({ type: drag.blockType, x: e.clientX, y: e.clientY });
      } else if (drag.mode === "pan") {
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        setView((v) => ({
          ...v,
          panX: drag.startPanX + dx,
          panY: drag.startPanY + dy,
        }));
      }
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const w = toWorld(e.clientX, e.clientY);

      if (drag.mode === "connect") {
        setNodes((curr) => {
          const target = resolveTarget(curr, w.x, w.y, drag.fromNodeId, "in");
          if (target) {
            setEdges((es) => {
              const dup = es.some(
                (ed) =>
                  ed.from === drag.fromNodeId &&
                  ed.fromHandle === drag.fromHandleId &&
                  ed.to === target.nodeId &&
                  ed.toHandle === target.handleId,
              );
              if (dup) return es;
              return [
                ...es,
                {
                  id: nextEdgeId(),
                  from: drag.fromNodeId,
                  fromHandle: drag.fromHandleId,
                  to: target.nodeId,
                  toHandle: target.handleId,
                  label: "",
                },
              ];
            });
          }
          return curr;
        });
        setPreview(null);
      } else if (drag.mode === "reconnect") {
        const requireRole: HandleRole = drag.end === "to" ? "in" : "out";
        setNodes((curr) => {
          const target = resolveTarget(
            curr,
            w.x,
            w.y,
            drag.anchorNodeId,
            requireRole,
          );
          if (target) {
            setEdges((es) =>
              es.map((ed) => {
                if (ed.id !== drag.edgeId) return ed;
                const next: GraphEdge =
                  drag.end === "to"
                    ? { ...ed, to: target.nodeId, toHandle: target.handleId }
                    : {
                        ...ed,
                        from: target.nodeId,
                        fromHandle: target.handleId,
                      };
                if (next.from === next.to) return ed;
                return next;
              }),
            );
          }
          return curr;
        });
        setPreview(null);
      } else if (drag.mode === "palette") {
        const rect = containerRef.current?.getBoundingClientRect();
        if (
          rect &&
          e.clientX >= rect.left &&
          e.clientY >= rect.top &&
          e.clientX <= rect.right &&
          e.clientY <= rect.bottom
        ) {
          createNode(drag.blockType, w.x, w.y);
        }
        setPaletteDrag(null);
      } else if (drag.mode === "pan") {
        setIsPanning(false);
      }

      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [toWorld, resolveTarget, createNode]);

  // ---------- Delete / Backspace ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (!selected) return;
      e.preventDefault();
      if (selected.type === "node") {
        const id = selected.id;
        setNodes((arr) => arr.filter((n) => n.id !== id));
        setEdges((es) => es.filter((ed) => ed.from !== id && ed.to !== id));
      } else if (selected.type === "edge") {
        const id = selected.id;
        setEdges((es) => es.filter((ed) => ed.id !== id));
      }
      setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // ---------- Spacebar pan-modifier + zoom hotkeys ----------
  useEffect(() => {
    const isTextEditing = () => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA";
    };

    const zoomCenterBy = (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setView((v) => zoomTo(v, factor, rect.width / 2, rect.height / 2));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTextEditing()) {
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          setSpaceHeld(true);
        }
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !isTextEditing()) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          zoomCenterBy(ZOOM_STEP);
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          zoomCenterBy(1 / ZOOM_STEP);
        } else if (e.key === "0") {
          e.preventDefault();
          setView(DEFAULT_VIEWPORT);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ---------- Wheel: Ctrl/⌘ + wheel = zoom-to-cursor; bare wheel = pan ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Shift+wheel → pan (keyboard-driven scroll fallback). Everything
      // else (bare wheel, Ctrl+wheel, Cmd+wheel, trackpad pinch which
      // surfaces as wheel + ctrlKey) zooms to the cursor.
      if (e.shiftKey) {
        setView((v) => ({
          ...v,
          panX: v.panX - (e.deltaX || e.deltaY),
          panY: v.panY - (e.deltaX ? e.deltaY : 0),
        }));
        return;
      }
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_K);
      setView((v) => zoomTo(v, factor, sx, sy));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---------- Zoom panel actions ----------
  const zoomBy = useCallback((factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => zoomTo(v, factor, rect.width / 2, rect.height / 2));
  }, []);
  const resetZoom = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => zoomTo(v, 1 / v.zoom, rect.width / 2, rect.height / 2));
  }, []);
  const fitToContent = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (nodes.length === 0) {
      setView(DEFAULT_VIEWPORT);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const { w, h } = nodeSize(n);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    }
    const padding = 40;
    const cw = Math.max(50, rect.width - padding * 2);
    const ch = Math.max(50, rect.height - padding * 2);
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const newZoom = clamp(Math.min(cw / bw, ch / bh), ZOOM_MIN, ZOOM_MAX);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({
      zoom: newZoom,
      panX: rect.width / 2 - cx * newZoom,
      panY: rect.height / 2 - cy * newZoom,
    });
  }, [nodes]);

  // ---------- Node / handle / canvas pointer handlers ----------
  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startPanIfTriggered(e)) return;
    // Deselect on background clicks: canvas root or grid (the only elements
    // covering empty area). Nodes/edges/labels stop propagation themselves.
    const t = e.target as HTMLElement;
    const isBg =
      t === e.currentTarget || t.classList.contains("vn-sg-grid");
    if (!isBg) return;
    setSelected(null);
    setEditingNode(null);
    setEditingEdgeId(null);
  };

  const onNodePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    node: GraphNode,
  ) => {
    if (startPanIfTriggered(e)) return;
    const target = e.target as HTMLElement;
    if (target.dataset.handle === "true") return;
    if (target.dataset.editable === "true") return;
    if (editingNode?.id === node.id) return;
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    dragRef.current = {
      mode: "node",
      id: node.id,
      offsetX: w.x - node.x,
      offsetY: w.y - node.y,
      moved: false,
    };
    setSelected({ type: "node", id: node.id });
  };

  const onConnectHandlePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    node: GraphNode,
    handleId: string,
  ) => {
    if (startPanIfTriggered(e)) return;
    e.stopPropagation();
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    dragRef.current = {
      mode: "connect",
      fromNodeId: node.id,
      fromHandleId: handleId,
    };
    setPreview({
      kind: "connect",
      fromNodeId: node.id,
      fromHandleId: handleId,
      x: w.x,
      y: w.y,
      target: null,
    });
  };

  const onEndpointPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    edge: GraphEdge,
    end: "from" | "to",
  ) => {
    if (startPanIfTriggered(e)) return;
    e.stopPropagation();
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    const anchorNodeId = end === "from" ? edge.to : edge.from;
    const anchorHandleId = end === "from" ? edge.toHandle : edge.fromHandle;
    dragRef.current = {
      mode: "reconnect",
      edgeId: edge.id,
      end,
      anchorNodeId,
      anchorHandleId,
    };
    setPreview({
      kind: "reconnect",
      edgeId: edge.id,
      end,
      anchorNodeId,
      anchorHandleId,
      x: w.x,
      y: w.y,
      target: null,
    });
    setSelected({ type: "edge", id: edge.id });
  };

  const onPalettePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    blockType: BlockType,
  ) => {
    e.preventDefault();
    dragRef.current = { mode: "palette", blockType };
    setPaletteDrag({ type: blockType, x: e.clientX, y: e.clientY });
  };

  // ---------- Geometry memo ----------
  const edgeGeom = useMemo<Record<string, EdgeGeom>>(() => {
    const map: Record<string, EdgeGeom> = {};
    for (const edge of edges) {
      const a = nodes.find((n) => n.id === edge.from);
      const b = nodes.find((n) => n.id === edge.to);
      if (!a || !b) continue;
      if (!findHandle(a, edge.fromHandle) || !findHandle(b, edge.toHandle))
        continue;
      map[edge.id] = pathBetween(a, edge.fromHandle, b, edge.toHandle);
    }
    return map;
  }, [edges, nodes]);

  const reconnectingEdgeId =
    preview?.kind === "reconnect" ? preview.edgeId : null;
  const isDragging =
    !!dragRef.current && dragRef.current.mode !== "node";

  function shouldShowHandles(n: GraphNode): boolean {
    if (preview?.target?.nodeId === n.id) return true;
    if (isDragging) return false;
    if (hoveredNodeId === n.id) return true;
    if (selected?.type === "node" && selected.id === n.id) return true;
    return false;
  }

  /**
   * When an edge is selected we render `endpoint` dots at its two ends,
   * which sit exactly on top of the connected handles — making it hard
   * to grab the endpoint for reconnect. Hide those specific handles so
   * the endpoint dot is the only target there. Skipped while the edge is
   * actively being reconnected (handles must reappear as drop targets).
   */
  const hiddenHandlesByNode = useMemo<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    if (selected?.type !== "edge") return map;
    const edge = edges.find((e) => e.id === selected.id);
    if (!edge || edge.id === reconnectingEdgeId) return map;
    const add = (nodeId: string, handleId: string) => {
      let s = map.get(nodeId);
      if (!s) {
        s = new Set();
        map.set(nodeId, s);
      }
      s.add(handleId);
    };
    add(edge.from, edge.fromHandle);
    add(edge.to, edge.toHandle);
    return map;
  }, [selected, edges, reconnectingEdgeId]);

  // ---------- Render ----------
  if (graph.loading || !graph.initialData) {
    return (
      <div className="vn-graph-canvas-loading">
        <span className="vn-graph-loading">Loading…</span>
      </div>
    );
  }

  return (
    <div className="vn-sg-shell">
      <Palette onPointerDown={onPalettePointerDown} />

      <div
        ref={containerRef}
        className={
          "vn-sg-canvas" +
          (spaceHeld ? " is-space" : "") +
          (isPanning ? " is-panning" : "")
        }
        onPointerDown={onCanvasPointerDown}
      >
        {/* Grid: pans/zooms via background-size/position — stays crisp,
            no rasterization. */}
        <div
          className="vn-sg-grid"
          style={{
            backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
            backgroundPosition: `${view.panX}px ${view.panY}px`,
          }}
        />

        {nodes.length === 0 && (
          <div className="vn-sg-empty">
            Drag a block from the left panel
            <span>to start sketching the story flow</span>
          </div>
        )}

        {/* SVG layer: vector content. Single transform on the <svg> keeps
            paths sharp at any zoom. */}
        <svg
          className="vn-sg-edges"
          style={{
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <defs>
            <marker
              id="vn-sg-arrow"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 12 6 L 0 12 z" fill="rgba(200,199,202,0.65)" />
            </marker>
            <marker
              id="vn-sg-arrow-active"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 12 6 L 0 12 z" fill="var(--text-1)" />
            </marker>
          </defs>

          <g style={{ pointerEvents: "auto" }}>
            {edges.map((edge) => {
              if (edge.id === reconnectingEdgeId) return null;
              const geom = edgeGeom[edge.id];
              if (!geom) return null;
              const isSel =
                selected?.type === "edge" && selected.id === edge.id;
              return (
                <g key={edge.id}>
                  <path
                    d={geom.d}
                    stroke="transparent"
                    strokeWidth={18}
                    fill="none"
                    style={{ cursor: "pointer", pointerEvents: "stroke" }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelected({ type: "edge", id: edge.id });
                      setEditingNode(null);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setSelected({ type: "edge", id: edge.id });
                      setEditingEdgeId(edge.id);
                    }}
                  />
                  <path
                    d={geom.d}
                    stroke={
                      isSel ? "var(--text-1)" : "rgba(200,199,202,0.55)"
                    }
                    strokeWidth={isSel ? 2.5 : 1.8}
                    fill="none"
                    markerEnd={
                      isSel ? "url(#vn-sg-arrow-active)" : "url(#vn-sg-arrow)"
                    }
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                </g>
              );
            })}
          </g>

          {/* Live preview of in-progress edge create / reconnect */}
          <PreviewPath preview={preview} nodes={nodes} />
        </svg>

        {/* Edge labels — projected to screen coords; content scales via --zoom */}
        {edges.map((edge) => {
          if (edge.id === reconnectingEdgeId) return null;
          const geom = edgeGeom[edge.id];
          if (!geom) return null;
          const mid = orthogonalMidpoint(geom.points);
          const isEditing = editingEdgeId === edge.id;
          const hasText = !!(edge.label && edge.label.trim());
          if (!hasText && !isEditing) return null;
          const sx = view.panX + mid.x * view.zoom;
          const sy = view.panY + mid.y * view.zoom;
          return (
            <div
              key={`label-${edge.id}`}
              className="vn-sg-edge-label"
              style={
                {
                  left: sx,
                  top: sy,
                  "--zoom": view.zoom,
                } as CSSProperties
              }
              onDoubleClick={(e) => {
                e.stopPropagation();
                setSelected({ type: "edge", id: edge.id });
                setEditingEdgeId(edge.id);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!isEditing) setSelected({ type: "edge", id: edge.id });
              }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  value={edge.label}
                  onChange={(e) =>
                    setEdges((es) =>
                      es.map((ed) =>
                        ed.id === edge.id ? { ...ed, label: e.target.value } : ed,
                      ),
                    )
                  }
                  onBlur={() => setEditingEdgeId(null)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                      setEditingEdgeId(null);
                    }
                    e.stopPropagation();
                  }}
                  placeholder="label…"
                  size={Math.max(6, edge.label.length + 2)}
                />
              ) : (
                <span>{edge.label}</span>
              )}
            </div>
          );
        })}

        {/* Nodes — positioned in screen coords; size and inner content scale via --zoom */}
        {nodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            view={view}
            isSelected={selected?.type === "node" && selected.id === node.id}
            isDropTarget={preview?.target?.nodeId === node.id}
            isHandlesVisible={shouldShowHandles(node)}
            hiddenHandleIds={hiddenHandlesByNode.get(node.id) ?? null}
            targetHandleId={
              preview?.target?.nodeId === node.id
                ? preview.target.handleId
                : null
            }
            editingNode={editingNode}
            onPointerDown={(e) => onNodePointerDown(e, node)}
            onPointerEnter={() => !isDragging && setHoveredNodeId(node.id)}
            onPointerLeave={() =>
              setHoveredNodeId((cur) => (cur === node.id ? null : cur))
            }
            onConnectHandlePointerDown={onConnectHandlePointerDown}
            onUpdate={(patch) => updateNode(node.id, patch)}
            onSetEditing={(field, optionIndex) => {
              if (field === "option" && typeof optionIndex === "number") {
                setEditingNode({ id: node.id, field, optionIndex });
              } else if (field !== "option") {
                setEditingNode({ id: node.id, field });
              }
            }}
            onClearEditing={() => setEditingNode(null)}
          />
        ))}

        {/* Edge endpoint dots — only when an edge is selected. Fixed
            12px screen size regardless of zoom (Figma-style). */}
        {selected?.type === "edge" &&
          (() => {
            const edge = edges.find((e) => e.id === selected.id);
            if (!edge) return null;
            if (edge.id === reconnectingEdgeId) return null;
            const geom = edgeGeom[edge.id];
            if (!geom) return null;
            return (["from", "to"] as const).map((end) => {
              const point = end === "from" ? geom.start : geom.end;
              const sx = view.panX + point.x * view.zoom;
              const sy = view.panY + point.y * view.zoom;
              return (
                <div
                  key={end}
                  className="vn-sg-endpoint"
                  style={{ left: sx - 6, top: sy - 6 }}
                  onPointerDown={(e) => onEndpointPointerDown(e, edge, end)}
                />
              );
            });
          })()}

        {/* Zoom panel — fixed-position UI overlay, untouched by view */}
        <ZoomPanel
          zoom={view.zoom}
          onZoomIn={() => zoomBy(ZOOM_STEP)}
          onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
          onReset={resetZoom}
          onFit={fitToContent}
        />
      </div>

      {paletteDrag && (
        <div
          className="vn-sg-palette-ghost"
          style={{ left: paletteDrag.x + 12, top: paletteDrag.y + 12 }}
        >
          <PaletteCard type={paletteDrag.type} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Zoom panel
// ============================================================

interface ZoomPanelProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
}

function ZoomPanel({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
}: ZoomPanelProps) {
  return (
    <div
      className="vn-sg-zoom-panel"
      // Don't deselect the canvas when interacting with the panel.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="vn-sg-zoom-btn"
        onClick={onZoomOut}
        title="Zoom out (Ctrl −)"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="vn-sg-zoom-pct"
        onClick={onReset}
        title="Reset to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="vn-sg-zoom-btn"
        onClick={onZoomIn}
        title="Zoom in (Ctrl +)"
        aria-label="Zoom in"
      >
        +
      </button>
      <span className="vn-sg-zoom-sep" />
      <button
        type="button"
        className="vn-sg-zoom-fit"
        onClick={onFit}
        title="Fit all blocks"
      >
        Fit
      </button>
    </div>
  );
}

// ============================================================
// Live preview path
// ============================================================

function PreviewPath({
  preview,
  nodes,
}: {
  preview: Preview;
  nodes: GraphNode[];
}) {
  if (!preview) return null;

  if (preview.kind === "connect") {
    const from = nodes.find((n) => n.id === preview.fromNodeId);
    if (!from) return null;
    const startSide =
      findHandle(from, preview.fromHandleId)?.side ?? "right";
    const start = handlePoint(from, preview.fromHandleId);

    if (preview.target) {
      const t = nodes.find((n) => n.id === preview.target!.nodeId);
      if (!t) return null;
      const geom = pathBetween(from, preview.fromHandleId, t, preview.target.handleId);
      return (
        <path
          d={geom.d}
          stroke="var(--text-1)"
          strokeWidth={2.4}
          fill="none"
          markerEnd="url(#vn-sg-arrow-active)"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    const free = freeOrthogonalPath(
      start.x,
      start.y,
      sideNormal(startSide),
      startSide,
      preview.x,
      preview.y,
    );
    return (
      <path
        d={free.d}
        stroke="var(--text-1)"
        strokeWidth={2}
        strokeDasharray="6 5"
        fill="none"
        markerEnd="url(#vn-sg-arrow-active)"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  // reconnect
  const anchor = nodes.find((n) => n.id === preview.anchorNodeId);
  if (!anchor) return null;
  const aHandle = findHandle(anchor, preview.anchorHandleId);
  if (!aHandle) return null;
  const aPt = handlePoint(anchor, preview.anchorHandleId);

  if (preview.target) {
    const t = nodes.find((n) => n.id === preview.target!.nodeId);
    if (!t) return null;
    const geom =
      preview.end === "to"
        ? pathBetween(anchor, preview.anchorHandleId, t, preview.target.handleId)
        : pathBetween(t, preview.target.handleId, anchor, preview.anchorHandleId);
    return (
      <path
        d={geom.d}
        stroke="var(--text-1)"
        strokeWidth={2.4}
        fill="none"
        markerEnd="url(#vn-sg-arrow-active)"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  const free = freeOrthogonalPath(
    aPt.x,
    aPt.y,
    sideNormal(aHandle.side),
    aHandle.side,
    preview.x,
    preview.y,
  );
  if (preview.end === "to") {
    return (
      <path
        d={free.d}
        stroke="var(--text-1)"
        strokeWidth={2}
        strokeDasharray="6 5"
        fill="none"
        markerEnd="url(#vn-sg-arrow-active)"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  const reversed = [...free.points].reverse();
  return (
    <path
      d={orthogonalPath(reversed)}
      stroke="var(--text-1)"
      strokeWidth={2}
      strokeDasharray="6 5"
      fill="none"
      markerEnd="url(#vn-sg-arrow-active)"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

// ============================================================
// Palette
// ============================================================

interface PaletteProps {
  onPointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    blockType: BlockType,
  ) => void;
}

function Palette({ onPointerDown }: PaletteProps) {
  return (
    <aside className="vn-sg-palette" style={{ width: PALETTE_WIDTH }}>
      <div className="vn-sg-palette-section">Blocks</div>
      <div className="vn-sg-palette-list">
        {(Object.keys(BLOCK_TYPES) as BlockType[]).map((type) => (
          <div
            key={type}
            onPointerDown={(e) => onPointerDown(e, type)}
            className="vn-sg-palette-card-wrap"
          >
            <PaletteCard type={type} />
          </div>
        ))}
      </div>
      <div className="vn-sg-palette-hint">
        Drag onto canvas. Click a node to edit. Drag from a handle to connect.
      </div>
    </aside>
  );
}

function PaletteCard({ type }: { type: BlockType }) {
  const spec = BLOCK_TYPES[type];
  return (
    <div
      className="vn-sg-palette-card"
      style={{ borderLeftColor: spec.accent }}
    >
      <span className="vn-sg-palette-icon" style={{ color: spec.accent }}>
        <BlockIcon type={type} />
      </span>
      <span className="vn-sg-palette-label">{spec.label}</span>
    </div>
  );
}

function BlockIcon({ type, size = 14 }: { type: BlockType; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (type === "scene") {
    return (
      <svg {...common}>
        <path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5A1.5 1.5 0 0 1 12 10.5H6.5L4 13v-2.5A1.5 1.5 0 0 1 2.5 9z" />
      </svg>
    );
  }
  if (type === "choice") {
    return (
      <svg {...common}>
        <path d="M4 2.5v3.5l4 4v3.5" />
        <path d="M12 2.5v3.5l-4 4" />
        <circle cx="4" cy="2.5" r="1" />
        <circle cx="12" cy="2.5" r="1" />
        <circle cx="8" cy="13.5" r="1" />
      </svg>
    );
  }
  if (type === "condition") {
    return (
      <svg {...common}>
        <path d="M8 2L14 8L8 14L2 8z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3.5 14V2.5" />
      <path d="M3.5 2.5h8.5L10 5.5l2 3H3.5" />
    </svg>
  );
}

// ============================================================
// Node renderer
// ============================================================

interface NodeViewProps {
  node: GraphNode;
  view: Viewport;
  isSelected: boolean;
  isDropTarget: boolean;
  isHandlesVisible: boolean;
  /** Handle ids to skip rendering — used to hide the connected handle of
   *  the currently-selected edge so its endpoint dot owns the hit area. */
  hiddenHandleIds: Set<string> | null;
  targetHandleId: string | null;
  editingNode: EditingNode;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onConnectHandlePointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    node: GraphNode,
    handleId: string,
  ) => void;
  onUpdate: (patch: Partial<GraphNode>) => void;
  onSetEditing: (
    field: "character" | "text" | "prompt" | "flag" | "title" | "option",
    optionIndex?: number,
  ) => void;
  onClearEditing: () => void;
}

function NodeView(props: NodeViewProps) {
  const {
    node,
    view,
    isSelected,
    isDropTarget,
    isHandlesVisible,
    hiddenHandleIds,
    targetHandleId,
    editingNode,
    onPointerDown,
    onPointerEnter,
    onPointerLeave,
    onConnectHandlePointerDown,
    onUpdate,
    onSetEditing,
    onClearEditing,
  } = props;
  const spec = BLOCK_TYPES[node.type];
  const { w, h } = nodeSize(node);

  // Project world → screen so the node is laid out in real CSS pixels.
  // No `transform: scale` anywhere on this subtree — text and borders are
  // re-rasterized at their actual size on every zoom change. Children
  // pick up `--zoom` via the CSS variable cascade and use calc() on it
  // (font-size, padding, border-radius, etc.) to match.
  const screenX = view.panX + node.x * view.zoom;
  const screenY = view.panY + node.y * view.zoom;
  const screenW = w * view.zoom;
  const screenH = h * view.zoom;

  const containerStyle: CSSProperties = {
    left: screenX,
    top: screenY,
    width: screenW,
    height: screenH,
    borderLeftColor: isSelected || isDropTarget ? "var(--text-1)" : spec.accent,
    ["--zoom" as string]: view.zoom,
  } as CSSProperties;

  return (
    <div
      className={
        "vn-sg-node" +
        (isSelected ? " is-selected" : "") +
        (isDropTarget ? " is-drop-target" : "") +
        (` is-${node.type}`)
      }
      style={containerStyle}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="vn-sg-node-head">
        <span className="vn-sg-node-icon" style={{ color: spec.accent }}>
          <BlockIcon type={node.type} size={12} />
        </span>
        <span className="vn-sg-node-label">{spec.label}</span>
        <span className="vn-sg-node-id">{node.id}</span>
      </div>

      <div className="vn-sg-node-body">
        {node.type === "scene" && (
          <SceneBody
            node={node}
            editing={editingNode}
            onUpdate={onUpdate}
            onSetEditing={onSetEditing}
            onClearEditing={onClearEditing}
          />
        )}
        {node.type === "choice" && (
          <ChoiceBody
            node={node}
            editing={editingNode}
            onUpdate={onUpdate}
            onSetEditing={onSetEditing}
            onClearEditing={onClearEditing}
          />
        )}
        {node.type === "condition" && (
          <ConditionBody
            node={node}
            editing={editingNode}
            onUpdate={onUpdate}
            onSetEditing={onSetEditing}
            onClearEditing={onClearEditing}
          />
        )}
        {node.type === "ending" && (
          <EndingBody
            node={node}
            editing={editingNode}
            onUpdate={onUpdate}
            onSetEditing={onSetEditing}
            onClearEditing={onClearEditing}
          />
        )}
      </div>

      {/* Handles — fixed 12px screen size at any zoom, positioned by
          projecting the world handle point into the node's local screen
          frame (container is screenW × screenH at top-left = screenX/Y). */}
      {nodeHandles(node).map((h) => {
        if (hiddenHandleIds?.has(h.id)) return null;
        const point = handlePoint(node, h.id);
        const left = (point.x - node.x) * view.zoom - HANDLE / 2;
        const top = (point.y - node.y) * view.zoom - HANDLE / 2;
        const isTarget = targetHandleId === h.id;
        const visible = isHandlesVisible || isTarget;
        const colorOverride =
          node.type === "condition" && h.id === "true"
            ? "#7a9994"
            : node.type === "condition" && h.id === "false"
            ? "#a87080"
            : null;
        return (
          <div
            key={h.id}
            data-handle="true"
            className={
              "vn-sg-handle" +
              ` is-${h.role}` +
              ` is-side-${h.side}` +
              (visible ? " is-visible" : "") +
              (isTarget ? " is-target" : "")
            }
            style={{
              left,
              top,
              width: HANDLE,
              height: HANDLE,
              borderColor: colorOverride ?? undefined,
            }}
            onPointerDown={(e) => {
              if (h.role === "out") onConnectHandlePointerDown(e, node, h.id);
            }}
          />
        );
      })}
    </div>
  );
}

// ============================================================
// Body components
// ============================================================

interface BodyProps<N extends GraphNode> {
  node: N;
  editing: EditingNode;
  onUpdate: (patch: Partial<GraphNode>) => void;
  onSetEditing: (
    field: "character" | "text" | "prompt" | "flag" | "title" | "option",
    optionIndex?: number,
  ) => void;
  onClearEditing: () => void;
}

function SceneBody({
  node,
  editing,
  onUpdate,
  onSetEditing,
  onClearEditing,
}: BodyProps<SceneNode>) {
  const isCharEditing =
    editing?.id === node.id && editing.field === "character";
  const isTextEditing = editing?.id === node.id && editing.field === "text";
  return (
    <>
      {isCharEditing ? (
        <input
          autoFocus
          className="vn-sg-input vn-sg-input-character"
          value={node.character}
          onChange={(e) => onUpdate({ character: e.target.value })}
          onBlur={onClearEditing}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onClearEditing();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Character"
          data-editable="true"
        />
      ) : (
        <button
          type="button"
          data-editable="true"
          className="vn-sg-field-btn vn-sg-field-character"
          onPointerDown={(e) => {
            e.stopPropagation();
            onSetEditing("character");
          }}
        >
          {node.character || "Character"}
        </button>
      )}
      {isTextEditing ? (
        <textarea
          autoFocus
          className="vn-sg-textarea"
          value={node.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          onBlur={onClearEditing}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClearEditing();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Dialogue or narration…"
          data-editable="true"
        />
      ) : (
        <button
          type="button"
          data-editable="true"
          className="vn-sg-field-btn vn-sg-field-text"
          onPointerDown={(e) => {
            e.stopPropagation();
            onSetEditing("text");
          }}
        >
          {node.text || "Click to add text…"}
        </button>
      )}
    </>
  );
}

function ChoiceBody({
  node,
  editing,
  onUpdate,
  onSetEditing,
  onClearEditing,
}: BodyProps<ChoiceNode>) {
  const isPromptEditing =
    editing?.id === node.id && editing.field === "prompt";
  const updateOption = (idx: number, value: string) => {
    const next = [...node.options];
    next[idx] = value;
    onUpdate({ options: next });
  };
  const addOption = () => onUpdate({ options: [...node.options, ""] });
  const removeOption = (idx: number) => {
    if (node.options.length <= 1) return;
    onUpdate({ options: node.options.filter((_, i) => i !== idx) });
  };
  return (
    <>
      {isPromptEditing ? (
        <input
          autoFocus
          className="vn-sg-input vn-sg-input-prompt"
          value={node.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          onBlur={onClearEditing}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onClearEditing();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Prompt to player"
          data-editable="true"
        />
      ) : (
        <button
          type="button"
          data-editable="true"
          className="vn-sg-field-btn vn-sg-field-prompt"
          onPointerDown={(e) => {
            e.stopPropagation();
            onSetEditing("prompt");
          }}
        >
          {node.prompt || "Prompt to player…"}
        </button>
      )}
      <div className="vn-sg-options">
        {node.options.map((opt, i) => {
          const isEditing =
            editing?.id === node.id &&
            editing.field === "option" &&
            editing.optionIndex === i;
          return (
            <div key={i} className="vn-sg-option-row">
              <span className="vn-sg-option-bullet">▸</span>
              {isEditing ? (
                <input
                  autoFocus
                  className="vn-sg-input vn-sg-input-option"
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  onBlur={onClearEditing}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape")
                      onClearEditing();
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  placeholder={`Option ${i + 1}`}
                  data-editable="true"
                />
              ) : (
                <button
                  type="button"
                  data-editable="true"
                  className="vn-sg-field-btn vn-sg-option-btn"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSetEditing("option", i);
                  }}
                >
                  {opt || `Option ${i + 1}`}
                </button>
              )}
              {node.options.length > 1 && (
                <button
                  type="button"
                  className="vn-sg-option-x"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    removeOption(i);
                  }}
                  title="Remove option"
                  data-editable="true"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="vn-sg-option-add"
          onPointerDown={(e) => {
            e.stopPropagation();
            addOption();
          }}
          data-editable="true"
        >
          + Option
        </button>
      </div>
    </>
  );
}

function ConditionBody({
  node,
  editing,
  onUpdate,
  onSetEditing,
  onClearEditing,
}: BodyProps<ConditionNode>) {
  const isFlagEditing = editing?.id === node.id && editing.field === "flag";
  return (
    <>
      <div className="vn-sg-cond-hint">If flag is set</div>
      {isFlagEditing ? (
        <input
          autoFocus
          className="vn-sg-input vn-sg-input-flag"
          value={node.flag}
          onChange={(e) => onUpdate({ flag: e.target.value })}
          onBlur={onClearEditing}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onClearEditing();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="flag_name"
          data-editable="true"
        />
      ) : (
        <button
          type="button"
          data-editable="true"
          className="vn-sg-field-btn vn-sg-field-flag"
          onPointerDown={(e) => {
            e.stopPropagation();
            onSetEditing("flag");
          }}
        >
          {node.flag || "flag_name"}
        </button>
      )}
      <div className="vn-sg-cond-legend">
        <span className="vn-sg-cond-true">true →</span>
        <span className="vn-sg-cond-false">← false</span>
      </div>
    </>
  );
}

function EndingBody({
  node,
  editing,
  onUpdate,
  onSetEditing,
  onClearEditing,
}: BodyProps<EndingNode>) {
  const isTitleEditing =
    editing?.id === node.id && editing.field === "title";
  return isTitleEditing ? (
    <input
      autoFocus
      className="vn-sg-input vn-sg-input-ending"
      value={node.title}
      onChange={(e) => onUpdate({ title: e.target.value })}
      onBlur={onClearEditing}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") onClearEditing();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      placeholder="Ending title"
      data-editable="true"
    />
  ) : (
    <button
      type="button"
      data-editable="true"
      className="vn-sg-field-btn vn-sg-field-ending"
      onPointerDown={(e) => {
        e.stopPropagation();
        onSetEditing("title");
      }}
    >
      {node.title || "Ending title…"}
    </button>
  );
}
