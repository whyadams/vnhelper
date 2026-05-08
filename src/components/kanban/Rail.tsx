import { useRef, useState } from "react";
import {
  useKanban,
  type WorkspaceListItem,
} from "../../state/kanbanStore";
import { PlusIcon } from "./Icon";
import { SettingsFilledIcon } from "./SidebarIcons";
import { useDialog } from "../ui/Dialog";
import { SettingsModal } from "../settings/SettingsModal";
import { EditWorkspaceModal } from "../workspace/EditWorkspaceModal";
import {
  MMenu,
  MMenuItem,
  MMenuPage,
  MMenuSeparator,
} from "../ui/MMenu";

export function Rail() {
  const {
    state,
    dispatch,
    createWorkspace,
    updateWorkspace,
    uploadWorkspaceAvatar,
    removeWorkspaceAvatar,
    deleteWorkspace,
  } = useKanban();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceListItem | null>(
    null,
  );
  const [menuFor, setMenuFor] = useState<WorkspaceListItem | null>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);

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

  const openMenuFor = (
    ws: WorkspaceListItem,
    el: HTMLElement,
  ) => {
    menuAnchorRef.current = el;
    setMenuFor(ws);
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
                "rail-app" +
                (state.workspaceId === ws.id ? " is-active" : "") +
                (ws.avatar_url ? " has-avatar" : "")
              }
              title={`${ws.name} · ${ws.role} · right-click for settings`}
              type="button"
              onClick={() =>
                dispatch({ type: "SET_ACTIVE_WORKSPACE", id: ws.id })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                openMenuFor(ws, e.currentTarget);
              }}
            >
              {ws.avatar_url ? (
                <img
                  src={ws.avatar_url}
                  alt=""
                  className="rail-app-img"
                  draggable={false}
                />
              ) : (
                <span className="rail-glyph">
                  {ws.name.trim().charAt(0).toUpperCase() || "W"}
                </span>
              )}
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
      <MMenu
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        anchorRef={menuAnchorRef as React.RefObject<HTMLElement>}
        align="left"
        minWidth={200}
      >
        <MMenuPage id="main">
          <MMenuItem
            onClick={() => {
              if (menuFor) {
                setEditWorkspace(menuFor);
              }
              setMenuFor(null);
            }}
          >
            <span>Workspace settings…</span>
          </MMenuItem>
          {menuFor?.role === "owner" && (
            <>
              <MMenuSeparator />
              <MMenuItem
                variant="danger"
                onClick={() => {
                  const ws = menuFor;
                  setMenuFor(null);
                  if (!ws) return;
                  void (async () => {
                    const ok = await dialog.confirm({
                      title: "Delete workspace",
                      message: `Delete "${ws.name}" and everything inside it? This cannot be undone.`,
                      variant: "danger",
                      confirmLabel: "Delete forever",
                    });
                    if (ok) await deleteWorkspace(ws.id);
                  })();
                }}
              >
                Delete workspace…
              </MMenuItem>
            </>
          )}
        </MMenuPage>
      </MMenu>
      <EditWorkspaceModal
        open={editWorkspace !== null}
        workspace={editWorkspace}
        onClose={() => setEditWorkspace(null)}
        onSave={async ({ name }) => {
          if (editWorkspace) await updateWorkspace(editWorkspace.id, { name });
        }}
        onUploadAvatar={async (file) => {
          if (!editWorkspace) return null;
          return uploadWorkspaceAvatar(editWorkspace.id, file);
        }}
        onRemoveAvatar={async () => {
          if (editWorkspace) await removeWorkspaceAvatar(editWorkspace.id);
        }}
        onDelete={async () => {
          if (editWorkspace) await deleteWorkspace(editWorkspace.id);
        }}
      />
    </aside>
  );
}
