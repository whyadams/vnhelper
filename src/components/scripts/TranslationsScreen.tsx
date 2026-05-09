import { useEffect, useMemo, useRef, useState } from "react";
import {
  useTranslations,
  type TranslationEntry,
  type TranslationsApi,
} from "../../state/translations";
import { useDialog } from "../ui/Dialog";

interface Props {
  workspaceId: string | null;
  projectId: string | null;
  projectTitle: string | undefined;
  onBack: () => void;
}

type Filter = "all" | "untranslated" | "translated" | "orphaned";

export function TranslationsScreen({
  workspaceId,
  projectId,
  projectTitle,
  onBack,
}: Props) {
  const tl = useTranslations(workspaceId, projectId);

  return (
    <main className="vn-tl-main">
      <Topbar tl={tl} projectTitle={projectTitle} onBack={onBack} />
      <div className="vn-tl-body">
        <FileTree tl={tl} />
        <EntriesPane tl={tl} />
      </div>
    </main>
  );
}

// ============================================================
// Topbar — back button, project label, upload, export
// ============================================================
function Topbar({
  tl,
  projectTitle,
  onBack,
}: {
  tl: TranslationsApi;
  projectTitle: string | undefined;
  onBack: () => void;
}) {
  const dialog = useDialog();
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const onPickFolder = () => folderInputRef.current?.click();

  const onFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = "";
    if (!list) return;
    setBusy(true);
    try {
      const stats = await tl.uploadFolder(list);
      const lines = [
        `+${stats.filesAdded} files added`,
        `↻${stats.filesUpdated} files updated`,
        `+${stats.entriesInserted} entries inserted`,
        `↻${stats.entriesRefreshed} entries refreshed`,
        stats.entriesOrphaned > 0
          ? `⚠${stats.entriesOrphaned} orphaned`
          : null,
        ...(stats.errors.length > 0
          ? [`Errors: ${stats.errors.slice(0, 3).join(" · ")}`]
          : []),
      ].filter(Boolean);
      await dialog.alert({
        title: "Import done",
        message: lines.join("\n"),
      });
    } finally {
      setBusy(false);
    }
  };

  const exportLang = async (lang: string) => {
    const zip = await tl.exportLanguage(lang);
    if (!zip) return;
    const blob = new Blob([zip], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lang}-translations.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vn-cast-topbar tmt-bar">
      <button
        type="button"
        className="vn-cast-back"
        onClick={onBack}
        title="Back to script"
        aria-label="Back"
      >
        ←
      </button>
      <span className="vn-cast-crumb">
        Script <span className="vn-cast-sep">/</span>{" "}
        <span className="vn-cast-crumb-active">
          {projectTitle ?? "Project"}
        </span>{" "}
        <span className="vn-cast-sep">/</span> Translations
      </span>
      <span className="vn-pane-spacer" />
      {tl.languages.map((lang) => (
        <button
          key={lang}
          type="button"
          className="hbtn"
          onClick={() => void exportLang(lang)}
          title={`Export ${lang} as zip`}
        >
          ⇩ {lang}
        </button>
      ))}
      <button
        type="button"
        className="hbtn is-primary"
        onClick={onPickFolder}
        disabled={busy}
      >
        {busy ? "Importing…" : "Upload folder"}
      </button>
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error non-standard but supported in Chromium webview
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: "none" }}
        onChange={(e) => void onFolderChange(e)}
      />
    </div>
  );
}

