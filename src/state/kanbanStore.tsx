import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  type BrandKey,
  type CardAssignee,
  type CardData,
  type CardMeta,
  type CardPriority,
  type CardTag,
  type ColumnData,
  type ColumnKey,
  type TagColor,
} from "../data/kanban";
import { useAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";
import type { Tables, TablesUpdate } from "../lib/database.types";

export type SortMode = "default" | "date-desc" | "date-asc" | "title-asc";
export type WorkspaceRole = "owner" | "editor" | "viewer" | "translator";

export interface WorkspaceListItem {
  id: string;
  name: string;
  role: WorkspaceRole;
  avatar_url: string | null;
  target_language: string | null;
}

export interface IncomingInvitation {
  id: string;
  workspace_id: string;
  workspace_name: string;
  inviter_name: string | null;
  inviter_email: string | null;
  role: WorkspaceRole;
  target_language: string | null;
  created_at: string;
}

export interface KanbanState {
  // UI state
  columns: ColumnData[];
  focusedId: string | null;
  search: string;
  activeNav: string;
  activeRail: string;
  listsCollapsed: boolean;
  filterTags: TagColor[];
  sort: SortMode;

  // Backend identifiers
  workspaces: WorkspaceListItem[];
  workspaceId: string | null;
  workspaceName: string;
  boardId: string | null;
  boardName: string;
  myRole: WorkspaceRole | null;
  myTargetLanguage: string | null;
  columnIdByKey: Partial<Record<ColumnKey, string>>;
  ready: boolean;

  incomingInvitations: IncomingInvitation[];
}

const DEFAULT_COLUMNS = [
  { key: "todo",     title: "To do",       position: 100 },
  { key: "progress", title: "In progress", position: 200 },
  { key: "review",   title: "Review",      position: 300 },
  { key: "done",     title: "Done",        position: 400 },
];

// User-initiated, persisted to DB
type LocalAction =
  | { type: "MOVE_CARD"; id: string; toColumn: ColumnKey; toIndex: number }
  | { type: "ADD_CARD"; columnKey: ColumnKey; title: string; cardId?: string }
  | { type: "DELETE_CARD"; id: string }
  | { type: "UPDATE_CARD"; id: string; patch: Partial<CardData> }
  | { type: "FOCUS_CARD"; id: string | null }
  | { type: "SET_SEARCH"; value: string }
  | { type: "SET_ACTIVE_NAV"; key: string }
  | { type: "SET_ACTIVE_RAIL"; key: string }
  | { type: "TOGGLE_LISTS" }
  | { type: "TOGGLE_FILTER_TAG"; tag: TagColor }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_SORT"; sort: SortMode }
  | { type: "SET_ACTIVE_WORKSPACE"; id: string };

// Internal/realtime — applied locally, not persisted
type RemoteAction =
  | { type: "SET_WORKSPACES"; list: WorkspaceListItem[] }
  | {
      type: "SET_BOARD";
      workspaceId: string;
      workspaceName: string;
      boardId: string;
      boardName: string;
      myRole: WorkspaceRole;
      myTargetLanguage: string | null;
      columns: ColumnData[];
      columnIdByKey: Partial<Record<ColumnKey, string>>;
    }
  | { type: "REMOTE_UPSERT_CARD"; card: CardData }
  | { type: "REMOTE_DELETE_CARD"; id: string }
  | { type: "LOCAL_PATCH_CARD"; id: string; patch: Partial<CardData> }
  | { type: "SET_INVITATIONS"; list: IncomingInvitation[] };

export type Action = LocalAction | RemoteAction;

const PERSISTABLE_TYPES = new Set([
  "MOVE_CARD",
  "ADD_CARD",
  "DELETE_CARD",
  "UPDATE_CARD",
]);

const initialState: KanbanState = {
  columns: [],
  focusedId: null,
  search: "",
  activeNav: "task",
  activeRail: "",
  listsCollapsed: false,
  filterTags: [],
  sort: "default",
  workspaces: [],
  workspaceId: null,
  workspaceName: "Workspace",
  boardId: null,
  boardName: "Board",
  myRole: null,
  myTargetLanguage: null,
  columnIdByKey: {},
  ready: false,
  incomingInvitations: [],
};

function findCard(
  state: KanbanState,
  id: string,
): { colIdx: number; cardIdx: number; card: CardData } | null {
  for (let i = 0; i < state.columns.length; i++) {
    const idx = state.columns[i].cards.findIndex((c) => c.id === id);
    if (idx >= 0) {
      return { colIdx: i, cardIdx: idx, card: state.columns[i].cards[idx] };
    }
  }
  return null;
}

function reducer(state: KanbanState, action: Action): KanbanState {
  switch (action.type) {
    case "SET_WORKSPACES": {
      const list = action.list;
      // If active workspace was removed, drop it
      const stillActive =
        state.workspaceId && list.some((w) => w.id === state.workspaceId);
      const activeWs = stillActive
        ? list.find((w) => w.id === state.workspaceId)
        : list[0];
      return {
        ...state,
        workspaces: list,
        workspaceId: stillActive ? state.workspaceId : (list[0]?.id ?? null),
        workspaceName: stillActive
          ? state.workspaceName
          : (list[0]?.name ?? "Workspace"),
        myRole: stillActive ? state.myRole : (list[0]?.role ?? null),
        myTargetLanguage: activeWs?.target_language ?? null,
      };
    }

    case "SET_INVITATIONS":
      return { ...state, incomingInvitations: action.list };

    case "SET_ACTIVE_WORKSPACE": {
      if (action.id === state.workspaceId) return state;
      const ws = state.workspaces.find((w) => w.id === action.id);
      return {
        ...state,
        workspaceId: action.id,
        workspaceName: ws?.name ?? state.workspaceName,
        myRole: ws?.role ?? null,
        myTargetLanguage: ws?.target_language ?? null,
        boardId: null,
        columns: [],
        columnIdByKey: {},
        focusedId: null,
        ready: false,
      };
    }

    case "SET_BOARD": {
      return {
        ...state,
        workspaceId: action.workspaceId,
        workspaceName: action.workspaceName,
        boardId: action.boardId,
        boardName: action.boardName,
        myRole: action.myRole,
        myTargetLanguage: action.myTargetLanguage,
        columns: action.columns,
        columnIdByKey: action.columnIdByKey,
        focusedId: state.focusedId ?? action.columns[0]?.cards[0]?.id ?? null,
        ready: true,
      };
    }

    case "MOVE_CARD": {
      const found = findCard(state, action.id);
      if (!found) return state;
      const { colIdx: srcCol, cardIdx: srcIdx, card } = found;

      const removed = state.columns.map((col, i) =>
        i === srcCol
          ? { ...col, cards: col.cards.filter((_, j) => j !== srcIdx) }
          : col,
      );

      const targetColIdx = removed.findIndex((c) => c.key === action.toColumn);
      if (targetColIdx < 0) return state;

      let insertIdx = action.toIndex;
      if (srcCol === targetColIdx && action.toIndex > srcIdx) {
        insertIdx = action.toIndex - 1;
      }
      insertIdx = Math.max(
        0,
        Math.min(insertIdx, removed[targetColIdx].cards.length),
      );

      const movedCard: CardData = {
        ...card,
        columnId: state.columnIdByKey[action.toColumn] ?? card.columnId,
      };

      const finalCols = removed.map((col, i) => {
        if (i !== targetColIdx) return col;
        const cards = [...col.cards];
        cards.splice(insertIdx, 0, movedCard);
        return { ...col, cards };
      });

      return { ...state, columns: finalCols };
    }

    case "ADD_CARD": {
      const id =
        action.cardId ?? globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
      const targetCol = state.columns.find((c) => c.key === action.columnKey);
      const lastPos = targetCol?.cards[targetCol.cards.length - 1]?.position ?? 0;
      const newCard: CardData = {
        id,
        brand: "linear",
        brandFallback: action.title.charAt(0).toUpperCase() || "•",
        title: action.title.trim(),
        subtitle: "",
        tags: [],
        meta: {},
        assignees: [],
        date: new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        position: lastPos + 1024,
        columnId: state.columnIdByKey[action.columnKey],
      };
      return {
        ...state,
        columns: state.columns.map((col) =>
          col.key === action.columnKey
            ? { ...col, cards: [...col.cards, newCard] }
            : col,
        ),
      };
    }

    case "REMOTE_UPSERT_CARD": {
      const incoming = action.card;
      const existing = findCard(state, incoming.id);
      if (existing) {
        const targetColIdx = state.columns.findIndex(
          (c) => c.cards.some((x) => x.id === incoming.id) === true,
        );
        const newColIdx = state.columns.findIndex(
          (c) => state.columnIdByKey[c.key] === incoming.columnId,
        );
        if (newColIdx === -1) return state;

        if (targetColIdx === newColIdx) {
          return {
            ...state,
            columns: state.columns.map((col, i) =>
              i === targetColIdx
                ? {
                    ...col,
                    cards: sortByPosition(
                      col.cards.map((c) =>
                        c.id === incoming.id
                          ? mergePreservingTags(c, incoming)
                          : c,
                      ),
                    ),
                  }
                : col,
            ),
          };
        }
        const withoutOld = state.columns.map((col, i) =>
          i === targetColIdx
            ? { ...col, cards: col.cards.filter((c) => c.id !== incoming.id) }
            : col,
        );
        const moved = mergePreservingTags(existing.card, incoming);
        return {
          ...state,
          columns: withoutOld.map((col, i) =>
            i === newColIdx
              ? { ...col, cards: sortByPosition([...col.cards, moved]) }
              : col,
          ),
        };
      }
      const colIdx = state.columns.findIndex(
        (c) => state.columnIdByKey[c.key] === incoming.columnId,
      );
      if (colIdx < 0) return state;
      return {
        ...state,
        columns: state.columns.map((col, i) =>
          i === colIdx
            ? { ...col, cards: sortByPosition([...col.cards, incoming]) }
            : col,
        ),
      };
    }

    case "REMOTE_DELETE_CARD":
      return {
        ...state,
        focusedId: state.focusedId === action.id ? null : state.focusedId,
        columns: state.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((c) => c.id !== action.id),
        })),
      };

    case "LOCAL_PATCH_CARD":
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) =>
            c.id === action.id ? { ...c, ...action.patch } : c,
          ),
        })),
      };

    case "UPDATE_CARD":
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) =>
            c.id === action.id ? { ...c, ...action.patch } : c,
          ),
        })),
      };

    case "DELETE_CARD":
      return {
        ...state,
        focusedId: state.focusedId === action.id ? null : state.focusedId,
        columns: state.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((c) => c.id !== action.id),
        })),
      };

    case "FOCUS_CARD":
      return { ...state, focusedId: action.id };
    case "SET_SEARCH":
      return { ...state, search: action.value };
    case "SET_ACTIVE_NAV":
      return { ...state, activeNav: action.key };
    case "SET_ACTIVE_RAIL":
      return { ...state, activeRail: action.key };
    case "TOGGLE_LISTS":
      return { ...state, listsCollapsed: !state.listsCollapsed };
    case "TOGGLE_FILTER_TAG": {
      const exists = state.filterTags.includes(action.tag);
      return {
        ...state,
        filterTags: exists
          ? state.filterTags.filter((t) => t !== action.tag)
          : [...state.filterTags, action.tag],
      };
    }
    case "CLEAR_FILTERS":
      return { ...state, filterTags: [], search: "" };
    case "SET_SORT":
      return { ...state, sort: action.sort };
    default:
      return state;
  }
}

