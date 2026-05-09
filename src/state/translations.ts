import { useCallback, useEffect, useMemo, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  generateRpyTranslation,
  mergeTranslationEntries,
  parseRpyTranslation,
  type ParsedEntry,
} from "../lib/renpyTranslate";

export interface TranslationFile {
  id: string;
  project_id: string;
  workspace_id: string;
  language: string;
  relative_path: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TranslationEntry {
  id: string;
  file_id: string;
  block_label: string | null;
  block_index: number;
  entry_index: number;
  source_file: string | null;
  source_line: number | null;
  old_text: string;
  new_text: string;
  status: "untranslated" | "translated" | "reviewed" | "orphaned";
  updated_at: string;
}

export interface UploadStats {
  filesAdded: number;
  filesUpdated: number;
  entriesInserted: number;
  entriesRefreshed: number;
  entriesOrphaned: number;
  errors: string[];
}

export function useTranslations(
  workspaceId: string | null,
  projectId: string | null,
) {
  const { user } = useAuth();
  const [files, setFiles] = useState<TranslationFile[]>([]);
  const [entries, setEntries] = useState<TranslationEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ---------- Load files for project ----------
  const refreshFiles = useCallback(async () => {
    if (!projectId) {
      setFiles([]);
      return;
    }
    const { data, error } = await supabase
      .from("script_translation_files")
      .select(
        "id, project_id, workspace_id, language, relative_path, sort_order, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .order("language", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("relative_path", { ascending: true });
    if (error) {
      console.error("translation files list", error);
      return;
    }
    setFiles((data ?? []) as TranslationFile[]);
  }, [projectId]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  // ---------- Load entries for active file ----------
  const refreshEntries = useCallback(async () => {
    if (!activeFileId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("script_translation_entries")
      .select(
        "id, file_id, block_label, block_index, entry_index, source_file, source_line, old_text, new_text, status, updated_at",
      )
      .eq("file_id", activeFileId)
      .order("block_index", { ascending: true })
      .order("entry_index", { ascending: true });
    setLoading(false);
    if (error) {
      console.error("translation entries list", error);
      return;
    }
    setEntries((data ?? []) as TranslationEntry[]);
  }, [activeFileId]);

  useEffect(() => {
    void refreshEntries();
  }, [refreshEntries]);

  // ---------- Realtime ----------
  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`tl:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "script_translation_files",
          filter: `project_id=eq.${projectId}`,
        },
        () => void refreshFiles(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [projectId, refreshFiles]);

  // ---------- Mutations ----------

  const updateEntry = useCallback(
    async (
      id: string,
      patch: Partial<Pick<TranslationEntry, "new_text" | "status">>,
    ) => {
      // Optimistic
      setEntries((cur) =>
        cur.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
      const { error } = await supabase
        .from("script_translation_entries")
        .update({ ...patch, updated_by: user?.id ?? null })
        .eq("id", id);
      if (error) console.error("updateEntry", error);
    },
    [user],
  );

  const setEntryNew = useCallback(
    async (id: string, value: string) => {
      const status =
        value.trim().length > 0 ? "translated" : "untranslated";
      await updateEntry(id, { new_text: value, status });
    },
    [updateEntry],
  );

  const deleteFile = useCallback(
    async (id: string) => {
      setFiles((cur) => cur.filter((f) => f.id !== id));
      if (activeFileId === id) setActiveFileId(null);
      const { error } = await supabase
        .from("script_translation_files")
        .delete()
        .eq("id", id);
      if (error) console.error("deleteFile", error);
    },
    [activeFileId],
  );

  // ---------- Folder upload ----------

  /**
   * Detect language for a path. Folder convention: `tl/<lang>/...`.
   * Falls back to first segment, then to "unknown".
   */
  const detectLanguage = (relPath: string, parsedLang: string | null) => {
    if (parsedLang) return parsedLang;
    const parts = relPath.split(/[\\/]/);
    const tlIdx = parts.findIndex((p) => p === "tl");
    if (tlIdx >= 0 && parts[tlIdx + 1]) return parts[tlIdx + 1];
    if (parts.length > 1 && parts[0]) return parts[0];
    return "unknown";
  };

  const stripTlPrefix = (relPath: string) => {
    const parts = relPath.split(/[\\/]/);
    const tlIdx = parts.findIndex((p) => p === "tl");
    if (tlIdx >= 0 && parts.length > tlIdx + 2) {
      // drop "tl/<lang>/"
      return parts.slice(tlIdx + 2).join("/");
    }
    return parts.join("/");
  };

  const uploadFolder = useCallback(
    async (fileList: FileList | File[]): Promise<UploadStats> => {
      const stats: UploadStats = {
        filesAdded: 0,
        filesUpdated: 0,
        entriesInserted: 0,
        entriesRefreshed: 0,
        entriesOrphaned: 0,
        errors: [],
      };
      if (!projectId || !workspaceId) {
        stats.errors.push("No active project");
        return stats;
      }

      const arr = Array.from(fileList).filter((f) =>
        f.name.toLowerCase().endsWith(".rpy"),
      );
      if (arr.length === 0) {
        stats.errors.push("No .rpy files in selection");
        return stats;
      }

      let order = 0;
      for (const f of arr) {
        try {
          // Browsers expose folder paths via `webkitRelativePath`.
          const fullPath =
            (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
            f.name;
          const text = await f.text();
          const parsed = parseRpyTranslation(text);
          const language = detectLanguage(fullPath, parsed.language);
          const relPath = stripTlPrefix(fullPath);

          // Find existing file (by project + language + relative_path)
          const { data: existingFiles } = await supabase
            .from("script_translation_files")
            .select("id")
            .eq("project_id", projectId)
            .eq("language", language)
            .eq("relative_path", relPath)
            .limit(1);

          let fileId: string;
          if (existingFiles && existingFiles.length > 0) {
            fileId = existingFiles[0].id;
            stats.filesUpdated++;
            await supabase
              .from("script_translation_files")
              .update({ sort_order: order })
              .eq("id", fileId);
          } else {
            const { data, error } = await supabase
              .from("script_translation_files")
              .insert({
                project_id: projectId,
                workspace_id: workspaceId,
                language,
                relative_path: relPath,
                sort_order: order,
              })
              .select("id")
              .single();
            if (error || !data) {
              stats.errors.push(`${relPath}: ${error?.message ?? "insert failed"}`);
              continue;
            }
            fileId = data.id;
            stats.filesAdded++;
          }
          order++;

          // Pull existing entries for diff
          const { data: existingRows } = await supabase
            .from("script_translation_entries")
            .select("id, old_text, new_text, status")
            .eq("file_id", fileId);

          const merge = mergeTranslationEntries(
            parsed.entries,
            (existingRows ?? []) as Array<{
              id: string;
              old_text: string;
              new_text: string;
              status: string;
            }>,
          );

          // Insert new entries (chunked)
          if (merge.toInsert.length > 0) {
            const rows = merge.toInsert.map((e: ParsedEntry) => ({
              file_id: fileId,
              block_label: e.block_label,
              block_index: e.block_index,
              entry_index: e.entry_index,
              source_file: e.source_file,
              source_line: e.source_line,
              old_text: e.old_text,
              new_text: e.new_text,
              status:
                e.new_text.trim().length > 0 ? "translated" : "untranslated",
            }));
            // chunk to avoid statement size issues
            for (let i = 0; i < rows.length; i += 500) {
              const slice = rows.slice(i, i + 500);
              const { error } = await supabase
                .from("script_translation_entries")
                .insert(slice);
              if (error) stats.errors.push(`${relPath}: ${error.message}`);
              else stats.entriesInserted += slice.length;
            }
          }

          // Refresh metadata of matched entries
          for (const r of merge.toRefresh) {
            const { error } = await supabase
              .from("script_translation_entries")
              .update({
                block_label: r.block_label,
                block_index: r.block_index,
                entry_index: r.entry_index,
                source_file: r.source_file,
                source_line: r.source_line,
              })
              .eq("id", r.id);
            if (error) stats.errors.push(`${relPath}: ${error.message}`);
            else stats.entriesRefreshed++;
          }

          // Mark orphans
          if (merge.toOrphan.length > 0) {
            const { error } = await supabase
              .from("script_translation_entries")
              .update({ status: "orphaned" })
              .in("id", merge.toOrphan);
            if (error) stats.errors.push(`${relPath}: ${error.message}`);
            else stats.entriesOrphaned += merge.toOrphan.length;
          }
        } catch (e) {
          stats.errors.push(
            `${f.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      await refreshFiles();
      await refreshEntries();
      return stats;
    },
    [projectId, workspaceId, refreshFiles, refreshEntries],
  );

  // ---------- Export ----------

  const exportLanguage = useCallback(
    async (language: string): Promise<Uint8Array | null> => {
      const langFiles = files.filter((f) => f.language === language);
      if (langFiles.length === 0) return null;

      const zipEntries: Record<string, Uint8Array> = {};
      for (const f of langFiles) {
        const { data, error } = await supabase
          .from("script_translation_entries")
          .select(
            "block_label, block_index, entry_index, source_file, source_line, old_text, new_text",
          )
          .eq("file_id", f.id)
          .neq("status", "orphaned")
          .order("block_index", { ascending: true })
          .order("entry_index", { ascending: true });
        if (error) {
          console.error("exportLanguage entries", error);
          continue;
        }
        const text = generateRpyTranslation({
          language: f.language,
          entries: (data ?? []).map((r) => ({
            block_label: r.block_label,
            block_index: r.block_index,
            entry_index: r.entry_index,
            source_file: r.source_file,
            source_line: r.source_line,
            old_text: r.old_text,
            new_text: r.new_text,
          })),
        });
        const path = `tl/${f.language}/${f.relative_path}`;
        zipEntries[path] = strToU8(text);
      }

      return zipSync(zipEntries);
    },
    [files],
  );

  // ---------- Derived ----------

  const languages = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => set.add(f.language));
    return Array.from(set).sort();
  }, [files]);

  const filesByLanguage = useMemo(() => {
    const m = new Map<string, TranslationFile[]>();
    for (const f of files) {
      const arr = m.get(f.language) ?? [];
      arr.push(f);
      m.set(f.language, arr);
    }
    return m;
  }, [files]);

  const fileStats = useMemo(() => {
    if (!activeFileId) return { total: 0, translated: 0, orphaned: 0 };
    const total = entries.length;
    const translated = entries.filter(
      (e) => e.status === "translated" || e.status === "reviewed",
    ).length;
    const orphaned = entries.filter((e) => e.status === "orphaned").length;
    return { total, translated, orphaned };
  }, [entries, activeFileId]);

  return {
    files,
    languages,
    filesByLanguage,
    activeFileId,
    setActiveFileId,
    entries,
    fileStats,
    loading,

    refreshFiles,
    uploadFolder,
    setEntryNew,
    updateEntry,
    deleteFile,
    exportLanguage,
  };
}

export type TranslationsApi = ReturnType<typeof useTranslations>;
