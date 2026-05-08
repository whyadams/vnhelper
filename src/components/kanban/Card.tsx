import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import type { CardData, CardPriority } from "../../data/kanban";
import { useKanban } from "../../state/kanbanStore";
import { MMenu, MMenuItem, MMenuPage, MMenuSeparator } from "../ui/MMenu";
import { CommentIcon, MoreHIcon } from "./Icon";
import { useDialog } from "../ui/Dialog";

function assigneeInitials(name: string | null, email: string | null): string {
  const src = name ?? email ?? "?";
  const parts = src.trim().split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

const priorityLabel: Record<CardPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function Card({ data }: { data: CardData }) {
  const { state, dispatch } = useKanban();
  const dialog = useDialog();
  const { title, description, tags, meta, assignees, date, priority } = data;
  const focused = state.focusedId === data.id;

  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);

  const onDragStart = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData("text/plain", data.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest(".card-more, .card-menu")) return;
    dispatch({ type: "FOCUS_CARD", id: data.id });
  };

  return (
    <article
      className={
        "card" +
        (focused ? " is-focus" : "") +
        (dragging ? " is-dragging" : "")
      }
      data-card-id={data.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      onClick={onClick}
    >
      <div className="card-top-row">
        {priority && (
          <span className={"priority-chip pri-" + priority}>
            {priorityLabel[priority]}
          </span>
        )}
        {tags.slice(0, 2).map((t) => (
          <span key={t.label} className={"tag t-" + t.color}>
            {t.label}
          </span>
        ))}
        {tags.length > 2 && (
          <span className="tag-more">+{tags.length - 2}</span>
        )}
        <span className="card-top-spacer" />
        <button
          className="card-more"
          type="button"
          aria-label="More"
          ref={moreRef}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreHIcon />
        </button>
        <MMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={moreRef}
          align="right"
          minWidth={180}
        >
          <MMenuPage id="main">
            <MMenuItem
              onClick={() => {
                dispatch({ type: "FOCUS_CARD", id: data.id });
                setMenuOpen(false);
              }}
            >
              Open
            </MMenuItem>
            <MMenuSeparator />
            <MMenuItem
              variant="danger"
              onClick={() => {
                setMenuOpen(false);
                void (async () => {
                  const ok = await dialog.confirm({
                    title: "Delete card",
                    message: `Delete "${data.title}"? This cannot be undone.`,
                    variant: "danger",
                    confirmLabel: "Delete",
                  });
                  if (ok) dispatch({ type: "DELETE_CARD", id: data.id });
                })();
              }}
            >
              Delete
            </MMenuItem>
          </MMenuPage>
        </MMenu>
      </div>

      <div className="card-title">{title}</div>

      {description && (
        <div className="card-desc">{description}</div>
      )}

      <div className="card-foot">
        {assignees.length > 0 ? (
          <div className="avatars">
            {assignees.slice(0, 3).map((a) => (
              <span
                key={a.user_id}
                className="av"
                title={a.name ?? a.email ?? ""}
              >
                {assigneeInitials(a.name, a.email)}
              </span>
            ))}
            {assignees.length > 3 && (
              <span className="av av-more">+{assignees.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="av-empty" />
        )}

        <span className="card-foot-right">
          {date && <span className="date">{date}</span>}
          {meta.comments != null && meta.comments > 0 && (
            <span className="meta">
              <CommentIcon className="ico" />
              {meta.comments}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}
