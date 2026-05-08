import { useEffect, useRef, useState } from "react";
import type { ScriptProject } from "../../state/scripts";
import { useDialog } from "../ui/Dialog";

const SUGGESTED_EMOJI = ["📖", "🎬", "🌸", "🌙", "⚔️", "🎭", "💌", "🎮", "✨", "🌃"];

interface Props {
  open: boolean;
  project: ScriptProject | null;
  onClose: () => void;
  onSave: (patch: { title: string; cover_emoji: string | null }) => void;
  onUploadCover: (file: File) => Promise<string | null>;
  onRemoveCover: () => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}

export function EditProjectModal({
  open,
  project,
  onClose,
  onSave,
  onUploadCover,
  onRemoveCover,
  onDelete,
}: Props) {
  const dialog = useDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("📖");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    setTitle(project.title);
    setEmoji(project.cover_emoji || "📖");
    setCoverUrl(project.cover_image_url);
    setErr(null);
  }, [open, project]);

  if (!open || !project) return null;

  const submit = () => {
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    onSave({
      title: title.trim(),
      cover_emoji: emoji.trim() || null,
    });
    onClose();
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same filename
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("File must be an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr("Image must be under 5MB");
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const url = await onUploadCover(file);
      if (url) setCoverUrl(url);
      else setErr("Upload failed");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveCover = async () => {
    setCoverUrl(null);
    await onRemoveCover();
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    const ok = await dialog.confirm({
      title: "Delete project",
      message: `Delete "${project.title}" and all its scenes? This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await onDelete();
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
          <h3>Edit project</h3>
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
          <label className="vn-modal-label">Cover image</label>
          <div className="vn-cover-row">
            <button
              type="button"
              className="vn-cover-preview"
              onClick={pickFile}
              disabled={uploading}
              title={coverUrl ? "Replace image" : "Upload image"}
            >
              {coverUrl ? (
                <img src={coverUrl} alt="cover" />
              ) : (
                <span className="vn-cover-emoji-fallback">{emoji}</span>
              )}
              {uploading && <span className="vn-cover-overlay">…</span>}
            </button>
            <div className="vn-cover-actions">
              <button
                type="button"
                className="hbtn"
                onClick={pickFile}
                disabled={uploading}
              >
                {coverUrl ? "Replace" : "Upload"}
              </button>
              {coverUrl && (
                <button
                  type="button"
                  className="hbtn"
                  onClick={() => void handleRemoveCover()}
                  disabled={uploading}
                >
                  Remove
                </button>
              )}
              <p className="vn-cover-hint">PNG / JPG / WEBP, up to 5MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={(e) => void onFileChange(e)}
            />
          </div>

          <label className="vn-modal-label">Cover emoji (fallback)</label>
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
            placeholder="Working title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onClose();
            }}
          />

          {err && <div className="vn-modal-error">{err}</div>}
        </div>
        <div className="vn-modal-foot">
          {onDelete && (
            <button
              type="button"
              className="hbtn is-danger"
              onClick={() => void handleDelete()}
              style={{ marginRight: "auto" }}
            >
              Delete
            </button>
          )}
          <button type="button" className="hbtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={submit}
            disabled={!title.trim() || uploading}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
