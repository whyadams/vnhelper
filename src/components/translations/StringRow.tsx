import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Role } from "../../lib/roles";
import { useKanban } from "../../state/kanbanStore";
import type {
  StringStatus,
  TranslationString,
} from "../../state/translations";

interface Props {
  row: TranslationString;
  fileTargetLang: string;
  role: Role;
  isFocused: boolean;
  onUpdate: (patch: { translatedText?: string; status?: StringStatus }) => Promise<void>;
  onFocus: () => void;
  onAdvance: () => void;
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

export function StringRow({
  row,
  fileTargetLang,
  role,
  isFocused,
  onUpdate,
  onFocus,
  onAdvance,
}: Props) {
  const { state } = useKanban();
  const [draft, setDraft] = useState(row.translatedText);
  const debounceRef = useRef<number | null>(null);
  const lastSentRef = useRef(row.translatedText);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const translatorLang = state.myTargetLanguage;

  // Auto-grow textarea to fit its content. Runs synchronously after every
  // DOM mutation so the height never lags a frame behind the typed text.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    // +2 absorbs sub-pixel rounding so the last line never gets cut off.
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
    void onUpdate({ translatedText: value });
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
    void onUpdate({ status: STATUS_ORDER[row.status] });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter — flush, mark done, jump to next.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !readOnly) {
      e.preventDefault();
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      flush(draft);
      if (row.status !== "done") {
        void onUpdate({ status: "done" });
      }
      onAdvance();
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
          onFocus={onFocus}
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
