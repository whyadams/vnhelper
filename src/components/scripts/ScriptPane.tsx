import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  hotkeysCoreFeature,
  syncDataLoaderFeature,
  type ItemInstance,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { ScriptNodeSummary } from "../../state/scripts";
import { ChevRight } from "./SharedIcons";
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

type ScriptsApi = ReturnType<typeof import("../../state/scripts").useScripts>;
type DropZone = "before" | "after" | "into";

const VIRTUAL_ROOT = "__vn_root__";
const TREE_INDENT = 18;

interface TreeItemData {
  id: string;
  name: string;
  kind: ScriptNodeSummary["kind"];
  emoji: string | null;
  pinned: boolean;
  parent_id: string | null;
  childIds: string[];
  isVirtualRoot: boolean;
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
  onShowCharacters: () => void;
  charactersActive?: boolean;
}

export function ScriptPane({
  scripts,
  onCreateProject,
  onEditProject,
  onShowCharacters,
  charactersActive,
}: PaneProps) {
  const dialog = useDialog();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [drag, setDrag] = useState<DragState>({
    draggingId: null,
    overId: null,
    zone: null,
  });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // ---------- Build flat item map for headless-tree ----------
  const itemsMap = useMemo<Record<string, TreeItemData>>(() => {
    const byParent = new Map<string, ScriptNodeSummary[]>();
    for (const n of scripts.nodes) {
      const arr = byParent.get(n.parent_id ?? VIRTUAL_ROOT) ?? [];
      arr.push(n);
      byParent.set(n.parent_id ?? VIRTUAL_ROOT, arr);
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => a.position - b.position);
    }
    const map: Record<string, TreeItemData> = {
      [VIRTUAL_ROOT]: {
        id: VIRTUAL_ROOT,
        name: "",
        kind: "chapter",
        emoji: null,
        pinned: false,
        parent_id: null,
        childIds: (byParent.get(VIRTUAL_ROOT) ?? []).map((n) => n.id),
        isVirtualRoot: true,
      },
    };
    for (const n of scripts.nodes) {
      map[n.id] = {
        id: n.id,
        name: n.title || "Untitled",
        kind: n.kind,
        emoji: n.emoji,
        pinned: n.pinned,
        parent_id: n.parent_id,
        childIds: (byParent.get(n.id) ?? []).map((c) => c.id),
        isVirtualRoot: false,
      };
    }
    return map;
  }, [scripts.nodes]);

  // Track expanded items + chapters the user has explicitly collapsed.
  // Default: chapters are expanded on first sight unless explicitly collapsed.
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(
    new Set(),
  );

  // Seed expandedItems with all chapter ids that haven't been explicitly collapsed.
  useEffect(() => {
    const chapterIds = scripts.nodes
      .filter((n) => n.kind === "chapter")
      .map((n) => n.id);
    setExpandedItems((prev) => {
      const set = new Set(prev);
      for (const id of chapterIds) {
        if (!collapsedChapters.has(id)) set.add(id);
      }
      // drop ids that no longer exist
      const valid = new Set(scripts.nodes.map((n) => n.id));
      for (const id of [...set]) {
        if (!valid.has(id)) set.delete(id);
      }
      return Array.from(set);
    });
  }, [scripts.nodes, collapsedChapters]);

  // Filter ids not present in the current itemsMap. Without this, a brief
  // window between node deletion and the cleanup effect can pass a stale id
  // to useTree, and the sync dataLoader throws on `undefined`.
  const validExpandedItems = useMemo(
    () => expandedItems.filter((id) => itemsMap[id] !== undefined),
    [expandedItems, itemsMap],
  );
  const validSelectedItems = useMemo(
    () =>
      scripts.activeNodeId && itemsMap[scripts.activeNodeId]
        ? [scripts.activeNodeId]
        : [],
    [scripts.activeNodeId, itemsMap],
  );

  const tree = useTree<TreeItemData>({
    state: {
      expandedItems: validExpandedItems,
      selectedItems: validSelectedItems,
    },
    setExpandedItems,
    indent: TREE_INDENT,
    rootItemId: VIRTUAL_ROOT,
    getItemName: (item) => item.getItemData()?.name ?? "",
    isItemFolder: (item) => {
      const d = item.getItemData();
      if (!d) return false;
      if (d.isVirtualRoot) return true;
      return d.kind === "chapter" || d.childIds.length > 0;
    },
    dataLoader: {
      getItem: (id: string) => itemsMap[id],
      getChildren: (id: string) => itemsMap[id]?.childIds ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  // Sync selection from external clicks (e.g. activeNodeId set by editor).
  // headless-tree handles selection change visually via state above.

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
      setExpandedItems((prev) =>
        prev.includes(target.id) ? prev : [...prev, target.id],
      );
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

  const visibleItems = scripts.activeProjectId
    ? tree.getItems().filter((it) => it.getId() !== VIRTUAL_ROOT)
    : [];

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
            {scripts.projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                data-active={
                  scripts.activeProjectId === p.id ? true : undefined
                }
                onSelect={() => scripts.setActiveProjectId(p.id)}
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
              </DropdownMenuItem>
            ))}
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

      <div
        className="vn-tree vn-tree-headless"
        style={{ ["--tree-indent" as never]: `${TREE_INDENT}px` }}
        {...tree.getContainerProps()}
      >
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
        ) : visibleItems.length === 0 ? (
          <div className="notes-empty fade-in">
            No scenes yet — click + to add a chapter or scene
          </div>
        ) : (
          visibleItems.map((item) => (
            <TreeRow
              key={item.getId()}
              item={item}
              scripts={scripts}
              drag={drag}
              setDrag={setDrag}
              isDescendant={isDescendant}
              onDrop={(s, t, z) => void handleDrop(s, t, z)}
              menuOpenId={menuOpenId}
              setMenuOpenId={setMenuOpenId}
              dialog={dialog}
              setExpandedItems={setExpandedItems}
              setCollapsedChapters={setCollapsedChapters}
            />
          ))
        )}
      </div>

      {scripts.activeProjectId && (
        <button
          type="button"
          className={
            "vn-pane-cast-btn" + (charactersActive ? " is-active" : "")
          }
          onClick={onShowCharacters}
          title="Manage characters & locations"
        >
          Cast
        </button>
      )}
    </aside>
  );
}

