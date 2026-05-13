import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { CardData, ColumnKey } from "../../data/kanban";
import { useAuth } from "../../state/AuthProvider";
import { findCardWithColumn, useKanban } from "../../state/kanbanStore";
import { useCardDetail } from "../../state/cardDetail";
import {
  CalendarIcon,
  CloseIcon,
  DropboxMini,
  LoomMini,
  NotionMini,
  PlusIcon,
  TrashIcon,
  ZendeskMini,
} from "./Icon";
import { Popover } from "./Popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { CommentComposer, renderCommentBody } from "./CommentComposer";
import { useDialog } from "../ui/Dialog";
import { LinkedEventsSection } from "../calendar/LinkedEventsSection";

function BrandGlyph({
  brand,
  fallback,
}: {
  brand: CardData["brand"];
  fallback?: string;
}) {
  switch (brand) {
    case "zendesk":
      return <ZendeskMini />;
    case "dropbox":
      return <DropboxMini />;
    case "loom":
      return <LoomMini />;
    case "notion":
      return <NotionMini />;
    default:
      return <span>{fallback ?? brand[0].toUpperCase()}</span>;
  }
}

function StatusDot({ columnKey }: { columnKey: ColumnKey }) {
  return <span className={"col-head " + columnKey}><span className="dot" /></span>;
}

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

function avatarInitials(name: string | null, email: string | null): string {
  const src = name ?? email ?? "?";
  return src.slice(0, 2).toUpperCase();
}

