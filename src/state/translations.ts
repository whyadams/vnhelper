import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  parseRenpyTranslations,
  type ParsedString,
  type ParseWarning,
} from "../lib/renpy";

export interface TranslationProject {
  id: string;
  workspace_id: string;
  name: string;
  source_lang: string;
  created_at: string;
}

export interface TranslationFile {
  id: string;
  project_id: string;
  filename: string;
  target_language: string;
  uploaded_at: string;
  folder_path: string;
}

export type StringStatus = "empty" | "draft" | "done";

export interface TranslationString {
  id: string;
  fileId: string;
  groupLabel: string | null;
  sourcePath: string;
  sourceLine: number;
  sourceText: string;
  translatedText: string;
  status: StringStatus;
  updatedAt: string;
  /** Ren'Py translate-id (`detective_e1d4`); null for strings: rows. */
  translateId: string | null;
  /** Speaker prefix (`dg`, `dm`, …); null for narrator / strings: rows. */
  speaker: string | null;
  /** Trailing modifier (`with dissolve`, `pause 0.5`, …); null when none. */
  trailing: string | null;
}

interface DbStringRow {
  id: string;
  file_id: string;
  group_label: string | null;
  source_path: string;
  source_line: number;
  source_text: string;
  translated_text: string;
  status: string;
  updated_at: string;
  translate_id: string | null;
  speaker: string | null;
  trailing: string | null;
}

function rowToString(r: DbStringRow): TranslationString {
  return {
    id: r.id,
    fileId: r.file_id,
    groupLabel: r.group_label,
    sourcePath: r.source_path,
    sourceLine: r.source_line,
    sourceText: r.source_text,
    translatedText: r.translated_text,
    status: (r.status as StringStatus) ?? "empty",
    updatedAt: r.updated_at,
    translateId: r.translate_id ?? null,
    speaker: r.speaker ?? null,
    trailing: r.trailing ?? null,
  };
}

const ACTIVE_PROJECT_KEY = "vnhelper.translations.activeProject";
const ACTIVE_FILE_KEY = "vnhelper.translations.activeFile";

function readLocal(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key);
}
function writeLocal(key: string, val: string | null) {
  if (typeof localStorage === "undefined") return;
  if (val) localStorage.setItem(key, val);
  else localStorage.removeItem(key);
}

