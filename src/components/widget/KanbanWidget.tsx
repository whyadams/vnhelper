import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyFilters, useKanban } from "../../state/kanbanStore";
import type { CardData, ColumnData } from "../../data/kanban";

const win = getCurrentWindow();

const PIN_STORAGE_KEY = "vnhelper.widget.alwaysOnTop";

function readPinPref(): boolean {
  if (typeof localStorage === "undefined") return true;
  const v = localStorage.getItem(PIN_STORAGE_KEY);
  // Default: pinned. The user can turn it off and the choice persists.
  return v === null ? true : v === "1";
}

function writePinPref(pinned: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PIN_STORAGE_KEY, pinned ? "1" : "0");
}

export function KanbanWidget() {
  const { state, dispatch } = useKanban();
  const [activeColumnKey, setActiveColumnKey] = useState<string | null>(null);
  const [pinned, setPinnedState] = useState<boolean>(() => readPinPref());

  // Apply the persisted pin preference on mount and any time the user
  // toggles it. The window is created with alwaysOnTop=true in tauri.conf,
  // so we explicitly sync to whatever the saved pref says.
  useEffect(() => {
    void win.setAlwaysOnTop(pinned);
    writePinPref(pinned);
  }, [pinned]);

  const togglePinned = () => setPinnedState((p) => !p);

  const columns: ColumnData[] = useMemo(
    () => applyFilters(state.columns, state),
    [state],
  );

  // Default to the first column with cards (or just the first column).
  useEffect(() => {
    if (activeColumnKey && columns.some((c) => c.key === activeColumnKey)) return;
    const firstWithCards = columns.find((c) => c.cards.length > 0);
    setActiveColumnKey(firstWithCards?.key ?? columns[0]?.key ?? null);
  }, [columns, activeColumnKey]);

  const activeColumn =
    columns.find((c) => c.key === activeColumnKey) ?? columns[0] ?? null;
  const total = columns.reduce((s, c) => s + c.cards.length, 0);

  if (!state.ready) {
    return (
      <div className="widget-shell">
        <WidgetHeader
          title="Loading…"
          pinned={pinned}
          onTogglePinned={togglePinned}
        />
        <div className="widget-loading">Loading workspace…</div>
      </div>
    );
  }

  return (
    <div className="widget-shell">
      <WidgetHeader
        title={state.boardName || "Board"}
        subtitle={`${total} tasks`}
        pinned={pinned}
        onTogglePinned={togglePinned}
      />

      <div className="widget-tabs" role="tablist">
        {columns.map((col) => (
          <button
            key={col.key}
            type="button"
            role="tab"
            aria-selected={activeColumnKey === col.key}
            className={
              "widget-tab " +
              col.key +
              (activeColumnKey === col.key ? " is-active" : "")
            }
            onClick={() => setActiveColumnKey(col.key)}
          >
            <span className="widget-tab-dot" />
            <span className="widget-tab-label">{col.title}</span>
            <span className="widget-tab-count">{col.cards.length}</span>
          </button>
        ))}
      </div>

      <div className="widget-cards">
        {activeColumn && activeColumn.cards.length === 0 && (
          <div className="widget-empty">No cards in this column.</div>
        )}
        {activeColumn?.cards.map((card) => (
          <WidgetCard key={card.id} card={card} />
        ))}
      </div>

      {activeColumn && (
        <button
          type="button"
          className="widget-add"
          onClick={() => {
            const title = window.prompt("New task title");
            if (!title || !title.trim()) return;
            dispatch({
              type: "ADD_CARD",
              columnKey: activeColumn.key,
              title: title.trim(),
            });
          }}
        >
          + New task
        </button>
      )}
    </div>
  );
}

function WidgetHeader({
  title,
  subtitle,
  pinned,
  onTogglePinned,
}: {
  title: string;
  subtitle?: string;
  pinned: boolean;
  onTogglePinned: () => void;
}) {
  return (
    <div className="widget-head" data-tauri-drag-region>
      <div className="widget-head-text" data-tauri-drag-region>
        <span className="widget-head-title" data-tauri-drag-region>
          {title}
        </span>
        {subtitle && (
          <span className="widget-head-sub" data-tauri-drag-region>
            {subtitle}
          </span>
        )}
      </div>
      <button
        type="button"
        className={"widget-head-btn" + (pinned ? " is-active" : "")}
        title={pinned ? "Unpin (allow other windows on top)" : "Pin on top"}
        aria-label={pinned ? "Unpin from top" : "Pin on top"}
        aria-pressed={pinned}
        onClick={onTogglePinned}
      >
        {/* Lock-pin glyph: filled when active, outline when off. */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1.5l1.6 2.4 2.4.4-1.7 1.9.4 2.6L6 7.5 3.3 8.8l.4-2.6L2 4.3l2.4-.4L6 1.5z"
            fill={pinned ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="widget-head-btn"
        title="Hide widget"
        aria-label="Hide widget"
        onClick={() => void win.hide()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 2l8 8M10 2l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function WidgetCard({ card }: { card: CardData }) {
  const priority = card.priority;
  return (
    <article className={"widget-card" + (priority ? " has-priority" : "")}>
      <div className="widget-card-row">
        {priority && (
          <span className={"widget-priority pri-" + priority}>{priority}</span>
        )}
        {card.tags.slice(0, 2).map((t) => (
          <span key={t.label} className={"widget-tag t-" + t.color}>
            {t.label}
          </span>
        ))}
      </div>
      <div className="widget-card-title">{card.title}</div>
      {card.subtitle && (
        <div className="widget-card-sub">{card.subtitle}</div>
      )}
    </article>
  );
}
