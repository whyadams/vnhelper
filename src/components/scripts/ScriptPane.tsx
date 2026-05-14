import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import type { ScriptNodeSummary } from "../../state/scripts";
// Tree caret + folder/file glyphs are local to this file (see bottom). They
// are copied verbatim from `TranslationsSidebar.tsx` so the two left sidebars
// look and feel like the same component.
import { useDialog } from "../ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SkeletonStack } from "../ui/Skeleton";
import { useKanban } from "../../state/kanbanStore";
import { useSubscription } from "../../state/subscription";
import { usePaywall } from "../subscription/Paywall";
import { CopyButton } from "../ui/CopyButton";

type ScriptsApi = ReturnType<typeof import("../../state/scripts").useScripts>;
type DropZone = "before" | "after" | "into";

// ---------- Tree shape ----------
// Mirrors the Translations sidebar's `TreeNode` discriminated union. A
// "folder" is any node that either is a chapter or has children; everything
// else is a "file" leaf.
type TreeNode =
  | { kind: "folder"; node: ScriptNodeSummary; children: TreeNode[] }
  | { kind: "file"; node: ScriptNodeSummary };

function buildScriptTree(nodes: ScriptNodeSummary[]): TreeNode[] {
  const byParent = new Map<string | null, ScriptNodeSummary[]>();
  for (const n of nodes) {
    const arr = byParent.get(n.parent_id) ?? [];
    arr.push(n);
    byParent.set(n.parent_id, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.position - b.position);
  }
  const build = (parentId: string | null): TreeNode[] => {
    const kids = byParent.get(parentId) ?? [];
    return kids.map((n) => {
      const children = build(n.id);
      const isFolder = n.kind === "chapter" || children.length > 0;
      return isFolder
        ? { kind: "folder" as const, node: n, children }
        : { kind: "file" as const, node: n };
    });
  };
  return build(null);
}

interface DragState {
  draggingId: string | null;
  overId: string | null;
  zone: DropZone | null;
}

interface PaneProps {
  scripts: ScriptsApi;
  onCreateProject: () => void;
  onEditProject: (project: ScriptsApi["activeProject"]) => void;
  /** Open the project Settings page (Writing style / Cast / Locations / Project). */
  onShowSettings: () => void;
  settingsActive?: boolean;
}

