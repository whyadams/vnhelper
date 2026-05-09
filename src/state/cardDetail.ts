import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { useKanban } from "./kanbanStore";
import type { TagColor } from "../data/kanban";

export interface SubtaskRow {
  id: string;
  label: string;
  done: boolean;
  position: number;
  created_at: string;
}

export interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author: { id: string; name: string | null; email: string | null } | null;
}

export interface BoardTag {
  id: string;
  label: string;
  color: TagColor;
}

export interface CardTagOnCard {
  tag_id: string;
  label: string;
  color: TagColor;
}

export interface WorkspaceMemberInfo {
  user_id: string;
  name: string | null;
  email: string | null;
}

const TAG_COLORS: TagColor[] = [
  "pink",
  "green",
  "amber",
  "violet",
  "sky",
  "rose",
  "teal",
];

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

export function useCardDetail(cardId: string | null, boardId: string | null) {
  const { user } = useAuth();
  const { state } = useKanban();
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [cardTags, setCardTags] = useState<CardTagOnCard[]>([]);
  const [boardTags, setBoardTags] = useState<BoardTag[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<
    WorkspaceMemberInfo[]
  >([]);

  // ---------- fetchers ----------
  const fetchSubtasks = useCallback(async () => {
    if (!cardId) return;
    const { data } = await supabase
      .from("card_subtasks")
      .select("id, label, done, position, created_at")
      .eq("card_id", cardId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    setSubtasks((data ?? []) as SubtaskRow[]);
  }, [cardId]);

  const fetchComments = useCallback(async () => {
    if (!cardId) return;
    const { data } = await supabase
      .from("card_comments")
      .select(
        "id, body, created_at, author_id, profiles:author_id(id, name, email)",
      )
      .eq("card_id", cardId)
      .order("created_at", { ascending: true });
    type Row = {
      id: string;
      body: string;
      created_at: string;
      author_id: string;
      profiles: { id: string; name: string | null; email: string | null } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    setComments(
      rows.map((r) => ({
        id: r.id,
        body: r.body,
        created_at: r.created_at,
        author_id: r.author_id,
        author: r.profiles,
      })),
    );
  }, [cardId]);

  const fetchCardTags = useCallback(async () => {
    if (!cardId) return;
    const { data } = await supabase
      .from("card_tags")
      .select("tag_id, tags(id, label, color)")
      .eq("card_id", cardId);
    type Row = {
      tag_id: string;
      tags: { id: string; label: string; color: string } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    setCardTags(
      rows
        .filter((r) => r.tags !== null)
        .map((r) => ({
          tag_id: r.tag_id,
          label: r.tags!.label,
          color: r.tags!.color as TagColor,
        })),
    );
  }, [cardId]);

  const fetchBoardTags = useCallback(async () => {
    if (!boardId) return;
    const { data } = await supabase
      .from("tags")
      .select("id, label, color")
      .eq("board_id", boardId)
      .order("label", { ascending: true });
    setBoardTags(
      (data ?? []).map((t) => ({
        id: t.id,
        label: t.label,
        color: t.color as TagColor,
      })),
    );
  }, [boardId]);

  const fetchWorkspaceMembers = useCallback(async () => {
    if (!state.workspaceId) return;
    const { data } = await supabase
      .from("workspace_members")
      .select(
        "user_id, profiles!workspace_members_user_id_fkey(id, name, email)",
      )
      .eq("workspace_id", state.workspaceId);
    type Row = {
      user_id: string;
      profiles: { id: string; name: string | null; email: string | null } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    setWorkspaceMembers(
      rows
        .filter((r) => r.profiles !== null)
        .map((r) => ({
          user_id: r.user_id,
          name: r.profiles!.name,
          email: r.profiles!.email,
        })),
    );
  }, [state.workspaceId]);

  // ---------- initial load on cardId change ----------
  // Synchronously wipe per-card state on every cardId change so the previous
  // card's subtasks/comments/tags don't flash while the new fetch lands.
  useEffect(() => {
    setSubtasks([]);
    setComments([]);
    setCardTags([]);
    if (!cardId) return;
    void fetchSubtasks();
    void fetchComments();
    void fetchCardTags();
  }, [cardId, fetchSubtasks, fetchComments, fetchCardTags]);

  useEffect(() => {
    setBoardTags([]);
    if (boardId) void fetchBoardTags();
  }, [boardId, fetchBoardTags]);

  useEffect(() => {
    setWorkspaceMembers([]);
    if (cardId) void fetchWorkspaceMembers();
  }, [cardId, fetchWorkspaceMembers]);

  // ---------- realtime subscriptions per focused card ----------
  useEffect(() => {
    if (!cardId) return;
    const ch = supabase
      .channel(`card:${cardId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "card_subtasks",
          filter: `card_id=eq.${cardId}`,
        },
        () => void fetchSubtasks(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "card_comments",
          filter: `card_id=eq.${cardId}`,
        },
        () => void fetchComments(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "card_tags",
          filter: `card_id=eq.${cardId}`,
        },
        () => void fetchCardTags(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [cardId, fetchSubtasks, fetchComments, fetchCardTags]);

  useEffect(() => {
    if (!boardId) return;
    const ch = supabase
      .channel(`tags:${boardId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tags",
          filter: `board_id=eq.${boardId}`,
        },
        () => void fetchBoardTags(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [boardId, fetchBoardTags]);

  // ---------- mutations ----------
  const addSubtask = useCallback(
    async (label: string) => {
      const trimmed = label.trim();
      if (!trimmed || !cardId) return;
      const nextPos =
        (subtasks[subtasks.length - 1]?.position ?? 0) + 1024;
      const { error } = await supabase.from("card_subtasks").insert({
        id: newUuid(),
        card_id: cardId,
        label: trimmed,
        position: nextPos,
        created_by: user?.id ?? null,
      });
      if (error) console.error("addSubtask failed", error);
    },
    [cardId, subtasks, user?.id],
  );

  const toggleSubtask = useCallback(
    async (id: string, done: boolean) => {
      // Optimistic
      setSubtasks((list) =>
        list.map((s) => (s.id === id ? { ...s, done } : s)),
      );
      const { error } = await supabase
        .from("card_subtasks")
        .update({ done })
        .eq("id", id);
      if (error) console.error("toggleSubtask failed", error);
    },
    [],
  );

  const renameSubtask = useCallback(async (id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const { error } = await supabase
      .from("card_subtasks")
      .update({ label: trimmed })
      .eq("id", id);
    if (error) console.error("renameSubtask failed", error);
  }, []);

  const deleteSubtask = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("card_subtasks")
      .delete()
      .eq("id", id);
    if (error) console.error("deleteSubtask failed", error);
  }, []);

  const addComment = useCallback(
    async (body: string, mentionedUserIds: string[] = []) => {
      const trimmed = body.trim();
      if (!trimmed || !cardId || !user) return;
      const { error } = await supabase.from("card_comments").insert({
        id: newUuid(),
        card_id: cardId,
        author_id: user.id,
        body: trimmed,
        mentioned_user_ids: mentionedUserIds.length > 0
          ? mentionedUserIds
          : undefined,
      });
      if (error) console.error("addComment failed", error);
    },
    [cardId, user],
  );

  const deleteComment = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("card_comments")
      .delete()
      .eq("id", id);
    if (error) console.error("deleteComment failed", error);
  }, []);

  const applyTag = useCallback(
    async (tagId: string) => {
      if (!cardId) return;
      const { error } = await supabase
        .from("card_tags")
        .insert({ card_id: cardId, tag_id: tagId });
      if (error && error.code !== "23505") console.error("applyTag", error);
    },
    [cardId],
  );

  const removeTag = useCallback(
    async (tagId: string) => {
      if (!cardId) return;
      const { error } = await supabase
        .from("card_tags")
        .delete()
        .eq("card_id", cardId)
        .eq("tag_id", tagId);
      if (error) console.error("removeTag failed", error);
    },
    [cardId],
  );

  const assignMember = useCallback(
    async (userId: string) => {
      if (!cardId) return;
      const { error } = await supabase.from("card_assignees").insert({
        card_id: cardId,
        user_id: userId,
        assigned_by: user?.id ?? null,
      });
      if (error && error.code !== "23505") {
        console.error("assignMember failed", error);
      }
    },
    [cardId, user?.id],
  );

  const unassignMember = useCallback(
    async (userId: string) => {
      if (!cardId) return;
      const { error } = await supabase
        .from("card_assignees")
        .delete()
        .eq("card_id", cardId)
        .eq("user_id", userId);
      if (error) console.error("unassignMember failed", error);
    },
    [cardId],
  );

  const createAndApplyTag = useCallback(
    async (label: string, color?: TagColor) => {
      if (!cardId || !boardId) return;
      const trimmed = label.trim();
      if (!trimmed) return;
      const chosenColor =
        color ?? TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      const { data, error } = await supabase
        .from("tags")
        .insert({ board_id: boardId, label: trimmed, color: chosenColor })
        .select("id")
        .single();
      if (error || !data) {
        // 23505 unique violation → tag with same label exists; fetch it
        if (error?.code === "23505") {
          const { data: existing } = await supabase
            .from("tags")
            .select("id")
            .eq("board_id", boardId)
            .eq("label", trimmed)
            .single();
          if (existing) await applyTag(existing.id);
        } else {
          console.error("createAndApplyTag", error);
        }
        return;
      }
      await applyTag(data.id);
    },
    [boardId, cardId, applyTag],
  );

  return {
    subtasks,
    comments,
    cardTags,
    boardTags,
    workspaceMembers,
    addSubtask,
    toggleSubtask,
    renameSubtask,
    deleteSubtask,
    addComment,
    deleteComment,
    applyTag,
    removeTag,
    createAndApplyTag,
    assignMember,
    unassignMember,
  };
}
