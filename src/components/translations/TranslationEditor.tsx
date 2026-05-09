import { useCallback, useMemo, useRef, useState } from "react";
import type { Role } from "../../lib/roles";
import type {
  StringStatus,
  TranslationFile,
  TranslationsApi,
  TranslationString,
} from "../../state/translations";
import { StringRow } from "./StringRow";

interface Props {
  api: TranslationsApi;
  file: TranslationFile;
  role: Role;
  sourceLang: string;
  canEdit: boolean;
  onExport: () => void;
  onImport: () => void;
}

type StatusFilter = "all" | StringStatus;

export function TranslationEditor({
  api,
  file,
  role,
  canEdit,
  onExport,
}: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    let empty = 0,
      draft = 0,
      done = 0;
    for (const s of api.strings) {
      if (s.status === "empty") empty++;
      else if (s.status === "draft") draft++;
      else done++;
    }
    return { all: api.strings.length, empty, draft, done };
  }, [api.strings]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return api.strings.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.sourceText.toLowerCase().includes(q) ||
        s.translatedText.toLowerCase().includes(q) ||
        s.sourcePath.toLowerCase().includes(q)
      );
    });
  }, [api.strings, search, statusFilter]);

  // Group consecutive rows by groupLabel — used only as a structural marker
  // for the renderer; the label itself is no longer shown to the user
  // (it carries Ren'Py-generated metadata like "Translation updated at ...").
  // The label is still kept in the parsed model so export round-trips it.
  const groups = useMemo(() => {
    const out: { label: string | null; rows: TranslationString[] }[] = [];
    for (const row of visible) {
      const last = out[out.length - 1];
      if (last && last.label === row.groupLabel) {
        last.rows.push(row);
      } else {
        out.push({ label: row.groupLabel, rows: [row] });
      }
    }
    return out;
  }, [visible]);

  const total = counts.all;
  const pct = total === 0 ? 0 : Math.round((counts.done / total) * 100);

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => {
      const el = rowsRef.current?.querySelector<HTMLTextAreaElement>(
        `textarea[data-row-id="${id}"]`,
      );
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }, []);

  const advanceFromRow = useCallback(
    (id: string) => {
      const idx = visible.findIndex((s) => s.id === id);
      if (idx === -1) return;
      for (let i = idx + 1; i < visible.length; i++) {
        if (visible[i].status !== "done") {
          focusRow(visible[i].id);
          return;
        }
      }
      const next = visible[idx + 1];
      if (next) focusRow(next.id);
    },
    [visible, focusRow],
  );

  const project = api.projects.find((p) => p.id === api.activeProjectId);
  const langLabel = project?.name ?? file.target_language;
  const folderSegments = useMemo(
    () =>
      (file.folder_path ?? "")
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean),
    [file.folder_path],
  );

  const onShellKeyDown = (e: React.KeyboardEvent) => {
    // ⌘K / Ctrl+K — focus search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    // ⌘E / Ctrl+E — export current file (no toolbar button per Figma).
    if (
      canEdit &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "e" &&
      api.strings.length > 0
    ) {
      e.preventDefault();
      onExport();
    }
  };

  return (
    <div className="tr-editor-shell" onKeyDown={onShellKeyDown}>
      {/* ===== Header (col3Head) ===== */}
      <div className="tr-ed-head">
        <div className="tr-ed-head-row">
          <nav className="tr-ed-breadcrumb" aria-label="File location">
            <span className="tr-bc-root" title={langLabel}>
              {langLabel}
            </span>
            {folderSegments.map((seg, i) => (
              <span key={i} className="tr-bc-group">
                <span className="tr-bc-sep" aria-hidden>
                  /
                </span>
                <span className="tr-bc-item" title={seg}>
                  {seg}
                </span>
              </span>
            ))}
            <span className="tr-bc-sep" aria-hidden>
              /
            </span>
            <span className="tr-bc-current" title={file.filename}>
              {file.filename}
            </span>
          </nav>

          <div className="tr-ed-mini-progress" aria-label="Translation progress">
            <span
              className={
                "tr-mini-pct" + (pct === 100 ? " is-complete" : "")
              }
            >
              {pct}%
            </span>
            <div className="tr-mini-bar">
              <div
                className={
                  "tr-mini-bar-fill" + (pct === 100 ? " is-complete" : "")
                }
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ===== Toolbar ===== */}
      <div className="tr-ed-toolbar">
        <label className="tr-search">
          <input
            ref={searchRef}
            className="tr-search-input"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="tr-kbd" aria-hidden>
            ⌘K
          </span>
        </label>

        <div
          className="tr-chips"
          role="tablist"
          aria-label="Filter by status"
        >
          <FilterChip
            label="All"
            count={counts.all}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <FilterChip
            label="Empty"
            count={counts.empty}
            active={statusFilter === "empty"}
            onClick={() => setStatusFilter("empty")}
          />
          <FilterChip
            label="Draft"
            count={counts.draft}
            active={statusFilter === "draft"}
            onClick={() => setStatusFilter("draft")}
          />
          <FilterChip
            label="Done"
            count={counts.done}
            active={statusFilter === "done"}
            onClick={() => setStatusFilter("done")}
          />
        </div>
      </div>

      {/* ===== Strings list ===== */}
      <div className="tr-rows" ref={rowsRef}>
        {groups.length === 0 ? (
          <div className="tr-empty">
            <p>No strings match the current filter.</p>
          </div>
        ) : (
          groups.map((g, i) => (
            <div key={`g-${i}-${g.label ?? ""}`} className="tr-group">
              {g.label && (
                <div
                  className="tr-group-divider"
                  role="separator"
                  aria-label={g.label}
                >
                  <span className="tr-group-divider-line" aria-hidden />
                  <span className="tr-group-divider-label">{g.label}</span>
                  <span className="tr-group-divider-line" aria-hidden />
                </div>
              )}
              {g.rows.map((row) => (
                <StringRow
                  key={row.id}
                  row={row}
                  fileTargetLang={file.target_language}
                  role={role}
                  isFocused={focusedId === row.id}
                  onFocus={() => setFocusedId(row.id)}
                  onAdvance={() => advanceFromRow(row.id)}
                  onUpdate={(patch) => api.updateString(row.id, patch)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface ChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, count, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={"tr-chip" + (active ? " is-active" : "")}
      onClick={onClick}
    >
      <span className="tr-chip-label">{label}</span>
      <span className="tr-chip-count">{count}</span>
    </button>
  );
}
