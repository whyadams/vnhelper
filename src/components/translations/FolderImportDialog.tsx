import { useEffect, useMemo, useState } from "react";
import {
  detectRenpyLanguage,
  parseRenpyTranslations,
} from "../../lib/renpy";
import type { FolderImportItem } from "./TranslationsSidebar";

interface PreviewItem {
  filename: string;
  folderPath: string;
  content: string;
  count: number;
  warnings: number;
  detectedLang: string;
  selected: boolean;
  status: "pending" | "importing" | "done" | "error";
  error?: string;
}

interface Props {
  open: boolean;
  items: FolderImportItem[] | null;
  // The active translation's target language — files are imported under it.
  defaultTargetLang: string;
  onClose: () => void;
  onImport: (
    filename: string,
    content: string,
    targetLang: string,
    folderPath: string,
  ) => Promise<{ inserted: number; warnings: number } | null>;
}

export function FolderImportDialog({
  open,
  items: incoming,
  defaultTargetLang,
  onClose,
  onImport,
}: Props) {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [overrideLang, setOverrideLang] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setErr(null);
    setOverrideLang("");
    setItems([]);
    if (!incoming || incoming.length === 0) return;

    let cancelled = false;
    setParsing(true);
    (async () => {
      const out: PreviewItem[] = [];
      for (const it of incoming) {
        try {
          const content = await it.file.text();
          const parsed = parseRenpyTranslations(content);
          const lang = detectRenpyLanguage(content) ?? "russian";
          out.push({
            filename: it.filename,
            folderPath: it.folderPath,
            content,
            count: parsed.strings.length,
            warnings: parsed.warnings.length,
            detectedLang: lang,
            selected: parsed.strings.length > 0,
            status: "pending",
          });
        } catch (e) {
          out.push({
            filename: it.filename,
            folderPath: it.folderPath,
            content: "",
            count: 0,
            warnings: 0,
            detectedLang: "russian",
            selected: false,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (!cancelled) {
        setItems(out);
        setParsing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, incoming]);

  const stats = useMemo(() => {
    const selected = items.filter((it) => it.selected);
    const totalStrings = selected.reduce((sum, it) => sum + it.count, 0);
    const langs = Array.from(
      new Set(selected.map((it) => it.detectedLang)),
    ).sort();
    return {
      filesSel: selected.length,
      totalFiles: items.length,
      totalStrings,
      langs,
    };
  }, [items]);

  if (!open) return null;

  const toggle = (i: number) => {
    setItems((cur) =>
      cur.map((it, idx) =>
        idx === i ? { ...it, selected: !it.selected } : it,
      ),
    );
  };

  const toggleAll = (val: boolean) => {
    setItems((cur) => cur.map((it) => ({ ...it, selected: val && it.count > 0 })));
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.selected || it.status === "done") continue;
        setItems((cur) =>
          cur.map((x, idx) => (idx === i ? { ...x, status: "importing" } : x)),
        );
        try {
          const targetLang =
            overrideLang.trim() || defaultTargetLang || it.detectedLang;
          await onImport(it.filename, it.content, targetLang, it.folderPath);
          setItems((cur) =>
            cur.map((x, idx) =>
              idx === i ? { ...x, status: "done" } : x,
            ),
          );
        } catch (e) {
          setItems((cur) =>
            cur.map((x, idx) =>
              idx === i
                ? {
                    ...x,
                    status: "error",
                    error: e instanceof Error ? e.message : String(e),
                  }
                : x,
            ),
          );
        }
      }
      // Auto-close if everything succeeded
      const stillPending = items.some(
        (it) =>
          it.selected && (it.status === "pending" || it.status === "importing"),
      );
      const anyErrors = items.some(
        (it) => it.selected && it.status === "error",
      );
      if (!stillPending && !anyErrors) onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const allSelected =
    items.length > 0 && items.every((it) => it.selected || it.count === 0);

  return (
    <div className="vn-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="vn-modal tr-folder-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <h3>Import folder</h3>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="vn-modal-body tr-folder-body">
          {parsing ? (
            <div className="tr-folder-loading">Reading files…</div>
          ) : (
            <>
              <div className="tr-folder-summary">
                <div>
                  <strong>{stats.filesSel}</strong> of {stats.totalFiles} files
                  ·{" "}
                  <strong>{stats.totalStrings.toLocaleString()}</strong> strings
                </div>
                <div className="tr-folder-langs">
                  <span className="tr-folder-summary-into">into</span>
                  <span className="tr-file-tag">
                    {overrideLang.trim() || defaultTargetLang}
                  </span>
                </div>
              </div>

              <div className="tr-folder-controls">
                <label className="tr-folder-checkall">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    disabled={busy}
                  />
                  <span>Select all</span>
                </label>
                <div className="tr-folder-override">
                  <span className="vn-modal-label tr-folder-override-label">
                    Override language
                  </span>
                  <input
                    className="vn-input tr-folder-override-input"
                    placeholder="auto-detect"
                    value={overrideLang}
                    onChange={(e) => setOverrideLang(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="tr-folder-list">
                {items.map((it, i) => (
                  <label
                    key={i}
                    className={
                      "tr-folder-item is-" +
                      it.status +
                      (it.count === 0 ? " is-disabled" : "")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={it.selected}
                      onChange={() => toggle(i)}
                      disabled={busy || it.count === 0}
                    />
                    <div className="tr-folder-item-text">
                      <div
                        className="tr-folder-item-name"
                        title={
                          it.folderPath
                            ? `${it.folderPath}/${it.filename}`
                            : it.filename
                        }
                      >
                        {it.folderPath && (
                          <span className="tr-folder-item-path">
                            {it.folderPath}/
                          </span>
                        )}
                        {it.filename}
                      </div>
                      <div className="tr-folder-item-meta">
                        {it.count === 0 ? (
                          <span className="tr-folder-warn">no strings</span>
                        ) : (
                          <>
                            <span>
                              {it.count.toLocaleString()}{" "}
                              {it.count === 1 ? "string" : "strings"}
                            </span>
                            <span className="tr-dot" />
                            <span className="tr-file-tag">
                              {it.detectedLang}
                            </span>
                            {it.warnings > 0 && (
                              <>
                                <span className="tr-dot" />
                                <span className="tr-folder-warn">
                                  {it.warnings} warnings
                                </span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                      {it.error && (
                        <div className="tr-folder-item-error">{it.error}</div>
                      )}
                    </div>
                    <div className="tr-folder-item-status">
                      {it.status === "importing" && <span>importing…</span>}
                      {it.status === "done" && (
                        <span className="tr-folder-ok">✓</span>
                      )}
                      {it.status === "error" && (
                        <span className="tr-folder-err">!</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          {err && <div className="vn-modal-error">{err}</div>}
        </div>

        <div className="vn-modal-foot">
          <button
            type="button"
            className="hbtn"
            onClick={onClose}
            disabled={busy}
          >
            {busy ? "Working…" : "Cancel"}
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={() => void submit()}
            disabled={busy || parsing || stats.filesSel === 0}
          >
            {busy
              ? `Importing… (${items.filter((it) => it.status === "done").length}/${stats.filesSel})`
              : `Import ${stats.filesSel} file${stats.filesSel === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
