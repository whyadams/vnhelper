import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import type { Json } from "../lib/database.types";
import type { RpyBlocks } from "../lib/renpy/blocks";

export type NodeKind = "chapter" | "scene" | "block";
export type ScriptContent = Json;

/** Origin of a scene's Renpy-blocks: authored in VnHelper, or imported from .rpy. */
export type ScriptSourceKind = "vnhelper" | "rpy_import";

export interface ScriptProject {
  id: string;
  workspace_id: string;
  title: string;
  synopsis: string;
  cover_emoji: string | null;
  cover_image_url: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ScriptNodeSummary {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: NodeKind;
  title: string;
  emoji: string | null;
  pinned: boolean;
  position: number;
  status: string;
  pov: string | null;
  location_id: string | null;
  tags: string[];
  /** Project-unique Ren'Py label — used for jump/call autocompletion across
   * the editor without having to fetch each scene's full body. */
  rpy_label: string | null;
  updated_at: string;
}

export interface ScriptNodeFull extends ScriptNodeSummary {
  body: string;
  /** Doc-tab content (TipTap doc). Independent from `rpy_blocks`. */
  content: ScriptContent | null;
  /** Renpy-tab content (structured Ren'Py blocks). Independent from `content`. */
  rpy_blocks: RpyBlocks | null;
  /** Project-unique Ren'Py label for this scene. Used by Graph to resolve jumps. */
  rpy_label: string | null;
  /** Where this scene's `rpy_blocks` came from. */
  source_kind: ScriptSourceKind;
  workspace_id: string;
  created_by: string | null;
  created_at: string;
}

export interface ScriptCharacter {
  id: string;
  project_id: string;
  workspace_id?: string;
  name: string;
  short_name: string | null;
  /** Ren'Py variable name (e.g. "mc", "eileen"). Project-unique. Falls back
   * to a slug of `name` at serialise time when null. */
  rpy_var: string | null;
  color: string;
  emoji: string | null;
  pronouns: string | null;
  age: string | null;
  role: string | null;
  voice_notes: string;
  traits: Json;
  aliases: string[];
  avatar_url: string | null;
  position: number;
}

export interface ScriptLocation {
  id: string;
  project_id: string;
  name: string;
  description: string;
  mood: string | null;
  image_url: string | null;
  position: number;
}

export type ScriptNodeWithChildren = ScriptNodeSummary & {
  children: ScriptNodeWithChildren[];
};

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

const ACTIVE_PROJECT_KEY = "vnhelper.scripts.activeProject";
const ACTIVE_NODE_KEY = "vnhelper.scripts.activeNode";

export function useScripts(workspaceId: string | null) {
  const { user } = useAuth();

  const [projects, setProjects] = useState<ScriptProject[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    () =>
      typeof localStorage !== "undefined"
        ? localStorage.getItem(ACTIVE_PROJECT_KEY)
        : null,
  );

  const [nodes, setNodes] = useState<ScriptNodeSummary[]>([]);
  const [characters, setCharacters] = useState<ScriptCharacter[]>([]);
  const [locations, setLocations] = useState<ScriptLocation[]>([]);

  const [activeNodeId, setActiveNodeIdState] = useState<string | null>(
    () =>
      typeof localStorage !== "undefined"
        ? localStorage.getItem(ACTIVE_NODE_KEY)
        : null,
  );
  const [activeNode, setActiveNode] = useState<ScriptNodeFull | null>(null);
  const [loading, setLoading] = useState(false);

  // "Ready" flags so consumers can show a skeleton while data is in flight
  // and avoid flashing empty-state screens for the brief async window.
  // - projectsReady: first fetchProjects() for current workspaceId settled
  // - contentReady: first fetch of nodes / characters / locations for current
  //                 activeProjectId settled (all three).
  const [projectsReady, setProjectsReady] = useState(false);
  const [contentReady, setContentReady] = useState(false);

  const activeProjectIdRef = useRef<string | null>(null);
  const activeNodeIdRef = useRef<string | null>(null);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  activeProjectIdRef.current = activeProjectId;
  activeNodeIdRef.current = activeNodeId;
  workspaceIdRef.current = workspaceId;

  // Synchronously clear ALL scoped state the moment the workspace flips.
  // Without this, the previous workspace's projects / nodes / characters /
  // locations linger on screen until the async refetch lands. This is the
  // root cause of the "Script shows old workspace's data" bug.
  useEffect(() => {
    setProjects([]);
    setNodes([]);
    setCharacters([]);
    setLocations([]);
    setActiveNode(null);
    // Reset readiness so consumers display skeletons until data arrives.
    setProjectsReady(false);
    setContentReady(false);
    // We don't touch activeProjectId here — fetchProjects() validates it
    // against the new workspace's project list and overrides if needed.
  }, [workspaceId]);

  // Same idea, but for project switches inside a workspace: clear nodes /
  // characters / locations and the open node before the async fetch arrives.
  useEffect(() => {
    setNodes([]);
    setCharacters([]);
    setLocations([]);
    setActiveNode(null);
    setContentReady(false);
  }, [activeProjectId]);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    if (typeof localStorage !== "undefined") {
      if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      else localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }, []);

