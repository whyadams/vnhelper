import { useEffect, useRef, useState } from "react";
import type { TagColor } from "../../data/kanban";
import { useKanban, type SortMode } from "../../state/kanbanStore";
import { FilterIcon, SortIcon } from "./Icon";
import {
  MMenu,
  MMenuItem,
  MMenuLabel,
  MMenuPage,
  MMenuSeparator,
} from "../ui/MMenu";

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
  const { state, dispatch, renameBoard } = useKanban();
  const filterRef = useRef<HTMLButtonElement | null>(null);
  const sortRef = useRef<HTMLButtonElement | null>(null);
  const [openFilter, setOpenFilter] = useState(false);
  const [openSort, setOpenSort] = useState(false);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(state.boardName);
  useEffect(() => {
    setTitleDraft(state.boardName);
  }, [state.boardName]);

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
          <button
            className={"hbtn" + (filterCount ? " is-active" : "")}
            type="button"
            ref={filterRef}
            onClick={() => setOpenFilter((v) => !v)}
          >
            <FilterIcon className="ico" />
            <span>Filter</span>
            {filterCount > 0 && <span className="hbtn-count">{filterCount}</span>}
          </button>
          <MMenu
            open={openFilter}
            onClose={() => setOpenFilter(false)}
            anchorRef={filterRef}
            minWidth={260}
          >
            <MMenuPage id="main">
              <MMenuLabel>Filter by tag</MMenuLabel>
              <div className="menu-tags mmenu-anim" style={{ padding: "0 12px 8px" }}>
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
              <MMenuSeparator />
              <MMenuItem
                onClick={() => {
                  dispatch({ type: "CLEAR_FILTERS" });
                  setOpenFilter(false);
                }}
              >
                Clear all
              </MMenuItem>
            </MMenuPage>
          </MMenu>

          <button
            className={"hbtn" + (state.sort !== "default" ? " is-active" : "")}
            type="button"
            ref={sortRef}
            onClick={() => setOpenSort((v) => !v)}
          >
            <SortIcon className="ico" />
            <span>Sort</span>
            {state.sort !== "default" && (
              <span className="hbtn-count">{sortLabel?.split(" ")[0]}</span>
            )}
          </button>
          <MMenu
            open={openSort}
            onClose={() => setOpenSort(false)}
            anchorRef={sortRef}
            minWidth={220}
          >
            <MMenuPage id="main">
              <MMenuLabel>Sort by</MMenuLabel>
              {sortOptions.map((o) => (
                <MMenuItem
                  key={o.value}
                  className={state.sort === o.value ? "is-active" : undefined}
                  onClick={() => {
                    dispatch({ type: "SET_SORT", sort: o.value });
                    setOpenSort(false);
                  }}
                >
                  {o.label}
                </MMenuItem>
              ))}
            </MMenuPage>
          </MMenu>
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