function mergePreservingTags(local: CardData, incoming: CardData): CardData {
  return {
    ...incoming,
    tags: incoming.tags.length > 0 ? incoming.tags : local.tags,
  };
}

function sortByPosition(cards: CardData[]): CardData[] {
  return [...cards].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const msg = typeof obj.message === "string" ? obj.message : null;
    const code = typeof obj.code === "string" ? obj.code : null;
    const details = typeof obj.details === "string" ? obj.details : null;
    const hint = typeof obj.hint === "string" ? obj.hint : null;
    const parts = [msg, code && `(${code})`, details, hint].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }
  return String(e);
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const KanbanCtx = createContext<{
  state: KanbanState;
  dispatch: Dispatch<Action>;
  refreshWorkspaces: () => Promise<void>;
  refreshInvitations: () => Promise<void>;
  createWorkspace: (name: string) => Promise<string | null>;
  updateWorkspace: (
    id: string,
    patch: { name?: string; avatar_url?: string | null },
  ) => Promise<void>;
  uploadWorkspaceAvatar: (
    workspaceId: string,
    file: File,
  ) => Promise<string | null>;
  removeWorkspaceAvatar: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  renameBoard: (name: string) => Promise<void>;
  addColumn: (title: string) => Promise<void>;
  renameColumn: (columnId: string, title: string) => Promise<void>;
  deleteColumn: (columnId: string) => Promise<void>;
} | null>(null);

