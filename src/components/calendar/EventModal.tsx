import { useEffect, useMemo, useRef, useState } from "react";
import type { TagColor } from "../../data/kanban";
import { useDialog } from "../ui/Dialog";
import type {
  AttachOption,
  AttachmentEntityType,
  AttachmentSummary,
} from "../../state/calendar";

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
  /** Existing attachments — populated when editing. */
  attachments: AttachmentSummary[];
  onClose: () => void;
  /** Persist the draft. Return the event id (new or existing) so the modal
   *  can flush pending attachments before closing. Returns null on failure. */
  onSave: (draft: EventDraft) => Promise<string | null>;
  onDelete?: (id: string) => Promise<void> | void;
  onAttach: (
    eventId: string,
    entity_type: AttachmentEntityType,
    entity_id: string,
  ) => Promise<void>;
  onDetach: (eventId: string, attachmentId: string) => Promise<void>;
  onSearchAttachOptions: (
    entity_type: AttachmentEntityType,
    query: string,
  ) => Promise<AttachOption[]>;
  /** Clicked an attachment row — open the linked entity in its own screen. */
  onNavigateAttachment: (a: AttachmentSummary) => void;
}

const TYPE_LABELS: Record<AttachmentEntityType, string> = {
  card: "Task",
  script_node: "Scene",
  character: "Character",
};

const TYPE_GLYPH: Record<AttachmentEntityType, string> = {
  card: "✓",
  script_node: "✎",
  character: "☻",
};

function toTimeInput(t: string | null): string {
  if (!t) return "";
  return t.slice(0, 5);
}

