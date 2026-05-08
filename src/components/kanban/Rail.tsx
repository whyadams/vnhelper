import { useState } from "react";
import { useKanban } from "../../state/kanbanStore";
import { PlusIcon } from "./Icon";
import { SettingsFilledIcon } from "./SidebarIcons";
import { useDialog } from "../ui/Dialog";
import { SettingsModal } from "../settings/SettingsModal";

export function Rail() {
  const { state, dispatch, createWorkspace } = useKanban();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const onCreate = async () => {
    if (busy) return;
    const name = await dialog.prompt({
      title: "New workspace",
      message: "Workspace name",
      placeholder: "e.g. My Visual Novel",
      confirmLabel: "Create",
    });
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      await createWorkspace(name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="rail">
      <div className="rail-top">
        <button
          className="rail-app bg-add"
          title="New workspace"
          type="button"
          onClick={() => void onCreate()}
          disabled={busy}
        >
          <PlusIcon />
        </button>
        {state.workspaces.length > 0 && <span className="rail-divider" />}
        <div className="rail-list">
          {state.workspaces.map((ws) => (
            <button
              key={ws.id}
              className={
                "rail-app" + (state.workspaceId === ws.id ? " is-active" : "")
              }
              title={`${ws.name} · ${ws.role}`}
              type="button"
              onClick={() =>
                dispatch({ type: "SET_ACTIVE_WORKSPACE", id: ws.id })
              }
            >
              <span className="rail-glyph">
                {ws.name.trim().charAt(0).toUpperCase() || "W"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <button
        className="rail-settings"
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => setSettingsOpen(true)}
      >
        <SettingsFilledIcon size={22} />
      </button>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </aside>
  );
}
