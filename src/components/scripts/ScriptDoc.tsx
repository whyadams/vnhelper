import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  ScriptCharacter,
  ScriptContent,
  ScriptLocation,
} from "../../state/scripts";
import { StarIcon } from "./SharedIcons";
// ScriptEditor is the TipTap-heavy Doc tab. We `React.lazy` it so the
// Renpy tab doesn't pay the cost of pulling in @tiptap/* (ProseMirror,
// extensions, custom VN nodes) just because ScriptDoc renders. Until the
// user switches to viewMode === "doc", the chunk never loads.
const ScriptEditor = lazy(() =>
  import("./ScriptEditor").then((m) => ({ default: m.ScriptEditor })),
);
import { useScriptStats } from "./scriptStats";
import { RenpyTable } from "./RenpyTable";
import { RpyImportModal } from "./RpyImportModal";
import { ScriptImportModal } from "./ScriptImportModal";
import type { RpyBlocks } from "../../lib/renpy/blocks";
import { useDialog } from "../ui/Dialog";
import { SkeletonBlock, SkeletonBox } from "../ui/Skeleton";
import { LinkedEventsSection } from "../calendar/LinkedEventsSection";
import { useSubscription } from "../../state/subscription";
import { usePaywall } from "../subscription/Paywall";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../ui/select";

// Radix Select rejects empty-string item values, so we use a sentinel for
// the "none" option and translate at the boundary.
const NONE_VALUE = "__none__";

type ScriptViewMode = "doc" | "renpy";

type ScriptsApi = ReturnType<typeof import("../../state/scripts").useScripts>;

const META_SAVE_DEBOUNCE_MS = 500;
const CONTENT_SAVE_DEBOUNCE_MS = 800;

// Persist the active Doc/Renpy tab across screen switches. On large scripts
// each tab carries a several-second mount cost (TipTap or RenpyTable), so
// always landing on "doc" forces the user to pay both costs in a row when
// they actually wanted Renpy.
const VIEW_MODE_KEY = "vnhelper.script.viewMode";
function loadViewMode(): ScriptViewMode {
  if (typeof localStorage === "undefined") return "doc";
  const v = localStorage.getItem(VIEW_MODE_KEY);
  return v === "renpy" ? "renpy" : "doc";
}

const STATUS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "draft", label: "Draft" },
  { key: "wip", label: "WIP" },
  { key: "review", label: "Review" },
  { key: "final", label: "Final" },
];

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}


const TAG_COLORS = [
  "pink",
  "green",
  "amber",
  "violet",
  "sky",
  "rose",
  "teal",
] as const;

