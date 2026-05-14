import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { supabase } from "../../lib/supabase";
import type { RpyBlocks } from "../../lib/renpy/blocks";
import { PathSimulator } from "./PathSimulator";
import type { GraphCharacter } from "./graphBuild";
import type { SimSourceRow } from "./pathSimulate";

/**
 * Root component for the standalone Path Simulator window.
 *
 * Spawned via `WebviewWindow` from the Graph "▶ Simulate" button so the
 * preview can run truly full-screen, free of the main window's sidebar /
 * topbar chrome. Auth is shared automatically — every Tauri webview in
 * this app shares WebView2 storage, so the Supabase session already
 * lives where this component looks for it.
 *
 * URL contract: `index.html?simulator=1&projectId=<uuid>&start=<label?>`.
 * On mount we read those params, fetch the project's script nodes +
 * characters once, and hand them to `<PathSimulator />`. Closing the
 * simulator closes the window — there's no "minimize to overlay" path
 * because the inline overlay already exists in the main window for
 * users who don't want a separate window.
 */
export function SimulatorWindow() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("projectId");
  const startLabel = params.get("start");

  const [rows, setRows] = useState<SimSourceRow[]>([]);
  const [characters, setCharacters] = useState<GraphCharacter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch the project's rows + characters once. Same query the inline
  // `GraphCanvas` simulator uses — keeping it in sync means a fix to
  // either side automatically improves both.
  useEffect(() => {
    if (!projectId) {
      setError("No projectId provided in URL");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [nodesRes, charsRes] = await Promise.all([
          supabase
            .from("script_nodes")
            .select(
              "id, kind, title, position, rpy_label, rpy_blocks, pov, photo_id",
            )
            .eq("project_id", projectId)
            .order("position", { ascending: true }),
          supabase
            .from("script_characters")
            .select("id, name, color")
            .eq("project_id", projectId),
        ]);
        if (cancelled) return;
        if (nodesRes.error) {
          setError(nodesRes.error.message);
          setLoading(false);
          return;
        }
        type Row = {
          id: string;
          kind: "chapter" | "scene" | "block";
          title: string;
          position: number;
          rpy_label: string | null;
          rpy_blocks: unknown;
          pov: string | null;
          photo_id: string | null;
        };
        const list = (nodesRes.data ?? []) as Row[];
        setRows(
          list.map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            position: r.position,
            rpy_label: r.rpy_label,
            rpy_blocks: (r.rpy_blocks as RpyBlocks | null) ?? null,
            photo_id: r.photo_id,
          })),
        );
        setCharacters((charsRes.data ?? []) as GraphCharacter[]);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Close = destroy the window. The user can re-open from the Graph
  // toolbar; we don't want a lingering hidden simulator window because
  // it would keep an Supabase realtime channel open for no reason.
  const onClose = () => {
    try {
      void getCurrentWindow().close();
    } catch {
      // Outside Tauri — best effort. The overlay will dismiss via
      // its own onClose handler.
    }
  };

  if (loading) {
    return (
      <div className="simulator-window-shell">
        <div className="simulator-window-loading">Loading project…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="simulator-window-shell">
        <div className="simulator-window-loading">
          Failed to load project: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="simulator-window-shell">
      <PathSimulator
        open
        rows={rows}
        characters={characters}
        startLabel={startLabel ?? null}
        onClose={onClose}
      />
    </div>
  );
}
