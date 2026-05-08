import { useEffect, useMemo, useState } from "react";
import type { ScriptCharacter, ScriptContent } from "../../state/scripts";
import { parseScriptText } from "./scriptImport";

interface BlockSummary {
  type: string;
  speaker?: string;
  text: string;
}

interface Props {
  open: boolean;
  characters: ScriptCharacter[];
  onClose: () => void;
  onImport: (content: ScriptContent, mode: "replace" | "append") => void;
}

function summarizeContent(content: ScriptContent): BlockSummary[] {
  const c = content as unknown as { content?: Array<{ type: string; attrs?: { speaker?: unknown }; content?: Array<{ text?: string }> }> };
  return (c.content ?? []).map((b) => {
    const text = (b.content ?? [])
      .map((t) => (typeof t.text === "string" ? t.text : ""))
      .join("");
    const speaker = typeof b.attrs?.speaker === "string" ? b.attrs.speaker : "";
    return { type: b.type, speaker, text };
  });
}

export function ScriptImportModal({ open, characters, onClose, onImport }: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("append");

  useEffect(() => {
    if (open) {
      setText("");
      setMode("append");
    }
  }, [open]);

  const parsed = useMemo<ScriptContent | null>(() => {
    if (!text.trim()) return null;
    return parseScriptText(text, characters);
  }, [text, characters]);

  const preview = useMemo<BlockSummary[]>(() => {
    if (!parsed) return [];
    return summarizeContent(parsed);
  }, [parsed]);

  if (!open) return null;

  const counts = preview.reduce<Record<string, number>>((acc, b) => {
    acc[b.type] = (acc[b.type] ?? 0) + 1;
    return acc;
  }, {});

  const submit = () => {
    if (!parsed) return;
    onImport(parsed, mode);
    onClose();
  };

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <div
        className="vn-modal vn-modal-import"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <h3>Import script text</h3>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="vn-modal-body vn-modal-import-body">
          <div className="vn-import-grid">
            <div className="vn-import-col">
              <label className="vn-modal-label">Plain text</label>
              <textarea
                className="vn-input vn-import-textarea"
                placeholder={
                  "Paste your script. Recognized patterns:\n\n" +
                  "Plain text:\n" +
                  '  СЦЕНА 1: «Сообщение»  →  scene heading\n' +
                  '  ЛОКАЦИЯ:              →  scene heading\n' +
                  '  ТАЙЛЕР:               →  dialogue (next line = text)\n' +
                  '  Everything else       →  direction (action)\n\n' +
                  "Ren'Py:\n" +
                  '  scene hc12 with dissolve  →  scene heading\n' +
                  '  mc "Текст"                →  dialogue (mc)\n' +
                  '  mc happy "Текст"          →  dialogue with emotion\n' +
                  '  "Голос за кадром"         →  direction'
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              <div className="vn-import-stats">
                {parsed ? (
                  <>
                    <span>{preview.length} blocks</span>
                    {counts.sceneHeading ? (
                      <span>· {counts.sceneHeading} headings</span>
                    ) : null}
                    {counts.dialogue ? (
                      <span>· {counts.dialogue} lines</span>
                    ) : null}
                    {counts.direction ? (
                      <span>· {counts.direction} actions</span>
                    ) : null}
                  </>
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
            <div className="vn-import-col">
              <label className="vn-modal-label">Preview</label>
              <div className="vn-import-preview">
                {preview.length === 0 ? (
                  <div className="vn-import-preview-empty">
                    Parsed blocks will appear here…
                  </div>
                ) : (
                  preview.map((b, i) => (
                    <div
                      key={i}
                      className={"vn-import-prow vn-import-prow-" + b.type}
                    >
                      <span className="vn-import-prow-kind">
                        {b.type === "sceneHeading"
                          ? "H"
                          : b.type === "dialogue"
                            ? "S"
                            : "A"}
                      </span>
                      {b.speaker && (
                        <span className="vn-import-prow-speaker">
                          {b.speaker}
                        </span>
                      )}
                      <span className="vn-import-prow-text">{b.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="vn-modal-foot">
          <div
            className="vn-view-toggle"
            role="radiogroup"
            aria-label="Import mode"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === "append"}
              className={
                "vn-view-toggle-btn" + (mode === "append" ? " is-active" : "")
              }
              onClick={() => setMode("append")}
              title="Add to the end of the scene"
            >
              Append
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "replace"}
              className={
                "vn-view-toggle-btn" + (mode === "replace" ? " is-active" : "")
              }
              onClick={() => setMode("replace")}
              title="Replace scene contents"
            >
              Replace
            </button>
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="hbtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={submit}
            disabled={!parsed || preview.length === 0}
          >
            Import {preview.length > 0 ? `(${preview.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
