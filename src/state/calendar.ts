import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
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

export function useCalendar(workspaceId: string | null) {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const fetchAll = useCallback(async () => {
    if (!workspaceId) {
      setEvents([]);
      return;
    }
    const { data, error } = await supabase
      .from("calendar_events")
      .select(
        "id, title, event_date, event_time, color, description, created_by",
      )
      .eq("workspace_id", workspaceId)
      .order("event_date", { ascending: true })
      .order("event_time", { ascending: true, nullsFirst: true });
    if (error) {
      console.error("calendar list", error);
      return;
    }
    setEvents(
      (data ?? []).map((e) => ({
        ...e,
        color: e.color as TagColor,
      })),
    );
  }, [workspaceId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Realtime
  useEffect(() => {
    if (!workspaceId) return;
    const ch = supabase
      .channel(`calendar:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_events",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => void fetchAll(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [workspaceId, fetchAll]);

  const createEvent = useCallback(
    async (input: {
      title: string;
      event_date: string;
      event_time?: string | null;
      color?: TagColor;
      description?: string | null;
    }) => {
      if (!workspaceId) return;
      const { error } = await supabase.from("calendar_events").insert({
        id: newUuid(),
        workspace_id: workspaceId,
        title: input.title.trim(),
        event_date: input.event_date,
        event_time: input.event_time ?? null,
        color: input.color ?? "violet",
        description: input.description ?? null,
        created_by: user?.id ?? null,
      });
      if (error) console.error("createEvent", error);
    },
    [workspaceId, user?.id],
  );

  const updateEvent = useCallback(
    async (id: string, patch: Partial<Omit<CalendarEvent, "id">>) => {
      const { error } = await supabase
        .from("calendar_events")
        .update(patch)
        .eq("id", id);
      if (error) console.error("updateEvent", error);
    },
    [],
  );

  const deleteEvent = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", id);
    if (error) console.error("deleteEvent", error);
  }, []);

  return { events, createEvent, updateEvent, deleteEvent };
}
