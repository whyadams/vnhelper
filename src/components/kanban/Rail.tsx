import { useState } from "react";
import {
  useKanban,
  type WorkspaceListItem,
} from "../../state/kanbanStore";
import { PlusIcon } from "./Icon";
import { SettingsFilledIcon } from "./SidebarIcons";
import { useDialog } from "../ui/Dialog";
import { useSubscription } from "../../state/subscription";
import { usePaywall } from "../subscription/Paywall";
import { useFrozenEntities } from "../../state/frozenEntities";
import { SettingsScreen } from "../settings/SettingsScreen";
import { EditWorkspaceModal } from "../workspace/EditWorkspaceModal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

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
  const { limits } = useSubscription();
  const paywall = usePaywall();
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceListItem | null>(
    null,
  );

  // The user "owns" only those workspaces in the list where they have the
  // `owner` role. The limit applies to owned workspaces — joining someone
  // else's workspace via invite doesn't count against the quota.
  const ownedCount = state.workspaces.filter((w) => w.role === "owner").length;
  const atWorkspaceLimit = ownedCount >= limits.maxWorkspaces;

  // Frozen overflow — workspaces past quota become read-locked behind a
  // paywall. We don't pass projects here; project freezing lives in the
  // script feature where the project list is already loaded.
  const { frozenWorkspaceIds } = useFrozenEntities(state.workspaces, [], limits);

  const onCreate = async () => {
    if (busy) return;
    if (atWorkspaceLimit) {
      paywall.show("workspace_limit");
      return;
    }
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

  const onDeleteWorkspace = async (ws: WorkspaceListItem) => {
    const ok = await dialog.confirm({
      title: "Delete workspace",
      message: `Delete "${ws.name}" and everything inside it? This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete forever",
    });
    if (ok) await deleteWorkspace(ws.id);
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
          {state.workspaces.map((ws) => {
            const isFrozen = frozenWorkspaceIds.has(ws.id);
            return (
            <ContextMenu key={ws.id}>
              <ContextMenuTrigger asChild>
                <button
                  className={
                    "rail-app" +
                    (state.workspaceId === ws.id ? " is-active" : "") +
                    (ws.avatar_url ? " has-avatar" : "") +
                    (isFrozen ? " is-frozen" : "")
                  }
                  title={
                    isFrozen
                      ? `${ws.name} · frozen (free plan)`
                      : `${ws.name} · ${ws.role} · right-click for settings`
                  }
                  type="button"
                  onClick={() => {
                    if (isFrozen) {
                      paywall.show("frozen_workspace");
                      return;
                    }
                    dispatch({ type: "SET_ACTIVE_WORKSPACE", id: ws.id });
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
                  {isFrozen && (
                    <span className="rail-app-lock" aria-hidden>
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    </span>
                  )}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-52">
                <ContextMenuItem onSelect={() => setEditWorkspace(ws)}>
                  Workspace settings…
                </ContextMenuItem>
                {ws.role === "owner" && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => void onDeleteWorkspace(ws)}
                    >
                      Delete workspace…
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
            );
          })}
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
      <SettingsScreen
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
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