export function EventModal({
  open,
  initial,
  attachments,
  onClose,
  onSave,
  onDelete,
  onAttach,
  onDetach,
  onSearchAttachOptions,
  onNavigateAttachment,
}: Props) {
  const dialog = useDialog();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [color, setColor] = useState<TagColor>("violet");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pending attachments for *new* events. Edits flow through onAttach/onDetach
  // immediately because the event already has a row to attach to.
  const [pendingAttachments, setPendingAttachments] = useState<AttachOption[]>(
    [],
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setTitle(initial.title);
    setDate(initial.event_date);
    setTime(toTimeInput(initial.event_time));
    setColor(initial.color);
    setDescription(initial.description ?? "");
    setErr(null);
    setPendingAttachments([]);
    setPickerOpen(false);
  }, [initial, open]);

  if (!open || !initial) return null;

  const isEdit = !!initial.id;

  // For the edit flow we render the live `attachments` prop; for the create
  // flow we render the `pendingAttachments` staged in local state.
  const visibleAttachments: Array<
    | { kind: "saved"; attachment: AttachmentSummary }
    | { kind: "pending"; option: AttachOption }
  > = isEdit
    ? attachments.map((a) => ({ kind: "saved" as const, attachment: a }))
    : pendingAttachments.map((o) => ({ kind: "pending" as const, option: o }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const savedId = await onSave({
        id: initial.id,
        title: title.trim(),
        event_date: date,
        event_time: time ? `${time}:00` : null,
        color,
        description: description.trim() || null,
      });
      if (!savedId) {
        setErr("Save failed");
        return;
      }
      // Flush staged attachments now that we have an event id.
      if (!isEdit && pendingAttachments.length > 0) {
        for (const o of pendingAttachments) {
          try {
            await onAttach(savedId, o.entity_type, o.entity_id);
          } catch (e2) {
            console.error("flush attach", e2);
          }
        }
      }
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

  const handlePick = async (option: AttachOption) => {
    if (isEdit && initial.id) {
      await onAttach(initial.id, option.entity_type, option.entity_id);
    } else {
      // Staging for create — avoid duplicates.
      setPendingAttachments((prev) => {
        if (
          prev.some(
            (p) =>
              p.entity_type === option.entity_type &&
              p.entity_id === option.entity_id,
          )
        ) {
          return prev;
        }
        return [...prev, option];
      });
    }
    setPickerOpen(false);
  };

  const handleRemove = async (
    item:
      | { kind: "saved"; attachment: AttachmentSummary }
      | { kind: "pending"; option: AttachOption },
  ) => {
    if (item.kind === "saved" && initial.id) {
      await onDetach(initial.id, item.attachment.id);
    } else if (item.kind === "pending") {
      setPendingAttachments((prev) =>
        prev.filter(
          (p) =>
            !(
              p.entity_type === item.option.entity_type &&
              p.entity_id === item.option.entity_id
            ),
        ),
      );
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

          <div className="ev-attach-section">
            <div className="ev-attach-head">
              <label className="vn-modal-label" style={{ margin: 0 }}>
                Attachments
              </label>
              <button
                type="button"
                className="ev-attach-add"
                onClick={() => setPickerOpen((v) => !v)}
                disabled={busy}
              >
                {pickerOpen ? "Close picker" : "+ Attach"}
              </button>
            </div>

            {visibleAttachments.length === 0 && !pickerOpen && (
              <div className="ev-attach-empty">
                Link this event to a task, scene, or character.
              </div>
            )}

            {visibleAttachments.length > 0 && (
              <ul className="ev-attach-list">
                {visibleAttachments.map((item, idx) => {
                  const type =
                    item.kind === "saved"
                      ? item.attachment.entity_type
                      : item.option.entity_type;
                  const name =
                    item.kind === "saved"
                      ? item.attachment.name
                      : item.option.name;
                  const subtitle =
                    item.kind === "saved"
                      ? null
                      : item.option.subtitle;
                  const exists =
                    item.kind === "saved" ? item.attachment.exists : true;
                  const key =
                    item.kind === "saved"
                      ? `s:${item.attachment.id}`
                      : `p:${item.option.entity_type}:${item.option.entity_id}:${idx}`;
                  return (
                    <li key={key} className={"ev-attach-chip t-" + type}>
                      <button
                        type="button"
                        className="ev-attach-chip-main"
                        onClick={() => {
                          if (item.kind === "saved" && exists) {
                            onNavigateAttachment(item.attachment);
                          }
                        }}
                        disabled={item.kind === "pending" || !exists}
                        title={exists ? "Open" : "Item no longer exists"}
                      >
                        <span className="ev-attach-glyph" aria-hidden>
                          {TYPE_GLYPH[type]}
                        </span>
                        <span className="ev-attach-body">
                          <span
                            className={
                              "ev-attach-name" + (!exists ? " is-deleted" : "")
                            }
                          >
                            {name}
                          </span>
                          <span className="ev-attach-type">
                            {TYPE_LABELS[type]}
                            {subtitle ? ` · ${subtitle}` : ""}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ev-attach-remove"
                        onClick={() => void handleRemove(item)}
                        aria-label="Remove attachment"
                        title="Remove"
                        disabled={busy}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {pickerOpen && (
              <AttachPicker
                onPick={handlePick}
                onSearch={onSearchAttachOptions}
                alreadyAttached={
                  isEdit
                    ? new Set(
                        attachments.map(
                          (a) => `${a.entity_type}:${a.entity_id}`,
                        ),
                      )
                    : new Set(
                        pendingAttachments.map(
                          (p) => `${p.entity_type}:${p.entity_id}`,
                        ),
                      )
                }
              />
            )}
          </div>

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

// ---------- Attach picker (inline) ----------

interface PickerProps {
  alreadyAttached: Set<string>;
  onPick: (option: AttachOption) => void | Promise<void>;
  onSearch: (
    entity_type: AttachmentEntityType,
    query: string,
  ) => Promise<AttachOption[]>;
}

function AttachPicker({ alreadyAttached, onPick, onSearch }: PickerProps) {
  const [tab, setTab] = useState<AttachmentEntityType>("card");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AttachOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced search. We refetch on tab change AND on each keystroke after
  // ~180ms idle; reflecting both signals through a single effect keeps the
  // race protection simple.
  const lastReqRef = useRef(0);
  useEffect(() => {
    const myReq = ++lastReqRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await onSearch(tab, query);
        if (myReq !== lastReqRef.current) return;
        setOptions(res);
      } finally {
        if (myReq === lastReqRef.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [tab, query, onSearch]);

  const tabs: AttachmentEntityType[] = useMemo(
    () => ["card", "script_node", "character"],
    [],
  );

  return (
    <div className="ev-attach-picker">
      <div className="ev-attach-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            className={"ev-attach-tab" + (tab === t ? " is-active" : "")}
            onClick={() => setTab(t)}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <input
        className="vn-input ev-attach-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${TYPE_LABELS[tab].toLowerCase()}s…`}
        autoFocus
      />
      <div className="ev-attach-results">
        {loading && <div className="ev-attach-empty">Loading…</div>}
        {!loading && options.length === 0 && (
          <div className="ev-attach-empty">No matches.</div>
        )}
        {!loading &&
          options.map((o) => {
            const key = `${o.entity_type}:${o.entity_id}`;
            const isAlready = alreadyAttached.has(key);
            return (
              <button
                key={key}
                type="button"
                className={
                  "ev-attach-result" + (isAlready ? " is-attached" : "")
                }
                onClick={() => !isAlready && void onPick(o)}
                disabled={isAlready}
              >
                <span className={"ev-attach-glyph t-" + o.entity_type} aria-hidden>
                  {TYPE_GLYPH[o.entity_type]}
                </span>
                <span className="ev-attach-body">
                  <span className="ev-attach-name">{o.name}</span>
                  {o.subtitle && (
                    <span className="ev-attach-type">{o.subtitle}</span>
                  )}
                </span>
                {isAlready && (
                  <span className="ev-attach-attached">attached</span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
