import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, emoji: string) => void;
}

const SUGGESTED_EMOJI = ["📖", "🎬", "🌸", "🌙", "⚔️", "🎭", "💌", "🎮", "✨", "🌃"];

export function CreateProjectModal({ open, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("📖");

  useEffect(() => {
    if (open) {
      setTitle("");
      setEmoji("📖");
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    if (!title.trim()) return;
    onCreate(title.trim(), emoji);
    onClose();
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
          <h3>New script project</h3>
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
          <label className="vn-modal-label">Cover emoji</label>
          <div className="vn-emoji-row">
            {SUGGESTED_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className={"vn-emoji-pick" + (emoji === e ? " is-active" : "")}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
            <input
              className="vn-input vn-emoji-input"
              maxLength={4}
              value={emoji}
              onChange={(ev) => setEmoji(ev.target.value)}
            />
          </div>
          <label className="vn-modal-label">Title</label>
          <input
            className="vn-input"
            autoFocus
            placeholder="Working title for your visual novel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="vn-modal-foot">
          <button type="button" className="hbtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={submit}
            disabled={!title.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