  const setActiveNodeId = useCallback((id: string | null) => {
    setActiveNodeIdState(id);
    if (typeof localStorage !== "undefined") {
      if (id) localStorage.setItem(ACTIVE_NODE_KEY, id);
      else localStorage.removeItem(ACTIVE_NODE_KEY);
    }
  }, []);

  // ---------- Projects ----------
  const fetchProjects = useCallback(async () => {
    if (!workspaceId) {
      setProjects([]);
      setProjectsReady(true);
      return;
    }
    const myWs = workspaceId;
    const { data, error } = await supabase
      .from("script_projects")
      .select(
        "id, workspace_id, title, synopsis, cover_emoji, cover_image_url, position, created_at, updated_at",
      )
      .eq("workspace_id", myWs)
      .order("position", { ascending: true });
    // Drop the response if the workspace flipped while we were fetching.
    if (workspaceIdRef.current !== myWs) return;
    if (error) {
      console.error("script projects list", error);
      setProjectsReady(true);
      return;
    }
    const list = (data ?? []) as ScriptProject[];
    setProjects(list);
    // Ensure active project is valid for this workspace
    if (
      activeProjectIdRef.current &&
      !list.some((p) => p.id === activeProjectIdRef.current)
    ) {
      setActiveProjectId(list[0]?.id ?? null);
    } else if (!activeProjectIdRef.current && list.length > 0) {
      setActiveProjectId(list[0].id);
    }
    setProjectsReady(true);
  }, [workspaceId, setActiveProjectId]);

  // ---------- Nodes / characters / locations for active project ----------
  const fetchNodes = useCallback(async () => {
    if (!activeProjectId) {
      setNodes([]);
      return;
    }
    const myProject = activeProjectId;
    const { data, error } = await supabase
      .from("script_nodes")
      .select(
        "id, project_id, parent_id, kind, title, emoji, pinned, position, status, pov, location_id, tags, rpy_label, updated_at",
      )
      .eq("project_id", myProject)
      .order("pinned", { ascending: false })
      .order("position", { ascending: true });
    if (activeProjectIdRef.current !== myProject) return;
    if (error) {
      console.error("script nodes list", error);
      return;
    }
    setNodes((data ?? []) as ScriptNodeSummary[]);
  }, [activeProjectId]);

  const fetchCharacters = useCallback(async () => {
    if (!activeProjectId) {
      setCharacters([]);
      return;
    }
    const myProject = activeProjectId;
    const { data, error } = await supabase
      .from("script_characters")
      .select(
        "id, project_id, workspace_id, name, short_name, rpy_var, color, emoji, pronouns, age, role, voice_notes, traits, aliases, avatar_url, position",
      )
      .eq("project_id", myProject)
      .order("position", { ascending: true });
    if (activeProjectIdRef.current !== myProject) return;
    if (error) {
      console.error("script characters list", error);
      return;
    }
    setCharacters((data ?? []) as ScriptCharacter[]);
  }, [activeProjectId]);

  const fetchLocations = useCallback(async () => {
    if (!activeProjectId) {
      setLocations([]);
      return;
    }
    const myProject = activeProjectId;
    const { data, error } = await supabase
      .from("script_locations")
      .select(
        "id, project_id, name, description, mood, image_url, position",
      )
      .eq("project_id", myProject)
      .order("position", { ascending: true });
    if (activeProjectIdRef.current !== myProject) return;
    if (error) {
      console.error("script locations list", error);
      return;
    }
    setLocations((data ?? []) as ScriptLocation[]);
  }, [activeProjectId]);

