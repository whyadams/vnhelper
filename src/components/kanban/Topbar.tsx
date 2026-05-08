import { useKanban } from "../../state/kanbanStore";
import { CategoryFilledIcon } from "./SidebarIcons";

const navTitle: Record<string, string> = {
  task: "Tasks",
  calendar: "Calendar",
  notes: "Notes",
  photos: "Photos",
};

export function Topbar() {
  const { state, dispatch } = useKanban();

  // Kanban "tmt" topbar (Figma 1509:4662): icon + board name + dot + task count + spacer + "New task"
  if (state.activeNav === "task") {
    const totalCards = state.columns.reduce(
      (s, c) => s + c.cards.length,
      0,
    );
    const firstCol = state.columns[0];
    const onAdd = () => {
      if (!firstCol) return;
      dispatch({
        type: "ADD_CARD",
        columnKey: firstCol.key,
        title: "New task",
      });
    };
    return (
      <div className="topbar tmt-bar">
        <CategoryFilledIcon size={21} className="tmt-ico" />
        <span className="tmt-title">{state.boardName || "Main Board"}</span>
        <span className="tmt-sep">·</span>
        <span className="tmt-meta">
          {totalCards} {totalCards === 1 ? "task" : "tasks"}
        </span>
        <span className="tmt-spacer" />
        <button
          type="button"
          className="tmt-add"
          onClick={onAdd}
          disabled={!firstCol}
        >
          New task
        </button>
      </div>
    );
  }

  return (
    <div className="topbar">
      <span className="crumb">{state.workspaceName || "Workspace"}</span>
      <span className="crumb-sep">/</span>
      <span className="crumb is-current">
        {navTitle[state.activeNav] ?? "Tasks"}
      </span>
    </div>
  );
}
