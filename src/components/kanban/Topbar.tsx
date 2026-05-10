import { Pin } from "lucide-react";
import { Webview } from "@tauri-apps/api/webview";
import { Window } from "@tauri-apps/api/window";
import { useKanban } from "../../state/kanbanStore";
import { CategoryFilledIcon } from "./SidebarIcons";

// Show / focus the always-on-top widget window. The window is declared
// statically in tauri.conf.json (label "widget") and starts hidden — we
// just bring it up on demand.
async function openWidget() {
  try {
    const win = await Window.getByLabel("widget");
    if (win) {
      await win.show();
      await win.setFocus();
      // The widget itself reads the persisted pin pref on mount and syncs
      // alwaysOnTop accordingly — don't force it from here.
      return;
    }
  } catch (e) {
    console.warn("openWidget: getByLabel failed", e);
  }
  // Fallback: create the window if for some reason it isn't registered.
  try {
    const w = new Window("widget", {
      title: "VnHelper Widget",
      width: 360,
      height: 540,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
    });
    await new Webview(w, "widget-webview", {
      url: "index.html",
      x: 0,
      y: 0,
      width: 360,
      height: 540,
    });
  } catch (e) {
    console.error("openWidget: create failed", e);
  }
}

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
          className="tmt-widget"
          onClick={() => void openWidget()}
          title="Pin board on desktop"
          aria-label="Open desktop widget"
        >
          <Pin className="size-3.5" />
        </button>
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
