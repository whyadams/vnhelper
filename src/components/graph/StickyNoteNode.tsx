import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";

export interface StickyNoteDatum extends Record<string, unknown> {
  text: string;
  color: string;
  /** Called when the user blurs the textarea with a different value. */
  onSaveText: (id: string, text: string) => void;
  /** Cycles to the next colour in the palette. */
  onChangeColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}

type Props = NodeProps & { id: string; data: StickyNoteDatum; selected: boolean };

/** Free-form colour palette. Keys are stored in `graph_annotations.color`;
 *  CSS variables read them as `--note-bg` / `--note-border`. */
export const NOTE_COLORS = [
  "yellow",
  "blue",
  "red",
  "green",
  "purple",
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

function isNoteColor(c: string): c is NoteColor {
  return (NOTE_COLORS as readonly string[]).includes(c);
}

/**
 * Sticky-note rendered as an xyflow custom node. Stays self-contained:
 * editing happens in-place via a textarea on focus / click-away saves;
 * the parent doesn't need to thread `editing` state down. The colour
 * picker is a small swatch row revealed on hover or focus.
 */
export const StickyNoteNode = memo(function StickyNoteNode({
  id,
  data,
  selected,
}: Props) {
  const [draft, setDraft] = useState(data.text);
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync external changes (realtime updates from other clients) — only when
  // we're not actively editing, so we don't clobber the user's typing.
  useEffect(() => {
    if (editing) return;
    setDraft(data.text);
  }, [data.text, editing]);

  const beginEdit = useCallback(() => {
    setEditing(true);
    // Defer focus by one frame so the textarea is mounted before we focus.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  }, []);

  const commitEdit = useCallback(() => {
    setEditing(false);
    if (draft !== data.text) data.onSaveText(id, draft);
  }, [draft, data, id]);

  const safeColor: NoteColor = isNoteColor(data.color) ? data.color : "yellow";

  return (
    <div
      className={
        "graph-note" +
        ` is-color-${safeColor}` +
        (selected ? " is-selected" : "") +
        (editing ? " is-editing" : "")
      }
      onDoubleClick={beginEdit}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="graph-note-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(data.text);
              setEditing(false);
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commitEdit();
            }
          }}
          // Prevent xyflow from capturing the keys (Backspace would
          // otherwise try to delete the node, arrows would pan, etc.).
          onPointerDown={(e) => e.stopPropagation()}
          spellCheck
          placeholder="Note…"
        />
      ) : (
        <div className="graph-note-text" onClick={beginEdit}>
          {data.text || (
            <span className="graph-note-placeholder">Empty note — click to edit</span>
          )}
        </div>
      )}

      <div className="graph-note-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={
              "graph-note-swatch is-color-" + c + (c === safeColor ? " is-active" : "")
            }
            onClick={() => data.onChangeColor(id, c)}
            title={`Colour: ${c}`}
            aria-label={`Set colour to ${c}`}
          />
        ))}
        <button
          type="button"
          className="graph-note-delete"
          onClick={() => data.onDelete(id)}
          title="Delete note"
          aria-label="Delete note"
        >
          ✕
        </button>
      </div>
    </div>
  );
});