export function KanbanProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, baseDispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [bootError, setBootError] = useState<string | null>(null);
  // Dedupes concurrent bootstrap calls (React StrictMode double-effects in dev).
  const creatingRef = useRef<Promise<{ id: string; name: string } | null> | null>(
    null,
  );

  // ============================================================
  // Workspaces list (with auto-bootstrap of first workspace)
  // ============================================================
  const refreshWorkspaces = useCallback(async () => {
    if (!user) return;
    try {
      const [{ data: ws, error: wsErr }, { data: mems, error: mErr }] =
        await Promise.all([
          supabase
            .from("workspaces")
            .select("id, name, avatar_url")
            .order("created_at", { ascending: true }),
          supabase
            .from("workspace_members")
            .select("workspace_id, role, target_language")
            .eq("user_id", user.id),
        ]);
      if (wsErr) throw wsErr;
      if (mErr) throw mErr;

      const roleByWs = new Map<string, WorkspaceRole>();
      const langByWs = new Map<string, string | null>();
      for (const m of mems ?? []) {
        roleByWs.set(m.workspace_id, m.role as WorkspaceRole);
        langByWs.set(m.workspace_id, m.target_language ?? null);
      }
      const list: WorkspaceListItem[] = (ws ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        role: roleByWs.get(w.id) ?? "viewer",
        avatar_url: w.avatar_url ?? null,
        target_language: langByWs.get(w.id) ?? null,
      }));

      if (list.length === 0) {
        const userName =
          (user.user_metadata?.name as string | undefined) ??
          user.email?.split("@")[0] ??
          "Me";

        // Dedupe concurrent bootstrap attempts (StrictMode double-effects).
        if (!creatingRef.current) {
          creatingRef.current = (async () => {
            try {
              const { data, error } = await supabase.rpc("create_workspace", {
                _name: `${userName}'s Workspace`,
              });
              if (error) throw error;
              return data ? { id: data.id, name: data.name } : null;
            } finally {
              creatingRef.current = null;
            }
          })();
        }
        const created = await creatingRef.current;
        if (created) {
          list.push({
            id: created.id,
            name: created.name,
            role: "owner",
            avatar_url: null,
            target_language: null,
          });
        }
      }

      baseDispatch({ type: "SET_WORKSPACES", list });
    } catch (e) {
      console.error("refreshWorkspaces failed", e);
      setBootError(formatError(e));
    }
  }, [user]);

  useEffect(() => {
    if (user) void refreshWorkspaces();
  }, [user, refreshWorkspaces]);

  // Live-update workspaces when membership changes (added/removed by others).
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`memberships:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_members",
          filter: `user_id=eq.${user.id}`,
        },
        () => void refreshWorkspaces(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user, refreshWorkspaces]);

  // ============================================================
  // Incoming invitations (single subscription, multiple consumers)
  // ============================================================
  const refreshInvitations = useCallback(async () => {
    if (!user) {
      baseDispatch({ type: "SET_INVITATIONS", list: [] });
      return;
    }
    const { data, error } = await supabase
      .from("workspace_invitations")
      .select(
        "id, workspace_id, role, target_language, created_at, workspaces(name), profiles!workspace_invitations_invited_by_fkey(name, email)",
      )
      .order("created_at", { ascending: false });
    if (error) {
      console.error("invitations fetch failed", error);
      return;
    }
    type Row = {
      id: string;
      workspace_id: string;
      role: WorkspaceRole;
      target_language: string | null;
      created_at: string;
      workspaces: { name: string } | null;
      profiles: { name: string | null; email: string | null } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    const myWsIds = new Set(stateRef.current.workspaces.map((w) => w.id));
    const list: IncomingInvitation[] = rows
      .filter((r) => !myWsIds.has(r.workspace_id))
      .map((r) => ({
        id: r.id,
        workspace_id: r.workspace_id,
        workspace_name: r.workspaces?.name ?? "Workspace",
        inviter_name: r.profiles?.name ?? null,
        inviter_email: r.profiles?.email ?? null,
        role: r.role,
        target_language: r.target_language ?? null,
        created_at: r.created_at,
      }));
    baseDispatch({ type: "SET_INVITATIONS", list });
  }, [user]);

  useEffect(() => {
    if (user) void refreshInvitations();
  }, [user, refreshInvitations]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`invites_user:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_invitations",
        },
        () => void refreshInvitations(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user, refreshInvitations]);

  // ============================================================
  // Load board for the active workspace
  // ============================================================
  const loadBoard = useCallback(
    async (workspaceId: string) => {
      if (!user) return;
      try {
        const ws = stateRef.current.workspaces.find(
          (w) => w.id === workspaceId,
        );
        const workspaceName = ws?.name ?? "Workspace";
        const myRole: WorkspaceRole = ws?.role ?? "viewer";
        const myTargetLanguage: string | null = ws?.target_language ?? null;

        // Find or create board
        const { data: boards, error: bErr } = await supabase
          .from("boards")
          .select("id, name")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: true })
          .limit(1);
        if (bErr) throw bErr;

        let boardId: string;
        let boardName: string;
        if (boards && boards.length > 0) {
          boardId = boards[0].id;
          boardName = boards[0].name;
        } else {
          const { data: b, error: insErr } = await supabase
            .from("boards")
            .insert({ workspace_id: workspaceId, name: "Main Board" })
            .select("id, name")
            .single();
          if (insErr || !b) throw insErr ?? new Error("board insert failed");
          boardId = b.id;
          boardName = b.name;
        }

        // Ensure 4 default columns
        const { data: existingCols, error: cErr } = await supabase
          .from("columns")
          .select("key")
          .eq("board_id", boardId);
        if (cErr) throw cErr;
        const existingKeys = new Set((existingCols ?? []).map((c) => c.key));
        const toCreate = DEFAULT_COLUMNS.filter(
          (c) => !existingKeys.has(c.key),
        );
        if (toCreate.length > 0) {
          const { error: colInsErr } = await supabase
            .from("columns")
            .insert(toCreate.map((c) => ({ board_id: boardId, ...c })));
          if (colInsErr) throw colInsErr;
        }

        const { data: cols, error: colsErr } = await supabase
          .from("columns")
          .select(
            `
            id, key, title, position,
            cards (
              id, title, subtitle, description, brand, brand_fallback,
              due_date, position, meta, column_id,
              card_tags ( tags ( id, label, color ) ),
              card_assignees ( user_id, profiles!card_assignees_user_id_fkey ( id, name, email ) ),
              priority
            )
          `,
          )
          .eq("board_id", boardId)
          .order("position", { ascending: true });
        if (colsErr) throw colsErr;

        const columns: ColumnData[] = (cols ?? []).map((col) => ({
          id: col.id,
          key: col.key as ColumnKey,
          title: col.title,
          cards: sortByPosition(
            (col.cards ?? []).map((c) => mapDbCard(c, col.id)),
          ),
        }));
        const columnIdByKey: Partial<Record<ColumnKey, string>> = {};
        for (const col of cols ?? []) {
          columnIdByKey[col.key as ColumnKey] = col.id;
        }

        // If the user has already switched to another workspace while this
        // request was in flight, drop the stale result — otherwise the late
        // SET_BOARD overwrites workspaceId back to the previous selection
        // and looks like the rail "auto-switches" by itself.
        if (stateRef.current.workspaceId !== workspaceId) return;

        baseDispatch({
          type: "SET_BOARD",
          workspaceId,
          workspaceName,
          boardId,
          boardName,
          myRole,
          myTargetLanguage,
          columns,
          columnIdByKey,
        });
      } catch (e) {
        console.error("loadBoard failed", e);
        setBootError(formatError(e));
      }
    },
    [user],
  );

  useEffect(() => {
    if (user && state.workspaceId) {
      void loadBoard(state.workspaceId);
    }
  }, [user, state.workspaceId, loadBoard]);

  // ============================================================
  // Realtime subscription for cards + card_tags on the active board
  // ============================================================
  useEffect(() => {
    if (!state.boardId) return;
    const boardId = state.boardId;

    const refreshCardTags = async (cardId: string) => {
      const board = stateRef.current;
      const cardExists = board.columns.some((col) =>
        col.cards.some((c) => c.id === cardId),
      );
      if (!cardExists) return;
      const { data } = await supabase
        .from("card_tags")
        .select("tags(id, label, color)")
        .eq("card_id", cardId);
      const tags: CardTag[] = ((data ?? []) as Array<{
        tags: { id: string; label: string; color: string } | null;
      }>)
        .map((r) => r.tags)
        .filter(
          (t): t is { id: string; label: string; color: string } => t !== null,
        )
        .map((t) => ({ label: t.label, color: t.color as TagColor }));
      baseDispatch({ type: "LOCAL_PATCH_CARD", id: cardId, patch: { tags } });
    };

    const refreshCardAssignees = async (cardId: string) => {
      const board = stateRef.current;
      const cardExists = board.columns.some((col) =>
        col.cards.some((c) => c.id === cardId),
      );
      if (!cardExists) return;
      const { data } = await supabase
        .from("card_assignees")
        .select(
          "user_id, profiles!card_assignees_user_id_fkey(id, name, email)",
        )
        .eq("card_id", cardId);
      type Row = {
        user_id: string;
        profiles: { id: string; name: string | null; email: string | null } | null;
      };
      const rows = (data ?? []) as unknown as Row[];
      const assignees: CardAssignee[] = rows
        .filter((r) => r.profiles !== null)
        .map((r) => ({
          user_id: r.user_id,
          name: r.profiles!.name,
          email: r.profiles!.email,
        }));
      baseDispatch({
        type: "LOCAL_PATCH_CARD",
        id: cardId,
        patch: { assignees },
      });
    };

    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "boards",
          filter: `id=eq.${boardId}`,
        },
        (
          payload: RealtimePostgresChangesPayload<Tables<"boards">>,
        ) => {
          if (payload.eventType === "UPDATE") {
            const row = payload.new as Tables<"boards">;
            baseDispatch({
              type: "SET_BOARD",
              workspaceId: stateRef.current.workspaceId ?? "",
              workspaceName: stateRef.current.workspaceName,
              boardId: row.id,
              boardName: row.name,
              myRole: stateRef.current.myRole ?? "viewer",
              myTargetLanguage: stateRef.current.myTargetLanguage,
              columns: stateRef.current.columns,
              columnIdByKey: stateRef.current.columnIdByKey,
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "columns",
          filter: `board_id=eq.${boardId}`,
        },
        () => {
          // Refetch the whole board to re-derive columns + columnIdByKey.
          // Column events are rare, full refetch is cheap and keeps
          // ordering / cards-mapping consistent.
          if (user && stateRef.current.workspaceId) {
            void loadBoard(stateRef.current.workspaceId);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cards",
          filter: `board_id=eq.${boardId}`,
        },
        (payload: RealtimePostgresChangesPayload<Tables<"cards">>) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as Tables<"cards"> | null)?.id;
            if (id) baseDispatch({ type: "REMOTE_DELETE_CARD", id });
            return;
          }
          const row = payload.new as Tables<"cards">;
          const ck = stateRef.current;
          const colId = row.column_id;
          const knownColKey = (
            Object.entries(ck.columnIdByKey) as [ColumnKey, string][]
          ).find(([, v]) => v === colId)?.[0];
          if (!knownColKey) return;
          const card = mapDbCard(row, colId);
          baseDispatch({ type: "REMOTE_UPSERT_CARD", card });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card_tags" },
        (
          payload: RealtimePostgresChangesPayload<Tables<"card_tags">>,
        ) => {
          const row = (payload.new ?? payload.old) as
            | Tables<"card_tags">
            | null;
          if (row?.card_id) void refreshCardTags(row.card_id);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card_assignees" },
        (
          payload: RealtimePostgresChangesPayload<Tables<"card_assignees">>,
        ) => {
          const row = (payload.new ?? payload.old) as
            | Tables<"card_assignees">
            | null;
          if (row?.card_id) void refreshCardAssignees(row.card_id);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [state.boardId]);

  // ============================================================
  // Persist layer
  // ============================================================
  const dispatch: Dispatch<Action> = useCallback(
    (action) => {
      let normalized: Action = action;
      if (action.type === "ADD_CARD" && !action.cardId) {
        normalized = {
          ...action,
          cardId: globalThis.crypto?.randomUUID?.() ?? fallbackUuid(),
        };
      }
      baseDispatch(normalized);
      if (PERSISTABLE_TYPES.has(normalized.type)) {
        void persistAction(
          normalized as LocalAction,
          stateRef.current,
          user?.id,
        );
      }
    },
    [user?.id],
  );

  // ============================================================
  // Board / column management
  // ============================================================
  const renameBoard = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!stateRef.current.boardId || !trimmed) return;
      const { error } = await supabase
        .from("boards")
        .update({ name: trimmed })
        .eq("id", stateRef.current.boardId);
      if (error) console.error("renameBoard", error);
    },
    [],
  );

  const addColumn = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!stateRef.current.boardId || !trimmed) return;
    const cols = stateRef.current.columns;
    const lastPos = cols[cols.length - 1]
      ? // find the existing position max — we keep position aligned with
        // the order we render, so use the count * 100 as a safe upper bound
        (cols.length + 1) * 1000
      : 100;
    // Generate a unique slug-like key
    const slug =
      trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24) || "col";
    const key = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    const { error } = await supabase.from("columns").insert({
      board_id: stateRef.current.boardId,
      key,
      title: trimmed,
      position: lastPos,
    });
    if (error) console.error("addColumn", error);
  }, []);

  const renameColumn = useCallback(
    async (columnId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const { error } = await supabase
        .from("columns")
        .update({ title: trimmed })
        .eq("id", columnId);
      if (error) console.error("renameColumn", error);
    },
    [],
  );

  const deleteColumn = useCallback(async (columnId: string) => {
    const { error } = await supabase
      .from("columns")
      .delete()
      .eq("id", columnId);
    if (error) console.error("deleteColumn", error);
  }, []);

  const createWorkspace = useCallback(
    async (name: string): Promise<string | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const { data, error } = await supabase.rpc("create_workspace", {
        _name: trimmed,
      });
      if (error) {
        console.error("createWorkspace failed", error);
        return null;
      }
      await refreshWorkspaces();
      if (data) baseDispatch({ type: "SET_ACTIVE_WORKSPACE", id: data.id });
      return data?.id ?? null;
    },
    [refreshWorkspaces],
  );

  const updateWorkspace = useCallback(
    async (id: string, patch: { name?: string; avatar_url?: string | null }) => {
      const { error } = await supabase
        .from("workspaces")
        .update(patch)
        .eq("id", id);
      if (error) {
        console.error("updateWorkspace failed", error);
        return;
      }
      await refreshWorkspaces();
    },
    [refreshWorkspaces],
  );

  const uploadWorkspaceAvatar = useCallback(
    async (workspaceId: string, file: File): Promise<string | null> => {
      if (!user) return null;
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${workspaceId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("workspace-avatars")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "image/png",
        });
      if (upErr) {
        console.error("uploadWorkspaceAvatar upload", upErr);
        return null;
      }
      const { data } = supabase.storage
        .from("workspace-avatars")
        .getPublicUrl(path);
      const url = data.publicUrl;
      await updateWorkspace(workspaceId, { avatar_url: url });
      return url;
    },
    [user, updateWorkspace],
  );

  const removeWorkspaceAvatar = useCallback(
    async (workspaceId: string) => {
      await updateWorkspace(workspaceId, { avatar_url: null });
    },
    [updateWorkspace],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("workspaces").delete().eq("id", id);
      if (error) {
        console.error("deleteWorkspace failed", error);
        return;
      }
      await refreshWorkspaces();
    },
    [refreshWorkspaces],
  );

  const value = useMemo(
    () => ({
      state,
      dispatch,
      refreshWorkspaces,
      refreshInvitations,
      createWorkspace,
      updateWorkspace,
      uploadWorkspaceAvatar,
      removeWorkspaceAvatar,
      deleteWorkspace,
      renameBoard,
      addColumn,
      renameColumn,
      deleteColumn,
    }),
    [
      state,
      dispatch,
      refreshWorkspaces,
      refreshInvitations,
      createWorkspace,
      updateWorkspace,
      uploadWorkspaceAvatar,
      removeWorkspaceAvatar,
      deleteWorkspace,
      renameBoard,
      addColumn,
      renameColumn,
      deleteColumn,
    ],
  );

  if (bootError) {
    return (
      <div className="app-splash" style={{ flexDirection: "column", gap: 8 }}>
        <div>Failed to load workspace</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>{bootError}</div>
      </div>
    );
  }

  return <KanbanCtx.Provider value={value}>{children}</KanbanCtx.Provider>;
}

