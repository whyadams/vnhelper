import {
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
import {
  ScriptEditor,
  useScriptStats,
} from "./ScriptEditor";
import { ScriptTable } from "./ScriptTable";
import { ScriptImportModal } from "./ScriptImportModal";
import { useDialog } from "../ui/Dialog";
import { SkeletonBlock, SkeletonBox } from "../ui/Skeleton";

type ScriptViewMode = "doc" | "table";

type ScriptsApi = ReturnType<typeof import("../../state/scripts").useScripts>;

const META_SAVE_DEBOUNCE_MS = 500;
const CONTENT_SAVE_DEBOUNCE_MS = 800;

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
  const node = scripts.activeNode;

  const [titleDraft, setTitleDraft] = useState("");
  const [emojiDraft, setEmojiDraft] = useState("");
  const [editingEmoji, setEditingEmoji] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [savedAgo, setSavedAgo] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ScriptViewMode>("doc");
  const [importOpen, setImportOpen] = useState(false);
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

  const onContentChange = (content: ScriptContent) => {
    if (!node) return;
    if (contentSaveTimeoutRef.current)
      clearTimeout(contentSaveTimeoutRef.current);
    contentSaveTimeoutRef.current = setTimeout(() => {
      void scripts.updateNode(node.id, { content });
    }, CONTENT_SAVE_DEBOUNCE_MS);
  };

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
  const onEmojiCommit = (v: string) => {
    const next = v.trim().slice(0, 4);
    setEmojiDraft(next);
    setEditingEmoji(false);
    scheduleMetaSave(titleDraft, next);
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
              aria-selected={viewMode === "table"}
              className={
                "vn-view-toggle-btn" + (viewMode === "table" ? " is-active" : "")
              }
              onClick={() => setViewMode("table")}
              title="Table view"
            >
              Table
            </button>
          </div>
          <button
            className="hbtn"
            type="button"
            onClick={() => setImportOpen(true)}
            title="Import plain-text script and auto-format"
          >
            Import
          </button>
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

      <div className="doc-scroll">
        <div className="doc">
          <div className="doc-emoji-row">
            {editingEmoji ? (
              <input
                className="doc-emoji-input"
                autoFocus
                value={emojiDraft}
                onChange={(e) => setEmojiDraft(e.target.value)}
                onBlur={(e) => onEmojiCommit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setEmojiDraft(node.emoji ?? "");
                    setEditingEmoji(false);
                  }
                }}
                placeholder="🎬"
                maxLength={4}
              />
            ) : (
              <button
                type="button"
                className="doc-emoji-wrap doc-emoji-btn"
                onClick={() => setEditingEmoji(true)}
                title="Set emoji"
              >
                {emojiDraft ? (
                  <span className="doc-emoji-large">{emojiDraft}</span>
                ) : (
                  <span className="doc-emoji-placeholder">+ Emoji</span>
                )}
              </button>
            )}
            <input
              className="doc-title-input"
              value={titleDraft}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Untitled"
              spellCheck={false}
            />
          </div>

          <div className="vn-meta-row">
            <span className="vn-meta-chip vn-meta-status">
              <span className="vn-meta-dot" />
              {STATUS_OPTIONS.find((s) => s.key === node.status)?.label ??
                "Draft"}
              <select
                className="vn-meta-overlay"
                value={node.status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </span>
            <span className="vn-meta-sep">·</span>
            {povCharacter ? (
              <span className="vn-meta-pill">
                <span
                  className="vn-meta-pov-chip"
                  style={{ background: povCharacter.color }}
                >
                  {(povCharacter.short_name ?? povCharacter.name)
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <span className="vn-meta-pov-name">{povCharacter.name}</span>
                <select
                  className="vn-meta-overlay"
                  value={node.pov ?? ""}
                  onChange={(e) => setPov(e.target.value || null)}
                  aria-label="POV"
                >
                  <option value="">— POV —</option>
                  {scripts.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </span>
            ) : (
              <span className="vn-meta-chip vn-meta-empty">
                — POV —
                <select
                  className="vn-meta-overlay"
                  value={node.pov ?? ""}
                  onChange={(e) => setPov(e.target.value || null)}
                  aria-label="POV"
                >
                  <option value="">— POV —</option>
                  {scripts.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <span className="vn-meta-sep">·</span>
            <span className="vn-meta-chip">
              {location
                ? `${location.name}${location.mood ? " · " + location.mood : ""}`
                : "— location —"}
              <select
                className="vn-meta-overlay"
                value={node.location_id ?? ""}
                onChange={(e) => setLocation(e.target.value || null)}
                aria-label="Location"
              >
                <option value="">— location —</option>
                {scripts.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.mood ? ` · ${l.mood}` : ""}
                  </option>
                ))}
              </select>
            </span>
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
          )}

          {editorInitial && viewMode === "table" && (
            <ScriptTable
              key={editorInitial.nodeId + ":" + externalRevision}
              initialContent={editorInitial.initialContent}
              characters={scripts.characters}
              onChange={onContentChange}
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
    </main>
  );
}
