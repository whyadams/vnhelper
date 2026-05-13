import { useEffect, useMemo, useRef, useState } from "react";
import { parseRpyScript } from "../../lib/renpy/scriptParser";
import { countTopLevelLabels } from "../../lib/renpy/splitByLabels";

interface Props {
  open: boolean;
  /** Whether a project is active. If not, we show a hint instead of the
   *  form — there's no destination to import into. */
  hasActiveProject: boolean;
  /** Defaults the chapter/scene title to something meaningful when the
   *  user pastes content. Usually the active project's name. */
  defaultCategoryName?: string;
  onClose: () => void;
  /** Returns the new chapter (split) or scene (single) id. The modal
   *  closes itself on success. */
  onImport: (opts: {
    text: string;
    mode: "split" | "single";
    categoryName: string;
    onProgress: (step: string, current?: number, total?: number) => void;
  }) => Promise<string | null>;
}

type Mode = "split" | "single";

/**
 * Ren'Py import dialog. Two paths:
 *
 *   - "split"  — break the imported .rpy into one scene per top-level
 *     `label X:`, grouped under a new chapter named by the user. Best
 *     for files with many scenes (keeps the editor snappy and surfaces
 *     structure in the sidebar).
 *
 *   - "single" — one scene carrying the whole file's blocks. Best for
 *     short fragments or when the user wants to manually re-organize.
 *
 * Parsing is synchronous and fast (a couple hundred ms for a 3000-line
 * file). The Supabase insert that follows can take a second or two for
 * a chapter + 30 scenes, so we show a progress strip while it runs.
 */
export function RpyImportModal({
  open,
  hasActiveProject,
  defaultCategoryName,
  onClose,
  onImport,
}: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("split");
  const [categoryName, setCategoryName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progressNum, setProgressNum] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    setMode("split");
    setCategoryName(defaultCategoryName ?? "");
    setParseError(null);
    setProgressLabel(null);
    setProgressNum(null);
    // Focus the paste area on next frame so the dialog has time to mount.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [open, defaultCategoryName]);

  // Live preview — count labels in the pasted text without committing.
  const stats = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      const parsed = parseRpyScript(trimmed);
      return {
        labels: countTopLevelLabels(parsed.blocks),
        blocks: parsed.blocks.length,
        warnings: parsed.warnings.length,
      };
    } catch {
      return null;
    }
  }, [text]);

  if (!open) return null;

  const busy = progressLabel !== null;

  const submit = async () => {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setParseError("Paste some Ren'Py content first.");
      return;
    }
    if (mode === "split" && !categoryName.trim()) {
      setParseError("Choose a category name for the new chapter.");
      return;
    }
    setParseError(null);
    setProgressLabel("Parsing…");
    try {
      const id = await onImport({
        text: trimmed,
        mode,
        categoryName: categoryName.trim(),
        onProgress: (step, current, total) => {
          setProgressLabel(step);
          if (typeof current === "number" && typeof total === "number") {
            setProgressNum({ current, total });
          }
        },
      });
      if (id) {
        onClose();
      } else {
        setParseError("Import failed. Check the console for details.");
        setProgressLabel(null);
        setProgressNum(null);
      }
    } catch (e) {
      setParseError(
        e instanceof Error ? e.message : "Unknown import error.",
      );
      setProgressLabel(null);
      setProgressNum(null);
    }
  };

  return (
    <div
      className="vn-modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="vn-modal vn-modal-import"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <span className="vn-modal-title">Import Ren'Py script</span>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={() => {
              if (!busy) onClose();
            }}
            aria-label="Close"
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="vn-modal-body vn-rpy-import-body">
          {!hasActiveProject ? (
            <p className="vn-rpy-import-empty">
              Create or pick a script project first — there's no
              destination for the import.
            </p>
          ) : (
            <>
              <label className="vn-modal-label">Paste .rpy content</label>
              <textarea
                ref={textareaRef}
                className="vn-input vn-rpy-import-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  "label scene_start:\n" +
                  '    play music "music/track.mp3"\n' +
                  "    scene bg with dissolve\n" +
                  '    mc "Hello"\n\n' +
                  "label scene_two:\n" +
                  "    …"
                }
                spellCheck={false}
                rows={10}
                disabled={busy}
              />

              {stats && (
                <div className="vn-rpy-import-stats">
                  <span>{stats.blocks} blocks</span>
                  <span>·</span>
                  <span>
                    {stats.labels} Ren'Py label
                    {stats.labels === 1 ? "" : "s"}
                  </span>
                  {stats.warnings > 0 && (
                    <>
                      <span>·</span>
                      <span className="vn-rpy-import-stat-warn">
                        {stats.warnings} warning
                        {stats.warnings === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="vn-rpy-import-modes">
                <label
                  className={
                    "vn-rpy-import-mode" +
                    (mode === "split" ? " is-active" : "")
                  }
                >
                  <input
                    type="radio"
                    name="rpy-import-mode"
                    value="split"
                    checked={mode === "split"}
                    onChange={() => setMode("split")}
                    disabled={busy}
                  />
                  <div className="vn-rpy-import-mode-body">
                    <div className="vn-rpy-import-mode-title">
                      Split by labels
                      {stats && stats.labels > 1 && (
                        <span className="vn-rpy-import-mode-badge">
                          {stats.labels} scenes
                        </span>
                      )}
                    </div>
                    <div className="vn-rpy-import-mode-sub">
                      Each <code>label X:</code> becomes its own scene under
                      a new chapter. Recommended for files with many labels
                      — keeps the editor responsive.
                    </div>
                  </div>
                </label>

                <label
                  className={
                    "vn-rpy-import-mode" +
                    (mode === "single" ? " is-active" : "")
                  }
                >
                  <input
                    type="radio"
                    name="rpy-import-mode"
                    value="single"
                    checked={mode === "single"}
                    onChange={() => setMode("single")}
                    disabled={busy}
                  />
                  <div className="vn-rpy-import-mode-body">
                    <div className="vn-rpy-import-mode-title">
                      Import as one scene
                    </div>
                    <div className="vn-rpy-import-mode-sub">
                      Keep all content in a single scene. Fine for short
                      fragments; large files will be slow to edit.
                    </div>
                  </div>
                </label>
              </div>

              {mode === "split" && (
                <>
                  <label className="vn-modal-label">Category name</label>
                  <input
                    type="text"
                    className="vn-input"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder="e.g. Chapter 1, Prologue, …"
                    disabled={busy}
                  />
                  <div className="vn-rpy-import-hint">
                    New chapter that will hold the imported scenes.
                  </div>
                </>
              )}

              {progressLabel && (
                <div className="vn-rpy-import-progress">
                  <div className="vn-rpy-import-progress-label">
                    {progressLabel}
                    {progressNum && (
                      <>
                        {" "}
                        ({progressNum.current} / {progressNum.total})
                      </>
                    )}
                  </div>
                  <div className="vn-rpy-import-progress-bar">
                    <div
                      className="vn-rpy-import-progress-fill"
                      style={{
                        width: progressNum
                          ? `${(progressNum.current / Math.max(1, progressNum.total)) * 100}%`
                          : "30%",
                      }}
                    />
                  </div>
                </div>
              )}

              {parseError && (
                <div className="vn-rpy-import-error">{parseError}</div>
              )}
            </>
          )}
        </div>

        <div className="vn-modal-foot">
          <button
            type="button"
            className="hbtn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={() => void submit()}
            disabled={busy || !hasActiveProject || !text.trim()}
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
