import { useKanban } from "../../state/kanbanStore";
import { useEntityEvents } from "../../state/entityEvents";
import type { AttachmentEntityType } from "../../state/calendar";

interface Props {
  entity_type: AttachmentEntityType;
  entity_id: string | null;
  /** Visual variant. The kanban drawer uses "section" so it matches the
   *  surrounding cp-section blocks; smaller hosts (cast card) use "compact". */
  variant?: "section" | "compact";
}

/** Reverse view of the calendar→attachment relation: "this entity is linked
 *  from these events." Lives inside any entity-detail surface (kanban card
 *  drawer, scene editor, character editor) and lets users jump to Calendar
 *  with the right day + event already open. */
export function LinkedEventsSection({ entity_type, entity_id, variant = "section" }: Props) {
  const { state, dispatch } = useKanban();
  const { events, loading } = useEntityEvents({
    workspaceId: state.workspaceId,
    entity_type,
    entity_id,
  });

  // Don't render anything while we have no events to show — keeps the host
  // surface from getting a permanent empty block. Loading is implicit; if
  // attachments exist this list resolves within a tick.
  if (!entity_id) return null;
  if (events.length === 0 && !loading) return null;

  const openInCalendar = (ev: (typeof events)[number]) => {
    dispatch({ type: "SET_ACTIVE_NAV", key: "calendar" });
    dispatch({
      type: "SET_PENDING_FOCUS",
      focus: { kind: "calendar_event", id: ev.id, date: ev.event_date },
    });
  };

  const className =
    variant === "compact" ? "linked-events linked-events-compact" : "linked-events";

  return (
    <section className={className}>
      <h4 className="linked-events-title">
        Scheduled
        <span className="linked-events-count">{events.length}</span>
      </h4>
      <ul className="linked-events-list">
        {events.map((ev) => (
          <li key={ev.id} className={"linked-event t-" + ev.color}>
            <button
              type="button"
              className="linked-event-btn"
              onClick={() => openInCalendar(ev)}
              title="Open in Calendar"
            >
              <span className="linked-event-bar" aria-hidden />
              <span className="linked-event-date">{formatDate(ev.event_date)}</span>
              {ev.event_time && (
                <span className="linked-event-time">
                  {ev.event_time.slice(0, 5)}
                </span>
              )}
              <span className="linked-event-title">{ev.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Short, no-year format ("Apr 21") unless the year differs from today, in
// which case we surface the year so a 2027 deadline doesn't look like next
// week's standup.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}
