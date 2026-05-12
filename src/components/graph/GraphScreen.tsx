import { useCallback } from "react";
import { useKanban } from "../../state/kanbanStore";
import { useScripts } from "../../state/scripts";
import { GraphCanvas } from "./GraphCanvas";

export function GraphScreen() {
  const { state, dispatch } = useKanban();
  const scripts = useScripts(state.workspaceId);

  const onOpenScene = useCallback(
    (sceneId: string) => {
      scripts.setActiveNodeId(sceneId);
      dispatch({ type: "SET_ACTIVE_NAV", key: "script" });
    },
    [scripts, dispatch],
  );

  if (!scripts.projectsReady) {
    return <div className="graph-loading">Loading projects…</div>;
  }

  if (scripts.projects.length === 0) {
    return (
      <main className="main graph-main">
        <div className="graph-empty">
          <p>You don't have any script projects yet.</p>
          <p className="graph-empty-hint">
            Create one in Script — the story-flow graph builds itself from
            your scenes.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="main graph-main">
      <header className="graph-header">
        <div className="graph-header-title">
          <span className="graph-header-eyebrow">Story flow</span>
          <h1>{scripts.activeProject?.title ?? "Select a project"}</h1>
        </div>
        {scripts.projects.length > 1 && (
          <select
            className="graph-project-select"
            value={scripts.activeProjectId ?? ""}
            onChange={(e) => scripts.setActiveProjectId(e.target.value || null)}
          >
            {scripts.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.cover_emoji ? `${p.cover_emoji}  ` : ""}
                {p.title}
              </option>
            ))}
          </select>
        )}
      </header>
      {scripts.activeProjectId && state.workspaceId ? (
        <GraphCanvas
          key={scripts.activeProjectId}
          projectId={scripts.activeProjectId}
          workspaceId={state.workspaceId}
          onOpenScene={onOpenScene}
        />
      ) : (
        <div className="graph-empty">
          <p>Pick a project to view its story flow.</p>
        </div>
      )}
    </main>
  );
}