// ============================================================
// File tree — left pane
// ============================================================
function FileTree({ tl }: { tl: TranslationsApi }) {
  const dialog = useDialog();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand active language on first render
  useEffect(() => {
    if (tl.languages.length > 0 && expanded.size === 0) {
      setExpanded(new Set(tl.languages));
    }
  }, [tl.languages, expanded.size]);

  const toggle = (lang: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });
  };

  return (
    <aside className="vn-tl-tree">
      {tl.languages.length === 0 && (
        <div className="vn-tl-empty">
          No translation files yet.
          <br />
          Click <strong>Upload folder</strong> above to import a Ren'Py
          translation directory.
        </div>
      )}
      {tl.languages.map((lang) => {
        const langFiles = tl.filesByLanguage.get(lang) ?? [];
        const isOpen = expanded.has(lang);
        return (
          <div key={lang} className="vn-tl-lang">
            <button
              type="button"
              className="vn-tl-lang-head"
              onClick={() => toggle(lang)}
            >
              <span className={"vn-tl-chev" + (isOpen ? " is-open" : "")}>
                ›
              </span>
              <span className="vn-tl-lang-name">{lang}</span>
              <span className="vn-tl-count">{langFiles.length}</span>
            </button>
            {isOpen && (
              <div className="vn-tl-files">
                {langFiles.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={
                      "vn-tl-file" +
                      (tl.activeFileId === f.id ? " is-active" : "")
                    }
                    onClick={() => tl.setActiveFileId(f.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      void (async () => {
                        const ok = await dialog.confirm({
                          title: "Delete file",
                          message: `Remove "${f.relative_path}" and all its translations?`,
                          variant: "danger",
                          confirmLabel: "Delete",
                        });
                        if (ok) await tl.deleteFile(f.id);
                      })();
                    }}
                    title={f.relative_path}
                  >
                    {f.relative_path}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}

// ============================================================
// Entries pane — right side
// ============================================================
function EntriesPane({ tl }: { tl: TranslationsApi }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = tl.entries;
    if (filter === "untranslated") {
      list = list.filter((e) => e.status === "untranslated");
    } else if (filter === "translated") {
      list = list.filter(
        (e) => e.status === "translated" || e.status === "reviewed",
      );
    } else if (filter === "orphaned") {
      list = list.filter((e) => e.status === "orphaned");
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.old_text.toLowerCase().includes(q) ||
          e.new_text.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tl.entries, filter, search]);

  if (!tl.activeFileId) {
    return (
      <section className="vn-tl-pane">
        <div className="vn-tl-empty">
          Select a file from the tree on the left to start translating.
        </div>
      </section>
    );
  }

  const { total, translated, orphaned } = tl.fileStats;
  const pct = total > 0 ? Math.round((translated / total) * 100) : 0;

  return (
    <section className="vn-tl-pane">
      <div className="vn-tl-pane-head">
        <div className="vn-tl-progress">
          <div className="vn-tl-progress-bar">
            <div
              className="vn-tl-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="vn-tl-progress-label">
            {translated} / {total} ({pct}%)
            {orphaned > 0 && (
              <span className="vn-tl-orphan-note"> · {orphaned} orphan</span>
            )}
          </span>
        </div>
        <div className="vn-tl-filters">
          <FilterChip
            label="All"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterChip
            label="Untranslated"
            active={filter === "untranslated"}
            onClick={() => setFilter("untranslated")}
          />
          <FilterChip
            label="Translated"
            active={filter === "translated"}
            onClick={() => setFilter("translated")}
          />
          {orphaned > 0 && (
            <FilterChip
              label="Orphaned"
              active={filter === "orphaned"}
              onClick={() => setFilter("orphaned")}
            />
          )}
          <input
            className="vn-input vn-tl-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="vn-tl-entries">
        {filtered.length === 0 && (
          <div className="vn-tl-empty">No entries match.</div>
        )}
        {filtered.map((e) => (
          <EntryRow key={e.id} entry={e} tl={tl} />
        ))}
      </div>
    </section>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"vn-tl-chip" + (active ? " is-active" : "")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function EntryRow({
  entry,
  tl,
}: {
  entry: TranslationEntry;
  tl: TranslationsApi;
}) {
  const [draft, setDraft] = useState(entry.new_text);

  // Sync external updates (e.g. realtime) into the input as long as user
  // hasn't typed something new.
  useEffect(() => {
    setDraft(entry.new_text);
  }, [entry.id, entry.new_text]);

  const commit = () => {
    if (draft !== entry.new_text) {
      void tl.setEntryNew(entry.id, draft);
    }
  };

  return (
    <div
      className={
        "vn-tl-row" +
        (entry.status === "orphaned" ? " is-orphan" : "") +
        (entry.status === "translated" ? " is-translated" : "")
      }
    >
      <div className="vn-tl-meta">
        {entry.source_file && (
          <span className="vn-tl-source">
            {entry.source_file}:{entry.source_line}
          </span>
        )}
        <StatusChip status={entry.status} />
      </div>
      <div className="vn-tl-pair">
        <div className="vn-tl-old">{entry.old_text}</div>
        <textarea
          className="vn-tl-new"
          value={draft}
          rows={Math.max(1, Math.min(6, draft.split("\n").length))}
          placeholder="(translation)"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          }}
        />
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: TranslationEntry["status"] }) {
  const label =
    status === "translated"
      ? "✓"
      : status === "reviewed"
        ? "✓✓"
        : status === "orphaned"
          ? "orphan"
          : "·";
  return <span className={"vn-tl-status t-" + status}>{label}</span>;
}
