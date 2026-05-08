import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";

export interface NotificationRow {
  id: string;
  kind: string;
  actor_id: string | null;
  workspace_id: string | null;
  card_id: string | null;
  comment_id: string | null;
  body: string;
  read: boolean;
  created_at: string;
}

export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);

  const fetchAll = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from("notifications")
      .select(
        "id, kind, actor_id, workspace_id, card_id, comment_id, body, read, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("notifications fetch", error);
      return;
    }
    setItems(data as NotificationRow[]);
  }, [user]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Realtime — unique channel per hook instance so multiple consumers
  // (Sidebar badge + NotificationsScreen) don't reuse a subscribed channel,
  // which would throw "cannot add `postgres_changes` callbacks after `subscribe()`".
  useEffect(() => {
    if (!user) return;
    const suffix = Math.random().toString(36).slice(2, 10);
    const ch = supabase
      .channel(`notifs:${user.id}:${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => void fetchAll(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user, fetchAll]);

  const markRead = useCallback(async (id: string) => {
    setItems((list) =>
      list.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", id);
    if (error) console.error("markRead", error);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    if (error) console.error("markAllRead", error);
  }, [user]);

  const removeOne = useCallback(async (id: string) => {
    setItems((list) => list.filter((n) => n.id !== id));
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id);
    if (error) console.error("removeOne", error);
  }, []);

  const unreadCount = useMemo(
    () => items.filter((n) => !n.read).length,
    [items],
  );

  return { items, unreadCount, markRead, markAllRead, removeOne };
}
