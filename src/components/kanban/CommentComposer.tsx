import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { WorkspaceMemberInfo } from "../../state/cardDetail";
import { CommentIcon } from "./Icon";

interface Props {
  members: WorkspaceMemberInfo[];
  myInitials: string;
  onSubmit: (body: string, mentionedUserIds: string[]) => void | Promise<void>;
}

function displayName(m: WorkspaceMemberInfo): string {
  return m.name ?? m.email ?? "Unknown";
}

/** Render a comment body with @mentions highlighted as a styled span. */
export function renderCommentBody(
  body: string,
  members: WorkspaceMemberInfo[],
): React.ReactNode {
  if (!body) return null;
  // Build a regex that matches any of the member display names preceded by @
  const names = members
    .map((m) => displayName(m))
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length); // longest first to avoid partial matches
  if (names.length === 0) {
    return <>{body}</>;
  }
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${escaped.join("|")})\\b`, "g");

  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastIdx) {
      out.push(body.slice(lastIdx, m.index));
    }
    out.push(
      <span key={m.index} className="cp-mention">
        @{m[1]}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < body.length) out.push(body.slice(lastIdx));
  return <>{out}</>;
}

export function CommentComposer({ members, myInitials, onSubmit }: Props) {
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Map<string, string>>(new Map());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Find @ trigger relative to caret
  const detectMention = (text: string, caret: number) => {
    // Walk backward from caret looking for an @, stop if whitespace
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        const before = i === 0 ? " " : text[i - 1];
        if (/\s/.test(before) || i === 0) {
          return { start: i, query: text.slice(i + 1, caret) };
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setBody(next);
    const caret = e.target.selectionStart;
    const m = detectMention(next, caret);
    if (m) {
      setPickerOpen(true);
      setPickerQuery(m.query);
      setPickerIndex(0);
    } else {
      setPickerOpen(false);
    }
  };

  const onSelectionChange = () => {
    if (!textareaRef.current) return;
    const caret = textareaRef.current.selectionStart;
    const m = detectMention(body, caret);
    if (m) {
      setPickerOpen(true);
      setPickerQuery(m.query);
    } else {
      setPickerOpen(false);
    }
  };

  const filtered = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return members
      .filter((m) => {
        const hay =
          (m.name ?? "").toLowerCase() + " " + (m.email ?? "").toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 6);
  }, [members, pickerQuery]);

  useEffect(() => {
    if (pickerIndex >= filtered.length) setPickerIndex(0);
  }, [filtered.length, pickerIndex]);

  const insertMention = (m: WorkspaceMemberInfo) => {
    if (!textareaRef.current) return;
    const caret = textareaRef.current.selectionStart;
    const dm = detectMention(body, caret);
    if (!dm) return;
    const name = displayName(m);
    const before = body.slice(0, dm.start);
    const after = body.slice(caret);
    const insertion = `@${name} `;
    const next = before + insertion + after;
    setBody(next);
    setMentions((map) => {
      const m2 = new Map(map);
      m2.set(name, m.user_id);
      return m2;
    });
    setPickerOpen(false);
    // Restore caret right after the inserted token
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const pos = before.length + insertion.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    // Only include user_ids whose @name token actually still appears
    const ids: string[] = [];
    for (const [name, userId] of mentions) {
      if (trimmed.includes(`@${name}`)) ids.push(userId);
    }
    await onSubmit(trimmed, ids);
    setBody("");
    setMentions(new Map());
    setPickerOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filtered[pickerIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="cp-comment-form">
      <span className="av cp-comment-av">{myInitials}</span>
      <div className="cp-composer-wrap">
        <textarea
          ref={textareaRef}
          className="cp-textarea cp-comment-input"
          placeholder="Write a comment… Type @ to mention. ⌘+Enter to send."
          value={body}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onKeyUp={onSelectionChange}
          onClick={onSelectionChange}
          rows={2}
        />
        {pickerOpen && filtered.length > 0 && (
          <div className="cp-mention-pop">
            {filtered.map((m, idx) => (
              <button
                key={m.user_id}
                type="button"
                className={
                  "cp-mention-item" + (idx === pickerIndex ? " is-active" : "")
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(m);
                }}
                onMouseEnter={() => setPickerIndex(idx)}
              >
                <span className="av">
                  {(m.name ?? m.email ?? "?")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="cp-mention-meta">
                  <span className="cp-mention-name">
                    {m.name ?? m.email ?? "Unknown"}
                  </span>
                  {m.name && m.email && (
                    <span className="cp-mention-email">{m.email}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="pill-btn cp-send"
        type="button"
        onClick={() => void send()}
        disabled={!body.trim()}
      >
        <CommentIcon className="ico" />
        Send
      </button>
    </div>
  );
}
