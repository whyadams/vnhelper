import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  projectName: string;
  filesCount: number;
  pct: number;
  onImportFile: () => void;
  onExportToFolder: () => void;
  onExportAsDownloads: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function TranslationSettingsScreen({
  open,
  onClose,
  projectName,
  filesCount,
  pct,
  onImportFile,
  onExportToFolder,
  onExportAsDownloads,
  onRename,
  onDelete,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Close the overlay before triggering downstream UI (folder picker, dialog
  // prompts, import modal) so they don't open on top of an obsolete pane.
  const after = (fn: () => void) => () => {
    onClose();
    setTimeout(fn, 0);
  };

  return (
    <div
      className="set-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${projectName} settings`}
    >
      <div className="set-topbar">
        <button
          type="button"
          className="set-back"
          onClick={onClose}
          aria-label="Close translation settings"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 12L6 8l4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {projectName}
        </button>
      </div>
      <div className="set-content">
        <div className="set-content-inner">
          <div className="set-section-head">
            <h2 className="set-section-h">Translation settings</h2>
            <p className="set-section-sub">
              {filesCount} {filesCount === 1 ? "file" : "files"} · {pct}%
              переведено
            </p>
          </div>

          <div className="tr-set-group">
            <h3 className="tr-set-group-title">Import</h3>
            <div className="tr-set-rows">
              <div className="set-row">
                <div className="set-row-label">
                  <div className="set-row-title">Import single file</div>
                  <div className="set-row-desc">
                    Добавить один <code>.rpy</code> в текущий проект.
                  </div>
                </div>
                <div className="set-row-control">
                  <button
                    type="button"
                    className="set-btn"
                    onClick={after(onImportFile)}
                  >
                    Import…
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="tr-set-group">
            <h3 className="tr-set-group-title">Export</h3>
            <div className="tr-set-rows">
              <div className="set-row">
                <div className="set-row-label">
                  <div className="set-row-title">Export to folder</div>
                  <div className="set-row-desc">
                    Сохранить все <code>.rpy</code> в выбранную папку с
                    сохранением исходной структуры. Рекомендуемый способ для
                    desktop.
                  </div>
                </div>
                <div className="set-row-control">
                  <button
                    type="button"
                    className="set-btn is-primary"
                    onClick={after(onExportToFolder)}
                  >
                    Export…
                  </button>
                </div>
              </div>
              <div className="set-row">
                <div className="set-row-label">
                  <div className="set-row-title">Export as downloads</div>
                  <div className="set-row-desc">
                    Скачать каждый файл отдельно через браузер — удобно, если
                    нужно загрузить файлы в веб-форму. Структура папок
                    кодируется в имена файлов.
                  </div>
                </div>
                <div className="set-row-control">
                  <button
                    type="button"
                    className="set-btn"
                    onClick={after(onExportAsDownloads)}
                  >
                    Download all
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="tr-set-group">
            <h3 className="tr-set-group-title">Translation</h3>
            <div className="tr-set-rows">
              <div className="set-row">
                <div className="set-row-label">
                  <div className="set-row-title">Rename</div>
                  <div className="set-row-desc">
                    Изменить название перевода (обычно — целевой язык).
                  </div>
                </div>
                <div className="set-row-control">
                  <button
                    type="button"
                    className="set-btn"
                    onClick={after(onRename)}
                  >
                    Rename…
                  </button>
                </div>
              </div>
              <div className="set-row">
                <div className="set-row-label">
                  <div className="set-row-title">Delete translation</div>
                  <div className="set-row-desc">
                    Удалить перевод и все его файлы и строки. Действие
                    необратимо.
                  </div>
                </div>
                <div className="set-row-control">
                  <button
                    type="button"
                    className="set-btn is-danger"
                    onClick={after(onDelete)}
                  >
                    Delete…
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
