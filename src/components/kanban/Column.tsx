import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { ColumnData } from "../../data/kanban";
import { useKanban } from "../../state/kanbanStore";
import { Card } from "./Card";
import { MoreHIcon, PlusIcon } from "./Icon";
import { MMenu, MMenuItem, MMenuPage, MMenuSeparator } from "../ui/MMenu";
import { useDialog } from "../ui/Dialog";

export function Column({ data }: { data: ColumnData }) {
  const { dispatch, renameColumn, deleteColumn } = useKanban();
  const dialog = useDialog();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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
    setMenuOpen(false);
    const cardCount = data.cards.length;
    const msg =
      cardCount > 0
        ? `Delete "${data.title}" and ${cardCount} card(s) inside it? This cannot be undone.`
        : `Delete "${data.title}"?`;
    const ok = await dialog.confirm({
      title: "Delete column",
      message: msg,
      variant: "danger",
      confirmLabel: "Delete",
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
            title="Double-click to rename"
          >
            {data.title}
          </span>
        )}
        <span className="count">{data.cards.length}</span>
        <div className="actions">
          <button
            className="col-head-add"
            type="button"
            aria-label="Add card"
            onClick={() => setAdding(true)}
          >
            <PlusIcon size={12} />
          </button>
          <button
            ref={moreRef}
            type="button"
            aria-label="More"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHIcon />
          </button>
          <MMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={moreRef}
            align="right"
            minWidth={200}
          >
            <MMenuPage id="main">
              <MMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(true);
                }}
              >
                Rename
              </MMenuItem>
              <MMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  setAdding(true);
                }}
              >
                Add card
              </MMenuItem>
              <MMenuSeparator />
              <MMenuItem variant="danger" onClick={() => void handleDelete()}>
                Delete column
              </MMenuItem>
            </MMenuPage>
          </MMenu>
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
              placeholder="Card title…"
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
            Add card
          </button>
        )}
      </div>
    </section>
  );
}
