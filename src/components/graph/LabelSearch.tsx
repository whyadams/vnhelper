import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface SearchItem {
  id: string;
  label: string;
  sceneTitle: string;
  chapter: string | null;
  isEntry: boolean;
  isOrphan: boolean;
  isUnreachable: boolean;
  isEnding: boolean;
  brokenOutboundCount: number;
}

interface Props {
  open: boolean;
  items: SearchItem[];
  /** Same callback used by inspector clickable refs — selects + pans camera. */
  onJumpToLabel: (labelName: string) => void;
  onClose: () => void;
}

/**
 * Cmd/Ctrl-K palette for finding labels by name. On large projects (Time
 * Heals has 36+ labels) hunting visually doesn't scale. Match is
 * case-insensitive substring against the label name and the parent scene
 * title — chapter is shown but not searched (too noisy when most labels
 * share one).
 *
 * Keyboard model mirrors common command palettes:
 *   ↑/↓ move highlight, Enter jumps, Esc closes, tab/click on item also jumps.
 */
export function LabelSearch({ open, items, onJumpToLabel, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset state every time the palette is reopened so the user always starts
  // from a clean prompt — keeps the experience predictable.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // Defer focus a tick so the input is mounted before we focus it.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.sceneTitle.toLowerCase().includes(q),
    );
  }, [items, query]);

  // Clamp highlight when the filtered list shrinks under it.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  // Keep the highlighted row visible during keyboard nav.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(
      `[data-search-row="${highlight}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  if (!open) return null;

  const commit = (idx: number) => {
    const item = filtered[idx];
    if (!item) return;
    onJumpToLabel(item.id);
    onClose();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(highlight);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="graph-search-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="graph-search" onKeyDown={onKey}>
        <div className="graph-search-input-wrap">
          <span className="graph-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="graph-search-input"
            type="text"
            placeholder={`Search ${items.length} labels…`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="graph-search-hint">Esc</span>
        </div>
        <div ref={listRef} className="graph-search-list">
          {filtered.length === 0 ? (
            <div className="graph-search-empty">No labels match.</div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                data-search-row={idx}
                className={
                  "graph-search-row" +
                  (idx === highlight ? " is-highlighted" : "")
                }
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => commit(idx)}
              >
                <span className="graph-search-row-main">
                  <span className="graph-search-label">{item.label}</span>
                  {item.isEntry && (
                    <span className="graph-search-tag graph-search-tag-entry">
                      START
                    </span>
                  )}
                  {!item.isEntry && item.isOrphan && (
                    <span className="graph-search-tag graph-search-tag-orphan">
                      ORPHAN
                    </span>
                  )}
                  {!item.isEntry && item.isUnreachable && !item.isOrphan && (
                    <span className="graph-search-tag graph-search-tag-unreach">
                      UNREACH
                    </span>
                  )}
                  {!item.isEntry && item.isEnding && (
                    <span className="graph-search-tag graph-search-tag-ending">
                      END
                    </span>
                  )}
                  {item.brokenOutboundCount > 0 && (
                    <span className="graph-search-tag graph-search-tag-broken">
                      ⚠ {item.brokenOutboundCount}
                    </span>
                  )}
                </span>
                <span className="graph-search-row-sub">
                  {item.chapter && <span>{item.chapter} · </span>}
                  <span>{item.sceneTitle}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="graph-search-footer">
          <span>↑↓ navigate</span>
          <span>↵ jump</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
