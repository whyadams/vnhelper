import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { useDialog } from "../ui/Dialog";
import type { TranslationFile, TranslationsApi } from "../../state/translations";
import { SkeletonStack } from "../ui/Skeleton";

// One file in a multi-file import — keeps the relative folder path so the
// sidebar tree can mirror the source project layout.
export interface FolderImportItem {
  file: File;
  filename: string;
  folderPath: string; // relative dir, "" for root, no trailing slash
}

// Native folder picker (Tauri). webkitdirectory is unreliable in WebView2.
async function pickFolderViaTauri(): Promise<FolderImportItem[] | null> {
  const picked = await openDialog({
    directory: true,
    multiple: false,
    recursive: true,
    title: "Pick a folder with .rpy translation files",
  });
  if (!picked || typeof picked !== "string") return null;

  const collected: { path: string; name: string; rel: string }[] = [];

  const walk = async (dir: string, relPrefix: string): Promise<void> => {
    const entries = await readDir(dir);
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`.replace(/\\/g, "/");
      const childRel = relPrefix
        ? `${relPrefix}/${entry.name}`
        : entry.name;
      if (entry.isDirectory) {
        await walk(full, childRel);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith(".rpy")) {
        collected.push({ path: full, name: entry.name, rel: relPrefix });
      }
    }
  };

  await walk(picked, "");

  if (collected.length === 0) return [];

  return Promise.all(
    collected.map(async ({ path, name, rel }) => {
      const content = await readTextFile(path);
      return {
        file: new File([content], name, { type: "text/plain" }),
        filename: name,
        folderPath: rel,
      };
    }),
  );
}

// Build FolderImportItem[] from a DataTransfer drop, preserving folder paths.
async function collectDroppedItems(
  items: DataTransferItem[],
  files: FileList,
): Promise<FolderImportItem[]> {
  const out: FolderImportItem[] = [];

  const folderOf = (fullPath: string, name: string): string => {
    // entry.fullPath is like "/Folder/Sub/file.rpy" or just "/file.rpy"
    let p = fullPath || "/" + name;
    if (p.startsWith("/")) p = p.slice(1);
    const idx = p.lastIndexOf("/");
    return idx === -1 ? "" : p.slice(0, idx);
  };

  const walk = async (entry: any, parentRel: string): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      await new Promise<void>((res) => {
        entry.file((f: File) => {
          if (f.name.toLowerCase().endsWith(".rpy")) {
            out.push({ file: f, filename: f.name, folderPath: parentRel });
          }
          res();
        });
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise<any[]>((res) => {
        reader.readEntries((arr: any[]) => res(arr));
      });
      const childRel = parentRel
        ? `${parentRel}/${entry.name}`
        : entry.name;
      for (const child of entries) await walk(child, childRel);
    }
  };

  if (items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
    for (const it of items) {
      const entry = (it as any).webkitGetAsEntry();
      if (!entry) continue;
      if (entry.isFile) {
        await new Promise<void>((res) => {
          entry.file((f: File) => {
            if (f.name.toLowerCase().endsWith(".rpy")) {
              const folderPath = folderOf(entry.fullPath, f.name);
              out.push({ file: f, filename: f.name, folderPath });
            }
            res();
          });
        });
      } else if (entry.isDirectory) {
        // Top-level dropped folder becomes the root (empty rel) so its
        // contents appear at the tree's top level.
        await walk(entry, "");
      }
    }
  } else {
    for (const f of Array.from(files)) {
      if (f.name.toLowerCase().endsWith(".rpy")) {
        out.push({ file: f, filename: f.name, folderPath: "" });
      }
    }
  }

  return out;
}

interface Props {
  api: TranslationsApi;
  canEdit: boolean;
  onNewProject: () => void;
  onImportFile: () => void;
  onImportFolder: (items: FolderImportItem[]) => void;
}

type View = "projects" | "files";

const RECENT_KEY_PREFIX = "vnhelper.translations.recent:";

function readRecentIds(projectId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY_PREFIX + projectId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function writeRecentIds(projectId: string, ids: string[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    RECENT_KEY_PREFIX + projectId,
    JSON.stringify(ids.slice(0, 4)),
  );
}

export function TranslationsSidebar({
  api,
  canEdit,
  onNewProject,
  onImportFile,
  onImportFolder,
}: Props) {
  const dialog = useDialog();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [view, setView] = useState<View>(
    api.activeProjectId ? "files" : "projects",
  );
  const [dragOver, setDragOver] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    api.activeProjectId ? readRecentIds(api.activeProjectId) : [],
  );

  const [pickerBusy, setPickerBusy] = useState(false);

  useEffect(() => {
    if (!api.activeProjectId && view === "files") setView("projects");
  }, [api.activeProjectId, view]);

  useEffect(() => {
    if (!api.activeProjectId) {
      setRecentIds([]);
      return;
    }
    setRecentIds(readRecentIds(api.activeProjectId));
  }, [api.activeProjectId]);

  useEffect(() => {
    if (!api.activeProjectId || !api.activeFileId) return;
    setRecentIds((prev) => {
      const next = [
        api.activeFileId!,
        ...prev.filter((id) => id !== api.activeFileId),
      ].slice(0, 4);
      writeRecentIds(api.activeProjectId!, next);
      return next;
    });
  }, [api.activeFileId, api.activeProjectId]);

  const onSelectProject = (id: string) => {
    api.setActiveProjectId(id);
    setView("files");
    setMenuFor(null);
  };

  const onBack = () => setView("projects");

  const onDeleteProject = async (id: string, name: string) => {
    setMenuFor(null);
    const ok = await dialog.confirm({
      title: "Delete translation",
      message: `Delete "${name}" and all its files and strings? This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete forever",
    });
    if (!ok) return;
    try {
      await api.deleteProject(id);
      setView("projects");
    } catch {
      void dialog.alert({
        title: "Delete failed",
        message: "Could not delete the translation.",
      });
    }
  };

  const onDeleteFile = async (id: string, filename: string) => {
    const ok = await dialog.confirm({
      title: "Delete file",
      message: `Delete "${filename}" and all its strings? This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete forever",
    });
    if (!ok) return;
    try {
      await api.deleteFile(id);
    } catch {
      void dialog.alert({
        title: "Delete failed",
        message: "Could not delete the file.",
      });
    }
  };

  const onClickImportFolder = async () => {
    if (pickerBusy) return;
    setPickerBusy(true);
    try {
      const items = await pickFolderViaTauri();
      if (items === null) return; // user cancelled
      if (items.length === 0) {
        void dialog.alert({
          title: "No .rpy files found",
          message: "The selected folder doesn't contain any .rpy files.",
        });
        return;
      }
      onImportFolder(items);
    } catch (e) {
      console.error("folder pick failed", e);
      void dialog.alert({
        title: "Folder pick failed",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPickerBusy(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit || !api.activeProjectId) return;

    const items = Array.from(e.dataTransfer.items ?? []);
    const collected = await collectDroppedItems(items, e.dataTransfer.files);

    if (collected.length === 0) {
      void dialog.alert({
        title: "Nothing to import",
        message: "Drop one or more .rpy files (or a folder containing them).",
      });
      return;
    }
    onImportFolder(collected);
  };

  const project = api.projects.find((p) => p.id === api.activeProjectId);

  const overallProgress = useMemo(() => {
    if (!project) return { pct: 0, total: 0, done: 0 };
    let total = 0;
    let done = 0;
    for (const f of api.files) {
      const stats = api.fileStats[f.id];
      if (!stats) continue;
      total += stats.total;
      done += stats.done;
    }
    return {
      pct: total === 0 ? 0 : Math.round((done / total) * 100),
      total,
      done,
    };
  }, [project, api.files, api.fileStats]);

  const recentFiles = useMemo(() => {
    if (!api.activeProjectId) return [];
    const fileMap = new Map(api.files.map((f) => [f.id, f]));
    return recentIds
      .map((id) => fileMap.get(id))
      .filter((f): f is NonNullable<typeof f> => !!f);
  }, [recentIds, api.files, api.activeProjectId]);

  return (
    <aside
      className={
        "tr-pane tr-sidebar" +
        (dragOver ? " is-drag-over" : "") +
        (view === "files" ? " is-files-view" : " is-projects-view")
      }
      onDragOver={(e) => {
        if (view !== "files" || !canEdit) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {view === "projects" ? (
        <>
          {/* Header */}
          <div className="tr-pane-head">
            <div className="tr-head-row tr-head-title-row">
              <h2 className="tr-pane-title">Translations</h2>
              <span className="tr-pane-count">{api.projects.length}</span>
              <span className="tr-head-spacer" />
            </div>
            {canEdit && (
              <button
                type="button"
                className="tr-row tr-row-filled"
                onClick={onNewProject}
              >
                <span className="tr-row-text">Add Language</span>
                <span className="tr-row-glyph" aria-hidden>
                  <PlusIcon />
                </span>
              </button>
            )}
          </div>

          {/* Body */}
          <div className="tr-pane-body tr-pane-body-list">
            {!api.projectsReady ? (
              <SkeletonStack count={4} height={40} rounded={9} gap={10} />
            ) : api.projects.length === 0 ? (
              <div className="tr-pane-empty fade-in">
                <p>No translations yet.</p>
                {!canEdit && <p>Ask a workspace owner to add one.</p>}
              </div>
            ) : (
              api.projects.map((p) => (
                <div
                  key={p.id}
                  className={
                    "tr-row-wrap" +
                    (p.id === api.activeProjectId ? " is-active" : "")
                  }
                >
                  <button
                    type="button"
                    className={
                      "tr-row " +
                      (p.id === api.activeProjectId
                        ? "tr-row-filled"
                        : "tr-row-outlined")
                    }
                    onClick={() => onSelectProject(p.id)}
                  >
                    <span className="tr-row-text">{p.name}</span>
                    <span className="tr-row-chev" aria-hidden>
                      <ChevronIcon />
                    </span>
                  </button>
                  {canEdit && (
                    <div className="tr-row-menu-wrap">
                      <button
                        type="button"
                        className="tr-icon-btn tr-row-menu-btn"
                        title="Translation actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor((cur) => (cur === p.id ? null : p.id));
                        }}
                      >
                        <DotsIcon />
                      </button>
                      {menuFor === p.id && (
                        <div className="tr-project-menu-pop">
                          <button
                            type="button"
                            className="tr-menu-item is-danger"
                            onClick={() => onDeleteProject(p.id, p.name)}
                          >
                            Delete translation
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      ) : project ? (
        <>
          {/* Header */}
          <div className="tr-pane-head">
            <div className="tr-head-row tr-head-detail-row">
              <h2 className="tr-pane-title tr-pane-title-detail" title={project.name}>
                {project.name}
              </h2>
              <span
                className={
                  "tr-pane-pct" +
                  (overallProgress.pct === 100
                    ? " is-complete"
                    : overallProgress.pct > 0
                      ? " is-progress"
                      : "")
                }
              >
                {overallProgress.pct}%
              </span>
            </div>
            <button
              type="button"
              className="tr-row tr-row-filled"
              onClick={onBack}
            >
              <span className="tr-row-glyph" aria-hidden>
                <ChevronIcon dir="left" />
              </span>
              <span className="tr-row-text">Return</span>
              <span className="tr-head-spacer" />
            </button>
          </div>

          {/* Body */}
          <div className="tr-pane-body tr-pane-body-detail">
            {recentFiles.length > 0 && (
              <section className="tr-section">
                <h4 className="tr-section-label">RECENT OPEN</h4>
                {recentFiles.map((f) => (
                  <FileRow
                    key={f.id}
                    file={f}
                    api={api}
                    canEdit={canEdit}
                    isActive={api.activeFileId === f.id}
                    onDelete={() => onDeleteFile(f.id, f.filename)}
                  />
                ))}
              </section>
            )}

            <section className="tr-section">
              <h4 className="tr-section-label">FILES</h4>
              {!api.filesReady ? (
                <SkeletonStack count={5} height={36} rounded={9} gap={6} />
              ) : api.files.length === 0 ? (
                <div className="tr-pane-empty fade-in">
                  <p>No files yet.</p>
                  <p className="tr-pane-empty-hint">
                    Drop a folder here, or use the button below.
                  </p>
                </div>
              ) : (
                <FilesTree
                  files={api.files}
                  api={api}
                  canEdit={canEdit}
                  activeFileId={api.activeFileId}
                  onDeleteFile={onDeleteFile}
                />
              )}
            </section>
          </div>

          {/* Footer */}
          {canEdit && (
            <div className="tr-pane-footer">
              <button
                type="button"
                className="tr-cta"
                onClick={onClickImportFolder}
                disabled={pickerBusy}
                title="Import all .rpy files from a folder"
              >
                {pickerBusy ? "Picking…" : "Import folder"}
              </button>
              <button
                type="button"
                className="tr-cta-icon"
                onClick={onImportFile}
                title="Import a single .rpy file"
                aria-label="Import single file"
              >
                <PlusIcon />
              </button>
            </div>
          )}
        </>
      ) : null}

      {dragOver && view === "files" && (
        <div className="tr-drag-overlay" aria-hidden>
          <div className="tr-drag-overlay-inner">
            <div className="tr-drag-overlay-icon">
              <PlusIcon />
            </div>
            <div>Drop .rpy files to import</div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ---------- File row ----------

interface FileRowProps {
  file: { id: string; filename: string };
  api: TranslationsApi;
  canEdit: boolean;
  isActive: boolean;
  onDelete: () => void;
  /** Show a file glyph to the left of the filename (used in the tree). */
  showIcon?: boolean;
}

function FileRow({
  file,
  api,
  canEdit,
  isActive,
  onDelete,
  showIcon,
}: FileRowProps) {
  const stats = api.fileStats[file.id];
  const total = stats?.total ?? 0;
  const done = stats?.done ?? 0;
  const dotClass =
    total === 0
      ? "is-pending"
      : done === total
        ? "is-done"
        : done === 0
          ? "is-empty"
          : "is-partial";

  return (
    <div className={"tr-row-wrap" + (isActive ? " is-active" : "")}>
      <button
        type="button"
        className={
          "tr-row tr-row-file" +
          (isActive ? " is-active" : "") +
          (showIcon ? " has-icon" : "")
        }
        onClick={() => api.setActiveFileId(file.id)}
      >
        {showIcon && (
          <span className="tr-row-icon" aria-hidden>
            <FileIcon />
          </span>
        )}
        <span className="tr-row-text" title={file.filename}>
          {file.filename}
        </span>
        <span
          className={"tr-row-dot " + dotClass}
          title={stats ? `${done} / ${total} translated` : "loading…"}
          aria-hidden
        />
      </button>
      {canEdit && (
        <div className="tr-row-actions">
          <button
            type="button"
            className="tr-icon-btn"
            title="Delete file"
            aria-label="Delete file"
            onClick={onDelete}
          >
            <CrossIcon />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Files tree ----------

type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; file: TranslationFile };

function buildFilesTree(files: TranslationFile[]): TreeNode[] {
  const root: { children: TreeNode[] } = { children: [] };
  const folders = new Map<string, { children: TreeNode[] }>();
  folders.set("", root);

  for (const f of files) {
    const segments = (f.folder_path || "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    let parent = root;
    let cumulative = "";
    for (const seg of segments) {
      cumulative = cumulative ? `${cumulative}/${seg}` : seg;
      let folder = folders.get(cumulative);
      if (!folder) {
        const node: TreeNode = {
          kind: "folder",
          name: seg,
          path: cumulative,
          children: [],
        };
        parent.children.push(node);
        folder = node;
        folders.set(cumulative, folder);
      }
      parent = folder as { children: TreeNode[] };
    }
    parent.children.push({ kind: "file", file: f });
  }

  // Sort: folders first, then files; alphabetical within each.
  const sortNode = (n: { children: TreeNode[] }) => {
    n.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      const an = a.kind === "folder" ? a.name : a.file.filename;
      const bn = b.kind === "folder" ? b.name : b.file.filename;
      return an.localeCompare(bn, undefined, { numeric: true });
    });
    for (const child of n.children) {
      if (child.kind === "folder") sortNode(child);
    }
  };
  sortNode(root);
  return root.children;
}

interface FilesTreeProps {
  files: TranslationFile[];
  api: TranslationsApi;
  canEdit: boolean;
  activeFileId: string | null;
  onDeleteFile: (id: string, filename: string) => void;
}

function FilesTree({
  files,
  api,
  canEdit,
  activeFileId,
  onDeleteFile,
}: FilesTreeProps) {
  const tree = useMemo(() => buildFilesTree(files), [files]);

  // Auto-expand folders containing the active file.
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    if (activeFileId) {
      const f = files.find((x) => x.id === activeFileId);
      if (f && f.folder_path) {
        const parts = f.folder_path.split("/").filter(Boolean);
        let acc = "";
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          set.add(acc);
        }
      }
    }
    return set;
  }, [activeFileId, files]);

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  // Re-merge auto-expanded set when active file changes (don't collapse user's manual expansions).
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of initialExpanded) next.add(p);
      return next;
    });
  }, [initialExpanded]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="tr-tree">
      {tree.map((node, i) => (
        <TreeNodeView
          key={node.kind === "folder" ? `f:${node.path}` : `r:${node.file.id}`}
          node={node}
          depth={0}
          api={api}
          canEdit={canEdit}
          activeFileId={activeFileId}
          onDeleteFile={onDeleteFile}
          expanded={expanded}
          onToggle={toggle}
          isFirst={i === 0}
        />
      ))}
    </div>
  );
}

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  api: TranslationsApi;
  canEdit: boolean;
  activeFileId: string | null;
  onDeleteFile: (id: string, filename: string) => void;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  isFirst: boolean;
}

function TreeNodeView({
  node,
  depth,
  api,
  canEdit,
  activeFileId,
  onDeleteFile,
  expanded,
  onToggle,
}: TreeNodeViewProps) {
  if (node.kind === "file") {
    return (
      <div className="tr-tree-row" style={indentStyle(depth)}>
        <FileRow
          file={node.file}
          api={api}
          canEdit={canEdit}
          isActive={activeFileId === node.file.id}
          onDelete={() => onDeleteFile(node.file.id, node.file.filename)}
          showIcon
        />
      </div>
    );
  }

  const isOpen = expanded.has(node.path);
  return (
    <>
      <div className="tr-tree-row" style={indentStyle(depth)}>
        <div className="tr-row-wrap">
          <button
            type="button"
            className="tr-row tr-row-folder"
            onClick={() => onToggle(node.path)}
            aria-expanded={isOpen}
          >
            <span
              className={"tr-folder-caret" + (isOpen ? " is-open" : "")}
              aria-hidden
            >
              <ChevronIcon />
            </span>
            <span className="tr-row-icon" aria-hidden>
              <FolderIcon open={isOpen} />
            </span>
            <span className="tr-row-text" title={node.path}>
              {node.name}
            </span>
          </button>
        </div>
      </div>
      {isOpen &&
        node.children.map((child) => (
          <TreeNodeView
            key={
              child.kind === "folder"
                ? `f:${child.path}`
                : `r:${child.file.id}`
            }
            node={child}
            depth={depth + 1}
            api={api}
            canEdit={canEdit}
            activeFileId={activeFileId}
            onDeleteFile={onDeleteFile}
            expanded={expanded}
            onToggle={onToggle}
            isFirst={false}
          />
        ))}
    </>
  );
}

function indentStyle(depth: number): React.CSSProperties {
  return depth === 0
    ? {}
    : { paddingLeft: `${depth * 14}px` };
}

// ---------- Inline icons (precise sizing per Figma) ----------

function PlusIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 1V9M1 5H9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ dir = "right" }: { dir?: "left" | "right" }) {
  return (
    <svg
      width="6"
      height="10"
      viewBox="0 0 6 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: dir === "left" ? "rotate(180deg)" : undefined }}
    >
      <path
        d="M1 1L5 5L1 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg
      width="14"
      height="3"
      viewBox="0 0 14 3"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="1.5" cy="1.5" r="1.2" />
      <circle cx="7" cy="1.5" r="1.2" />
      <circle cx="12.5" cy="1.5" r="1.2" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M1 1L9 9M9 1L1 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FolderIcon({ open = false }: { open?: boolean }) {
  // 14x12 folder glyph. When `open` is true, the front face tilts forward,
  // creating the classic "drawer-out" silhouette used in Finder/VS Code.
  if (open) {
    return (
      <svg
        width="14"
        height="12"
        viewBox="0 0 14 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H5.5L6.75 3.75H11.5C12.05 3.75 12.5 4.2 12.5 4.75V5.25H3.5L1.5 11V3.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M3.5 5.25H13.25L11.5 10.5C11.36 10.91 10.97 11.2 10.53 11.2H1.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="12"
      viewBox="0 0 14 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H5.5L6.75 3.75H11.5C12.05 3.75 12.5 4.2 12.5 4.75V9.5C12.5 10.05 12.05 10.5 11.5 10.5H2.5C1.95 10.5 1.5 10.05 1.5 9.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon() {
  // 11x14 document with a folded top-right corner. Stroke-only to read as
  // a hint, not a heavy shape — matches the rest of the sidebar weight.
  return (
    <svg
      width="11"
      height="14"
      viewBox="0 0 11 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 1.5H7L9.5 4V11.5C9.5 12.05 9.05 12.5 8.5 12.5H2C1.45 12.5 1 12.05 1 11.5V2.5C1 1.95 1.45 1.5 2 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M7 1.5V4H9.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