export function CardDetailPanel() {
  const { state, dispatch } = useKanban();
  const dialog = useDialog();
  const { user } = useAuth();
  const found = findCardWithColumn(state, state.focusedId);
  const cardId = found?.card.id ?? null;
  const detail = useCardDetail(cardId, state.boardId);

  const tagBtnRef = useRef<HTMLButtonElement | null>(null);
  const assignBtnRef = useRef<HTMLButtonElement | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [draftDesc, setDraftDesc] = useState("");
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [assignSearch, setAssignSearch] = useState("");

  useEffect(() => {
    if (found) {
      setDraftDesc(found.card.description ?? "");
      setSubtaskDraft("");
      setAddingSubtask(false);
      setStatusOpen(false);
      setTagOpen(false);
      setTagSearch("");
      setAssignOpen(false);
      setAssignSearch("");
    }
  }, [state.focusedId, found?.card.id]);

  useEffect(() => {
    if (!found) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const el = e.target as HTMLElement;
        if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
        dispatch({ type: "FOCUS_CARD", id: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [found, dispatch]);

  const filteredBoardTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const appliedIds = new Set(detail.cardTags.map((t) => t.tag_id));
    return detail.boardTags
      .filter((t) => !appliedIds.has(t.id))
      .filter((t) => !q || t.label.toLowerCase().includes(q));
  }, [detail.boardTags, detail.cardTags, tagSearch]);

  const exactMatch = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return false;
    return detail.boardTags.some((t) => t.label.toLowerCase() === q);
  }, [detail.boardTags, tagSearch]);

  const filteredMembers = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    const assignedIds = new Set(
      (found?.card.assignees ?? []).map((a) => a.user_id),
    );
    return detail.workspaceMembers
      .filter((m) => !assignedIds.has(m.user_id))
      .filter((m) => {
        if (!q) return true;
        const hay = ((m.name ?? "") + " " + (m.email ?? "")).toLowerCase();
        return hay.includes(q);
      });
  }, [detail.workspaceMembers, found?.card.assignees, assignSearch]);

  if (!found) return null;
  const { card, column } = found;

  const completed = detail.subtasks.filter((s) => s.done).length;
  const close = () => dispatch({ type: "FOCUS_CARD", id: null });

  const commitDescription = () => {
    if (draftDesc !== (card.description ?? "")) {
      dispatch({
        type: "UPDATE_CARD",
        id: card.id,
        patch: { description: draftDesc },
      });
    }
  };

  const renameTitle = (next: string) => {
    if (next.trim() && next !== card.title) {
      dispatch({
        type: "UPDATE_CARD",
        id: card.id,
        patch: { title: next.trim() },
      });
    }
  };

  const moveTo = (key: ColumnKey) => {
    if (key === column.key) {
      setStatusOpen(false);
      return;
    }
    const targetCol = state.columns.find((c) => c.key === key);
    const idx = targetCol ? targetCol.cards.length : 0;
    dispatch({ type: "MOVE_CARD", id: card.id, toColumn: key, toIndex: idx });
    setStatusOpen(false);
  };

  const onSubtaskKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = subtaskDraft.trim();
      if (v) {
        void detail.addSubtask(v);
        setSubtaskDraft("");
      } else {
        setAddingSubtask(false);
      }
    } else if (e.key === "Escape") {
      setSubtaskDraft("");
      setAddingSubtask(false);
    }
  };

  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: "Delete card",
      message: `Delete "${card.title}"? This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (ok) dispatch({ type: "DELETE_CARD", id: card.id });
  };

  return (
    <aside className="card-panel">
      <header className="cp-head">
        <DropdownMenu open={statusOpen} onOpenChange={setStatusOpen}>
          <DropdownMenuTrigger asChild>
            <button className="cp-status-btn" type="button">
              <StatusDot columnKey={column.key} />
              {column.title}
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel>Move to status</DropdownMenuLabel>
            {state.columns.map((col) => (
              <DropdownMenuItem
                key={col.key}
                data-active={col.key === column.key || undefined}
                onSelect={() => moveTo(col.key)}
              >
                <span className={"col-head cp-menu-dot " + col.key}>
                  <span className="dot" />
                </span>
                <span style={{ marginLeft: 8 }}>{col.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="cp-head-actions">
          <button
            className="cp-icon-btn cp-danger"
            type="button"
            aria-label="Delete"
            onClick={() => void handleDelete()}
          >
            <TrashIcon />
          </button>
          <button
            className="cp-icon-btn"
            type="button"
            aria-label="Close"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="cp-scroll">
        <div className="cp-brand-row">
          <span className="card-brand cp-brand-lg">
            <BrandGlyph brand={card.brand} fallback={card.brandFallback} />
          </span>
          <div className="cp-brand-meta">
            <div className="cp-eyebrow">{card.subtitle || "Card"}</div>
            <div className="cp-id">#{card.id.slice(0, 8).toUpperCase()}</div>
          </div>
        </div>

        <input
          className="cp-title"
          defaultValue={card.title}
          onBlur={(e) => renameTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          spellCheck={false}
          key={card.id}
        />

        <div className="cp-props">
          <div className="cp-prop">
            <svg
              className="cp-prop-ico"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
            >
              <path d="M3 21V5a2 2 0 0 1 2-2h6l4 4h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7" />
            </svg>
            <span className="cp-prop-key">Priority</span>
            <span className="cp-prop-val cp-priority-row">
              {(["low", "medium", "high", "urgent"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={
                    "priority-chip pri-" +
                    p +
                    (card.priority === p ? " is-active" : " is-dim")
                  }
                  onClick={() =>
                    dispatch({
                      type: "UPDATE_CARD",
                      id: card.id,
                      patch: { priority: card.priority === p ? null : p },
                    })
                  }
                >
                  {p === "low"
                    ? "Low"
                    : p === "medium"
                      ? "Medium"
                      : p === "high"
                        ? "High"
                        : "Urgent"}
                </button>
              ))}
            </span>
          </div>

          <div className="cp-prop">
            <CalendarIcon className="cp-prop-ico" />
            <span className="cp-prop-key">Due date</span>
            <span className="cp-prop-val">
              {card.date || <span className="cp-empty">Not set</span>}
            </span>
          </div>

          <div className="cp-prop cp-prop-tags">
            <svg
              className="cp-prop-ico"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
            >
              <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 1.4-.6h5.6a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4z" />
              <circle cx="16" cy="8" r="1" />
            </svg>
            <span className="cp-prop-key">Tags</span>
            <span className="cp-prop-val cp-tags">
              {detail.cardTags.length === 0 && (
                <span className="cp-empty">No tags</span>
              )}
              {detail.cardTags.map((t) => (
                <span
                  key={t.tag_id}
                  className={"tag t-" + t.color + " removable"}
                  onClick={() => void detail.removeTag(t.tag_id)}
                  title="Click to remove"
                >
                  {t.label}
                  <span className="tag-x">×</span>
                </span>
              ))}
              <button
                ref={tagBtnRef}
                className="tag tag-add"
                type="button"
                onClick={() => setTagOpen((v) => !v)}
              >
                <PlusIcon size={10} />
                Tag
              </button>
              <Popover
                open={tagOpen}
                onClose={() => {
                  setTagOpen(false);
                  setTagSearch("");
                }}
                anchorRef={tagBtnRef}
                align="left"
              >
                <div className="menu menu-tags-pop">
                  <input
                    className="cp-tag-search"
                    placeholder="Search or create…"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && tagSearch.trim() && !exactMatch) {
                        void detail.createAndApplyTag(tagSearch.trim());
                        setTagSearch("");
                        setTagOpen(false);
                      }
                    }}
                    autoFocus
                  />
                  <div className="cp-tag-list">
                    {filteredBoardTags.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="cp-tag-item"
                        onClick={() => {
                          void detail.applyTag(t.id);
                          setTagSearch("");
                          setTagOpen(false);
                        }}
                      >
                        <span className={"tag t-" + t.color}>{t.label}</span>
                      </button>
                    ))}
                    {tagSearch.trim() && !exactMatch && (
                      <button
                        type="button"
                        className="cp-tag-item cp-tag-create"
                        onClick={() => {
                          void detail.createAndApplyTag(tagSearch.trim());
                          setTagSearch("");
                          setTagOpen(false);
                        }}
                      >
                        <PlusIcon size={10} /> Create "{tagSearch.trim()}"
                      </button>
                    )}
                    {filteredBoardTags.length === 0 &&
                      !tagSearch.trim() && (
                        <div className="cp-empty cp-tag-empty">
                          No tags yet — type to create one
                        </div>
                      )}
                  </div>
                </div>
              </Popover>
            </span>
          </div>

          <div className="cp-prop cp-prop-assignees">
            <svg
              className="cp-prop-ico"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
            >
              <circle cx="9" cy="8" r="3.5" />
              <circle cx="17" cy="9" r="2.5" />
              <path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5M14 19c0-2 1.5-3.5 3-3.5s3 1.5 3 3.5" />
            </svg>
            <span className="cp-prop-key">Assignees</span>
            <span className="cp-prop-val cp-assignees">
              {card.assignees.length === 0 && (
                <span className="cp-empty">Unassigned</span>
              )}
              {card.assignees.map((a) => (
                <span
                  key={a.user_id}
                  className="cp-assignee removable"
                  onClick={() => void detail.unassignMember(a.user_id)}
                  title={`${a.name ?? a.email ?? ""} — click to remove`}
                >
                  <span className="av">
                    {avatarInitials(a.name, a.email)}
                  </span>
                  <span className="cp-assignee-name">
                    {a.name ?? a.email ?? "Unknown"}
                  </span>
                  <span className="tag-x">×</span>
                </span>
              ))}
              <button
                ref={assignBtnRef}
                className="tag tag-add"
                type="button"
                onClick={() => setAssignOpen((v) => !v)}
              >
                <PlusIcon size={10} />
                Assign
              </button>
              <Popover
                open={assignOpen}
                onClose={() => {
                  setAssignOpen(false);
                  setAssignSearch("");
                }}
                anchorRef={assignBtnRef}
                align="left"
              >
                <div className="menu menu-tags-pop">
                  <input
                    className="cp-tag-search"
                    placeholder="Search members…"
                    value={assignSearch}
                    onChange={(e) => setAssignSearch(e.target.value)}
                    autoFocus
                  />
                  <div className="cp-tag-list">
                    {filteredMembers.length === 0 ? (
                      <div className="cp-empty cp-tag-empty">
                        {assignSearch
                          ? "No matches"
                          : "Everyone is already assigned"}
                      </div>
                    ) : (
                      filteredMembers.map((m) => (
                        <button
                          key={m.user_id}
                          type="button"
                          className="cp-tag-item cp-assign-item"
                          onClick={() => {
                            void detail.assignMember(m.user_id);
                            setAssignSearch("");
                            setAssignOpen(false);
                          }}
                        >
                          <span className="av">
                            {avatarInitials(m.name, m.email)}
                          </span>
                          <span className="cp-assign-meta">
                            <span className="cp-assign-name">
                              {m.name ?? m.email ?? "Unknown"}
                            </span>
                            {m.name && m.email && (
                              <span className="cp-assign-email">
                                {m.email}
                              </span>
                            )}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </Popover>
            </span>
          </div>

          {card.creator && (
            <div className="cp-prop cp-prop-creator">
              <svg
                className="cp-prop-ico"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" />
              </svg>
              <span className="cp-prop-key">Created by</span>
              <span className="cp-prop-val">
                <span className="cp-assignee">
                  <span className="cp-assignee-name">
                    {card.creator.name ??
                      card.creator.email ??
                      "Unknown"}
                  </span>
                </span>
              </span>
            </div>
          )}
        </div>

        <section className="cp-section">
          <h3 className="cp-section-title">Description</h3>
          <textarea
            className="cp-textarea"
            value={draftDesc}
            placeholder="Add a description…"
            onChange={(e) => setDraftDesc(e.target.value)}
            onBlur={commitDescription}
            rows={4}
          />
        </section>

        <section className="cp-section">
          <div className="cp-section-row">
            <h3 className="cp-section-title">
              Subtasks
              <span className="cp-count">
                {completed}/{detail.subtasks.length}
              </span>
            </h3>
            <button
              className="cp-link"
              type="button"
              onClick={() => setAddingSubtask(true)}
            >
              <PlusIcon size={12} />
              Add
            </button>
          </div>
          <div className="cp-progress">
            <div
              className="cp-progress-bar"
              style={{
                width: detail.subtasks.length
                  ? `${(completed / detail.subtasks.length) * 100}%`
                  : 0,
              }}
            />
          </div>
          <div className="cp-subtasks">
            {detail.subtasks.map((s) => (
              <div
                key={s.id}
                className={"cp-subtask" + (s.done ? " is-done" : "")}
              >
                <label className="cp-subtask-label-wrap">
                  <input
                    type="checkbox"
                    checked={s.done}
                    onChange={() => void detail.toggleSubtask(s.id, !s.done)}
                  />
                  <span className="cp-check" />
                  <span className="cp-subtask-label">{s.label}</span>
                </label>
                <button
                  className="cp-subtask-delete"
                  type="button"
                  aria-label="Delete subtask"
                  onClick={() => void detail.deleteSubtask(s.id)}
                >
                  ×
                </button>
              </div>
            ))}
            {addingSubtask && (
              <div className="cp-subtask cp-subtask-add">
                <input
                  className="cp-subtask-input"
                  placeholder="New subtask…"
                  value={subtaskDraft}
                  autoFocus
                  onChange={(e) => setSubtaskDraft(e.target.value)}
                  onKeyDown={onSubtaskKey}
                  onBlur={() => {
                    const v = subtaskDraft.trim();
                    if (v) void detail.addSubtask(v);
                    setSubtaskDraft("");
                    setAddingSubtask(false);
                  }}
                />
              </div>
            )}
          </div>
        </section>

        <LinkedEventsSection entity_type="card" entity_id={card.id} />

        <section className="cp-section">
          <h3 className="cp-section-title">
            Activity
            <span className="cp-count">{detail.comments.length}</span>
          </h3>
          <div className="cp-comments">
            {detail.comments.map((c) => {
              const isMine = c.author_id === user?.id;
              return (
                <div key={c.id} className="cp-comment">
                  <span className="av cp-comment-av">
                    {avatarInitials(c.author?.name ?? null, c.author?.email ?? null)}
                  </span>
                  <div className="cp-comment-body">
                    <div className="cp-comment-meta">
                      <span className="cp-comment-name">
                        {c.author?.name ?? c.author?.email ?? "Unknown"}
                      </span>
                      <span className="cp-comment-when">
                        {timeAgo(c.created_at)}
                      </span>
                      {isMine && (
                        <button
                          className="cp-comment-delete"
                          type="button"
                          onClick={() => void detail.deleteComment(c.id)}
                          aria-label="Delete"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="cp-comment-text">
                      {renderCommentBody(c.body, detail.workspaceMembers)}
                    </div>
                  </div>
                </div>
              );
            })}
            {detail.comments.length === 0 && (
              <div className="cp-empty cp-comments-empty">
                No activity yet. Be the first to comment.
              </div>
            )}
          </div>

          <CommentComposer
            members={detail.workspaceMembers}
            myInitials={avatarInitials(
              (user?.user_metadata?.name as string | undefined) ?? null,
              user?.email ?? null,
            )}
            onSubmit={(body, mentions) => detail.addComment(body, mentions)}
          />
        </section>
      </div>
    </aside>
  );
}
