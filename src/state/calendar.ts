import { useCallback, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { useScopedQuery } from "./_helpers/useScopedQuery";
import type { TagColor } from "../data/kanban";

export interface CalendarEvent {
  id: string;
  title: string;
  event_date: string; // YYYY-MM-DD
  event_time: string | null; // HH:MM:SS or null
  color: TagColor;
  description: string | null;
  created_by: string | null;
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function newUuid() {
  return globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
}

const EMPTY: CalendarEvent[] = [];

interface DbEvent {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  color: string;
  description: string | null;
  created_by: string | null;
}

function rowToEvent(r: DbEvent): CalendarEvent {
  return { ...r, color: r.color as TagColor };
}

export function useCalendar(workspaceId: string | null) {
  const { user } = useAuth();

  const {
    data: events,
    setData: setEvents,
    refetch,
    scopeRef,
  } = useScopedQuery<CalendarEvent[], string>({
    scope: workspaceId,
    initial: EMPTY,
    fetch: async (wsId) => {
      const { data, error } = await supabase
        .from("calendar_events")
        .select(
          "id, title, event_date, event_time, color, description, created_by",
        )
        .eq("workspace_id", wsId)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true, nullsFirst: true });
      if (error) {
        console.error("calendar list", error);
        return [];
      }
      return ((data ?? []) as DbEvent[]).map(rowToEvent);
    },
  });

  // Realtime — inline INSERT/UPDATE/DELETE, no full refetch.
  useEffect(() => {
    if (!workspaceId) return;
    const myWs = workspaceId;
    const ch = supabase
      .channel(`calendar:${myWs}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_events",
          filter: `workspace_id=eq.${myWs}`,
        },
        (payload) => {
          if (scopeRef.current !== myWs) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setEvents((cur) => cur.filter((e) => e.id !== id));
            return;
          }
          const row = payload.new as DbEvent | null;
          if (!row) return;
          const next = rowToEvent(row);
          setEvents((cur) => {
            const idx = cur.findIndex((e) => e.id === next.id);
            if (idx === -1) return [...cur, next];
            const copy = cur.slice();
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [workspaceId, scopeRef, setEvents]);

  const createEvent = useCallback(
    async (input: {
      title: string;
      event_date: string;
      event_time?: string | null;
      color?: TagColor;
      description?: string | null;
    }) => {
      if (!workspaceId) return;
      const id = newUuid();
      const optimistic: CalendarEvent = {
        id,
        title: input.title.trim(),
        event_date: input.event_date,
        event_time: input.event_time ?? null,
        color: input.color ?? "violet",
        description: input.description ?? null,
        created_by: user?.id ?? null,
      };
      // Optimistic insert.
      setEvents((cur) => [...cur, optimistic]);

      const { error } = await supabase.from("calendar_events").insert({
        id,
        workspace_id: workspaceId,
        title: optimistic.title,
        event_date: optimistic.event_date,
        event_time: optimistic.event_time,
        color: optimistic.color,
        description: optimistic.description,
        created_by: optimistic.created_by,
      });
      if (error) {
        console.error("createEvent", error);
        setEvents((cur) => cur.filter((e) => e.id !== id));
      }
    },
    [workspaceId, user?.id, setEvents],
  );

  const updateEvent = useCallback(
    async (id: string, patch: Partial<Omit<CalendarEvent, "id">>) => {
      // Optimistic update.
      let snapshot: CalendarEvent | undefined;
      setEvents((cur) =>
        cur.map((e) => {
          if (e.id !== id) return e;
          snapshot = e;
          return { ...e, ...patch };
        }),
      );
      const { error } = await supabase
        .from("calendar_events")
        .update(patch)
        .eq("id", id);
      if (error) {
        console.error("updateEvent", error);
        if (snapshot) {
          setEvents((cur) => cur.map((e) => (e.id === id ? snapshot! : e)));
        }
      }
    },
    [setEvents],
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      // Optimistic delete.
      let snapshot: CalendarEvent | undefined;
      setEvents((cur) => {
        snapshot = cur.find((e) => e.id === id);
        return cur.filter((e) => e.id !== id);
      });
      const { error } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", id);
      if (error) {
        console.error("deleteEvent", error);
        if (snapshot) setEvents((cur) => [...cur, snapshot!]);
      }
    },
    [setEvents],
  );

  return { events, refetch, createEvent, updateEvent, deleteEvent };
}
