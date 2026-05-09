import { useEffect, useRef, useState } from "react";
import {
  detectRenpyLanguage,
  parseRenpyTranslations,
} from "../../lib/renpy";

interface Props {
  open: boolean;
  onClose: () => void;
  // The active translation's target language — applied to the imported file.
  defaultTargetLang: string;
  onImport: (
    filename: string,
    content: string,
    targetLang: string,
  ) => Promise<{ inserted: number; warnings: number } | null>;
}

interface Preview {
  filename: string;
  content: string;
  count: number;
  warnings: number;
  detectedLang: string | null;
}

export function ImportRpyDialog({
  open,
  onClose,
  defaultTargetLang,
  onImport,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setBusy(false);
    setErr(null);
  }, [open]);

  if (!open) return null;

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    try {
      const content = await file.text();
      const parsed = parseRenpyTranslations(content);
      const lang = detectRenpyLanguage(content);
      setPreview({
        filename: file.name,
        content,
        count: parsed.strings.length,
        warnings: parsed.warnings.length,
        detectedLang: lang,
      });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    }
  };

  const submit = async () => {
    if (!preview || !defaultTargetLang || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onImport(preview.filename, preview.content, defaultTargetLang);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const langMismatch =
    preview?.detectedLang &&
    preview.detectedLang.toLowerCase() !== defaultTargetLang.toLowerCase();

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <div
        className="vn-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <h3>Import .rpy file</h3>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="vn-modal-body">
          <label className="vn-modal-label">File</label>
          <div className="tr-dlg-file-row">
            <button
              type="button"
              className="hbtn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              {preview ? "Choose another…" : "Choose .rpy file…"}
            </button>
            {preview && (
              <span className="tr-file-name" title={preview.filename}>
                {preview.filename}
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".rpy,text/plain"
              style={{ display: "none" }}
              onChange={(e) => void onFileChange(e)}
            />
          </div>

          {preview && (
            <p className="tr-import-preview">
              {preview.count} strings · {preview.warnings} warnings · imports
              into <strong>{defaultTargetLang}</strong>
              {preview.detectedLang && (
                <>
                  {" "}
                  · file says <strong>{preview.detectedLang}</strong>
                </>
              )}
            </p>
          )}
          {langMismatch && (
            <div className="vn-modal-error">
              The file's language ({preview!.detectedLang}) doesn't match this
              translation ({defaultTargetLang}). The file will still be imported
              under {defaultTargetLang}.
            </div>
          )}

          {err && <div className="vn-modal-error">{err}</div>}
        </div>
        <div className="vn-modal-foot">
          <button type="button" className="hbtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={() => void submit()}
            disabled={!preview || busy}
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