export function useKanban() {
  const v = useContext(KanbanCtx);
  if (!v) throw new Error("useKanban must be used within KanbanProvider");
  return v;
}

// ============================================================
// Helpers
// ============================================================

type DbCardRow = Pick<
  Tables<"cards">,
  | "id"
  | "title"
  | "subtitle"
  | "description"
  | "brand"
  | "brand_fallback"
  | "due_date"
  | "position"
  | "meta"
  | "column_id"
  | "priority"
> & {
  card_tags?: Array<{
    tags: { id: string; label: string; color: string } | null;
  }>;
  card_assignees?: Array<{
    user_id: string;
    profiles: { id: string; name: string | null; email: string | null } | null;
  }>;
};

function mapDbCard(row: DbCardRow, columnId: string): CardData {
  const tags: CardTag[] = (row.card_tags ?? [])
    .map((ct) => ct.tags)
    .filter(
      (t): t is { id: string; label: string; color: string } => t !== null,
    )
    .map((t) => ({ label: t.label, color: t.color as TagColor }));
  const assignees: CardAssignee[] = (row.card_assignees ?? [])
    .filter((a) => a.profiles !== null)
    .map((a) => ({
      user_id: a.user_id,
      name: a.profiles!.name,
      email: a.profiles!.email,
    }));
  const meta = (row.meta ?? {}) as CardMeta;
  return {
    id: row.id,
    brand: (row.brand as BrandKey) ?? "linear",
    brandFallback: row.brand_fallback ?? undefined,
    title: row.title,
    subtitle: row.subtitle ?? "",
    tags,
    meta,
    assignees,
    date: row.due_date ?? "",
    description: row.description ?? undefined,
    priority: (row.priority as CardPriority | null) ?? undefined,
    position: row.position,
    columnId,
  };
}

