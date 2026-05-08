import { useRef, useState } from "react";
import { useKanban } from "../../../state/kanbanStore";
import { useScripts } from "../../../state/scripts";
import { useStoryGraph } from "../../../state/storyGraph";
import { Popover } from "../../kanban/Popover";
import { ShareFilledIcon } from "../../kanban/SidebarIcons";
import { CreateProjectModal } from "../CreateProjectModal";
import { StoryGraphCanvas } from "./StoryGraphCanvas";

export function StoryGraphScreen() {
  const { state } = useKanban();
  const scripts = useScripts(state.workspaceId);
  const graph = useStoryGraph(state.workspaceId, scripts.activeProjectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectBtnRef = useRef<HTMLButtonElement | null>(null);

  if (!scripts.activeProjectId) {
    return (
      <main className="main">
        <div className="topbar notes-topbar">
          <span className="crumb">Graph</span>
        </div>
        <div className="notes-empty-doc">
          <p>Pick a script project, or create a new one.</p>
          <button
            type="button"
            className="hbtn"
            onClick={() => setCreateOpen(true)}
          >
            + New script project
          </button>
        </div>
        <CreateProjectModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={(title, emoji) => {
            void scripts.createProject(title, emoji);
          }}
        />
      </main>
    );
  }

  return (
    <main className="main vn-graph-main">
      <div className="topbar tmt-bar vn-graph-topbar">
        <ShareFilledIcon size={20} className="tmt-ico" />
        <span className="tmt-title">Graph</span>
        <span className="tmt-sep">·</span>
        <button
          ref={projectBtnRef}
          type="button"
          className="vn-graph-project-btn"
          onClick={() => setProjectMenuOpen((v) => !v)}
        >
          <span className="vn-graph-project-emoji">
            {scripts.activeProject?.cover_emoji ?? "📖"}
          </span>
          <span className="vn-graph-project-name">
            {scripts.activeProject?.title ?? "Untitled"}
          </span>
          <span className="vn-graph-project-chev">⌄</span>
        </button>
        <Popover
          open={projectMenuOpen}
          onClose={() => setProjectMenuOpen(false)}
          anchorRef={projectBtnRef}
          align="left"
        >
          <div className="menu vn-project-menu">
            {scripts.projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={
                  "menu-item" +
                  (scripts.activeProjectId === p.id ? " is-active" : "")
                }
                onClick={() => {
                  scripts.setActiveProjectId(p.id);
                  setProjectMenuOpen(false);
                }}
              >
                <span className="vn-project-emoji">
                  {p.cover_emoji ?? "📖"}
                </span>
                <span className="vn-project-name">{p.title}</span>
              </button>
            ))}
            {scripts.projects.length > 0 && <div className="menu-divider" />}
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setProjectMenuOpen(false);
                setCreateOpen(true);
              }}
            >
              + New script project
            </button>
          </div>
        </Popover>
        <span className="tmt-spacer" />
        {graph.loading && <span className="vn-graph-loading">Loading…</span>}
      </div>

      <div className="vn-graph-canvas-wrap">
        <StoryGraphCanvas key={scripts.activeProjectId} graph={graph} />
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(title, emoji) => {
          void scripts.createProject(title, emoji);
        }}
      />
    </main>
  );
}