export function ScriptPane({
  scripts,
  onCreateProject,
  onEditProject,
  onShowSettings,
  settingsActive,
}: PaneProps) {
  const dialog = useDialog();
  const { state: kanbanState } = useKanban();
  const { limits } = useSubscription();
  const paywall = usePaywall();

  // Frozen project ids in the current workspace (only matters when the
  // workspace is owned by the current user — invited workspaces are gated
  // by the OWNER's tier and stay fully open from our side).
  const frozenProjectIds = useMemo(() => {
    const currentWs = kanbanState.workspaces.find(
      (w) => w.id === kanbanState.workspaceId,
    );
    if (!currentWs || currentWs.role !== "owner") return new Set<string>();
    if (!Number.isFinite(limits.maxScriptProjectsPerWorkspace))
      return new Set<string>();
    // Oldest project stays active; rest freeze.
    const sorted = scripts.projects
      .slice()
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    const frozen = new Set<string>();
    for (let i = limits.maxScriptProjectsPerWorkspace; i < sorted.length; i++) {
      frozen.add(sorted[i].id);
    }
    return frozen;
  }, [
    kanbanState.workspaces,
    kanbanState.workspaceId,
    scripts.projects,
    limits.maxScriptProjectsPerWorkspace,
  ]);

  // If the active project just became frozen (trial expired while viewing
  // an overflow project), jump back to the active (oldest) one.
  useEffect(() => {
    if (
      scripts.activeProjectId &&
      frozenProjectIds.has(scripts.activeProjectId)
    ) {
      const sorted = scripts.projects
        .slice()
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      const fallback = sorted.find((p) => !frozenProjectIds.has(p.id));
      if (fallback) scripts.setActiveProjectId(fallback.id);
    }
    // scripts.setActiveProjectId identity churns each render; we intentionally
    // depend only on the ids being compared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts.activeProjectId, frozenProjectIds, scripts.projects]);

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [drag, setDrag] = useState<DragState>({
    draggingId: null,
    overId: null,
    zone: null,
  });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // ---------- Expansion state ----------
  // Single Set<string> source of truth, persisted per-project to localStorage.
  const EXPAND_KEY = useMemo(
    () =>
      scripts.activeProjectId
        ? `vnhelper.script.tree.expanded:${scripts.activeProjectId}`
        : null,
    [scripts.activeProjectId],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!EXPAND_KEY) {
      setExpanded(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(EXPAND_KEY);
      setExpanded(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setExpanded(new Set());
    }
  }, [EXPAND_KEY]);

  useEffect(() => {
    if (!EXPAND_KEY) return;
    try {
      localStorage.setItem(EXPAND_KEY, JSON.stringify([...expanded]));
    } catch {
      // ignore quota errors
    }
  }, [EXPAND_KEY, expanded]);

  // First-sight chapter auto-expand. After the user explicitly collapses a
  // chapter, `seenRef` makes sure this effect never re-expands it.
  const seenChaptersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const toAdd: string[] = [];
    for (const n of scripts.nodes) {
      if (n.kind !== "chapter") continue;
      if (seenChaptersRef.current.has(n.id)) continue;
      seenChaptersRef.current.add(n.id);
      toAdd.push(n.id);
    }
    if (toAdd.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of toAdd) next.add(id);
      return next;
    });
  }, [scripts.nodes]);

  // GC: drop ids of nodes that no longer exist.
  useEffect(() => {
    const valid = new Set(scripts.nodes.map((n) => n.id));
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (!valid.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [scripts.nodes]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Auto-expand chain to the active node so it's always reachable.
  useEffect(() => {
    if (!scripts.activeNodeId) return;
    const byId = new Map(scripts.nodes.map((n) => [n.id, n]));
    const toAdd: string[] = [];
    let cur = byId.get(scripts.activeNodeId);
    while (cur && cur.parent_id) {
      toAdd.push(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
    if (toAdd.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let added = false;
      for (const id of toAdd) {
        if (!next.has(id)) {
          next.add(id);
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [scripts.activeNodeId, scripts.nodes]);

  // ---------- DnD helpers ----------
  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of scripts.nodes) {
      if (n.parent_id) {
        const arr = map.get(n.parent_id) ?? [];
        arr.push(n.id);
        map.set(n.parent_id, arr);
      }
    }
    return map;
  }, [scripts.nodes]);

  const isDescendant = (rootId: string, candidateId: string): boolean => {
    if (rootId === candidateId) return true;
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const kids = childrenByParent.get(cur) ?? [];
      for (const k of kids) {
        if (k === candidateId) return true;
        stack.push(k);
      }
    }
    return false;
  };

  const handleDrop = async (
    sourceId: string,
    targetId: string,
    zone: DropZone,
  ) => {
    const all = scripts.nodes;
    const target = all.find((n) => n.id === targetId);
    if (!target) return;

    if (zone === "into") {
      const siblings = all
        .filter((n) => n.parent_id === target.id)
        .sort((a, b) => a.position - b.position);
      const lastPos = siblings[siblings.length - 1]?.position ?? 0;
      await scripts.updateNode(sourceId, {
        parent_id: target.id,
        position: lastPos + 1024,
      });
      setExpanded((prev) => {
        if (prev.has(target.id)) return prev;
        const next = new Set(prev);
        next.add(target.id);
        return next;
      });
      return;
    }

    const newParent = target.parent_id;
    const siblings = all
      .filter((n) => n.parent_id === newParent && n.id !== sourceId)
      .sort((a, b) => a.position - b.position);
    const idx = siblings.findIndex((n) => n.id === target.id);
    if (idx < 0) return;

    let before: number | null;
    let after: number | null;
    if (zone === "before") {
      before = siblings[idx - 1]?.position ?? null;
      after = siblings[idx].position;
    } else {
      before = siblings[idx].position;
      after = siblings[idx + 1]?.position ?? null;
    }
    let newPos: number;
    if (before == null && after == null) newPos = 1024;
    else if (before == null) newPos = (after ?? 0) - 1024;
    else if (after == null) newPos = before + 1024;
    else newPos = (before + after) / 2;

    await scripts.updateNode(sourceId, {
      parent_id: newParent,
      position: newPos,
    });
  };

  // ---------- Render ----------
  const projectInitial =
    (scripts.activeProject?.title ?? "?").trim().charAt(0).toUpperCase() || "?";

  const tree = useMemo(() => buildScriptTree(scripts.nodes), [scripts.nodes]);

  return (
    <aside className="notes-pane vn-pane">
      <div className="vn-pane-col3head">
        <div className="vn-pane-head">
          <span className="vn-pane-title">Script</span>
          <span className="vn-pane-count">{scripts.stats.total}</span>
          <span className="vn-pane-spacer" />
          <button
            className="vn-pane-add"
            type="button"
            aria-label="New scene"
            title="New scene"
            onClick={() => void scripts.createNode({ kind: "scene" })}
            disabled={!scripts.activeProjectId}
          >
            <span className="vn-pane-add-glyph">+</span>
          </button>
        </div>

        <DropdownMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="vn-project-switch">
              {scripts.activeProject?.cover_image_url ? (
                <span className="vn-project-av vn-project-av-img">
                  <img
                    src={scripts.activeProject.cover_image_url}
                    alt=""
                    draggable={false}
                  />
                </span>
              ) : (
                <span className="vn-project-av">{projectInitial}</span>
              )}
              <span className="vn-project-name">
                {scripts.activeProject?.title ?? "No project"}
              </span>
              <span className="vn-project-chev">›</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-60">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {scripts.projects.map((p) => {
              const isFrozen = frozenProjectIds.has(p.id);
              return (
              <DropdownMenuItem
                key={p.id}
                data-active={
                  scripts.activeProjectId === p.id ? true : undefined
                }
                className={isFrozen ? "is-frozen" : undefined}
                onSelect={(e) => {
                  if (isFrozen) {
                    e.preventDefault();
                    paywall.show("frozen_project");
                    return;
                  }
                  scripts.setActiveProjectId(p.id);
                }}
              >
                {p.cover_image_url ? (
                  <span className="vn-project-cover-thumb">
                    <img src={p.cover_image_url} alt="" draggable={false} />
                  </span>
                ) : (
                  <span className="vn-project-emoji">
                    {p.cover_emoji ?? "📖"}
                  </span>
                )}
                <span className="vn-project-name">{p.title}</span>
                {!isFrozen && (
                  <CopyButton
                    value={p.id}
                    title="Copy project id (use as project_id in MCP script tools)"
                  />
                )}
                {isFrozen && (
                  <span className="vn-project-lock" aria-hidden>
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  </span>
                )}
                {!isFrozen && (
                <button
                  type="button"
                  className="vn-project-edit-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjectMenuOpen(false);
                    onEditProject(p);
                  }}
                  aria-label="Edit project"
                  title="Edit"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                )}
              </DropdownMenuItem>
              );
            })}
            {scripts.projects.length > 0 && <DropdownMenuSeparator />}
            {scripts.activeProject && (
              <DropdownMenuItem
                onSelect={() => onEditProject(scripts.activeProject)}
              >
                Project settings…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onCreateProject()}>
              + New script project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="vn-tree">
        {!scripts.projectsReady ? (
          <SkeletonStack count={6} height={32} rounded={8} />
        ) : !scripts.activeProjectId ? (
          <div className="notes-empty fade-in">
            <div style={{ marginBottom: 6 }}>No script project yet.</div>
            <button type="button" className="hbtn" onClick={onCreateProject}>
              + Create your first script
            </button>
          </div>
        ) : !scripts.contentReady ? (
          <SkeletonStack count={8} height={32} rounded={8} />
        ) : tree.length === 0 ? (
          <div className="notes-empty fade-in">
            No scenes yet — click + to add a chapter or scene
          </div>
        ) : (
          <div className="tr-tree">
            {tree.map((node) => (
              <TreeNodeView
                key={
                  node.kind === "folder"
                    ? `f:${node.node.id}`
                    : `r:${node.node.id}`
                }
                node={node}
                depth={0}
                scripts={scripts}
                expanded={expanded}
                onToggle={toggleExpanded}
                drag={drag}
                setDrag={setDrag}
                isDescendant={isDescendant}
                onDrop={(s, t, z) => void handleDrop(s, t, z)}
                menuOpenId={menuOpenId}
                setMenuOpenId={setMenuOpenId}
                dialog={dialog}
              />
            ))}
          </div>
        )}
      </div>

      {scripts.activeProjectId && (
        <button
          type="button"
          className={
            "vn-pane-cast-btn" + (settingsActive ? " is-active" : "")
          }
          onClick={onShowSettings}
          title="Writing style · Cast · Locations · Project"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: 6 }}
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
      )}
    </aside>
  );
}

