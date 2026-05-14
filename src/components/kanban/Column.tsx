import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { ColumnData } from "../../data/kanban";
import { useKanban } from "../../state/kanbanStore";
import { Card } from "./Card";
import { MoreHIcon, PlusIcon } from "./Icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useDialog } from "../ui/Dialog";

export function Column({ data }: { data: ColumnData }) {
  const { dispatch, renameColumn, deleteColumn } = useKanban();
  const dialog = useDialog();
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);
  useEffect(() => {
    setTitleDraft(data.title);
  }, [data.title]);

  const computeDropIndex = (e: DragEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body) return 0;
    const cards = Array.from(body.querySelectorAll<HTMLElement>("[data-card-id]"));
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
    setDropIndex(computeDropIndex(e));
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!bodyRef.current?.contains(e.relatedTarget as Node)) {
      setDragOver(false);
      setDropIndex(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const toIndex = computeDropIndex(e);
    dispatch({ type: "MOVE_CARD", id, toColumn: data.key, toIndex });
    setDragOver(false);
    setDropIndex(null);
  };

  const submitDraft = () => {
    const value = draft.trim();
    if (value)
      dispatch({ type: "ADD_CARD", columnKey: data.key, title: value });
    setDraft("");
    setAdding(false);
  };

  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitDraft();
    } else if (e.key === "Escape") {
      setAdding(false);
      setDraft("");
    }
  };

  const commitRename = () => {
    const next = titleDraft.trim();
    setRenaming(false);
    if (next && next !== data.title) {
      void renameColumn(data.id, next);
    } else {
      setTitleDraft(data.title);
    }
  };

  const handleDelete = async () => {
    const cardCount = data.cards.length;
    const msg =
      cardCount > 0
        ? t("kanban.delete_column_with_cards", { title: data.title, count: cardCount })
        : t("kanban.delete_column_empty", { title: data.title });
    const ok = await dialog.confirm({
      title: t("kanban.delete_column_title"),
      message: msg,
      variant: "danger",
      confirmLabel: t("common.delete"),
    });
    if (ok) void deleteColumn(data.id);
  };

  return (
    <section className={"col col-" + data.key}>
      <div className={"col-head " + data.key}>
        <span className="dot" />
        {renaming ? (
          <input
            className="col-title-input"
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setTitleDraft(data.title);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span
            className="title"
            onDoubleClick={() => setRenaming(true)}
            title={t("kanban.double_click_to_rename")}
          >
            {data.title}
          </span>
        )}
        <span className="count">{data.cards.length}</span>
        <div className="actions">
          <button
            className="col-head-add"
            type="button"
            aria-label={t("kanban.add_card")}
            onClick={() => setAdding(true)}
          >
            <PlusIcon size={12} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="col-head-more"
                type="button"
                aria-label={t("kanban.column_actions")}
                title={t("kanban.column_actions")}
              >
                <MoreHIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                {t("kanban.rename_column")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAdding(true)}>
                {t("kanban.add_card")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void handleDelete()}
              >
                {t("kanban.delete_column")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        className={"col-body" + (dragOver ? " is-drop-target" : "")}
        ref={bodyRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {data.cards.map((c, i) => (
          <div key={c.id} className="card-slot">
            {dragOver && dropIndex === i && <div className="drop-indicator" />}
            <Card data={c} />
          </div>
        ))}
        {dragOver && dropIndex === data.cards.length && (
          <div className="drop-indicator" />
        )}

        {adding ? (
          <div className="add-card-form">
            <input
              ref={inputRef}
              className="add-card-input"
              value={draft}
              placeholder={t("kanban.add_card_placeholder")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onDraftKey}
              onBlur={submitDraft}
            />
          </div>
        ) : (
          <button
            className="add-card"
            type="button"
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="ico" />
            {t("kanban.add_card")}
          </button>
        )}
      </div>
    </section>
  );
}
