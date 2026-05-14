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
import { CopyButton } from "../ui/CopyButton";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_LONG = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
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

type ViewMode = "month" | "week" | "day" | "agenda";

const VIEW_LABEL: Record<ViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};

const VIEW_KEY = "vnhelper.calendar.view";

/** How tall an hour-slot row is in Week / Day views. Time-positioned events
 *  use this for their top/height math, so it has to match the CSS variable
 *  `--cal-hour-px` in calendar.css. */
const HOUR_PX = 44;

const today = new Date();

// ───────────────────────── helpers ──────────────────────────

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

function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

/** Monday-anchored start of the week. Mutation-free. */
function startOfWeek(d: Date): Date {
  const nd = new Date(d);
  const dow = (nd.getDay() + 6) % 7;
  nd.setDate(nd.getDate() - dow);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

function buildMonthMatrix(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const offset = (firstDay.getDay() + 6) % 7;
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

/** HH:MM(:SS) → minutes since midnight. Null when no time set. */
function timeToMin(time: string | null): number | null {
  if (!time) return null;
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ───────────────────────── component ────────────────────────

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

  // Persist the chosen view so a reload doesn't drop the user back to Month.
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === "week" || v === "day" || v === "agenda" ? v : "month";
    } catch {
      return "month";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // ignore quota errors
    }
  }, [view]);

  /** Cursor semantics depend on the view:
   *  - month / agenda: any date in the month being displayed
   *  - week: any date in the week being displayed
   *  - day: the exact day being displayed */
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<Date>(today);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<EventDraft | null>(null);
  const [modalEventId, setModalEventId] = useState<string | null>(null);

  const eventMap = useMemo(() => eventsByDate(events), [events]);

  // ── period nav ──
  const goPrev = () => {
    if (view === "month" || view === "agenda") {
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
    } else if (view === "week") {
      setCursor((c) => addDays(c, -7));
    } else {
      setCursor((c) => addDays(c, -1));
    }
  };
  const goNext = () => {
    if (view === "month" || view === "agenda") {
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
    } else if (view === "week") {
      setCursor((c) => addDays(c, 7));
    } else {
      setCursor((c) => addDays(c, 1));
    }
  };
  const goToday = () => {
    setCursor(new Date());
    setSelected(new Date());
  };

  const openNew = (date: Date = selected, time: string | null = null) => {
    setModalDraft({
      title: "",
      event_date: isoFromDate(date),
      event_time: time,
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

  // Cross-screen entry: jump to date + open event on pendingFocus.
  useEffect(() => {
    const focus = state.pendingFocus;
    if (!focus || focus.kind !== "calendar_event") return;
    const ev = events.find((e) => e.id === focus.id);
    if (!ev) return;
    const [y, m, d] = focus.date.split("-").map((s) => Number.parseInt(s, 10));
    if (y && m && d) {
      const target = new Date(y, m - 1, d);
      setCursor(target);
      setSelected(target);
    }
    openEdit(ev);
    dispatch({ type: "CLEAR_PENDING_FOCUS" });
  }, [state.pendingFocus, events, dispatch]);

  const modalAttachments =
    (modalEventId
      ? events.find((e) => e.id === modalEventId)?.attachments
      : null) ?? [];

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
    return createEvent({
      title: draft.title,
      event_date: draft.event_date,
      event_time: draft.event_time,
      color: draft.color,
      description: draft.description,
    });
  };

  const navigateAttachment = (a: AttachmentSummary) => {
    if (!a.exists) return;
    if (a.entity_type === "card") {
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
    dispatch({ type: "SET_ACTIVE_NAV", key: "script" });
    dispatch({
      type: "SET_PENDING_FOCUS",
      focus: { kind: "character", id: a.entity_id },
    });
  };

  // Title shown next to the calendar icon — adapts to the active view.
  const periodLabel = useMemo(() => {
    if (view === "month" || view === "agenda") {
      return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      if (sameMonth) {
        return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
      }
      return `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
    }
    // day
    return cursor.toLocaleDateString("en-US", {
      weekday: "short",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [cursor, view]);

  return (
    <main className="main cal-screen">
      <div className="topbar tmt-bar cal-topbar">
        <CalendarFilledIcon size={20} className="tmt-ico" />
        <span className="tmt-title">{periodLabel}</span>
        <div className="cal-nav">
          <button
            className="cal-nav-btn"
            type="button"
            aria-label="Previous"
            onClick={goPrev}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            className="cal-nav-btn"
            type="button"
            aria-label="Next"
            onClick={goNext}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <button type="button" className="cal-today-btn" onClick={goToday}>
          Today
        </button>

        {/* View switcher — segmented control. */}
        <div className="cal-view-toggle" role="tablist" aria-label="Calendar view">
          {(["month", "week", "day", "agenda"] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={"cal-view-btn" + (view === v ? " is-active" : "")}
              onClick={() => setView(v)}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>

        <span className="tmt-spacer" />
        <button type="button" className="tmt-add" onClick={() => openNew()}>
          + New event
        </button>
      </div>

      <div className={"cal-body cal-body-" + view}>
        {view === "month" && (
          <MonthView
            cursor={cursor}
            selected={selected}
            eventMap={eventMap}
            onSelectDay={setSelected}
            onOpenNewOnDay={(d) => openNew(d)}
            onOpenEdit={openEdit}
            onNavigateAttachment={navigateAttachment}
            onOpenNewForSelected={() => openNew()}
          />
        )}
        {view === "week" && (
          <WeekView
            cursor={cursor}
            eventMap={eventMap}
            onOpenEdit={openEdit}
            onOpenNew={(d, time) => openNew(d, time)}
          />
        )}
        {view === "day" && (
          <DayView
            cursor={cursor}
            eventMap={eventMap}
            onOpenEdit={openEdit}
            onOpenNew={(time) => openNew(cursor, time)}
            onNavigateAttachment={navigateAttachment}
          />
        )}
        {view === "agenda" && (
          <AgendaView
            cursor={cursor}
            events={events}
            onOpenEdit={openEdit}
            onOpenNew={() => openNew()}
            onNavigateAttachment={navigateAttachment}
          />
        )}
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

// ─────────────────────── month view ─────────────────────────

interface MonthViewProps {
  cursor: Date;
  selected: Date;
  eventMap: Record<string, CalendarEvent[]>;
  onSelectDay: (d: Date) => void;
  onOpenNewOnDay: (d: Date) => void;
  onOpenNewForSelected: () => void;
  onOpenEdit: (ev: CalendarEvent) => void;
  onNavigateAttachment: (a: AttachmentSummary) => void;
}

function MonthView({
  cursor,
  selected,
  eventMap,
  onSelectDay,
  onOpenNewOnDay,
  onOpenNewForSelected,
  onOpenEdit,
  onNavigateAttachment,
}: MonthViewProps) {
  const cells = useMemo(
    () => buildMonthMatrix(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const selectedISO = isoFromDate(selected);
  const selectedEvents = eventMap[selectedISO] ?? [];

  return (
    <>
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
                onClick={() => onSelectDay(date)}
                onDoubleClick={() => onOpenNewOnDay(date)}
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
                        onOpenEdit(ev);
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
                          title={`${ev.attachments.length} attachment${ev.attachments.length === 1 ? "" : "s"}`}
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
            <div className="cal-side-date">{formatDateLong(selected)}</div>
          </div>
          <button
            className="icon-btn bordered cal-side-add"
            type="button"
            onClick={onOpenNewForSelected}
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
              <SideEventCard
                key={ev.id}
                ev={ev}
                onOpenEdit={onOpenEdit}
                onNavigateAttachment={onNavigateAttachment}
              />
            ))}
          </div>
        )}
      </aside>
    </>
  );
}

/** Detailed event card used in the Month-view sidebar and the Day view. */
function SideEventCard({
  ev,
  onOpenEdit,
  onNavigateAttachment,
}: {
  ev: CalendarEvent;
  onOpenEdit: (ev: CalendarEvent) => void;
  onNavigateAttachment: (a: AttachmentSummary) => void;
}) {
  return (
    <div
      className={"cal-side-event t-" + ev.color}
      onClick={() => onOpenEdit(ev)}
    >
      <span className="cal-side-bar" />
      <div className="cal-side-event-body">
        <div
          className="cal-side-event-title"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span style={{ flex: 1 }}>{ev.title}</span>
          <CopyButton
            value={ev.id}
            title="Copy event id (use as event_id in MCP calendar tools)"
          />
        </div>
        {ev.event_time && (
          <div className="cal-side-event-time">{ev.event_time.slice(0, 5)}</div>
        )}
        {ev.description && (
          <div className="cal-side-event-desc">{ev.description}</div>
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
                    onNavigateAttachment(a);
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
                  <span className="cal-side-attach-name">{a.name}</span>
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
  );
}

// ─────────────────────── week view ─────────────────────────

interface WeekViewProps {
  cursor: Date;
  eventMap: Record<string, CalendarEvent[]>;
  onOpenEdit: (ev: CalendarEvent) => void;
  /** Called when the user clicks an empty hour slot — passes the clicked
   *  date plus an HH:MM string rounded to the slot. */
  onOpenNew: (d: Date, time: string) => void;
}

function WeekView({ cursor, eventMap, onOpenEdit, onOpenNew }: WeekViewProps) {
  const days = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const allDayByDay = useMemo(() => {
    return days.map((d) => {
      const iso = isoFromDate(d);
      return (eventMap[iso] ?? []).filter((e) => !e.event_time);
    });
  }, [days, eventMap]);

  const timedByDay = useMemo(() => {
    return days.map((d) => {
      const iso = isoFromDate(d);
      return (eventMap[iso] ?? []).filter((e) => !!e.event_time);
    });
  }, [days, eventMap]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);

  return (
    <div className="cal-week">
      <div className="cal-week-header">
        <div className="cal-week-gutter" />
        {days.map((d, i) => (
          <div
            key={i}
            className={"cal-week-dayhead" + (isSameDay(d, today) ? " is-today" : "")}
          >
            <div className="cal-week-dayname">{WEEKDAYS[i]}</div>
            <div className="cal-week-daynum">{d.getDate()}</div>
          </div>
        ))}
      </div>

      {/* All-day strip — events without a time sit here. */}
      {allDayByDay.some((arr) => arr.length > 0) && (
        <div className="cal-week-allday">
          <div className="cal-week-gutter cal-week-allday-label">all-day</div>
          {allDayByDay.map((list, i) => (
            <div key={i} className="cal-week-allday-cell">
              {list.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className={"cal-chip t-" + ev.color}
                  onClick={() => onOpenEdit(ev)}
                >
                  <span className="cal-chip-dot" />
                  <span className="cal-chip-title">{ev.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="cal-week-scroll">
        <div
          className="cal-week-body"
          style={{ ["--cal-hour-px" as never]: `${HOUR_PX}px` }}
        >
          <div className="cal-week-gutter cal-week-hours">
            {hours.map((h) => (
              <div key={h} className="cal-week-hour">
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((d, dayIdx) => {
            const isToday = isSameDay(d, today);
            return (
              <div
                key={dayIdx}
                className={"cal-week-col" + (isToday ? " is-today" : "")}
              >
                {/* Click target rows — one per hour, click → new event at HH:00. */}
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="cal-week-slot"
                    onClick={() =>
                      onOpenNew(d, `${String(h).padStart(2, "0")}:00`)
                    }
                    aria-label={`New event at ${h}:00`}
                  />
                ))}
                {/* Absolute-positioned timed events on top of the slot grid. */}
                {timedByDay[dayIdx].map((ev) => (
                  <TimedEventBlock
                    key={ev.id}
                    ev={ev}
                    onClick={() => onOpenEdit(ev)}
                  />
                ))}
                {/* Today's "now" line */}
                {isToday && <NowLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Absolutely-positioned event block inside a Week/Day-view hour grid. */
function TimedEventBlock({
  ev,
  onClick,
}: {
  ev: CalendarEvent;
  onClick: () => void;
}) {
  const startMin = timeToMin(ev.event_time);
  if (startMin == null) return null;
  // Assume 1-hour duration for now (the schema has no end_time). Tall enough
  // to be readable; users can update once we add duration in a future pass.
  const top = (startMin / 60) * HOUR_PX;
  const height = HOUR_PX - 4;
  return (
    <button
      type="button"
      className={"cal-week-event t-" + ev.color}
      style={{ top, height }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={ev.title}
    >
      <span className="cal-week-event-time">
        {ev.event_time?.slice(0, 5)}
      </span>
      <span className="cal-week-event-title">{ev.title}</span>
      {ev.attachments.length > 0 && (
        <span className="cal-chip-attach">⛓</span>
      )}
    </button>
  );
}

function NowLine() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const top = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_PX;
  return (
    <div className="cal-now-line" style={{ top }}>
      <span className="cal-now-dot" />
    </div>
  );
}

// ─────────────────────── day view ──────────────────────────

interface DayViewProps {
  cursor: Date;
  eventMap: Record<string, CalendarEvent[]>;
  onOpenEdit: (ev: CalendarEvent) => void;
  onOpenNew: (time: string) => void;
  onNavigateAttachment: (a: AttachmentSummary) => void;
}

function DayView({
  cursor,
  eventMap,
  onOpenEdit,
  onOpenNew,
  onNavigateAttachment,
}: DayViewProps) {
  const iso = isoFromDate(cursor);
  const list = eventMap[iso] ?? [];
  const allDay = list.filter((e) => !e.event_time);
  const timed = list.filter((e) => !!e.event_time);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);
  const isToday = isSameDay(cursor, today);

  return (
    <div className="cal-day">
      <div className="cal-day-summary">
        <div>
          <div className="cal-side-day">
            {cursor.toLocaleDateString("en-US", { weekday: "long" })}
          </div>
          <div className="cal-side-date">{formatDateLong(cursor)}</div>
        </div>
        <span className="cal-day-count">
          {list.length} event{list.length === 1 ? "" : "s"}
        </span>
      </div>

      {allDay.length > 0 && (
        <div className="cal-day-allday">
          <div className="cal-day-allday-label">All-day</div>
          <div className="cal-day-allday-list">
            {allDay.map((ev) => (
              <SideEventCard
                key={ev.id}
                ev={ev}
                onOpenEdit={onOpenEdit}
                onNavigateAttachment={onNavigateAttachment}
              />
            ))}
          </div>
        </div>
      )}

      <div className="cal-week-scroll">
        <div
          className="cal-day-grid"
          style={{ ["--cal-hour-px" as never]: `${HOUR_PX}px` }}
        >
          <div className="cal-week-gutter cal-week-hours">
            {hours.map((h) => (
              <div key={h} className="cal-week-hour">
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          <div className={"cal-week-col cal-day-col" + (isToday ? " is-today" : "")}>
            {hours.map((h) => (
              <button
                key={h}
                type="button"
                className="cal-week-slot"
                onClick={() => onOpenNew(`${String(h).padStart(2, "0")}:00`)}
              />
            ))}
            {timed.map((ev) => (
              <TimedEventBlock
                key={ev.id}
                ev={ev}
                onClick={() => onOpenEdit(ev)}
              />
            ))}
            {isToday && <NowLine />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────── agenda view ─────────────────────────

interface AgendaViewProps {
  cursor: Date;
  events: CalendarEvent[];
  onOpenEdit: (ev: CalendarEvent) => void;
  onOpenNew: () => void;
  onNavigateAttachment: (a: AttachmentSummary) => void;
}

function AgendaView({
  cursor,
  events,
  onOpenEdit,
  onOpenNew,
  onNavigateAttachment,
}: AgendaViewProps) {
  // Show all events whose date is in the cursor's month OR later. Lets the
  // user page through future months without losing earlier ones if they
  // navigate back.
  const monthStart = new Date(
    cursor.getFullYear(),
    cursor.getMonth(),
    1,
  );
  const monthEnd = new Date(
    cursor.getFullYear(),
    cursor.getMonth() + 1,
    0,
    23,
    59,
    59,
  );

  const inWindow = useMemo(() => {
    return events.filter((e) => {
      const [y, m, d] = e.event_date.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return date >= monthStart && date <= monthEnd;
    });
  }, [events, monthStart.getTime(), monthEnd.getTime()]);

  const grouped = useMemo(() => {
    const byDate = new Map<string, CalendarEvent[]>();
    for (const e of inWindow) {
      const arr = byDate.get(e.event_date) ?? [];
      arr.push(e);
      byDate.set(e.event_date, arr);
    }
    return Array.from(byDate.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [inWindow]);

  if (grouped.length === 0) {
    return (
      <div className="cal-agenda">
        <div className="cal-empty cal-agenda-empty">
          No events scheduled this month.
          <br />
          <button
            type="button"
            onClick={onOpenNew}
            className="cal-agenda-empty-btn"
          >
            + New event
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cal-agenda">
      {grouped.map(([dateIso, list]) => {
        const [y, m, d] = dateIso.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        const isToday = isSameDay(date, today);
        return (
          <section
            key={dateIso}
            className={"cal-agenda-day" + (isToday ? " is-today" : "")}
          >
            <header className="cal-agenda-head">
              <div className="cal-agenda-daynum">{date.getDate()}</div>
              <div className="cal-agenda-meta">
                <div className="cal-agenda-dayname">
                  {WEEKDAYS_LONG[(date.getDay() + 6) % 7]}
                </div>
                <div className="cal-agenda-monthname">
                  {MONTH_NAMES[date.getMonth()]} {date.getFullYear()}
                  {isToday && (
                    <span className="cal-agenda-today-pill">Today</span>
                  )}
                </div>
              </div>
            </header>
            <div className="cal-agenda-list">
              {list.map((ev) => (
                <SideEventCard
                  key={ev.id}
                  ev={ev}
                  onOpenEdit={onOpenEdit}
                  onNavigateAttachment={onNavigateAttachment}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