async function persistAction(
  action: LocalAction,
  state: KanbanState,
  userId: string | undefined,
): Promise<void> {
  if (!state.boardId) return;

  switch (action.type) {
    case "ADD_CARD": {
      const cardId = action.cardId;
      if (!cardId) {
        console.error("ADD_CARD persist: missing cardId");
        return;
      }
      const columnId = state.columnIdByKey[action.columnKey];
      if (!columnId) {
        console.error("ADD_CARD persist: unknown column", action.columnKey);
        return;
      }
      const targetCol = state.columns.find((c) => c.key === action.columnKey);
      const lastPos =
        targetCol?.cards[targetCol.cards.length - 1]?.position ?? 0;
      const todayLabel = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const { error } = await supabase.from("cards").insert({
        id: cardId,
        board_id: state.boardId,
        column_id: columnId,
        title: action.title.trim(),
        subtitle: "",
        brand: "linear",
        brand_fallback: action.title.charAt(0).toUpperCase() || "•",
        due_date: todayLabel,
        position: lastPos + 1024,
        meta: {} as never,
        created_by: userId ?? null,
      });
      if (error) console.error("ADD_CARD persist failed", error);
      return;
    }
    case "DELETE_CARD": {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("id", action.id);
      if (error) console.error("DELETE_CARD persist failed", error);
      return;
    }
    case "UPDATE_CARD": {
      const patch = action.patch;
      const dbPatch: TablesUpdate<"cards"> = {};
      if (patch.title !== undefined) dbPatch.title = patch.title;
      if (patch.subtitle !== undefined) dbPatch.subtitle = patch.subtitle;
      if (patch.description !== undefined)
        dbPatch.description = patch.description;
      if (patch.brand !== undefined) dbPatch.brand = patch.brand;
      if (patch.brandFallback !== undefined)
        dbPatch.brand_fallback = patch.brandFallback;
      if (patch.date !== undefined) dbPatch.due_date = patch.date;
      if (patch.meta !== undefined) dbPatch.meta = patch.meta as never;
      if (patch.priority !== undefined)
        dbPatch.priority = patch.priority ?? null;
      if (Object.keys(dbPatch).length === 0) return;
      const { error } = await supabase
        .from("cards")
        .update(dbPatch)
        .eq("id", action.id);
      if (error) console.error("UPDATE_CARD persist failed", error);
      return;
    }
    case "MOVE_CARD": {
      const targetColumnId = state.columnIdByKey[action.toColumn];
      if (!targetColumnId) return;
      const found = findCard(state, action.id);
      if (!found) return;
      const sim = simulateMove(state, action);
      const targetCol = sim.find((c) => c.key === action.toColumn);
      if (!targetCol) return;
      const idx = targetCol.cards.findIndex((c) => c.id === action.id);
      const before = targetCol.cards[idx - 1]?.position ?? null;
      const after = targetCol.cards[idx + 1]?.position ?? null;
      const newPos = computePosition(before, after);
      const { error } = await supabase
        .from("cards")
        .update({ column_id: targetColumnId, position: newPos })
        .eq("id", action.id);
      if (error) console.error("MOVE_CARD persist failed", error);
      return;
    }
    default:
      return;
  }
}

