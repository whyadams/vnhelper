import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { TagColor } from "../../data/kanban";
import { useKanban, type SortMode } from "../../state/kanbanStore";
import { FilterIcon, SortIcon } from "./Icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useDialog } from "../ui/Dialog";

const tagOptions: { color: TagColor; label: string }[] = [
  { color: "pink", label: "Branding" },
  { color: "green", label: "Marketing" },
  { color: "amber", label: "Sales" },
  { color: "violet", label: "SaaS" },
  { color: "sky", label: "Engineering" },
  { color: "rose", label: "Funnel" },
  { color: "teal", label: "Web" },
];

const sortOptions: { value: SortMode; label: string }[] = [
  { value: "default", label: "Default order" },
  { value: "date-desc", label: "Date — newest first" },
  { value: "date-asc", label: "Date — oldest first" },
  { value: "title-asc", label: "Title (A → Z)" },
];

const subTabs: { key: string; label: string; available: boolean }[] = [
  { key: "overview", label: "Overview", available: false },
  { key: "list", label: "List", available: false },
  { key: "board", label: "Board", available: true },
  { key: "timeline", label: "Timeline", available: false },
];

export function ProjectHeader() {
  const { state, dispatch, renameBoard, clearBoardCards, resetBoardColumns } =
    useKanban();
  const dialog = useDialog();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(state.boardName);
  useEffect(() => {
    setTitleDraft(state.boardName);
  }, [state.boardName]);

  const canEdit = state.myRole === "owner" || state.myRole === "editor";

  const commitTitle = () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next && next !== state.boardName) {
      void renameBoard(next);
    } else {
      setTitleDraft(state.boardName);
    }
  };

  const filterCount = state.filterTags.length;
  const sortLabel = sortOptions.find((o) => o.value === state.sort)?.label;

  const totalCards = state.columns.reduce(
    (sum, c) => sum + c.cards.length,
    0,
  );

  return (
    <div className="header">
      <div className="header-row">
        <div className="header-title">
          {editingTitle ? (
            <input
              className="h-title-input"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setTitleDraft(state.boardName);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <h1
              onDoubleClick={() => setEditingTitle(true)}
              title="Double-click to rename board"
            >
              {state.boardName || "Board"}
            </h1>
          )}
          <span className="header-card-count">
            {totalCards} {totalCards === 1 ? "card" : "cards"}
          </span>
        </div>

        <div className="header-toolbar">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={"hbtn" + (filterCount ? " is-active" : "")}
                type="button"
              >
                <FilterIcon className="ico" />
                <span>Filter</span>
                {filterCount > 0 && (
                  <span className="hbtn-count">{filterCount}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-64">
              <DropdownMenuLabel>Filter by tag</DropdownMenuLabel>
              <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                {tagOptions.map((t) => {
                  const active = state.filterTags.includes(t.color);
                  return (
                    <button
                      key={t.color}
                      type="button"
                      className={"tag t-" + t.color + (active ? " is-on" : "")}
                      onClick={() =>
                        dispatch({ type: "TOGGLE_FILTER_TAG", tag: t.color })
                      }
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => dispatch({ type: "CLEAR_FILTERS" })}
              >
                Clear all
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={
                  "hbtn" + (state.sort !== "default" ? " is-active" : "")
                }
                type="button"
              >
                <SortIcon className="ico" />
                <span>Sort</span>
                {state.sort !== "default" && (
                  <span className="hbtn-count">{sortLabel?.split(" ")[0]}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              {sortOptions.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  data-active={state.sort === o.value || undefined}
                  onSelect={() => dispatch({ type: "SET_SORT", sort: o.value })}
                >
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="hbtn hbtn-icon"
                  aria-label="Project settings"
                  title="Project settings"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel>Board</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setEditingTitle(true)}>
                  Rename board
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void (async () => {
                      const ok = await dialog.confirm({
                        title: "Clear all cards",
                        message: `Delete every card on "${state.boardName}"? Columns are kept. This cannot be undone.`,
                        variant: "danger",
                        confirmLabel: "Clear cards",
                      });
                      if (ok) await clearBoardCards();
                    })();
                  }}
                >
                  Clear all cards
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    void (async () => {
                      const ok = await dialog.confirm({
                        title: "Reset columns to defaults",
                        message:
                          "Delete every existing column (and its cards) and recreate the four defaults: To do, In progress, Review, Done. This cannot be undone.",
                        variant: "danger",
                        confirmLabel: "Reset columns",
                      });
                      if (ok) await resetBoardColumns();
                    })();
                  }}
                >
                  Reset columns to defaults
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="header-tabs">
        {subTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={
              "header-tab" +
              (t.key === "board" ? " is-active" : "") +
              (!t.available ? " is-disabled" : "")
            }
            disabled={!t.available}
            title={!t.available ? "Coming soon" : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
