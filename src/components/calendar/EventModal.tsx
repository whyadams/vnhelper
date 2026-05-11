import { useEffect, useState } from "react";
import type { TagColor } from "../../data/kanban";
import { useDialog } from "../ui/Dialog";

const COLORS: TagColor[] = [
  "pink",
  "green",
  "amber",
  "violet",
  "sky",
  "rose",
  "teal",
];

export interface EventDraft {
  id?: string;
  title: string;
  event_date: string;
  event_time: string | null;
  color: TagColor;
  description: string | null;
  creator?: { id: string; name: string | null; email: string | null } | null;
}

interface Props {
  open: boolean;
  initial: EventDraft | null;
  onClose: () => void;
  onSave: (e: EventDraft) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
}

function toTimeInput(t: string | null): string {
  if (!t) return "";
  // postgres `time` returns "HH:MM:SS"; <input type="time"> wants "HH:MM"
  return t.slice(0, 5);
}

export function EventModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const dialog = useDialog();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [color, setColor] = useState<TagColor>("violet");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) return;
    setTitle(initial.title);
    setDate(initial.event_date);
    setTime(toTimeInput(initial.event_time));
    setColor(initial.color);
    setDescription(initial.description ?? "");
    setErr(null);
  }, [initial, open]);

  if (!open || !initial) return null;

  const isEdit = !!initial.id;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        id: initial.id,
        title: title.trim(),
        event_date: date,
        event_time: time ? `${time}:00` : null,
        color,
        description: description.trim() || null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!initial.id || !onDelete) return;
    const ok = await dialog.confirm({
      title: "Delete event",
      message: `Delete "${title}"?`,
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onDelete(initial.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <form
        className="vn-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <div className="vn-modal-head-title">
            <h3>{isEdit ? "Edit event" : "New event"}</h3>
            {isEdit && initial.creator && (
              <div className="vn-modal-head-meta">
                Created by{" "}
                {initial.creator.name ??
                  initial.creator.email ??
                  "Unknown"}
              </div>
            )}
          </div>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="vn-modal-body">
          <label className="vn-modal-label">Title</label>
          <input
            className="vn-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting, deadline, anything…"
            autoFocus
            required
          />

          <div className="ev-row">
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="vn-modal-label">Date</label>
              <input
                className="vn-input vn-input-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="vn-modal-label">Time (optional)</label>
              <input
                className="vn-input vn-input-date"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <label className="vn-modal-label">Color</label>
          <div className="ev-color-row">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={
                  "ev-color t-" + c + (color === c ? " is-active" : "")
                }
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>

          <label className="vn-modal-label">Description (optional)</label>
          <textarea
            className="vn-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Notes about the event…"
          />

          {err && <div className="vn-modal-error">{err}</div>}
        </div>

        <div className="vn-modal-foot">
          {isEdit && onDelete && (
            <button
              type="button"
              className="hbtn is-danger"
              onClick={handleDelete}
              disabled={busy}
              style={{ marginRight: "auto" }}
            >
              Delete
            </button>
          )}
          <button type="button" className="hbtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="hbtn is-primary"
            disabled={busy || !title.trim()}
          >
            {busy ? "…" : isEdit ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