function colorForTag(label: string): (typeof TAG_COLORS)[number] {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

interface DocProps {
  scripts: ScriptsApi;
  onAddCharacter: () => void;
}

export function ScriptDoc({ scripts, onAddCharacter }: DocProps) {
  const dialog = useDialog();
  const { limits } = useSubscription();
  const paywall = usePaywall();
  const node = scripts.activeNode;

  const [titleDraft, setTitleDraft] = useState("");
  const [emojiDraft, setEmojiDraft] = useState("");
  const [, setEditingEmoji] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [savedAgo, setSavedAgo] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<ScriptViewMode>(loadViewMode);
  const setViewMode = (v: ScriptViewMode) => {
    setViewModeState(v);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(VIEW_MODE_KEY, v);
    }
  };
  const [importOpen, setImportOpen] = useState(false);
  const [rpyImportOpen, setRpyImportOpen] = useState(false);
  // Bumped on every external content replacement (e.g. Import) so the
  // TipTap editor and Table view get fresh `key` and remount with new state.
  const [externalRevision, setExternalRevision] = useState(0);
  const metaSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastMetaSavedRef = useRef<{ title: string; emoji: string }>({
    title: "",
    emoji: "",
  });

  useEffect(() => {
    if (metaSaveTimeoutRef.current) {
      clearTimeout(metaSaveTimeoutRef.current);
      metaSaveTimeoutRef.current = null;
    }
    if (contentSaveTimeoutRef.current) {
      clearTimeout(contentSaveTimeoutRef.current);
      contentSaveTimeoutRef.current = null;
    }
    if (node) {
      setTitleDraft(node.title);
      setEmojiDraft(node.emoji ?? "");
      lastMetaSavedRef.current = {
        title: node.title,
        emoji: node.emoji ?? "",
      };
    } else {
      setTitleDraft("");
      setEmojiDraft("");
    }
    setEditingEmoji(false);
    setTagDraft("");
  }, [node?.id]);

  useEffect(() => {
    if (!node) {
      setSavedAgo(null);
      return;
    }
    const update = () => setSavedAgo(timeAgo(node.updated_at));
    update();
    const i = setInterval(update, 30_000);
    return () => clearInterval(i);
  }, [node?.updated_at, node?.id]);

  const scheduleMetaSave = (nextTitle: string, nextEmoji: string) => {
    if (!node) return;
    if (metaSaveTimeoutRef.current) clearTimeout(metaSaveTimeoutRef.current);
    metaSaveTimeoutRef.current = setTimeout(() => {
      const last = lastMetaSavedRef.current;
      const patch: Record<string, string | null> = {};
      if (nextTitle !== last.title)
        patch.title = nextTitle.trim() || "Untitled";
      if (nextEmoji !== last.emoji) patch.emoji = nextEmoji.trim() || null;
      if (Object.keys(patch).length === 0) return;
      lastMetaSavedRef.current = {
        title: typeof patch.title === "string" ? patch.title : last.title,
        emoji:
          patch.emoji === null
            ? ""
            : typeof patch.emoji === "string"
              ? patch.emoji
              : last.emoji,
      };
      void scripts.updateNode(node.id, patch);
    }, META_SAVE_DEBOUNCE_MS);
  };

  // Memoized save callbacks — RenpyTable + ScriptEditor are wrapped in memo
  // (or stable-key remount), so a fresh `onChange` reference each render
  // would either invalidate the memo or trigger a useEffect resync on every
  // parent re-render. Stable refs guarantee the children only re-render
  // when their own data actually changes.
  const onContentChange = useCallback(
    (content: ScriptContent) => {
      const id = node?.id;
      if (!id) return;
      if (contentSaveTimeoutRef.current)
        clearTimeout(contentSaveTimeoutRef.current);
      contentSaveTimeoutRef.current = setTimeout(() => {
        void scripts.updateNode(id, { content });
      }, CONTENT_SAVE_DEBOUNCE_MS);
    },
    [node?.id, scripts],
  );

  // Renpy-tab save shares the same debounce slot as Doc — only one of the two
  // tabs is visible at a time, so a pending save from the other never races.
  const onRpyBlocksChange = useCallback(
    (rpy_blocks: RpyBlocks) => {
      const id = node?.id;
      if (!id) return;
      if (contentSaveTimeoutRef.current)
        clearTimeout(contentSaveTimeoutRef.current);
      contentSaveTimeoutRef.current = setTimeout(() => {
        void scripts.updateNode(id, { rpy_blocks });
      }, CONTENT_SAVE_DEBOUNCE_MS);
    },
    [node?.id, scripts],
  );

  // Bulk operations (paste-import, clear-all, replace-via-import) bypass the
  // debounce so the save lands before any other UI event can race against it.
  // The debounce is for keystroke-level edits — bulk replacements need to be
  // atomic and immediate.
  const onRpyBlocksReplace = useCallback(
    async (rpy_blocks: RpyBlocks) => {
      const id = node?.id;
      if (!id) return;
      if (contentSaveTimeoutRef.current) {
        clearTimeout(contentSaveTimeoutRef.current);
        contentSaveTimeoutRef.current = null;
      }
      await scripts.updateNode(id, { rpy_blocks });
    },
    [node?.id, scripts],
  );

  /** Build the project's .rpy and trigger a browser download. */
  const onClickExportRpy = async () => {
    if (!limits.canExportRpy) {
      paywall.show("rpy_export");
      return;
    }
    const result = await scripts.exportRpyProject();
    if (!result) {
      void dialog.alert({
        title: "Export failed",
        message: "Could not load project scenes. Try refreshing the app.",
      });
      return;
    }
    if (result.sceneCount === 0) {
      void dialog.alert({
        title: "Nothing to export",
        message:
          "No scenes have Ren'Py content yet. Open a scene's Renpy tab and write or paste some content first.",
      });
      return;
    }
    const blob = new Blob([result.text], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    if (result.warnings.length > 0) {
      void dialog.alert({
        title: `Exported ${result.sceneCount} scene(s) — with warnings`,
        message:
          result.warnings.slice(0, 6).join("\n") +
          (result.warnings.length > 6
            ? `\n…and ${result.warnings.length - 6} more`
            : ""),
      });
    }
  };

  // All Ren'Py-labels available across the project — feeds jump/call
  // autocompletion in RenpyTable so the user can pick existing targets
  // and broken jumps light up immediately when a target is missing.
  const projectLabels = useMemo(() => {
    const set = new Set<string>();
    for (const n of scripts.nodes) {
      if (n.kind === "scene" && n.rpy_label?.trim()) {
        set.add(n.rpy_label.trim());
      }
    }
    return Array.from(set).sort();
  }, [scripts.nodes]);

  const editorInitial = useMemo(() => {
    if (!node) return null;
    return {
      nodeId: node.id,
      initialContent: node.content,
      initialMarkdown: node.body,
    };
  }, [node?.id, node?.content, node?.body]);

  const stats = useScriptStats(node?.content ?? null);
  const location: ScriptLocation | null = useMemo(() => {
    if (!node?.location_id) return null;
    return scripts.locations.find((l) => l.id === node.location_id) ?? null;
  }, [node?.location_id, scripts.locations]);

  const povCharacter: ScriptCharacter | null = useMemo(() => {
    if (!node?.pov) return null;
    return (
      scripts.characters.find((c) => c.id === node.pov) ??
      scripts.characters.find(
        (c) => c.name.toLowerCase() === node.pov!.toLowerCase(),
      ) ??
      null
    );
  }, [node?.pov, scripts.characters]);

  // Pre-data state: render a skeleton instead of empty-state messages so
  // workspace switching doesn't flash "Pick or create a project" for a frame.
  if (!scripts.projectsReady) {
    return (
      <main className="main">
        <div className="topbar notes-topbar">
          <span className="crumb">Script</span>
        </div>
        <div className="notes-empty-doc">
          <SkeletonBox style={{ width: 320, maxWidth: "60%" }}>
            <SkeletonBlock height={20} width="80%" />
            <SkeletonBlock height={14} width="60%" style={{ marginTop: 12 }} />
            <SkeletonBlock height={14} width="50%" style={{ marginTop: 8 }} />
          </SkeletonBox>
        </div>
      </main>
    );
  }

  if (!scripts.activeProjectId) {
    return (
      <main className="main">
        <div className="topbar notes-topbar">
          <span className="crumb">Script</span>
        </div>
        <div className="notes-empty-doc fade-in">
          <p>Pick or create a script project from the sidebar.</p>
        </div>
      </main>
    );
  }

  if (!scripts.contentReady) {
    return (
      <main className="main">
        <div className="topbar notes-topbar">
          <span className="crumb">Script</span>
          <span className="crumb-sep">/</span>
          <span className="crumb is-current">
            {scripts.activeProject?.title ?? ""}
          </span>
        </div>
        <div className="notes-empty-doc">
          <SkeletonBox style={{ width: 360, maxWidth: "70%" }}>
            <SkeletonBlock height={24} width="70%" />
            <SkeletonBlock height={14} width="90%" style={{ marginTop: 14 }} />
            <SkeletonBlock height={14} width="80%" style={{ marginTop: 8 }} />
            <SkeletonBlock height={14} width="60%" style={{ marginTop: 8 }} />
          </SkeletonBox>
        </div>
      </main>
    );
  }

  if (!node) {
    return (
      <main className="main">
        <div className="topbar notes-topbar">
          <span className="crumb">Script</span>
          <span className="crumb-sep">/</span>
          <span className="crumb is-current">
            {scripts.activeProject?.title ?? "Untitled"}
          </span>
        </div>
        <div className="notes-empty-doc fade-in">
          <p>Select a scene from the sidebar, or create a new one.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="hbtn"
              onClick={() => void scripts.createNode({ kind: "chapter" })}
            >
              + Chapter
            </button>
            <button
              type="button"
              className="hbtn"
              onClick={() => void scripts.createNode({ kind: "scene" })}
            >
              + Scene
            </button>
          </div>
        </div>
      </main>
    );
  }

  const onTitleChange = (v: string) => {
    setTitleDraft(v);
    scheduleMetaSave(v, emojiDraft);
  };

  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: "Delete scene",
      message: `Delete "${titleDraft || "Untitled"}"? This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (ok) void scripts.deleteNode(node.id);
  };

  const addTag = () => {
    const v = tagDraft.trim();
    if (!v) return;
    if (node.tags.includes(v)) {
      setTagDraft("");
      return;
    }
    void scripts.updateNode(node.id, { tags: [...node.tags, v] });
    setTagDraft("");
  };

  const removeTag = (label: string) => {
    void scripts.updateNode(node.id, {
      tags: node.tags.filter((t) => t !== label),
    });
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagDraft && node.tags.length > 0) {
      removeTag(node.tags[node.tags.length - 1]);
    }
  };

  const setStatus = (status: string) => {
    void scripts.updateNode(node.id, { status });
  };

  const setPov = (charId: string | null) => {
    void scripts.updateNode(node.id, { pov: charId });
  };

  const setLocation = (locId: string | null) => {
    void scripts.updateNode(node.id, { location_id: locId });
  };

  return (
    <main className="main vn-main">
      <div className="topbar notes-topbar">
        <span className="crumb">Script</span>
        <span className="crumb-sep">/</span>
        <span className="crumb">{scripts.activeProject?.title}</span>
        <span className="crumb-sep">/</span>
        <span className="crumb is-current">
          {emojiDraft && <span className="notes-crumb-emoji">{emojiDraft}</span>}
          {titleDraft || "Untitled"}
        </span>
        <div className="topbar-right">
          {savedAgo && <span className="saved">Saved · {savedAgo}</span>}
          <div
            className="vn-view-toggle"
            role="tablist"
            aria-label="View mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "doc"}
              className={
                "vn-view-toggle-btn" + (viewMode === "doc" ? " is-active" : "")
              }
              onClick={() => setViewMode("doc")}
              title="Document view"
            >
              Doc
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "renpy"}
              className={
                "vn-view-toggle-btn" + (viewMode === "renpy" ? " is-active" : "")
              }
              onClick={() => setViewMode("renpy")}
              title="Ren'Py block view (independent of Doc)"
            >
              Renpy
            </button>
          </div>
          <span className="topbar-sep" aria-hidden />
          <div className="topbar-group">
            <button
              className="hbtn fix-hbtn"
              type="button"
              onClick={() => {
                // Two completely different import flows depending on the
                // active tab — Doc parses plaintext into TipTap blocks,
                // Renpy parses .rpy syntax into structured rpy_blocks.
                if (viewMode === "renpy") setRpyImportOpen(true);
                else setImportOpen(true);
              }}
              title={
                viewMode === "renpy"
                  ? "Import a .rpy file"
                  : "Import plain-text script and auto-format"
              }
            >
              Import
            </button>
            {viewMode === "renpy" && (
              <button
                className="hbtn fix-hbtn"
                type="button"
                onClick={() => void onClickExportRpy()}
                title="Export the whole project as a compilable .rpy file"
              >
                Export .rpy
              </button>
            )}
          </div>
          <span className="topbar-sep" aria-hidden />
          <div className="topbar-group">
            <button
              className={"hbtn icon-only" + (node.pinned ? " is-active" : "")}
              type="button"
              aria-label={node.pinned ? "Unpin" : "Pin"}
              onClick={() => void scripts.togglePin(node.id)}
              title={node.pinned ? "Unpin" : "Pin"}
            >
              <StarIcon />
            </button>
            <button
              className="hbtn icon-only"
              type="button"
              aria-label="Delete"
              onClick={() => void handleDelete()}
              title="Delete"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="doc-scroll">
        <div className="doc">
          <div className="doc-emoji-row">
            <input
              className="doc-title-input"
              value={titleDraft}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Untitled"
              spellCheck={false}
            />
          </div>

          <div className="vn-meta-row">
            <Select value={node.status} onValueChange={setStatus}>
              <SelectTrigger
                chevron={false}
                aria-label="Status"
                className="vn-meta-chip vn-meta-status"
              >
                <span className="vn-meta-dot" />
                {STATUS_OPTIONS.find((s) => s.key === node.status)?.label ??
                  "Draft"}
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="vn-meta-sep">·</span>
            <Select
              value={node.pov ?? NONE_VALUE}
              onValueChange={(v) => setPov(v === NONE_VALUE ? null : v)}
            >
              <SelectTrigger
                chevron={false}
                aria-label="POV"
                className={povCharacter ? "vn-meta-pill" : "vn-meta-chip vn-meta-empty"}
              >
                {povCharacter ? (
                  <>
                    <span
                      className="vn-meta-pov-chip"
                      style={{ background: povCharacter.color }}
                    >
                      {(povCharacter.short_name ?? povCharacter.name)
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                    <span className="vn-meta-pov-name">
                      {povCharacter.name}
                    </span>
                  </>
                ) : (
                  "— POV —"
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— POV —</SelectItem>
                {scripts.characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="vn-meta-sep">·</span>
            <Select
              value={node.location_id ?? NONE_VALUE}
              onValueChange={(v) =>
                setLocation(v === NONE_VALUE ? null : v)
              }
            >
              <SelectTrigger
                chevron={false}
                aria-label="Location"
                className="vn-meta-chip"
              >
                {location
                  ? `${location.name}${location.mood ? " · " + location.mood : ""}`
                  : "— location —"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— location —</SelectItem>
                {scripts.locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                    {l.mood ? ` · ${l.mood}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="vn-meta-sep">·</span>
            <span className="vn-meta-stat" title="Words">
              {stats.words} words
            </span>
          </div>

          {(node.tags.length > 0 || tagDraft) && (
            <div className="vn-meta-tags">
              {node.tags.map((t) => (
                <span
                  key={t}
                  className={"tag t-" + colorForTag(t) + " removable"}
                  onClick={() => removeTag(t)}
                  title="Click to remove"
                >
                  {t}
                  <span className="tag-x">×</span>
                </span>
              ))}
              <input
                className="notes-tag-input"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={onTagKey}
                onBlur={addTag}
                placeholder="+ tag"
              />
            </div>
          )}

          {editorInitial && viewMode === "doc" && (
            <Suspense
              fallback={
                <div className="doc-editor-loading">
                  <SkeletonBlock height={20} width="60%" />
                  <SkeletonBlock height={14} width="90%" style={{ marginTop: 12 }} />
                  <SkeletonBlock height={14} width="80%" style={{ marginTop: 8 }} />
                </div>
              }
            >
              <ScriptEditor
                key={editorInitial.nodeId + ":" + externalRevision}
                nodeId={editorInitial.nodeId}
                initialContent={editorInitial.initialContent}
                initialMarkdown={editorInitial.initialMarkdown}
                characters={scripts.characters}
                projectTitle={scripts.activeProject?.title}
                synopsis={scripts.activeProject?.synopsis}
                sceneTitle={node.title}
                povCharacter={povCharacter?.name ?? node.pov ?? null}
                location={location?.name ?? null}
                onChange={onContentChange}
              />
            </Suspense>
          )}

          {editorInitial && viewMode === "renpy" && (
            <RenpyTable
              key={editorInitial.nodeId + ":renpy:" + externalRevision}
              nodeId={editorInitial.nodeId}
              initialBlocks={node.rpy_blocks}
              characters={scripts.characters}
              projectLabels={projectLabels}
              onChange={onRpyBlocksChange}
              onReplace={onRpyBlocksReplace}
            />
          )}

          {viewMode === "doc" && (
            <div className="vn-add-hint">
              <span className="vn-add-hint-plus">+</span>
              <span className="vn-add-hint-text">
                Type '/' for commands · '@' for character
              </span>
            </div>
          )}

          <LinkedEventsSection
            entity_type="script_node"
            entity_id={scripts.activeNodeId}
          />

          <div className="vn-cast-bar">
            <div className="vn-cast-bar-list">
              {scripts.characters.length === 0 ? (
                <span className="vn-cast-bar-empty">
                  No characters yet — add one and their name will start
                  highlighting in the script automatically.
                </span>
              ) : (
                scripts.characters.map((c) => (
                  <span
                    key={c.id}
                    className="vn-cast-bar-chip"
                    title={
                      c.aliases.length > 0
                        ? `Aliases: ${c.aliases.join(", ")}`
                        : c.name
                    }
                  >
                    {c.avatar_url ? (
                      <img
                        src={c.avatar_url}
                        alt=""
                        className="vn-cast-bar-av-img"
                      />
                    ) : (
                      <span
                        className="vn-cast-bar-av"
                        style={{ background: c.color }}
                      >
                        {(c.short_name ?? c.name).slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="vn-cast-bar-chip-name">{c.name}</span>
                  </span>
                ))
              )}
            </div>
            <button
              type="button"
              className="vn-cast-bar-add"
              onClick={onAddCharacter}
            >
              <span className="vn-cast-bar-add-plus">+</span>
              Add character
            </button>
          </div>
        </div>
      </div>

      <ScriptImportModal
        open={importOpen}
        characters={scripts.characters}
        onClose={() => setImportOpen(false)}
        onImport={(parsed, mode) => {
          if (!node) return;
          let nextContent: ScriptContent = parsed;
          if (mode === "append") {
            const existing = node.content as unknown as
              | { type?: string; content?: unknown[] }
              | null;
            const existingBlocks =
              existing && Array.isArray(existing.content) ? existing.content : [];
            const incoming = parsed as unknown as { content?: unknown[] };
            nextContent = {
              type: "doc",
              content: [...existingBlocks, ...(incoming.content ?? [])],
            } as unknown as ScriptContent;
          }
          // Cancel any in-flight content debounce — we're replacing content
          // wholesale, the editor's pending keystrokes would otherwise overwrite
          // the imported data.
          if (contentSaveTimeoutRef.current) {
            clearTimeout(contentSaveTimeoutRef.current);
            contentSaveTimeoutRef.current = null;
          }
          void scripts.updateNode(node.id, { content: nextContent });
          setExternalRevision((n) => n + 1);
        }}
      />

      <RpyImportModal
        open={rpyImportOpen}
        hasActiveProject={!!scripts.activeProjectId}
        defaultCategoryName={scripts.activeProject?.title}
        onClose={() => setRpyImportOpen(false)}
        onImport={async ({ text, mode, categoryName, onProgress }) => {
          onProgress("Parsing…");
          const { parseRpyScript } = await import(
            "../../lib/renpy/scriptParser"
          );
          const parsed = parseRpyScript(text);
          if (parsed.blocks.length === 0) return null;
          return scripts.bulkImportRpy({
            blocks: parsed.blocks,
            mode,
            categoryName,
            onProgress,
          });
        }}
      />
    </main>
  );
}