// ---------- Recursive tree row (mirrors Translations' `TreeNodeView`) ----

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  scripts: ScriptsApi;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  drag: DragState;
  setDrag: (s: DragState) => void;
  isDescendant: (rootId: string, candidateId: string) => boolean;
  onDrop: (sourceId: string, targetId: string, zone: DropZone) => void;
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
  dialog: ReturnType<typeof useDialog>;
}

function TreeNodeView(props: TreeNodeViewProps) {
  const { node, depth, expanded } = props;
  const id = node.node.id;
  const isFolder = node.kind === "folder";
  const isOpen = isFolder && expanded.has(id);

  return (
    <>
      <div className="tr-tree-row" style={indentStyle(depth)}>
        <ScriptRow {...props} />
      </div>
      {isFolder &&
        isOpen &&
        node.children.map((child) => (
          <TreeNodeView
            key={
              child.kind === "folder"
                ? `f:${child.node.id}`
                : `r:${child.node.id}`
            }
            {...props}
            node={child}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

function indentStyle(depth: number): CSSProperties {
  return depth === 0 ? {} : { paddingLeft: `${depth * 14}px` };
}

// ---------- Individual row (folder or file) -----------------------------
function ScriptRow({
  node,
  scripts,
  expanded,
  onToggle,
  drag,
  setDrag,
  isDescendant,
  onDrop,
  menuOpenId,
  setMenuOpenId,
  dialog,
}: TreeNodeViewProps) {
  const id = node.node.id;
  const data = node.node;
  const isFolder = node.kind === "folder";
  const hasChildren = isFolder && node.children.length > 0;
  const isOpen = isFolder && expanded.has(id);
  const isActive = scripts.activeNodeId === id;
  const menuOpen = menuOpenId === id;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const isDragSource = drag.draggingId === id;
  const isDropTarget = drag.overId === id;
  const dropZone = isDropTarget ? drag.zone : null;

  // ---------- HTML5 drag events ----------
  const computeZone = (e: DragEvent<HTMLDivElement>): DropZone => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return "into";
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.25) return "before";
    if (y > h * 0.75) return "after";
    return "into";
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDrag({ draggingId: id, overId: null, zone: null });
  };
  const onDragEnd = () =>
    setDrag({ draggingId: null, overId: null, zone: null });

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag.draggingId || drag.draggingId === id) return;
    if (isDescendant(drag.draggingId, id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const zone = computeZone(e);
    if (drag.overId !== id || drag.zone !== zone) {
      setDrag({ draggingId: drag.draggingId, overId: id, zone });
    }
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
      if (drag.overId === id)
        setDrag({ draggingId: drag.draggingId, overId: null, zone: null });
    }
  };
  const onDropEvt = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!drag.draggingId || drag.draggingId === id) return;
    if (isDescendant(drag.draggingId, id)) return;
    const zone = drag.zone ?? computeZone(e);
    onDrop(drag.draggingId, id, zone);
    setDrag({ draggingId: null, overId: null, zone: null });
  };

  // ---------- Click handlers ----------
  const handleRowClick = () => {
    scripts.setActiveNodeId(id);
    if (isFolder) onToggle(id);
  };

  const wrapClass =
    "tr-row-wrap" +
    (isActive ? " is-active" : "") +
    (isDragSource ? " is-dragging" : "") +
    (isDropTarget && dropZone === "into" ? " drop-into" : "");

  const rowClass = isFolder
    ? "tr-row tr-row-folder" + (isActive ? " is-active" : "")
    : "tr-row tr-row-file has-icon" + (isActive ? " is-active" : "");

  return (
    <div
      ref={wrapRef}
      className={wrapClass}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropEvt}
    >
      {isDropTarget && dropZone === "before" && (
        <span className="tree-drop-line drop-line-top" />
      )}
      {isDropTarget && dropZone === "after" && (
        <span className="tree-drop-line drop-line-bottom" />
      )}
      <button
        type="button"
        className={rowClass}
        onClick={handleRowClick}
        aria-expanded={isFolder ? isOpen : undefined}
      >
        {isFolder ? (
          <span
            className={"tr-folder-caret" + (isOpen ? " is-open" : "")}
            aria-hidden
          >
            <ChevronIcon />
          </span>
        ) : (
          <span className="tr-folder-caret" aria-hidden />
        )}
        {!data.emoji && (
          <span className="tr-row-icon" aria-hidden>
            {isFolder ? <FolderIcon open={isOpen} /> : <FileIcon />}
          </span>
        )}
        {data.emoji && (
          <span className="tr-row-icon" aria-hidden>
            {data.emoji}
          </span>
        )}
        <span className="tr-row-text" title={data.title || "Untitled"}>
          {data.title || "Untitled"}
        </span>
      </button>

      <div className="tr-row-actions">
        <CopyButton
          value={id}
          title={`Copy ${data.kind} id (use as entity_id in MCP script tools)`}
        />
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => setMenuOpenId(open ? id : null)}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="tr-icon-btn"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              aria-label="Actions"
              title="Actions"
            >
              <DotsIcon />
            </button>
          </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem onSelect={() => void scripts.togglePin(id)}>
            {data.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void scripts.createNode({ parentId: id, kind: "scene" });
            }}
          >
            + Add scene
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void scripts.createNode({ parentId: id, kind: "block" });
            }}
          >
            + Add block
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Convert to…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-40">
              {data.kind !== "chapter" && (
                <DropdownMenuItem
                  onSelect={() =>
                    void scripts.updateNode(id, { kind: "chapter" })
                  }
                >
                  Chapter
                </DropdownMenuItem>
              )}
              {data.kind !== "scene" && (
                <DropdownMenuItem
                  onSelect={() =>
                    void scripts.updateNode(id, { kind: "scene" })
                  }
                >
                  Scene
                </DropdownMenuItem>
              )}
              {data.kind !== "block" && (
                <DropdownMenuItem
                  onSelect={() =>
                    void scripts.updateNode(id, { kind: "block" })
                  }
                >
                  Block
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {data.parent_id && (
            <DropdownMenuItem
              onSelect={() => void scripts.updateNode(id, { parent_id: null })}
            >
              Move to root
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              void (async () => {
                const ok = await dialog.confirm({
                  title: "Delete",
                  message: `Delete "${data.title || "Untitled"}"${
                    hasChildren ? " and all children" : ""
                  }?`,
                  variant: "danger",
                  confirmLabel: "Delete",
                });
                if (ok) void scripts.deleteNode(id);
              })();
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------- Inline icons (copied from TranslationsSidebar) --------------

function ChevronIcon() {
  return (
    <svg
      width="6"
      height="10"
      viewBox="0 0 6 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
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

function FolderIcon({ open = false }: { open?: boolean }) {
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
