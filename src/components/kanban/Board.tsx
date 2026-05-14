import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyFilters, useKanban } from "../../state/kanbanStore";
import { Column } from "./Column";
import { PlusIcon } from "./Icon";

// Selectors for elements that should NOT trigger drag-to-pan on left click.
// Middle button always pans regardless of target.
const PAN_BLOCKLIST =
  '[data-card-id], button, a, input, textarea, select, [contenteditable="true"], [role="menu"], [role="menuitem"]';

export function Board() {
  const { state, addColumn } = useKanban();
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const view = applyFilters(state.columns, state);
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Drag-to-pan: hold mouse button on the board background (or middle-click
  // anywhere) and drag horizontally to scroll. Useful when many columns
  // overflow the viewport. Card drag, dropdowns and inputs are preserved.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    let panning = false;
    let activePointerId = -1;
    let startX = 0;
    let startScroll = 0;

    const onPointerDown = (e: PointerEvent) => {
      const isMiddle = e.button === 1;
      const isLeft = e.button === 0;
      if (!isMiddle && !isLeft) return;
      if (isLeft) {
        const target = e.target as Element | null;
        if (target && target.closest(PAN_BLOCKLIST)) return;
      }
      panning = true;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      try {
        el.setPointerCapture(activePointerId);
      } catch {
        // ignore — capture may fail for synthetic events
      }
      el.classList.add("is-panning");
      // Suppress WebView2 middle-click autoscroll widget.
      if (isMiddle) e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning || e.pointerId !== activePointerId) return;
      el.scrollLeft = startScroll - (e.clientX - startX);
    };

    const stop = (e: PointerEvent) => {
      if (!panning || e.pointerId !== activePointerId) return;
      panning = false;
      if (el.hasPointerCapture(activePointerId)) {
        el.releasePointerCapture(activePointerId);
      }
      activePointerId = -1;
      el.classList.remove("is-panning");
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
  }, []);

  const submit = () => {
    const v = draft.trim();
    if (v) void addColumn(v);
    setDraft("");
    setAdding(false);
  };

  const canEdit = state.myRole === "owner" || state.myRole === "editor";

  return (
    <div className="board" ref={boardRef}>
      {view.map((c) => (
        <Column key={c.id} data={c} />
      ))}
      {canEdit && (
        <div className="col col-add">
          {adding ? (
            <div className="col-add-form">
              <input
                className="col-add-input"
                placeholder={t("kanban.column_title_placeholder")}
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
              {t("kanban.add_column")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
