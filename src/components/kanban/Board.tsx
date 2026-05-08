import { useState } from "react";
import { applyFilters, useKanban } from "../../state/kanbanStore";
import { Column } from "./Column";
import { PlusIcon } from "./Icon";

export function Board() {
  const { state, addColumn } = useKanban();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const view = applyFilters(state.columns, state);

  const submit = () => {
    const v = draft.trim();
    if (v) void addColumn(v);
    setDraft("");
    setAdding(false);
  };

  const canEdit = state.myRole === "owner" || state.myRole === "editor";

  return (
    <div className="board">
      {view.map((c) => (
        <Column key={c.id} data={c} />
      ))}
      {canEdit && (
        <div className="col col-add">
          {adding ? (
            <div className="col-add-form">
              <input
                className="col-add-input"
                placeholder="Column title…"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={submit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                  if (e.key === "Escape") {
                    setDraft("");
                    setAdding(false);
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="col-add-btn"
              onClick={() => setAdding(true)}
            >
              <PlusIcon size={14} />
              Add column
            </button>
          )}
        </div>
      )}
    </div>
  );
}
