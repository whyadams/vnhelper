import { useEffect, useMemo, useState } from "react";
import { useKanban } from "../../state/kanbanStore";
import {
  useCalendar,
  type AttachmentEntityType,
  type AttachmentSummary,
  type CalendarEvent,
} from "../../state/calendar";
import { CalendarFilledIcon } from "../kanban/SidebarIcons";
import { EventModal, type EventDraft } from "./EventModal";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

const today = new Date();

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildMonthMatrix(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const offset = (firstDay.getDay() + 6) % 7; // Monday-based
  const totalCells = Math.ceil((offset + lastDay.getDate()) / 7) * 7;
  const cells: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month, 1 + (i - offset));
    cells.push({ date, isCurrentMonth: date.getMonth() === month });
  }
  return cells;
}

function eventsByDate(list: CalendarEvent[]) {
  const map: Record<string, CalendarEvent[]> = {};
  for (const e of list) {
    (map[e.event_date] ||= []).push(e);
  }
  return map;
}

export function CalendarScreen() {
  const { state, dispatch } = useKanban();
  const {
    events,
    createEvent,
    updateEvent,
    deleteEvent,
    attachToEvent,
    detachFromEvent,
    searchAttachOptions,
  } = useCalendar(state.workspaceId);

  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = useState<Date>(today);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<EventDraft | null>(null);
  /** When the modal is editing an existing event we read the live event from
   *  `events` so its attachments list updates in place after attach/detach. */
  const [modalEventId, setModalEventId] = useState<string | null>(null);

  const cells = useMemo(
    () => buildMonthMatrix(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const eventMap = useMemo(() => eventsByDate(events), [events]);

  const goPrev = () =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const goNext = () =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(today);
  };

  const selectedISO = isoFromDate(selected);
  const selectedEvents = eventMap[selectedISO] ?? [];

  const openNew = (date: Date = selected) => {
    setModalDraft({
      title: "",
      event_date: isoFromDate(date),
      event_time: null,
      color: "violet",
      description: null,
    });
    setModalEventId(null);
    setModalOpen(true);
  };

  const openEdit = (ev: CalendarEvent) => {
    setModalDraft({
      id: ev.id,
      title: ev.title,
      event_date: ev.event_date,
      event_time: ev.event_time,
      color: ev.color,
      description: ev.description,
      creator: ev.creator,
    });
    setModalEventId(ev.id);
    setModalOpen(true);
  };

  // Cross-screen entry point: when another screen requests "open this event"
  // (e.g. a Linked Events row in a kanban card drawer), jump to the right
  // month, select the day, and open the modal. We wait until the event is in
  // `events` before opening to avoid flashing an empty modal.
  useEffect(() => {
    const focus = state.pendingFocus;
    if (!focus || focus.kind !== "calendar_event") return;
    const ev = events.find((e) => e.id === focus.id);
    if (!ev) return; // events still loading — try again on next render
    const [y, m, d] = focus.date.split("-").map((s) => Number.parseInt(s, 10));
    if (y && m && d) {
      setCursor(new Date(y, m - 1, 1));
      setSelected(new Date(y, m - 1, d));
    }
    openEdit(ev);
    dispatch({ type: "CLEAR_PENDING_FOCUS" });
  }, [state.pendingFocus, events, dispatch]);

  // Resolve live attachments for the currently-edited event so that the
  // modal's list stays in sync with state updates (attach/detach are async
  // through the calendar hook).
  const modalAttachments =
    (modalEventId
      ? events.find((e) => e.id === modalEventId)?.attachments
      : null) ?? [];

  /** Persist the draft. Returns the event id so EventModal can flush its
   *  staged attachments (the new-event case has nothing to attach to until
   *  the row exists). */
  const onSave = async (draft: EventDraft): Promise<string | null> => {
    if (draft.id) {
      await updateEvent(draft.id, {
        title: draft.title,
        event_date: draft.event_date,
        event_time: draft.event_time,
        color: draft.color,
        description: draft.description,
      });
      return draft.id;
    }
    const newId = await createEvent({
      title: draft.title,
      event_date: draft.event_date,
      event_time: draft.event_time,
      color: draft.color,
      description: draft.description,
    });
    return newId;
  };

  const navigateAttachment = (a: AttachmentSummary) => {
    if (!a.exists) return;
    if (a.entity_type === "card") {
      // Cards live in the loaded board state, so a direct focus dispatch is
      // enough — no need to round-trip through pendingFocus.
      dispatch({ type: "SET_ACTIVE_NAV", key: "task" });
      dispatch({ type: "FOCUS_CARD", id: a.entity_id });
      return;
    }
    if (a.entity_type === "script_node") {
      dispatch({ type: "SET_ACTIVE_NAV", key: "script" });
      dispatch({
        type: "SET_PENDING_FOCUS",
        focus: { kind: "script_node", id: a.entity_id },
      });
      return;
    }
    // character
    dispatch({ type: "SET_ACTIVE_NAV", key: "script" });
    dispatch({
      type: "SET_PENDING_FOCUS",
      focus: { kind: "character", id: a.entity_id },
    });
  };

  return (
    <main className="main cal-screen">
      <div className="topbar tmt-bar cal-topbar">
        <CalendarFilledIcon size={20} className="tmt-ico" />
        <span className="tmt-title">{MONTH_NAMES[cursor.getMonth()]}</span>
        <span className="cal-year-inline">{cursor.getFullYear()}</span>
        <div className="cal-nav">
          <button
            className="cal-nav-btn"
            type="button"
            aria-label="Previous month"
            onClick={goPrev}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            className="cal-nav-btn"
            type="button"
            aria-label="Next month"
            onClick={goNext}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="cal-today-btn"
          onClick={goToday}
        >
          Today
        </button>
        <span className="tmt-spacer" />
        <button
          type="button"
          className="tmt-add"
          onClick={() => openNew()}
        >
          + New event
        </button>
      </div>

      <div className="cal-body">
        <div className="cal-grid-wrap">
          <div className="cal-weekdays">
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-weekday">
                {d}
              </div>
            ))}
          </div>
          <div
            className="cal-grid"
            style={{ gridTemplateRows: `repeat(${cells.length / 7}, 1fr)` }}
          >
            {cells.map(({ date, isCurrentMonth }) => {
              const iso = isoFromDate(date);
              const list = eventMap[iso] ?? [];
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selected);
              const visible = list.slice(0, 3);
              const overflow = list.length - visible.length;

              return (
                <button
                  key={iso}
                  type="button"
                  className={
                    "cal-cell" +
                    (isCurrentMonth ? "" : " is-other") +
                    (isToday ? " is-today" : "") +
                    (isSelected ? " is-selected" : "")
                  }
                  onClick={() => setSelected(date)}
                  onDoubleClick={() => openNew(date)}
                  title="Double-click to add event"
                >
                  <div className="cal-cell-head">
                    <span className="cal-day-num">{date.getDate()}</span>
                    {date.getDate() === 1 && isCurrentMonth && (
                      <span className="cal-month-tag">
                        {MONTH_NAMES[date.getMonth()].slice(0, 3)}
                      </span>
                    )}
                  </div>
                  <div className="cal-events">
                    {visible.map((ev) => (
                      <span
                        key={ev.id}
                        className={"cal-chip t-" + ev.color}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(ev);
                        }}
                      >
                        <span className="cal-chip-dot" />
                        {ev.event_time && (
                          <span className="cal-chip-time">
                            {ev.event_time.slice(0, 5)}
                          </span>
                        )}
                        <span className="cal-chip-title">{ev.title}</span>
                        {ev.attachments.length > 0 && (
                          <span
                            className="cal-chip-attach"
                            title={`${ev.attachments.length} attachment${
                              ev.attachments.length === 1 ? "" : "s"
                            }`}
                          >
                            ⛓
                          </span>
                        )}
                      </span>
                    ))}
                    {overflow > 0 && (
                      <span className="cal-more">+{overflow} more</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="cal-side">
          <div className="cal-side-head">
            <div>
              <div className="cal-side-day">
                {selected.toLocaleDateString("en-US", { weekday: "long" })}
              </div>
              <div className="cal-side-date">
                {selected.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
            <button
              className="icon-btn bordered cal-side-add"
              type="button"
              onClick={() => openNew()}
              aria-label="Add event"
              title="Add event on this day"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <div className="cal-empty">
              No events scheduled.
              <br />
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                Click + to add one.
              </span>
            </div>
          ) : (
            <div className="cal-side-list">
              {selectedEvents.map((ev) => (
                <div
                  key={ev.id}
                  className={"cal-side-event t-" + ev.color}
                  onClick={() => openEdit(ev)}
                >
                  <span className="cal-side-bar" />
                  <div className="cal-side-event-body">
                    <div className="cal-side-event-title">{ev.title}</div>
                    {ev.event_time && (
                      <div className="cal-side-event-time">
                        {ev.event_time.slice(0, 5)}
                      </div>
                    )}
                    {ev.description && (
                      <div className="cal-side-event-desc">
                        {ev.description}
                      </div>
                    )}
                    {ev.attachments.length > 0 && (
                      <ul className="cal-side-attach-list">
                        {ev.attachments.map((a) => (
                          <li
                            key={a.id}
                            className={
                              "cal-side-attach t-" +
                              a.entity_type +
                              (a.exists ? "" : " is-deleted")
                            }
                          >
                            <button
                              type="button"
                              className="cal-side-attach-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigateAttachment(a);
                              }}
                              disabled={!a.exists}
                              title={
                                a.exists
                                  ? `Open ${TYPE_LABELS[a.entity_type].toLowerCase()}`
                                  : "Item no longer exists"
                              }
                            >
                              <span className="cal-side-attach-glyph" aria-hidden>
                                {TYPE_GLYPH[a.entity_type]}
                              </span>
                              <span className="cal-side-attach-name">
                                {a.name}
                              </span>
                              <span className="cal-side-attach-type">
                                {TYPE_LABELS[a.entity_type]}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {ev.creator && (
                      <div className="cal-side-event-creator">
                        by {ev.creator.name ?? ev.creator.email ?? "Unknown"}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <EventModal
        open={modalOpen}
        initial={modalDraft}
        attachments={modalAttachments}
        onClose={() => setModalOpen(false)}
        onSave={onSave}
        onDelete={deleteEvent}
        onAttach={attachToEvent}
        onDetach={detachFromEvent}
        onSearchAttachOptions={searchAttachOptions}
        onNavigateAttachment={navigateAttachment}
      />
    </main>
  );
}
