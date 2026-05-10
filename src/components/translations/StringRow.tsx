import { memo, useEffect, useRef, useState } from "react";
import type { Role } from "../../lib/roles";
import type {
  StringStatus,
  TranslationString,
} from "../../state/translations";

interface Props {
  row: TranslationString;
  fileTargetLang: string;
  role: Role;
  /** Translator's assigned language; null for non-translators. */
  myTargetLanguage: string | null;
  isFocused: boolean;
  onUpdate: (
    id: string,
    patch: { translatedText?: string; status?: StringStatus },
  ) => Promise<void>;
  onFocus: (id: string) => void;
  onAdvance: (id: string) => void;
}

const STATUS_ORDER: Record<StringStatus, StringStatus> = {
  empty: "draft",
  draft: "done",
  done: "empty",
};

const TAG_RE = /(\{[^}]+\})/g;

function renderSourceWithTags(text: string) {
  const parts = text.split(TAG_RE);
  return parts.map((p, i) => {
    if (i % 2 === 1) {
      return (
        <span key={i} className="renpy-tag">
          {p}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function StringRowImpl({
  row,
  fileTargetLang,
  role,
  myTargetLanguage,
  isFocused,
  onUpdate,
  onFocus,
  onAdvance,
}: Props) {
  const [draft, setDraft] = useState(row.translatedText);
  const debounceRef = useRef<number | null>(null);
  const lastSentRef = useRef(row.translatedText);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const translatorLang = myTargetLanguage;

  // Auto-grow textarea after paint. useEffect (not useLayoutEffect) so
  // mounting hundreds of rows on file switch doesn't trigger 800 sync
  // layouts before the first paint.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft]);

  useEffect(() => {
    setDraft(row.translatedText);
    lastSentRef.current = row.translatedText;
  }, [row.translatedText]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const readOnly =
    role === "viewer" ||
    (role === "translator" &&
      translatorLang !== null &&
      translatorLang !== fileTargetLang);

  if (
    role === "translator" &&
    translatorLang !== null &&
    translatorLang !== fileTargetLang
  ) {
    return null;
  }

  const flush = (value: string) => {
    if (value === lastSentRef.current) return;
    lastSentRef.current = value;
    void onUpdate(row.id, { translatedText: value });
  };

  const onChange = (value: string) => {
    setDraft(value);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => flush(value), 600);
  };

  const onBlur = () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    flush(draft);
  };

  const cycleStatus = () => {
    if (readOnly) return;
    void onUpdate(row.id, { status: STATUS_ORDER[row.status] });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !readOnly) {
      e.preventDefault();
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      flush(draft);
      if (row.status !== "done") {
        void onUpdate(row.id, { status: "done" });
      }
      onAdvance(row.id);
    }
  };

  const statusLabel =
    row.status === "done"
      ? "Done"
      : row.status === "draft"
        ? "Draft"
        : "Empty";

  return (
    <div
      className={
        "tr-card is-" + row.status + (isFocused ? " is-focused" : "")
      }
    >
      <div className="tr-card-head">
        <span
          className="tr-card-loc"
          title={`${row.sourcePath}:${row.sourceLine}`}
        >
          {row.sourcePath}
          <span className="tr-loc-line">:{row.sourceLine}</span>
        </span>
        {row.speaker && (
          <span className="tr-card-speaker" title="Speaker">
            {row.speaker}
          </span>
        )}
        {row.trailing && (
          <span
            className="tr-card-trailing"
            title="Trailing Ren'Py modifier — preserved automatically on export"
          >
            {row.trailing}
          </span>
        )}
        <span className="tr-card-spacer" />
        <button
          type="button"
          className={"tr-card-status-pill is-" + row.status}
          onClick={cycleStatus}
          disabled={readOnly}
          title={`Status: ${statusLabel} — click to cycle`}
        >
          <span className="pill-dot" />
          {statusLabel}
        </button>
      </div>

      <div className="tr-card-source">{renderSourceWithTags(row.sourceText)}</div>

      <div className="tr-card-target">
        <textarea
          ref={taRef}
          className="tr-textarea"
          data-row-id={row.id}
          value={draft}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onFocus={() => onFocus(row.id)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={readOnly ? "" : "Type translation…"}
        />
        {!readOnly && isFocused && (
          <div className="tr-card-hint">
            <span>
              <kbd>Ctrl</kbd> + <kbd>Enter</kbd> mark done & jump to next
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export const StringRow = memo(StringRowImpl);
