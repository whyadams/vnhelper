import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import type { Json } from "../lib/database.types";
import {
  bumpIdCounterFromNodes,
  reviveNode,
  type GraphBoard,
  type GraphEdge,
  type GraphNode,
  type Viewport,
} from "../components/scripts/graph/storyGraphTypes";

const EMPTY_BOARD: GraphBoard = { nodes: [], edges: [] };

function reviveViewport(raw: unknown): Viewport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.panX !== "number" ||
    typeof r.panY !== "number" ||
    typeof r.zoom !== "number"
  ) {
    return undefined;
  }
  return { panX: r.panX, panY: r.panY, zoom: r.zoom };
}

function reviveBoard(raw: unknown): GraphBoard {
  if (!raw || typeof raw !== "object") return EMPTY_BOARD;
  const r = raw as Record<string, unknown>;
  // Old Excalidraw shape `{elements, appState, files}` → start fresh.
  if (Array.isArray(r.elements)) return EMPTY_BOARD;
  const nodesRaw = Array.isArray(r.nodes) ? r.nodes : [];
  const edgesRaw = Array.isArray(r.edges) ? r.edges : [];
  const nodes: GraphNode[] = [];
  for (const item of nodesRaw) {
    const n = reviveNode(item);
    if (n) nodes.push(n);
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  for (const e of edgesRaw) {
    if (!e || typeof e !== "object") continue;
    const r2 = e as Record<string, unknown>;
    if (
      typeof r2.from !== "string" ||
      typeof r2.to !== "string" ||
      typeof r2.fromHandle !== "string" ||
      typeof r2.toHandle !== "string"
    ) {
      continue;
    }
    if (!nodeIds.has(r2.from) || !nodeIds.has(r2.to)) continue;
    edges.push({
      id: typeof r2.id === "string" ? r2.id : `e-${edges.length}`,
      from: r2.from,
      fromHandle: r2.fromHandle,
      to: r2.to,
      toHandle: r2.toHandle,
      label: typeof r2.label === "string" ? r2.label : "",
    });
  }
  bumpIdCounterFromNodes(nodes);
  const viewport = reviveViewport(r.viewport);
  return viewport ? { nodes, edges, viewport } : { nodes, edges };
}

export function useStoryGraph(
  workspaceId: string | null,
  projectId: string | null,
) {
  const { user } = useAuth();
  const [initialData, setInitialData] = useState<GraphBoard | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setInitialData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("graph_boards")
        .select("data")
        .eq("project_id", projectId)
        .maybeSingle();
      if (cancelled) return;
      setLoading(false);
      if (error) {
        console.error("graph_boards fetch", error);
        setInitialData(EMPTY_BOARD);
        return;
      }
      setInitialData(reviveBoard(data?.data));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = useCallback(
    async (next: GraphBoard) => {
      if (!workspaceId || !projectId || !user) return;
      const { error } = await supabase.from("graph_boards").upsert(
        {
          project_id: projectId,
          workspace_id: workspaceId,
          data: next as unknown as Json,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id" },
      );
      if (error) console.error("graph_boards save", error);
    },
    [workspaceId, projectId, user],
  );

  return { initialData, loading, save };
}