interface RowProps {
  item: ItemInstance<TreeItemData>;
  scripts: ScriptsApi;
  drag: DragState;
  setDrag: (s: DragState) => void;
  isDescendant: (rootId: string, candidateId: string) => boolean;
  onDrop: (sourceId: string, targetId: string, zone: DropZone) => void;
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
  dialog: ReturnType<typeof useDialog>;
  setExpandedItems: React.Dispatch<React.SetStateAction<string[]>>;
  setCollapsedChapters: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function TreeRow({
  item,
  scripts,
  drag,
  setDrag,
  isDescendant,
  onDrop,
  menuOpenId,
  setMenuOpenId,
  dialog,
  setExpandedItems,
  setCollapsedChapters,
}: RowProps) {
  const id = item.getId();
  const data = item.getItemData();
  const level = item.getItemMeta().level - 1; // virtual root is level 0
  const isChapter = data?.kind === "chapter";
  const hasChildren = (data?.childIds.length ?? 0) > 0;
  const isFolder = isChapter || hasChildren;
  const isExpanded = item.isExpanded();
  const isActive = scripts.activeNodeId === id;
  const menuOpen = menuOpenId === id;

  const rowRef = useRef<HTMLDivElement | null>(null);
  const isDragSource = drag.draggingId === id;
  const isDropTarget = drag.overId === id;
  const dropZone = isDropTarget ? drag.zone : null;

  // ---------- HTML5 drag events ----------
  const computeZone = (e: DragEvent<HTMLDivElement>): DropZone => {
    const rect = rowRef.current?.getBoundingClientRect();
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
    if (!rowRef.current?.contains(e.relatedTarget as Node)) {
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

  const handleClick = () => {
    scripts.setActiveNodeId(id);
  };

  const toggleExpand = () => {
    if (isExpanded) {
      setExpandedItems((prev) => prev.filter((x) => x !== id));
      if (isChapter) {
        setCollapsedChapters((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
    } else {
      setExpandedItems((prev) =>
        prev.includes(id) ? prev : [...prev, id],
      );
      if (isChapter) {
        setCollapsedChapters((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  return (
    <div
      ref={rowRef}
        className={
          "vn-row" +
          (isChapter ? " is-chapter" : " is-scene") +
          (isActive ? " is-active" : "") +
          (isDragSource ? " is-dragging" : "") +
          (isDropTarget && dropZone === "into" ? " drop-into" : "")
        }
        style={{
          paddingInlineStart: `${level * 18 + 8}px`,
          position: "relative",
        }}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDropEvt}
        onClick={handleClick}
        data-folder={isFolder || undefined}
        data-selected={isActive || undefined}
        aria-expanded={isFolder ? isExpanded : undefined}
      >
        {isDropTarget && dropZone === "before" && (
          <span className="tree-drop-line drop-line-top" />
        )}
        {isDropTarget && dropZone === "after" && (
          <span className="tree-drop-line drop-line-bottom" />
        )}
        {isFolder ? (
          <button
            className="vn-row-chev"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand();
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <ChevRight className={"chev" + (isExpanded ? " is-open" : "")} />
          </button>
        ) : (
          <span className="vn-row-chev vn-row-chev-spacer" />
        )}
        {data?.emoji && <span className="vn-row-emoji">{data.emoji}</span>}
        <span className="vn-row-lbl">{data?.name || "Untitled"}</span>
        {isActive && !isChapter && <span className="vn-row-dot" />}
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => setMenuOpenId(open ? id : null)}
        >
          <DropdownMenuTrigger asChild>
            <button
              className="vn-row-more"
              onClick={(e) => e.stopPropagation()}
              aria-label="Actions"
              title="Actions"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem onSelect={() => void scripts.togglePin(id)}>
              {data?.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void scripts.createNode({ parentId: id, kind: "scene" });
                setExpandedItems((prev) =>
                  prev.includes(id) ? prev : [...prev, id],
                );
              }}
            >
              + Add scene
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void scripts.createNode({ parentId: id, kind: "block" });
                setExpandedItems((prev) =>
                  prev.includes(id) ? prev : [...prev, id],
                );
              }}
            >
              + Add block
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Convert to…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-40">
                {data?.kind !== "chapter" && (
                  <DropdownMenuItem
                    onSelect={() =>
                      void scripts.updateNode(id, { kind: "chapter" })
                    }
                  >
                    Chapter
                  </DropdownMenuItem>
                )}
                {data?.kind !== "scene" && (
                  <DropdownMenuItem
                    onSelect={() =>
                      void scripts.updateNode(id, { kind: "scene" })
                    }
                  >
                    Scene
                  </DropdownMenuItem>
                )}
                {data?.kind !== "block" && (
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
            {data?.parent_id && (
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
                    message: `Delete "${data?.name || "Untitled"}"${
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
  );
}
