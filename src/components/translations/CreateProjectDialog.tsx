import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  // name (= target language) and sourceLang
  onCreate: (name: string, sourceLang: string) => Promise<void> | void;
}

const COMMON_LANGS = [
  "russian",
  "english",
  "spanish",
  "french",
  "german",
  "japanese",
  "korean",
  "chinese",
];

export function CreateProjectDialog({ open, onClose, onCreate }: Props) {
  const [targetLang, setTargetLang] = useState("");
  const [sourceLang, setSourceLang] = useState("english");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetLang("");
    setSourceLang("english");
    setBusy(false);
    setErr(null);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const tl = targetLang.trim();
    const sl = sourceLang.trim() || "english";
    if (!tl || busy) return;
    if (tl.toLowerCase() === sl.toLowerCase()) {
      setErr("Target language must differ from the source language.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // name = target language → it shows up as the row title in the sidebar.
      await onCreate(tl, sl);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <div
        className="vn-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <h3>New translation</h3>
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
          <label className="vn-modal-label">Target language</label>
          <input
            className="vn-input"
            autoFocus
            list="tr-lang-options"
            placeholder="e.g. russian"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onClose();
            }}
          />
          <datalist id="tr-lang-options">
            {COMMON_LANGS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>

          <label className="vn-modal-label">Source language</label>
          <input
            className="vn-input"
            list="tr-lang-options"
            placeholder="english"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
          />
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
            disabled={!targetLang.trim() || busy}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
