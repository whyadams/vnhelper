import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { TagColor } from "../data/kanban";
import type { AttachmentEntityType } from "./calendar";

/** A calendar event linked to some entity. Pared down compared to the full
 *  `CalendarEvent` from state/calendar — the reverse-link surface only needs
 *  enough to render a one-line chip and navigate. */
export interface LinkedEvent {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  color: TagColor;
}

/** Returns the calendar events linked (via `calendar_event_attachments`) to
 *  the given entity in the current workspace. Realtime-light: the list
 *  refetches on workspace/entity change and via `refresh()`. Inline updates
 *  for attach/detach happen on the source side; this hook just owns reads.
 *
 *  Skip when `enabled` is false or any scope arg is null — useful when the
 *  parent is mounted before the entity is known (e.g. a drawer that lazy-
 *  fetches the focused card). */
export function useEntityEvents(opts: {
  workspaceId: string | null;
  entity_type: AttachmentEntityType;
  entity_id: string | null;
  enabled?: boolean;
}) {
  const { workspaceId, entity_type, entity_id, enabled = true } = opts;
  const [events, setEvents] = useState<LinkedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const fetchOnce = useCallback(async () => {
    if (!enabled || !workspaceId || !entity_id) {
      setEvents([]);
      return;
    }
    const myReq = ++reqRef.current;
    setLoading(true);
    try {
      const { data: atts, error: attErr } = await supabase
        .from("calendar_event_attachments")
        .select("event_id")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", entity_type)
        .eq("entity_id", entity_id);
      if (attErr) {
        console.error("useEntityEvents attachments", attErr);
        if (myReq === reqRef.current) setEvents([]);
        return;
      }
      const eventIds = (atts ?? []).map((a) => a.event_id);
      if (eventIds.length === 0) {
        if (myReq === reqRef.current) setEvents([]);
        return;
      }
      const { data, error } = await supabase
        .from("calendar_events")
        .select("id, title, event_date, event_time, color")
        .in("id", eventIds)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true, nullsFirst: true });
      if (error) {
        console.error("useEntityEvents events", error);
        if (myReq === reqRef.current) setEvents([]);
        return;
      }
      if (myReq === reqRef.current) {
        setEvents(
          (data ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            event_date: r.event_date,
            event_time: r.event_time,
            color: r.color as TagColor,
          })),
        );
      }
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, [workspaceId, entity_type, entity_id, enabled]);

  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  // Realtime: subscribe to attachment changes for this workspace; refetch the
  // small list when something touches our entity. Cheap because the entire
  // payload (the attachments table) is workspace-scoped already.
  useEffect(() => {
    if (!enabled || !workspaceId || !entity_id) return;
    const ch = supabase
      .channel(
        `linked-events:${workspaceId}:${entity_type}:${entity_id}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_event_attachments",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { entity_type?: string; entity_id?: string }
            | null;
          if (!row) return;
          if (
            row.entity_type === entity_type &&
            row.entity_id === entity_id
          ) {
            void fetchOnce();
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_events",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          // Edits to a linked event's title/date should reflect; refetch.
          void fetchOnce();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [enabled, workspaceId, entity_type, entity_id, fetchOnce]);

  return { events, loading, refresh: fetchOnce };
}
