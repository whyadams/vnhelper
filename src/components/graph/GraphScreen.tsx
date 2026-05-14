import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useKanban } from "../../state/kanbanStore";
import { useScripts } from "../../state/scripts";
import { GraphCanvas } from "./GraphCanvas";

export function GraphScreen() {
  const { state, dispatch } = useKanban();
  const scripts = useScripts(state.workspaceId);
  const { t } = useTranslation();

  const onOpenScene = useCallback(
    (sceneId: string) => {
      scripts.setActiveNodeId(sceneId);
      dispatch({ type: "SET_ACTIVE_NAV", key: "script" });
    },
    [scripts, dispatch],
  );

  if (!scripts.projectsReady) {
    return <div className="graph-loading">{t("graph.loading_projects")}</div>;
  }

  if (scripts.projects.length === 0) {
    return (
      <main className="main graph-main">
        <div className="graph-empty">
          <p>{t("graph.empty_no_projects")}</p>
          <p className="graph-empty-hint">{t("graph.empty_no_projects_hint")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="main graph-main">
      <div className="topbar graph-topbar">
        <span className="crumb">{t("graph.crumb")}</span>
        {scripts.activeProject && (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb is-current">
              {scripts.activeProject.cover_emoji ? (
                <span className="crumb-glyph" aria-hidden>
                  {scripts.activeProject.cover_emoji}
                </span>
              ) : null}
              {scripts.activeProject.title}
            </span>
          </>
        )}
        {scripts.projects.length > 1 && (
          <select
            className="graph-project-select"
            value={scripts.activeProjectId ?? ""}
            onChange={(e) => scripts.setActiveProjectId(e.target.value || null)}
            aria-label={t("graph.switch_project_aria")}
          >
            {scripts.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.cover_emoji ? `${p.cover_emoji}  ` : ""}
                {p.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {scripts.activeProjectId && state.workspaceId ? (
        <GraphCanvas
          key={scripts.activeProjectId}
          projectId={scripts.activeProjectId}
          workspaceId={state.workspaceId}
          onOpenScene={onOpenScene}
          createNode={scripts.createNode}
          updateNode={scripts.updateNode}
          deleteNode={scripts.deleteNode}
        />
      ) : (
        <div className="graph-empty">
          <p>{t("graph.empty_pick")}</p>
        </div>
      )}
    </main>
  );
}