  // ---------- Single node ----------
  const fetchActiveNode = useCallback(async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("script_nodes")
      .select(
        "id, project_id, workspace_id, parent_id, kind, title, emoji, body, content, rpy_blocks, rpy_label, source_kind, tags, status, pov, location_id, pinned, position, updated_at, created_by, created_at",
      )
      .eq("id", id)
      .single();
    setLoading(false);
    if (error) {
      console.error("script node fetch", error);
      setActiveNode(null);
      return;
    }
    if (activeNodeIdRef.current === id) {
      // rpy_blocks comes back as Json; cast to our typed shape. Empty/null
      // is normalised to null so the editor can render its empty state.
      const row = data as Omit<ScriptNodeFull, "rpy_blocks" | "source_kind"> & {
        rpy_blocks: Json | null;
        source_kind: string;
      };
      setActiveNode({
        ...row,
        rpy_blocks: (row.rpy_blocks as RpyBlocks | null) ?? null,
        source_kind:
          row.source_kind === "rpy_import" ? "rpy_import" : "vnhelper",
      });
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!activeProjectId) {
      // No project selected → nothing to load; consumers can render their
      // empty state immediately rather than skeleton.
      setContentReady(true);
      return;
    }
    const myProject = activeProjectId;
    void Promise.all([fetchNodes(), fetchCharacters(), fetchLocations()])
      .catch((e) => console.error("script content fetch failed", e))
      .finally(() => {
        if (activeProjectIdRef.current === myProject) setContentReady(true);
      });
  }, [activeProjectId, fetchNodes, fetchCharacters, fetchLocations]);

  useEffect(() => {
    if (!activeNodeId) {
      setActiveNode(null);
      return;
    }
    void fetchActiveNode(activeNodeId);
  }, [activeNodeId, fetchActiveNode]);

  // Drop active node when it leaves the active project
  useEffect(() => {
    if (
      activeNodeId &&
      nodes.length > 0 &&
      !nodes.some((n) => n.id === activeNodeId)
    ) {
      // Either node belongs to a different project or was deleted.
      // If we don't find it, clear it; user can pick a new one.
      setActiveNodeId(null);
    }
  }, [nodes, activeNodeId, setActiveNodeId]);

  // ---------- Realtime ----------
  // Workspace-scoped: project list updates. Inline INSERT/UPDATE/DELETE on
  // `projects` so we don't refetch the entire list on every echo.
  useEffect(() => {
    if (!workspaceId) return;
    const myWs = workspaceId;
    const ch = supabase
      .channel(`scripts:${myWs}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_projects",
          filter: `workspace_id=eq.${myWs}`,
        },
        (payload) => {
          if (workspaceIdRef.current !== myWs) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setProjects((cur) => cur.filter((p) => p.id !== id));
            return;
          }
          const row = payload.new as ScriptProject | null;
          if (!row) return;
          setProjects((cur) => {
            const idx = cur.findIndex((p) => p.id === row.id);
            if (idx === -1) {
              return [...cur, row].sort((a, b) => a.position - b.position);
            }
            const copy = cur.slice();
            copy[idx] = { ...copy[idx], ...row };
            return copy;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [workspaceId]);

  // Project-scoped: nodes / characters / locations. Each handler patches its
  // local list inline instead of re-fetching everything.
  useEffect(() => {
    if (!activeProjectId) return;
    const myProject = activeProjectId;
    const ch = supabase
      .channel(`script_project:${myProject}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_nodes",
          filter: `project_id=eq.${myProject}`,
        },
        (payload) => {
          if (activeProjectIdRef.current !== myProject) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setNodes((cur) => cur.filter((n) => n.id !== id));
            if (activeNodeIdRef.current === id) {
              setActiveNode(null);
              setActiveNodeId(null);
            }
            return;
          }
          const row = payload.new as ScriptNodeSummary | null;
          if (!row) return;
          setNodes((cur) => {
            const idx = cur.findIndex((n) => n.id === row.id);
            if (idx === -1) {
              // Skip duplicates: optimistic insert may have added it already.
              return [...cur, row];
            }
            const copy = cur.slice();
            copy[idx] = { ...copy[idx], ...row };
            return copy;
          });
          // If the open node was edited elsewhere, refresh its full body.
          if (
            payload.eventType === "UPDATE" &&
            activeNodeIdRef.current === row.id
          ) {
            void fetchActiveNode(row.id);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_characters",
          filter: `project_id=eq.${myProject}`,
        },
        (payload) => {
          if (activeProjectIdRef.current !== myProject) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setCharacters((cur) => cur.filter((c) => c.id !== id));
            return;
          }
          const row = payload.new as ScriptCharacter | null;
          if (!row) return;
          setCharacters((cur) => {
            const idx = cur.findIndex((c) => c.id === row.id);
            if (idx === -1) return [...cur, row];
            const copy = cur.slice();
            copy[idx] = { ...copy[idx], ...row };
            return copy;
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_locations",
          filter: `project_id=eq.${myProject}`,
        },
        (payload) => {
          if (activeProjectIdRef.current !== myProject) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setLocations((cur) => cur.filter((l) => l.id !== id));
            return;
          }
          const row = payload.new as ScriptLocation | null;
          if (!row) return;
          setLocations((cur) => {
            const idx = cur.findIndex((l) => l.id === row.id);
            if (idx === -1) return [...cur, row];
            const copy = cur.slice();
            copy[idx] = { ...copy[idx], ...row };
            return copy;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [activeProjectId, fetchActiveNode, setActiveNodeId]);

  // ---------- Project mutations ----------
  const createProject = useCallback(
    async (title: string, coverEmoji?: string): Promise<string | null> => {
      if (!workspaceId || !user) return null;
      const id = newUuid();
      const now = new Date().toISOString();
      const optimistic: ScriptProject = {
        id,
        workspace_id: workspaceId,
        title: title.trim() || "Untitled Script",
        synopsis: "",
        cover_emoji: coverEmoji ?? null,
        cover_image_url: null,
        position: Date.now(),
        created_at: now,
        updated_at: now,
      };
      // Optimistic: show in list immediately and switch to it.
      setProjects((cur) => [...cur, optimistic]);
      setActiveProjectId(id);
      setActiveNodeId(null);

      const { error } = await supabase.from("script_projects").insert({
        id,
        workspace_id: workspaceId,
        title: optimistic.title,
        cover_emoji: coverEmoji ?? null,
        created_by: user.id,
        updated_by: user.id,
        position: optimistic.position,
      });
      if (error) {
        console.error("createProject", error);
        // Rollback: drop the optimistic row.
        setProjects((cur) => cur.filter((p) => p.id !== id));
        return null;
      }
      return id;
    },
    [workspaceId, user, setActiveProjectId, setActiveNodeId],
  );

  const updateProject = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<
          ScriptProject,
          | "title"
          | "synopsis"
          | "cover_emoji"
          | "cover_image_url"
          | "position"
        >
      >,
    ) => {
      if (!user) return;
      setProjects((cur) =>
        cur.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
      const { error } = await supabase
        .from("script_projects")
        .update({ ...patch, updated_by: user.id })
        .eq("id", id);
      if (error) console.error("updateProject", error);
    },
    [user],
  );

  const uploadProjectCover = useCallback(
    async (projectId: string, file: File): Promise<string | null> => {
      if (!user || !workspaceId) return null;
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${workspaceId}/${projectId}/cover-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("script-covers")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "image/png",
        });
      if (upErr) {
        console.error("uploadProjectCover upload", upErr);
        return null;
      }
      const { data } = supabase.storage
        .from("script-covers")
        .getPublicUrl(path);
      const url = data.publicUrl;
      await updateProject(projectId, { cover_image_url: url });
      return url;
    },
    [user, workspaceId, updateProject],
  );

  const removeProjectCover = useCallback(
    async (projectId: string) => {
      await updateProject(projectId, { cover_image_url: null });
    },
    [updateProject],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      let snapshot: ScriptProject | undefined;
      setProjects((cur) => {
        snapshot = cur.find((p) => p.id === id);
        return cur.filter((p) => p.id !== id);
      });
      if (activeProjectIdRef.current === id) {
        setActiveProjectId(null);
        setActiveNodeId(null);
      }
      const { error } = await supabase
        .from("script_projects")
        .delete()
        .eq("id", id);
      if (error) {
        console.error("deleteProject", error);
        if (snapshot) setProjects((cur) => [...cur, snapshot!]);
      }
    },
    [setActiveProjectId, setActiveNodeId],
  );

  // ---------- Node mutations ----------
  const createNode = useCallback(
    async (opts: {
      parentId?: string | null;
      kind?: NodeKind;
      title?: string;
    } = {}): Promise<string | null> => {
      if (!workspaceId || !user || !activeProjectId) return null;
      const id = newUuid();
      const now = new Date().toISOString();
      const kind = opts.kind ?? "scene";
      const optimistic: ScriptNodeSummary = {
        id,
        project_id: activeProjectId,
        parent_id: opts.parentId ?? null,
        kind,
        title: opts.title ?? "Untitled",
        emoji: null,
        pinned: false,
        position: Date.now(),
        status: "draft",
        pov: null,
        location_id: null,
        tags: [],
        rpy_label: null,
        updated_at: now,
      };
      // Optimistic: insert into the local tree before the round-trip.
      setNodes((cur) => [...cur, optimistic]);
      setActiveNodeId(id);

      const { error } = await supabase.from("script_nodes").insert({
        id,
        project_id: activeProjectId,
        workspace_id: workspaceId,
        parent_id: optimistic.parent_id,
        kind,
        title: optimistic.title,
        body: "",
        created_by: user.id,
        updated_by: user.id,
        position: optimistic.position,
      });
      if (error) {
        console.error("createNode", error);
        // Rollback optimistic insert.
        setNodes((cur) => cur.filter((n) => n.id !== id));
        if (activeNodeIdRef.current === id) setActiveNodeId(null);
        return null;
      }
      return id;
    },
    [workspaceId, user, activeProjectId, setActiveNodeId],
  );

  const updateNode = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<
          ScriptNodeFull,
          | "title"
          | "body"
          | "content"
          | "rpy_blocks"
          | "rpy_label"
          | "source_kind"
          | "emoji"
          | "pinned"
          | "tags"
          | "parent_id"
          | "position"
          | "status"
          | "pov"
          | "location_id"
          | "kind"
        >
      >,
    ) => {
      if (!user) return;
      setActiveNode((cur) =>
        cur && cur.id === id ? { ...cur, ...patch } : cur,
      );
      setNodes((list) =>
        list.map((n) =>
          n.id === id
            ? {
                ...n,
                title: patch.title ?? n.title,
                emoji: patch.emoji !== undefined ? patch.emoji : n.emoji,
                pinned: patch.pinned ?? n.pinned,
                tags: patch.tags ?? n.tags,
                status: patch.status ?? n.status,
                pov: patch.pov !== undefined ? patch.pov : n.pov,
                location_id:
                  patch.location_id !== undefined
                    ? patch.location_id
                    : n.location_id,
                kind: patch.kind ?? n.kind,
                parent_id:
                  patch.parent_id !== undefined
                    ? patch.parent_id
                    : n.parent_id,
                position: patch.position ?? n.position,
              }
            : n,
        ),
      );
      // `rpy_blocks` is typed as `Json` at the DB boundary; our typed
      // `RpyBlocks` is a more specific shape and TS won't narrow it down
      // automatically. The `as never` is Supabase-SDK's escape hatch for
      // intentional updates whose payload shape is wider than the row.
      const { error } = await supabase
        .from("script_nodes")
        .update({ ...patch, updated_by: user.id } as never)
        .eq("id", id);
      if (error) console.error("updateNode", error);
    },
    [user],
  );

  const deleteNode = useCallback(
    async (id: string) => {
      // Optimistic local removal: walk local tree to collect the node + every
      // descendant, then drop them all in one setNodes pass. The DB cascade
      // removes the same set server-side; the realtime DELETE events arrive
      // moments later but the UI is already correct.
      setNodes((list) => {
        const childrenByParent = new Map<string, string[]>();
        for (const n of list) {
          if (n.parent_id) {
            const arr = childrenByParent.get(n.parent_id) ?? [];
            arr.push(n.id);
            childrenByParent.set(n.parent_id, arr);
          }
        }
        const toRemove = new Set<string>();
        const stack = [id];
        while (stack.length) {
          const cur = stack.pop()!;
          if (toRemove.has(cur)) continue;
          toRemove.add(cur);
          for (const child of childrenByParent.get(cur) ?? []) {
            stack.push(child);
          }
        }
        return list.filter((n) => !toRemove.has(n.id));
      });
      if (activeNodeIdRef.current === id) {
        setActiveNodeId(null);
        setActiveNode(null);
      }
      const { error } = await supabase
        .from("script_nodes")
        .delete()
        .eq("id", id);
      if (error) console.error("deleteNode", error);
    },
    [setActiveNodeId],
  );

  const togglePin = useCallback(
    async (id: string) => {
      const cur = nodes.find((n) => n.id === id);
      if (!cur) return;
      await updateNode(id, { pinned: !cur.pinned });
    },
    [nodes, updateNode],
  );

  // ---------- Character mutations ----------
  const createCharacter = useCallback(
    async (
      name: string,
      opts: { color?: string; aliases?: string[]; emoji?: string | null } = {},
    ): Promise<string | null> => {
      if (!workspaceId || !user || !activeProjectId) return null;
      const id = newUuid();
      const optimistic: ScriptCharacter = {
        id,
        project_id: activeProjectId,
        workspace_id: workspaceId,
        name: name.trim() || "Unnamed",
        short_name: null,
        rpy_var: null,
        color: opts.color ?? "#6aa6ff",
        emoji: opts.emoji ?? null,
        pronouns: null,
        age: null,
        role: null,
        voice_notes: "",
        traits: null,
        aliases: opts.aliases ?? [],
        avatar_url: null,
        position: Date.now(),
      };
      setCharacters((cur) => [...cur, optimistic]);

      const { error } = await supabase.from("script_characters").insert({
        id,
        project_id: activeProjectId,
        workspace_id: workspaceId,
        name: optimistic.name,
        color: optimistic.color,
        emoji: optimistic.emoji,
        aliases: optimistic.aliases,
        created_by: user.id,
        position: optimistic.position,
      });
      if (error) {
        console.error("createCharacter", error);
        setCharacters((cur) => cur.filter((c) => c.id !== id));
        return null;
      }
      return id;
    },
    [workspaceId, user, activeProjectId],
  );

  const updateCharacter = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<
          ScriptCharacter,
          | "name"
          | "short_name"
          | "rpy_var"
          | "color"
          | "emoji"
          | "pronouns"
          | "age"
          | "role"
          | "voice_notes"
          | "traits"
          | "aliases"
          | "avatar_url"
          | "position"
        >
      >,
    ) => {
      setCharacters((cur) =>
        cur.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
      const { error } = await supabase
        .from("script_characters")
        .update(patch)
        .eq("id", id);
      if (error) console.error("updateCharacter", error);
    },
    [],
  );

  const deleteCharacter = useCallback(async (id: string) => {
    // Optimistic removal so the row disappears before the server round-trip.
    let snapshot: ScriptCharacter | undefined;
    setCharacters((cur) => {
      snapshot = cur.find((c) => c.id === id);
      return cur.filter((c) => c.id !== id);
    });
    const { error } = await supabase
      .from("script_characters")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("deleteCharacter", error);
      // Rollback if the server rejected the delete.
      if (snapshot) setCharacters((cur) => [...cur, snapshot!]);
    }
  }, []);

  // ---------- Location mutations ----------
  const createLocation = useCallback(
    async (name: string): Promise<string | null> => {
      if (!workspaceId || !user || !activeProjectId) return null;
      const id = newUuid();
      const optimistic: ScriptLocation = {
        id,
        project_id: activeProjectId,
        name: name.trim() || "Unnamed",
        description: "",
        mood: null,
        image_url: null,
        position: Date.now(),
      };
      setLocations((cur) => [...cur, optimistic]);

      const { error } = await supabase.from("script_locations").insert({
        id,
        project_id: activeProjectId,
        workspace_id: workspaceId,
        name: optimistic.name,
        created_by: user.id,
        position: optimistic.position,
      });
      if (error) {
        console.error("createLocation", error);
        setLocations((cur) => cur.filter((l) => l.id !== id));
        return null;
      }
      return id;
    },
    [workspaceId, user, activeProjectId],
  );

  const updateLocation = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<
          ScriptLocation,
          "name" | "description" | "mood" | "image_url" | "position"
        >
      >,
    ) => {
      setLocations((cur) =>
        cur.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      );
      const { error } = await supabase
        .from("script_locations")
        .update(patch)
        .eq("id", id);
      if (error) console.error("updateLocation", error);
    },
    [],
  );

  const deleteLocation = useCallback(async (id: string) => {
    let snapshot: ScriptLocation | undefined;
    setLocations((cur) => {
      snapshot = cur.find((l) => l.id === id);
      return cur.filter((l) => l.id !== id);
    });
    const { error } = await supabase
      .from("script_locations")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("deleteLocation", error);
      if (snapshot) setLocations((cur) => [...cur, snapshot!]);
    }
  }, []);

  // ---------- Derived ----------
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const tree = useMemo<ScriptNodeWithChildren[]>(() => {
    const byId = new Map<string, ScriptNodeWithChildren>();
    nodes.forEach((n) => byId.set(n.id, { ...n, children: [] }));
    const roots: ScriptNodeWithChildren[] = [];
    byId.forEach((node) => {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [nodes]);

  const characterByShortName = useMemo(() => {
    const m = new Map<string, ScriptCharacter>();
    characters.forEach((c) => {
      if (c.short_name) m.set(c.short_name.toLowerCase(), c);
    });
    return m;
  }, [characters]);

  const stats = useMemo(() => {
    const sceneCount = nodes.filter((n) => n.kind === "scene").length;
    const chapterCount = nodes.filter((n) => n.kind === "chapter").length;
    return { sceneCount, chapterCount, total: nodes.length };
  }, [nodes]);

  /**
   * Bulk-fetch scene nodes with their `rpy_blocks` and assemble a single
   * .rpy file. Walks the project tree depth-first to preserve narrative
   * ordering (chapters → parts → scenes). Returns the serialized text plus
   * stats / warnings the caller can surface to the user.
   */
  const exportRpyProject = useCallback(async () => {
    if (!activeProjectId || !activeProject) return null;

    const { data, error } = await supabase
      .from("script_nodes")
      .select("id, parent_id, kind, title, position, rpy_label, rpy_blocks")
      .eq("project_id", activeProjectId)
      .order("position", { ascending: true });
    if (error) {
      console.error("export fetch nodes", error);
      return null;
    }

    // Build a parent → children map so we can walk depth-first preserving the
    // user's ordering inside each level (already sorted by `position` above).
    type Row = {
      id: string;
      parent_id: string | null;
      kind: "chapter" | "scene" | "block";
      title: string;
      position: number;
      rpy_label: string | null;
      rpy_blocks: Json | null;
    };
    const rows = (data ?? []) as Row[];
    const childrenOf = new Map<string | null, Row[]>();
    for (const r of rows) {
      const arr = childrenOf.get(r.parent_id) ?? [];
      arr.push(r);
      childrenOf.set(r.parent_id, arr);
    }

    const scenes: import("../lib/renpy/projectExport").ExportScene[] = [];
    const walk = (parent: string | null) => {
      const kids = childrenOf.get(parent) ?? [];
      for (const k of kids) {
        if (k.kind === "scene") {
          scenes.push({
            id: k.id,
            title: k.title,
            rpy_label: k.rpy_label,
            rpy_blocks:
              (k.rpy_blocks as import("../lib/renpy/blocks").RpyBlocks | null) ??
              null,
          });
        }
        walk(k.id);
      }
    };
    walk(null);

    const linkedCharacters = characters
      .filter((c) => c.rpy_var && c.rpy_var.trim())
      .map((c) => ({
        name: c.name,
        rpy_var: c.rpy_var!.trim(),
        color: c.color,
      }));

    const { buildRenpyProjectFile } = await import(
      "../lib/renpy/projectExport"
    );
    return buildRenpyProjectFile({
      projectTitle: activeProject.title,
      scenes,
      characters: linkedCharacters,
    });
  }, [activeProjectId, activeProject, characters]);

  return {
    // projects
    projects,
    activeProjectId,
    activeProject,
    setActiveProjectId,
    createProject,
    updateProject,
    deleteProject,
    uploadProjectCover,
    removeProjectCover,

    // nodes
    nodes,
    tree,
    activeNodeId,
    setActiveNodeId,
    activeNode,
    loading,
    createNode,
    updateNode,
    deleteNode,
    togglePin,

    // characters
    characters,
    characterByShortName,
    createCharacter,
    updateCharacter,
    deleteCharacter,

    // locations
    locations,
    createLocation,
    updateLocation,
    deleteLocation,

    // export
    exportRpyProject,

    // misc
    stats,
    projectsReady,
    contentReady,
  };
}