function simulateMove(
  state: KanbanState,
  action: { type: "MOVE_CARD"; id: string; toColumn: ColumnKey; toIndex: number },
): ColumnData[] {
  const found = findCard(state, action.id);
  if (!found) return state.columns;
  const removed = state.columns.map((col, i) =>
    i === found.colIdx
      ? { ...col, cards: col.cards.filter((_, j) => j !== found.cardIdx) }
      : col,
  );
  const targetColIdx = removed.findIndex((c) => c.key === action.toColumn);
  if (targetColIdx < 0) return removed;
  let insertIdx = action.toIndex;
  if (found.colIdx === targetColIdx && action.toIndex > found.cardIdx) {
    insertIdx = action.toIndex - 1;
  }
  insertIdx = Math.max(
    0,
    Math.min(insertIdx, removed[targetColIdx].cards.length),
  );
  return removed.map((col, i) => {
    if (i !== targetColIdx) return col;
    const cards = [...col.cards];
    cards.splice(insertIdx, 0, found.card);
    return { ...col, cards };
  });
}

function computePosition(before: number | null, after: number | null): number {
  if (before == null && after == null) return 1024;
  if (before == null) return (after ?? 0) - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

// ============================================================
// Public selectors
// ============================================================
export function findCardWithColumn(
  state: KanbanState,
  id: string | null,
): { card: CardData; column: ColumnData } | null {
  if (!id) return null;
  for (const col of state.columns) {
    const c = col.cards.find((x) => x.id === id);
    if (c) return { card: c, column: col };
  }
  return null;
}

export function applyFilters(
  cols: ColumnData[],
  state: KanbanState,
): ColumnData[] {
  const { search, filterTags, sort } = state;
  const q = search.trim().toLowerCase();
  const sorted = (cards: CardData[]) => {
    if (sort === "default") return cards;
    const copy = [...cards];
    if (sort === "title-asc") {
      copy.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      copy.sort((a, b) => {
        const da = Date.parse(a.date);
        const db = Date.parse(b.date);
        return sort === "date-desc" ? db - da : da - db;
      });
    }
    return copy;
  };

  return cols.map((col) => {
    let cards = col.cards;
    if (q) {
      cards = cards.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.subtitle.toLowerCase().includes(q) ||
          c.tags.some((t) => t.label.toLowerCase().includes(q)),
      );
    }
    if (filterTags.length > 0) {
      cards = cards.filter((c) =>
        c.tags.some((t) => filterTags.includes(t.color)),
      );
    }
    return { ...col, cards: sorted(cards) };
  });
}