export function useTranslations(workspaceId: string | null) {
  const { user } = useAuth();

  const [projects, setProjects] = useState<TranslationProject[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    () => readLocal(ACTIVE_PROJECT_KEY),
  );
  const [files, setFiles] = useState<TranslationFile[]>([]);
  const [activeFileId, setActiveFileIdState] = useState<string | null>(
    () => readLocal(ACTIVE_FILE_KEY),
  );
  const [strings, setStrings] = useState<TranslationString[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileStats, setFileStats] = useState<
    Record<string, { total: number; done: number }>
  >({});

  // "Ready" flags so consumers can render skeletons during workspace switches
  // and avoid empty-state flashes between sync reset and async fetch.
  const [projectsReady, setProjectsReady] = useState(false);
  const [filesReady, setFilesReady] = useState(false);

  const activeProjectIdRef = useRef<string | null>(activeProjectId);
  const activeFileIdRef = useRef<string | null>(activeFileId);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  activeProjectIdRef.current = activeProjectId;
  activeFileIdRef.current = activeFileId;
  workspaceIdRef.current = workspaceId;

  // Synchronously wipe everything when workspace flips. Without this the
  // previous workspace's translations linger on screen until the new
  // fetchProjects() arrives.
  useEffect(() => {
    setProjects([]);
    setFiles([]);
    setStrings([]);
    setFileStats({});
    setProjectsReady(false);
    setFilesReady(false);
  }, [workspaceId]);

  // Synchronously wipe per-project state on project switch.
  useEffect(() => {
    setFiles([]);
    setStrings([]);
    setFileStats({});
    setFilesReady(false);
  }, [activeProjectId]);

  // Synchronously wipe strings on file switch.
  useEffect(() => {
    setStrings([]);
  }, [activeFileId]);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    writeLocal(ACTIVE_PROJECT_KEY, id);
  }, []);

  const setActiveFileId = useCallback((id: string | null) => {
    setActiveFileIdState(id);
    writeLocal(ACTIVE_FILE_KEY, id);
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
      .from("translation_projects")
      .select("id, workspace_id, name, source_lang, created_at")
      .eq("workspace_id", myWs)
      .order("created_at", { ascending: true });
    if (workspaceIdRef.current !== myWs) return;
    if (error) {
      console.error("translation projects list", error);
      setProjectsReady(true);
      return;
    }
    const list = (data ?? []) as TranslationProject[];
    setProjects(list);
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

  // ---------- Files for active project ----------
  const fetchFiles = useCallback(async () => {
    if (!activeProjectId) {
      setFiles([]);
      setFilesReady(true);
      return;
    }
    const myProject = activeProjectId;
    const { data, error } = await supabase
      .from("translation_files")
      .select(
        "id, project_id, filename, target_language, uploaded_at, folder_path",
      )
      .eq("project_id", myProject)
      .order("folder_path", { ascending: true })
      .order("filename", { ascending: true });
    if (activeProjectIdRef.current !== myProject) return;
    if (error) {
      console.error("translation files list", error);
      setFilesReady(true);
      return;
    }
    setFiles((data ?? []) as TranslationFile[]);
    setFilesReady(true);
  }, [activeProjectId]);

  // ---------- Per-file stats (total/done) ----------
  // One RPC round-trip aggregates every file's stats. The previous
  // implementation issued 2*N parallel head-count queries which slowed
  // big projects to 10–15 seconds when many files were involved.
  const fetchFileStats = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) {
      setFileStats({});
      return;
    }
    const { data, error } = await supabase.rpc("translation_file_stats", {
      _file_ids: fileIds,
    });
    if (error) {
      console.error("translation_file_stats", error);
      return;
    }
    type Row = { file_id: string; total: number | null; done: number | null };
    const rows = (data ?? []) as unknown as Row[];
    const next: Record<string, { total: number; done: number }> = {};
    // Files with zero strings won't appear in GROUP BY output — seed all
    // requested IDs with zeros so the UI shows "0/0" rather than skeleton.
    for (const id of fileIds) next[id] = { total: 0, done: 0 };
    for (const r of rows) {
      next[r.file_id] = {
        total: Number(r.total ?? 0),
        done: Number(r.done ?? 0),
      };
    }
    setFileStats(next);
  }, []);

  // ---------- Strings for active file ----------
  const fetchStrings = useCallback(async () => {
    if (!activeFileId) {
      setStrings([]);
      return;
    }
    setLoading(true);
    // Supabase enforces a default 1000-row limit when no .range / .limit
    // is set. Big translation files (5k–20k rows) silently get truncated
    // without it. Page through the table in 1000-row windows until exhausted.
    const PAGE = 1000;
    const collected: DbStringRow[] = [];
    let from = 0;
    let error: unknown = null;
    // Capture the file id at start so paging can short-circuit if the user
    // switches files mid-fetch.
    const myFile = activeFileId;
    while (true) {
      const { data: page, error: pageErr } = await supabase
        .from("translation_strings")
        .select(
          "id, file_id, group_label, source_path, source_line, source_text, translated_text, status, updated_at, translate_id, speaker, trailing",
        )
        .eq("file_id", myFile)
        .order("source_path", { ascending: true })
        .order("source_line", { ascending: true })
        .range(from, from + PAGE - 1);
      if (pageErr) {
        error = pageErr;
        break;
      }
      if (activeFileIdRef.current !== myFile) {
        // The user moved on; drop the in-flight result.
        setLoading(false);
        return;
      }
      const rows = (page ?? []) as DbStringRow[];
      collected.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    const data = collected;
    setLoading(false);
    if (error) {
      console.error("translation strings list", error);
      setStrings([]);
      return;
    }
    if (activeFileIdRef.current !== activeFileId) return;
    setStrings(((data ?? []) as DbStringRow[]).map(rowToString));
  }, [activeFileId]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    void fetchFileStats(files.map((f) => f.id));
  }, [files, fetchFileStats]);

  useEffect(() => {
    void fetchStrings();
  }, [fetchStrings]);

  // Drop active file when it leaves the active project
  useEffect(() => {
    if (
      activeFileId &&
      files.length > 0 &&
      !files.some((f) => f.id === activeFileId)
    ) {
      setActiveFileId(null);
    }
  }, [files, activeFileId, setActiveFileId]);

  // ---------- Realtime ----------
  // Workspace-scoped: project list updates inline.
  useEffect(() => {
    if (!workspaceId) return;
    const myWs = workspaceId;
    const ch = supabase
      .channel(`translations:ws:${myWs}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "translation_projects",
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
          const row = payload.new as TranslationProject | null;
          if (!row) return;
          setProjects((cur) => {
            const idx = cur.findIndex((p) => p.id === row.id);
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
  }, [workspaceId]);

  // Project-scoped: file list updates inline.
  useEffect(() => {
    if (!activeProjectId) return;
    const myProject = activeProjectId;
    const ch = supabase
      .channel(`translations:project:${myProject}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "translation_files",
          filter: `project_id=eq.${myProject}`,
        },
        (payload) => {
          if (activeProjectIdRef.current !== myProject) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setFiles((cur) => cur.filter((f) => f.id !== id));
            return;
          }
          const row = payload.new as TranslationFile | null;
          if (!row) return;
          setFiles((cur) => {
            const idx = cur.findIndex((f) => f.id === row.id);
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
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeFileId) return;
    const fileId = activeFileId;
    const ch = supabase
      .channel(`translations:file:${fileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "translation_strings",
          filter: `file_id=eq.${fileId}`,
        },
        (payload) => {
          if (activeFileIdRef.current !== fileId) return;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string } | null)?.id;
            if (!id) return;
            setStrings((cur) => cur.filter((s) => s.id !== id));
            return;
          }
          const row = payload.new as DbStringRow | null;
          if (!row) return;
          const next = rowToString(row);
          setStrings((cur) => {
            const idx = cur.findIndex((s) => s.id === next.id);
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
  }, [activeFileId]);

  // ---------- Mutations ----------
  const createProject = useCallback(
    async (name: string, sourceLang: string): Promise<string> => {
      if (!workspaceId || !user) throw new Error("workspace or user missing");
      const cleanName = name.trim() || "Untitled translations";
      const cleanSrc = sourceLang.trim() || "english";

      const { data, error } = await supabase
        .from("translation_projects")
        .insert({
          workspace_id: workspaceId,
          name: cleanName,
          source_lang: cleanSrc,
          created_by: user.id,
        })
        .select("id, created_at")
        .single();
      if (error || !data) {
        console.error("createProject (translations)", error);
        throw error ?? new Error("createProject failed");
      }
      // Optimistic: insert into local list immediately so the new translation
      // shows up before the realtime echo lands.
      const optimistic: TranslationProject = {
        id: data.id,
        workspace_id: workspaceId,
        name: cleanName,
        source_lang: cleanSrc,
        created_at: data.created_at ?? new Date().toISOString(),
      };
      setProjects((cur) =>
        cur.some((p) => p.id === data.id) ? cur : [...cur, optimistic],
      );
      setActiveProjectId(data.id);
      setActiveFileId(null);
      return data.id;
    },
    [workspaceId, user, setActiveProjectId, setActiveFileId],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      // Optimistic removal.
      let snapshot: TranslationProject | undefined;
      setProjects((cur) => {
        snapshot = cur.find((p) => p.id === id);
        return cur.filter((p) => p.id !== id);
      });
      if (activeProjectIdRef.current === id) {
        setActiveProjectId(null);
        setActiveFileId(null);
      }
      const { error } = await supabase
        .from("translation_projects")
        .delete()
        .eq("id", id);
      if (error) {
        console.error("deleteProject (translations)", error);
        if (snapshot) setProjects((cur) => [...cur, snapshot!]);
        throw error;
      }
    },
    [setActiveProjectId, setActiveFileId],
  );

  const importRpyFile = useCallback(
    async (
      projectId: string,
      filename: string,
      content: string,
      targetLang: string,
      folderPath: string = "",
    ): Promise<{ fileId: string; inserted: number; warnings: ParseWarning[] }> => {
      if (!user) throw new Error("user missing");
      const parsed = parseRenpyTranslations(content);

      const { data: fileRow, error: fileErr } = await supabase
        .from("translation_files")
        .insert({
          project_id: projectId,
          filename,
          raw_content: content,
          target_language: targetLang,
          uploaded_by: user.id,
          folder_path: folderPath,
        })
        .select("id")
        .single();
      if (fileErr || !fileRow) {
        console.error("importRpyFile insert file", fileErr);
        throw fileErr ?? new Error("insert file failed");
      }
      const fileId = fileRow.id as string;

      // Optimistic insert into the file list so the new row shows up
      // immediately (the realtime echo will reconcile any server-side fields).
      if (activeProjectIdRef.current === projectId) {
        const optimisticFile: TranslationFile = {
          id: fileId,
          project_id: projectId,
          filename,
          target_language: targetLang,
          uploaded_at: new Date().toISOString(),
          folder_path: folderPath,
        };
        setFiles((cur) =>
          cur.some((f) => f.id === fileId) ? cur : [...cur, optimisticFile],
        );
      }

      const rows = parsed.strings.map((s: ParsedString) => ({
        file_id: fileId,
        group_label: s.groupLabel,
        source_path: s.sourcePath,
        source_line: s.sourceLine,
        source_text: s.sourceText,
        translated_text: s.translatedText,
        status: s.translatedText === "" ? "empty" : "done",
        translate_id: s.translateId,
        speaker: s.speaker,
        trailing: s.trailing,
      }));

      let inserted = 0;
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("translation_strings")
          .insert(slice)
          .select("id");
        if (error) {
          console.error("importRpyFile insert strings", error);
          throw error;
        }
        inserted += data?.length ?? 0;
      }

      setActiveFileId(fileId);
      return { fileId, inserted, warnings: parsed.warnings };
    },
    [user, setActiveFileId],
  );

  const deleteFile = useCallback(
    async (id: string) => {
      // Optimistic removal from local file list.
      let snapshot: TranslationFile | undefined;
      setFiles((cur) => {
        snapshot = cur.find((f) => f.id === id);
        return cur.filter((f) => f.id !== id);
      });
      if (activeFileIdRef.current === id) {
        setActiveFileId(null);
      }
      const { error } = await supabase
        .from("translation_files")
        .delete()
        .eq("id", id);
      if (error) {
        console.error("deleteFile (translations)", error);
        if (snapshot) setFiles((cur) => [...cur, snapshot!]);
        throw error;
      }
    },
    [setActiveFileId],
  );

  const updateString = useCallback(
    async (
      id: string,
      patch: { translatedText?: string; status?: StringStatus },
    ) => {
      const prev = strings.find((s) => s.id === id);
      setStrings((cur) =>
        cur.map((s) =>
          s.id === id
            ? {
                ...s,
                translatedText: patch.translatedText ?? s.translatedText,
                status: patch.status ?? s.status,
              }
            : s,
        ),
      );
      const dbPatch: { translated_text?: string; status?: string } = {};
      if (patch.translatedText !== undefined)
        dbPatch.translated_text = patch.translatedText;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      const { error } = await supabase
        .from("translation_strings")
        .update(dbPatch)
        .eq("id", id);
      if (error) {
        console.error("updateString", error);
        if (prev) {
          setStrings((cur) => cur.map((s) => (s.id === id ? prev : s)));
        }
        throw error;
      }
    },
    [strings],
  );

  // Live-merge: active file's stats reflect current in-memory strings,
  // so toggling status updates progress without waiting for a refetch.
  const liveFileStats = useMemo(() => {
    if (!activeFileId) return fileStats;
    const total = strings.length;
    const done = strings.filter((s) => s.status === "done").length;
    return { ...fileStats, [activeFileId]: { total, done } };
  }, [fileStats, activeFileId, strings]);

  return {
    projects,
    activeProjectId,
    setActiveProjectId,
    files,
    activeFileId,
    setActiveFileId,
    strings,
    loading,
    fileStats: liveFileStats,
    projectsReady,
    filesReady,
    createProject,
    deleteProject,
    importRpyFile,
    deleteFile,
    updateString,
  };
}

export type TranslationsApi = ReturnType<typeof useTranslations>;
