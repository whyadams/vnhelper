import { useEffect, useState } from "react";
import { EllipsisHorizontalIcon as MoreHorizontal } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
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

// Tag colour swatch labels are project-specific user data, not UI chrome —
// leave them in English. Sort/tabs are chrome and are translated below.
const tagOptions: { color: TagColor; label: string }[] = [
  { color: "pink", label: "Branding" },
  { color: "green", label: "Marketing" },
  { color: "amber", label: "Sales" },
  { color: "violet", label: "SaaS" },
  { color: "sky", label: "Engineering" },
  { color: "rose", label: "Funnel" },
  { color: "teal", label: "Web" },
];

const sortOptions: { value: SortMode; labelKey: string }[] = [
  { value: "default", labelKey: "kanban.sort_default" },
  { value: "date-desc", labelKey: "kanban.sort_date_desc" },
  { value: "date-asc", labelKey: "kanban.sort_date_asc" },
  { value: "title-asc", labelKey: "kanban.sort_title_asc" },
];

const subTabs: { key: string; labelKey: string; available: boolean }[] = [
  { key: "overview", labelKey: "kanban.view_overview", available: false },
  { key: "list", labelKey: "kanban.view_list", available: false },
  { key: "board", labelKey: "kanban.view_board", available: true },
  { key: "timeline", labelKey: "kanban.view_timeline", available: false },
];

export function ProjectHeader() {
  const { state, dispatch, renameBoard, clearBoardCards, resetBoardColumns } =
    useKanban();
  const dialog = useDialog();
  const { t } = useTranslation();

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
  const sortLabel = sortOptions.find((o) => o.value === state.sort)?.labelKey;
  const sortLabelText = sortLabel ? t(sortLabel) : "";

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
              title={t("kanban.double_click_to_rename_board")}
            >
              {state.boardName || t("kanban.board_default")}
            </h1>
          )}
          <span className="header-card-count">
            {t("kanban.task_count", { count: totalCards })}
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
                <span>{t("kanban.filter")}</span>
                {filterCount > 0 && (
                  <span className="hbtn-count">{filterCount}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-64">
              <DropdownMenuLabel>{t("kanban.filter_by_tag")}</DropdownMenuLabel>
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
                {t("common.cancel")}
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
                <span>{t("kanban.sort")}</span>
                {state.sort !== "default" && (
                  <span className="hbtn-count">{sortLabelText.split(" ")[0]}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuLabel>{t("kanban.sort_by")}</DropdownMenuLabel>
              {sortOptions.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  data-active={state.sort === o.value || undefined}
                  onSelect={() => dispatch({ type: "SET_SORT", sort: o.value })}
                >
                  {t(o.labelKey)}
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
                  aria-label={t("kanban.project_settings")}
                  title={t("kanban.project_settings")}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel>{t("kanban.view_board")}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setEditingTitle(true)}>
                  {t("common.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void (async () => {
                      const ok = await dialog.confirm({
                        title: t("kanban.clear_all_cards"),
                        message: t("kanban.clear_cards_message", { board: state.boardName }),
                        variant: "danger",
                        confirmLabel: t("kanban.clear_cards_confirm"),
                      });
                      if (ok) await clearBoardCards();
                    })();
                  }}
                >
                  {t("kanban.clear_all_cards")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("kanban.columns_heading")}</DropdownMenuLabel>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    void (async () => {
                      const ok = await dialog.confirm({
                        title: t("kanban.reset_columns"),
                        message: t("kanban.reset_columns_message"),
                        variant: "danger",
                        confirmLabel: t("kanban.reset_columns_confirm"),
                      });
                      if (ok) await resetBoardColumns();
                    })();
                  }}
                >
                  {t("kanban.reset_columns")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="header-tabs">
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={
              "header-tab" +
              (tab.key === "board" ? " is-active" : "") +
              (!tab.available ? " is-disabled" : "")
            }
            disabled={!tab.available}
            title={!tab.available ? t("kanban.coming_soon") : undefined}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
