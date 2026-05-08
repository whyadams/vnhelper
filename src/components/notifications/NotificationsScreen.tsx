import { useMemo, useState } from "react";
import { useNotifications, type NotificationRow } from "../../state/notifications";
import { useKanban } from "../../state/kanbanStore";
import { BellFilledIcon } from "../kanban/SidebarIcons";

type Tab = "all" | "unread" | "mention" | "workspace";

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function dayKey(iso: string): "today" | "yesterday" | "older" {
  const d = new Date(iso);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, today)) return "today";
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  if (isSameDay(d, yest)) return "yesterday";
  return "older";
}

function avatarClass(kind: string): string {
  if (kind === "comment_mention") return "is-mention";
  if (kind === "card_assigned") return "is-task";
  return "is-info";
}

function avatarGlyph(kind: string): string {
  if (kind === "comment_mention") return "@";
  if (kind === "card_assigned") return "✓";
  return "ℹ";
}

function kindLabel(kind: string): string {
  if (kind === "comment_mention") return "Mention";
  if (kind === "card_assigned") return "Assignment";
  return kind;
}

export function NotificationsScreen() {
  const { state, dispatch } = useKanban();
  const notifications = useNotifications();
  const [tab, setTab] = useState<Tab>("all");

  const filtered = useMemo(() => {
    return notifications.items.filter((n) => {
      if (tab === "unread") return !n.read;
      if (tab === "mention") return n.kind === "comment_mention";
      if (tab === "workspace")
        return n.kind !== "comment_mention" && n.kind !== "card_assigned";
      return true;
    });
  }, [notifications.items, tab]);

  const grouped = useMemo(() => {
    const today: NotificationRow[] = [];
    const yesterday: NotificationRow[] = [];
    const older: NotificationRow[] = [];
    for (const n of filtered) {
      const k = dayKey(n.created_at);
      if (k === "today") today.push(n);
      else if (k === "yesterday") yesterday.push(n);
      else older.push(n);
    }
    return { today, yesterday, older };
  }, [filtered]);

  const navigate = async (n: NotificationRow) => {
    if (!n.read) await notifications.markRead(n.id);
    if (n.card_id) {
      if (n.workspace_id && n.workspace_id !== state.workspaceId) {
        dispatch({ type: "SET_ACTIVE_WORKSPACE", id: n.workspace_id });
      }
      dispatch({ type: "SET_ACTIVE_NAV", key: "task" });
      dispatch({ type: "FOCUS_CARD", id: n.card_id });
    }
  };

  const renderGroup = (label: string, list: NotificationRow[]) => {
    if (list.length === 0) return null;
    return (
      <>
        <h3 className="ws-notif-group-label">{label}</h3>
        <div className="ws-notif-list">
          {list.map((n) => (
            <div
              key={n.id}
              className={"ws-notif" + (n.read ? "" : " is-unread")}
              onClick={() => void navigate(n)}
            >
              <div className={"ws-notif-av " + avatarClass(n.kind)}>
                {avatarGlyph(n.kind)}
              </div>
              <div className="ws-notif-body">
                <div className="ws-notif-text">{n.body}</div>
                <div className="ws-notif-meta">
                  {timeAgo(n.created_at)} · {kindLabel(n.kind)}
                </div>
              </div>
              {!n.read && <div className="ws-notif-dot" />}
              <button
                type="button"
                className="ws-notif-x"
                onClick={(e) => {
                  e.stopPropagation();
                  void notifications.removeOne(n.id);
                }}
                title="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </>
    );
  };

  const counts = {
    all: notifications.items.length,
    unread: notifications.unreadCount,
  };

  return (
    <main className="main">
      <div className="ws-screen-topbar">
        <BellFilledIcon size={20} className="ws-screen-glyph" />
        <span className="ws-screen-title">Notifications</span>
        {counts.unread > 0 && (
          <span className="ws-screen-ct is-danger">{counts.unread} new</span>
        )}
        <span style={{ flex: 1 }} />
        {counts.unread > 0 && (
          <button
            type="button"
            className="hbtn"
            onClick={() => void notifications.markAllRead()}
          >
            ✓ Mark all read
          </button>
        )}
      </div>

      <div className="ws-tabs">
        <button
          type="button"
          className={"ws-tab" + (tab === "all" ? " is-active" : "")}
          onClick={() => setTab("all")}
        >
          All <span>{counts.all}</span>
        </button>
        <button
          type="button"
          className={
            "ws-tab is-danger" + (tab === "unread" ? " is-active" : "")
          }
          onClick={() => setTab("unread")}
        >
          Unread <span>{counts.unread}</span>
        </button>
        <button
          type="button"
          className={"ws-tab" + (tab === "mention" ? " is-active" : "")}
          onClick={() => setTab("mention")}
        >
          Mentions
        </button>
        <button
          type="button"
          className={"ws-tab" + (tab === "workspace" ? " is-active" : "")}
          onClick={() => setTab("workspace")}
        >
          Workspace
        </button>
      </div>

      <div className="ws-body">
        {filtered.length === 0 ? (
          <div className="ws-empty">No notifications yet.</div>
        ) : (
          <>
            {renderGroup("TODAY", grouped.today)}
            {renderGroup("YESTERDAY", grouped.yesterday)}
            {renderGroup("EARLIER", grouped.older)}
          </>
        )}
      </div>
    </main>
  );
}
