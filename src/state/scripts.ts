import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import type { Json } from "../lib/database.types";

export type NodeKind = "chapter" | "scene" | "block";
export type ScriptContent = Json;

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
  updated_at: string;
}

export interface ScriptNodeFull extends ScriptNodeSummary {
  body: string;
  content: ScriptContent | null;
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

  const activeProjectIdRef = useRef<string | null>(null);
  const activeNodeIdRef = useRef<string | null>(null);
  activeProjectIdRef.current = activeProjectId;
  activeNodeIdRef.current = activeNodeId;

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
      return;
    }
    const { data, error } = await supabase
      .from("script_projects")
      .select(
        "id, workspace_id, title, synopsis, cover_emoji, cover_image_url, position, created_at, updated_at",
      )
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true });
    if (error) {
      console.error("script projects list", error);
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
  }, [workspaceId, setActiveProjectId]);

  // ---------- Nodes / characters / locations for active project ----------
  const fetchNodes = useCallback(async () => {
    if (!activeProjectId) {
      setNodes([]);
      return;
    }
    const { data, error } = await supabase
      .from("script_nodes")
      .select(
        "id, project_id, parent_id, kind, title, emoji, pinned, position, status, pov, location_id, tags, updated_at",
      )
      .eq("project_id", activeProjectId)
      .order("pinned", { ascending: false })
      .order("position", { ascending: true });
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
    const { data, error } = await supabase
      .from("script_characters")
      .select(
        "id, project_id, workspace_id, name, short_name, color, emoji, pronouns, age, role, voice_notes, traits, aliases, avatar_url, position",
      )
      .eq("project_id", activeProjectId)
      .order("position", { ascending: true });
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
    const { data, error } = await supabase
      .from("script_locations")
      .select(
        "id, project_id, name, description, mood, image_url, position",
      )
      .eq("project_id", activeProjectId)
      .order("position", { ascending: true });
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
        "id, project_id, workspace_id, parent_id, kind, title, emoji, body, content, tags, status, pov, location_id, pinned, position, updated_at, created_by, created_at",
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
      setActiveNode(data as ScriptNodeFull);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    void fetchNodes();
    void fetchCharacters();
    void fetchLocations();
  }, [fetchNodes, fetchCharacters, fetchLocations]);

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
  useEffect(() => {
    if (!workspaceId) return;
    const ch = supabase
      .channel(`scripts:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_projects",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => void fetchProjects(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [workspaceId, fetchProjects]);

  useEffect(() => {
    if (!activeProjectId) return;
    const ch = supabase
      .channel(`script_project:${activeProjectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_nodes",
          filter: `project_id=eq.${activeProjectId}`,
        },
        (payload) => {
          void fetchNodes();
          const id =
            (payload.new as { id?: string } | null)?.id ??
            (payload.old as { id?: string } | null)?.id;
          if (
            payload.eventType === "DELETE" &&
            id &&
            activeNodeIdRef.current === id
          ) {
            setActiveNode(null);
            setActiveNodeId(null);
            return;
          }
          if (
            payload.eventType === "UPDATE" &&
            id &&
            activeNodeIdRef.current === id
          ) {
            void fetchActiveNode(id);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_characters",
          filter: `project_id=eq.${activeProjectId}`,
        },
        () => void fetchCharacters(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_locations",
          filter: `project_id=eq.${activeProjectId}`,
        },
        () => void fetchLocations(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [
    activeProjectId,
    fetchNodes,
    fetchCharacters,
    fetchLocations,
    fetchActiveNode,
    setActiveNodeId,
  ]);

  // ---------- Project mutations ----------
  const createProject = useCallback(
    async (title: string, coverEmoji?: string): Promise<string | null> => {
      if (!workspaceId || !user) return null;
      const id = newUuid();
      const { error } = await supabase.from("script_projects").insert({
        id,
        workspace_id: workspaceId,
        title: title.trim() || "Untitled Script",
        cover_emoji: coverEmoji ?? null,
        created_by: user.id,
        updated_by: user.id,
        position: Date.now(),
      });
      if (error) {
        console.error("createProject", error);
        return null;
      }
      setActiveProjectId(id);
      setActiveNodeId(null);
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
      if (activeProjectIdRef.current === id) {
        setActiveProjectId(null);
        setActiveNodeId(null);
      }
      const { error } = await supabase
        .from("script_projects")
        .delete()
        .eq("id", id);
      if (error) console.error("deleteProject", error);
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
      const { error } = await supabase.from("script_nodes").insert({
        id,
        project_id: activeProjectId,
        workspace_id: workspaceId,
        parent_id: opts.parentId ?? null,
        kind: opts.kind ?? "scene",
        title: opts.title ?? "Untitled",
        body: "",
        created_by: user.id,
        updated_by: user.id,
        position: Date.now(),
      });
      if (error) {
        console.error("createNode", error);
        return null;
      }
      setActiveNodeId(id);
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
      const { error } = await supabase
        .from("script_nodes")
        .update({ ...patch, updated_by: user.id })
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
      const { error } = await supabase.from("script_characters").insert({
        id,
        project_id: activeProjectId,
        workspace_id: workspaceId,
        name: name.trim() || "Unnamed",
        color: opts.color ?? "#6aa6ff",
        emoji: opts.emoji ?? null,
        aliases: opts.aliases ?? [],
        created_by: user.id,
        position: Date.now(),
      });
      if (error) {
        console.error("createCharacter", error);
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
    const { error } = await supabase
      .from("script_characters")
      .delete()
      .eq("id", id);
    if (error) console.error("deleteCharacter", error);
  }, []);

  // ---------- Location mutations ----------
  const createLocation = useCallback(
    async (name: string): Promise<string | null> => {
      if (!workspaceId || !user || !activeProjectId) return null;
      const id = newUuid();
      const { error } = await supabase.from("script_locations").insert({
        id,
        project_id: activeProjectId,
        workspace_id: workspaceId,
        name: name.trim() || "Unnamed",
        created_by: user.id,
        position: Date.now(),
      });
      if (error) {
        console.error("createLocation", error);
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
    const { error } = await supabase
      .from("script_locations")
      .delete()
      .eq("id", id);
    if (error) console.error("deleteLocation", error);
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

    // misc
    stats,
  };
}
