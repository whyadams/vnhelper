import { useCallback, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { useScopedQuery } from "./_helpers/useScopedQuery";
import type { TagColor } from "../data/kanban";

export interface EventCreator {
  id: string;
  name: string | null;
  email: string | null;
}

export type AttachmentEntityType = "card" | "script_node" | "character";

export interface AttachmentSummary {
  id: string;
  event_id: string;
  entity_type: AttachmentEntityType;
  entity_id: string;
  /** Resolved at fetch time. Falls back to "Deleted item" when the target row
   * is gone (which only happens transiently — triggers cascade-delete the
   * attachment when the underlying entity is dropped). */
  name: string;
  /** True if the entity still exists at fetch time. UI can grey out the row
   * when this is false instead of showing a confusing click target. */
  exists: boolean;
}

export interface AttachOption {
  entity_type: AttachmentEntityType;
  entity_id: string;
  name: string;
  /** Secondary line — column name for cards, "Chapter / Scene" for nodes, etc. */
  subtitle: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  event_date: string; // YYYY-MM-DD
  event_time: string | null; // HH:MM:SS or null
  color: TagColor;
  description: string | null;
  created_by: string | null;
  /** Author profile, resolved from `profiles` after fetch. May be null when
   * the user was deleted or until a realtime payload is enriched. */
  creator: EventCreator | null;
  attachments: AttachmentSummary[];
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

interface DbAttachment {
  id: string;
  event_id: string;
  entity_type: string;
  entity_id: string;
}

function isAttachmentType(s: string): s is AttachmentEntityType {
  return s === "card" || s === "script_node" || s === "character";
}

/** Resolve a batch of attachment rows into UI-ready summaries by fetching
 *  each entity type's display name in a single query. */
async function resolveAttachments(
  rows: DbAttachment[],
): Promise<AttachmentSummary[]> {
  if (rows.length === 0) return [];

  const cardIds: string[] = [];
  const nodeIds: string[] = [];
  const charIds: string[] = [];
  for (const r of rows) {
    if (r.entity_type === "card") cardIds.push(r.entity_id);
    else if (r.entity_type === "script_node") nodeIds.push(r.entity_id);
    else if (r.entity_type === "character") charIds.push(r.entity_id);
  }

  const cardNames = new Map<string, string>();
  const nodeNames = new Map<string, string>();
  const charNames = new Map<string, string>();

  // Parallelise; each list-fetch is its own RLS-scoped query so a deleted
  // entity simply doesn't come back and we render "Deleted item".
  await Promise.all([
    cardIds.length === 0
      ? null
      : supabase
          .from("cards")
          .select("id, title")
          .in("id", cardIds)
          .then(({ data, error }) => {
            if (error) {
              console.error("resolveAttachments cards", error);
              return;
            }
            for (const c of data ?? []) cardNames.set(c.id, c.title || "(no title)");
          }),
    nodeIds.length === 0
      ? null
      : supabase
          .from("script_nodes")
          .select("id, title")
          .in("id", nodeIds)
          .then(({ data, error }) => {
            if (error) {
              console.error("resolveAttachments script_nodes", error);
              return;
            }
            for (const n of data ?? []) nodeNames.set(n.id, n.title || "Untitled");
          }),
    charIds.length === 0
      ? null
      : supabase
          .from("script_characters")
          .select("id, name")
          .in("id", charIds)
          .then(({ data, error }) => {
            if (error) {
              console.error("resolveAttachments script_characters", error);
              return;
            }
            for (const c of data ?? []) charNames.set(c.id, c.name);
          }),
  ]);

  return rows.flatMap((r): AttachmentSummary[] => {
    if (!isAttachmentType(r.entity_type)) return [];
    const map =
      r.entity_type === "card"
        ? cardNames
        : r.entity_type === "script_node"
          ? nodeNames
          : charNames;
    const name = map.get(r.entity_id);
    return [
      {
        id: r.id,
        event_id: r.event_id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        name: name ?? "Deleted item",
        exists: name !== undefined,
      },
    ];
  });
}

function rowToEvent(
  r: DbEvent,
  creator: EventCreator | null = null,
  attachments: AttachmentSummary[] = [],
): CalendarEvent {
  return { ...r, color: r.color as TagColor, creator, attachments };
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
      const rows = (data ?? []) as DbEvent[];
      const eventIds = rows.map((r) => r.id);

      // Fetch attachments + creators in parallel.
      const [{ data: attRows, error: attErr }, profileMap] = await Promise.all([
        eventIds.length === 0
          ? Promise.resolve({ data: [] as DbAttachment[], error: null })
          : supabase
              .from("calendar_event_attachments")
              .select("id, event_id, entity_type, entity_id")
              .in("event_id", eventIds),
        (async () => {
          const ids = Array.from(
            new Set(
              rows.map((r) => r.created_by).filter((x): x is string => !!x),
            ),
          );
          if (ids.length === 0) return new Map<string, EventCreator>();
          const { data: profiles, error: pErr } = await supabase
            .from("profiles")
            .select("id, name, email")
            .in("id", ids);
          if (pErr) {
            console.error("calendar creators", pErr);
            return new Map<string, EventCreator>();
          }
          return new Map<string, EventCreator>(
            (profiles ?? []).map((p) => [
              p.id,
              { id: p.id, name: p.name, email: p.email },
            ]),
          );
        })(),
      ]);
      if (attErr) console.error("calendar attachments list", attErr);

      const resolvedAttachments = await resolveAttachments(
        (attRows ?? []) as DbAttachment[],
      );
      const attByEvent = new Map<string, AttachmentSummary[]>();
      for (const a of resolvedAttachments) {
        const arr = attByEvent.get(a.event_id) ?? [];
        arr.push(a);
        attByEvent.set(a.event_id, arr);
      }

      return rows.map((r) =>
        rowToEvent(
          r,
          r.created_by ? (profileMap.get(r.created_by) ?? null) : null,
          attByEvent.get(r.id) ?? [],
        ),
      );
    },
  });

  // Realtime — inline INSERT/UPDATE/DELETE on events. We also listen to the
  // attachments table so a remote attach/detach reflects without refetch.
  //
  // Channel name is suffixed with a fresh UUID *per effect run* so we don't
  // collide with (a) React Strict Mode's dev double-invoke, where cleanup's
  // async `removeChannel` hasn't completed by the time the re-mount runs,
  // and (b) other consumers of `useCalendar` mounted in the same workspace
  // (e.g. the CalendarNotifier poller). Supabase's RealtimeChannel rejects
  // adding `.on()` listeners to an already-`subscribe()`d channel; isolated
  // channel names sidestep that entirely.
  useEffect(() => {
    if (!workspaceId) return;
    const myWs = workspaceId;
    const channelId = newUuid();
    const ch = supabase
      .channel(`calendar:${myWs}:${channelId}`)
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
          setEvents((cur) => {
            const existing = cur.find((e) => e.id === row.id);
            const preservedCreator =
              existing && existing.created_by === row.created_by
                ? existing.creator
                : null;
            const preservedAttachments = existing?.attachments ?? [];
            const next = rowToEvent(row, preservedCreator, preservedAttachments);
            const idx = cur.findIndex((e) => e.id === next.id);
            if (idx === -1) return [...cur, next];
            const copy = cur.slice();
            copy[idx] = next;
            return copy;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_event_attachments",
          filter: `workspace_id=eq.${myWs}`,
        },
        (payload) => {
          if (scopeRef.current !== myWs) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setEvents((cur) =>
              cur.map((e) => ({
                ...e,
                attachments: e.attachments.filter((a) => a.id !== id),
              })),
            );
            return;
          }
          const row = payload.new as DbAttachment | null;
          if (!row || !isAttachmentType(row.entity_type)) return;
          // Resolve name in the background so we can render the row.
          void resolveAttachments([row]).then((resolved) => {
            const att = resolved[0];
            if (!att) return;
            setEvents((cur) =>
              cur.map((e) => {
                if (e.id !== att.event_id) return e;
                if (e.attachments.some((a) => a.id === att.id)) {
                  return {
                    ...e,
                    attachments: e.attachments.map((a) =>
                      a.id === att.id ? att : a,
                    ),
                  };
                }
                return { ...e, attachments: [...e.attachments, att] };
              }),
            );
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
      if (!workspaceId) return null;
      const id = newUuid();
      const optimistic: CalendarEvent = {
        id,
        title: input.title.trim(),
        event_date: input.event_date,
        event_time: input.event_time ?? null,
        color: input.color ?? "violet",
        description: input.description ?? null,
        created_by: user?.id ?? null,
        creator: user
          ? {
              id: user.id,
              name:
                (user.user_metadata?.name as string | undefined) ?? null,
              email: user.email ?? null,
            }
          : null,
        attachments: [],
      };
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
        return null;
      }
      return id;
    },
    [workspaceId, user, setEvents],
  );

  const updateEvent = useCallback(
    async (id: string, patch: Partial<Omit<CalendarEvent, "id">>) => {
      let snapshot: CalendarEvent | undefined;
      setEvents((cur) =>
        cur.map((e) => {
          if (e.id !== id) return e;
          snapshot = e;
          return { ...e, ...patch };
        }),
      );
      // Strip client-side / non-DB fields before sending the patch upstream.
      const {
        creator: _ignoredCreator,
        created_by: _ignoredCreatedBy,
        attachments: _ignoredAttachments,
        ...dbPatch
      } = patch;
      void _ignoredCreator;
      void _ignoredCreatedBy;
      void _ignoredAttachments;
      const { error } = await supabase
        .from("calendar_events")
        .update(dbPatch)
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

  const attachToEvent = useCallback(
    async (
      eventId: string,
      entity_type: AttachmentEntityType,
      entity_id: string,
    ) => {
      if (!workspaceId) return;
      // Guard against duplicates client-side (the DB unique constraint will
      // also reject, but skipping a no-op is friendlier).
      const existing = events.find((e) => e.id === eventId);
      if (
        existing?.attachments.some(
          (a) => a.entity_type === entity_type && a.entity_id === entity_id,
        )
      ) {
        return;
      }
      const id = newUuid();
      const optimistic: AttachmentSummary = {
        id,
        event_id: eventId,
        entity_type,
        entity_id,
        name: "…",
        exists: true,
      };
      setEvents((cur) =>
        cur.map((e) =>
          e.id === eventId
            ? { ...e, attachments: [...e.attachments, optimistic] }
            : e,
        ),
      );

      const { error } = await supabase
        .from("calendar_event_attachments")
        .insert({
          id,
          event_id: eventId,
          workspace_id: workspaceId,
          entity_type,
          entity_id,
          created_by: user?.id ?? null,
        });
      if (error) {
        console.error("attachToEvent", error);
        setEvents((cur) =>
          cur.map((e) =>
            e.id === eventId
              ? {
                  ...e,
                  attachments: e.attachments.filter((a) => a.id !== id),
                }
              : e,
          ),
        );
        return;
      }
      // Fill in the resolved display name now that the row exists.
      const [resolved] = await resolveAttachments([
        {
          id,
          event_id: eventId,
          entity_type,
          entity_id,
        },
      ]);
      if (resolved) {
        setEvents((cur) =>
          cur.map((e) =>
            e.id === eventId
              ? {
                  ...e,
                  attachments: e.attachments.map((a) =>
                    a.id === id ? resolved : a,
                  ),
                }
              : e,
          ),
        );
      }
    },
    [workspaceId, user?.id, events, setEvents],
  );

  const detachFromEvent = useCallback(
    async (eventId: string, attachmentId: string) => {
      let snapshot: AttachmentSummary | undefined;
      setEvents((cur) =>
        cur.map((e) => {
          if (e.id !== eventId) return e;
          snapshot = e.attachments.find((a) => a.id === attachmentId);
          return {
            ...e,
            attachments: e.attachments.filter((a) => a.id !== attachmentId),
          };
        }),
      );
      const { error } = await supabase
        .from("calendar_event_attachments")
        .delete()
        .eq("id", attachmentId);
      if (error) {
        console.error("detachFromEvent", error);
        if (snapshot) {
          const restored = snapshot;
          setEvents((cur) =>
            cur.map((e) =>
              e.id === eventId
                ? { ...e, attachments: [...e.attachments, restored] }
                : e,
            ),
          );
        }
      }
    },
    [setEvents],
  );

  /** List attachable entities of a given type in the current workspace,
   *  optionally filtered by a substring of the display name. Used by the
   *  EventModal "Attach" picker. */
  const searchAttachOptions = useCallback(
    async (
      entity_type: AttachmentEntityType,
      query: string,
      limit = 30,
    ): Promise<AttachOption[]> => {
      if (!workspaceId) return [];
      const q = query.trim();
      if (entity_type === "card") {
        // Cards belong to a board → board belongs to a workspace. We need
        // workspace_id-scoping here so multiple workspaces don't bleed.
        let req = supabase
          .from("cards")
          .select(
            "id, title, subtitle, board:boards!inner(workspace_id)",
            { count: "exact" },
          )
          .eq("board.workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (q) req = req.ilike("title", `%${q}%`);
        const { data, error } = await req;
        if (error) {
          console.error("searchAttachOptions cards", error);
          return [];
        }
        return (data ?? []).map((c) => ({
          entity_type: "card" as const,
          entity_id: c.id,
          name: c.title || "(no title)",
          subtitle: c.subtitle || null,
        }));
      }
      if (entity_type === "script_node") {
        let req = supabase
          .from("script_nodes")
          .select("id, title, kind")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (q) req = req.ilike("title", `%${q}%`);
        const { data, error } = await req;
        if (error) {
          console.error("searchAttachOptions script_nodes", error);
          return [];
        }
        return (data ?? []).map((n) => ({
          entity_type: "script_node" as const,
          entity_id: n.id,
          name: n.title || "Untitled",
          subtitle: n.kind,
        }));
      }
      // characters
      let req = supabase
        .from("script_characters")
        .select("id, name, role")
        .eq("workspace_id", workspaceId)
        .order("position", { ascending: true })
        .limit(limit);
      if (q) req = req.ilike("name", `%${q}%`);
      const { data, error } = await req;
      if (error) {
        console.error("searchAttachOptions script_characters", error);
        return [];
      }
      return (data ?? []).map((c) => ({
        entity_type: "character" as const,
        entity_id: c.id,
        name: c.name,
        subtitle: c.role,
      }));
    },
    [workspaceId],
  );

  return {
    events,
    refetch,
    createEvent,
    updateEvent,
    deleteEvent,
    attachToEvent,
    detachFromEvent,
    searchAttachOptions,
  };
}
